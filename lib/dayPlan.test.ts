import { describe, expect, it } from "vitest";
import { buildDayPlan, buildEstimator, workingIntervals, type DayPlanInput } from "./dayPlan";
import type { DailyTask, MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

const TODAY = "2026-09-29";
const at = (hm: string, date = TODAY) => new Date(`${date}T${hm}:00`).getTime();
const MIN = 60;

function input(overrides: Partial<DayPlanInput> = {}): DayPlanInput {
  return {
    now: at("09:00"),
    today: TODAY,
    workStart: "09:00",
    workEnd: "18:00",
    breaks: [{ start: "12:00", end: "13:00" }],
    dailyTasks: [],
    projects: [],
    todoTasks: [],
    masterTasks: [],
    records: [],
    ...overrides,
  };
}

function master(id: string, category: string, name: string, estimatedSeconds: number): MasterTask {
  return { id, category, name, estimatedSeconds, isFavorite: false, sampleCount: 1, createdAt: 0, updatedAt: 0 };
}

function todo(id: string, overrides: Partial<TodoTask> = {}): TodoTask {
  return { id, listId: "l", title: id, important: false, completed: false, order: 0, createdAt: 0, ...overrides };
}

function project(id: string, overrides: Partial<ProjectItem> = {}): ProjectItem {
  return { id, title: id, category: "開発", workName: "作業", dueDate: TODAY, createdAt: 0, ...overrides };
}

function record(masterTaskId: string, seconds: number, method: string | undefined, endedAt: number): WorkRecord {
  return {
    id: `${masterTaskId}-${endedAt}`,
    date: TODAY,
    category: "c",
    name: "n",
    masterTaskId,
    seconds,
    startedAt: endedAt - seconds * 1000,
    endedAt,
    excludedFromStats: false,
    method,
  };
}

describe("workingIntervals", () => {
  it("始業〜終業から休憩を除く", () => {
    const ivs = workingIntervals(TODAY, "09:00", "18:00", [{ start: "12:00", end: "13:00" }]);
    expect(ivs).toEqual([
      { start: at("09:00"), end: at("12:00") },
      { start: at("13:00"), end: at("18:00") },
    ]);
  });
});

describe("buildEstimator", () => {
  it("直近に使った手段で2件以上の実績があれば、その手段の平均で見積もる", () => {
    const m = master("m1", "業務", "見積作成", 3000);
    const records = [
      record("m1", 3600, "Excel", 1),
      record("m1", 3600, "Excel", 2),
      record("m1", 600, "Claude", 3),
      record("m1", 900, "Claude", 4),
    ];
    const e = buildEstimator([m], records).forMaster("業務", "見積作成");
    expect(e?.seconds).toBe(750);
    expect(e?.source).toContain("Claude");
  });

  it("直近の手段の実績が1件だけなら、マスタ全体の平均を使う", () => {
    const m = master("m1", "業務", "見積作成", 3000);
    const e = buildEstimator([m], [record("m1", 600, "Claude", 3)]).forMaster("業務", "見積作成");
    expect(e?.seconds).toBe(3000);
  });
});

describe("buildDayPlan", () => {
  it("期日が近い順に並べ、休憩をまたいで時刻を割り当てる", () => {
    const plan = buildDayPlan(
      input({
        now: at("11:00"),
        todoTasks: [todo("tomorrow", { dueDate: "2026-09-30" }), todo("today", { dueDate: TODAY })],
        masterTasks: [master("a", "ToDo", "today", 90 * MIN), master("b", "ToDo", "tomorrow", 30 * MIN)],
      })
    );
    expect(plan.scheduled.map((s) => s.title)).toEqual(["today", "tomorrow"]);
    // 11:00から90分 → 12:00〜13:00の休憩をまたいで13:30まで
    expect(plan.scheduled[0].startMs).toBe(at("11:00"));
    expect(plan.scheduled[0].endMs).toBe(at("13:30"));
    expect(plan.scheduled[1].startMs).toBe(at("13:30"));
  });

  it("同じ期日なら重要なもの→短いものの順", () => {
    const plan = buildDayPlan(
      input({
        todoTasks: [todo("long", { dueDate: TODAY }), todo("short", { dueDate: TODAY }), todo("imp", { dueDate: TODAY, important: true })],
        masterTasks: [master("a", "ToDo", "long", 60 * MIN), master("b", "ToDo", "short", 10 * MIN), master("c", "ToDo", "imp", 60 * MIN)],
      })
    );
    expect(plan.scheduled.map((s) => s.title)).toEqual(["imp", "short", "long"]);
  });

  it("本日の作業に並んでいる未着手の作業は、並べた順を保ちつつ計画に含める", () => {
    const daily = (id: string, order: number): DailyTask => ({
      id,
      date: TODAY,
      order,
      category: "業務",
      name: id,
      estimatedSeconds: 20 * MIN,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
    });
    const plan = buildDayPlan(input({ dailyTasks: [daily("second", 1), daily("first", 0)] }));
    expect(plan.scheduled.map((s) => s.title)).toEqual(["first", "second"]);
  });

  it("本日の作業に入っているToDo・段階は、案件・ToDo側から重ねて出さない", () => {
    const plan = buildDayPlan(
      input({
        todoTasks: [todo("t1", { dueDate: TODAY })],
        projects: [project("p1", { stages: [{ id: "s1", title: "設計", completed: false }] })],
        dailyTasks: [
          { id: "d1", date: TODAY, order: 0, category: "x", name: "x", estimatedSeconds: 0, status: "pending", segments: [], accumulatedMs: 0, isSpontaneous: true, todoTaskId: "t1" },
          { id: "d2", date: TODAY, order: 1, category: "x", name: "y", estimatedSeconds: 0, status: "pending", segments: [], accumulatedMs: 0, isSpontaneous: true, projectId: "p1", stageId: "s1" },
        ],
      })
    );
    expect(plan.scheduled.map((s) => s.kind)).toEqual(["daily", "daily"]);
  });

  it("期日のない段階は、案件ごとに次の1段階だけを候補にする", () => {
    const stages = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, title: `段階${i}`, completed: i < 3 }));
    const plan = buildDayPlan(input({ projects: [project("p1", { stages })] }));
    expect(plan.scheduled.map((s) => s.title)).toEqual(["段階3"]);
  });

  it("期日に余裕があり今日に収まらないものは明日以降へ、今日期限のものは入るところまで着手する", () => {
    const plan = buildDayPlan(
      input({
        now: at("17:00"),
        todoTasks: [todo("due-today", { dueDate: TODAY }), todo("later", { dueDate: "2026-10-01" })],
        masterTasks: [master("a", "ToDo", "due-today", 120 * MIN), master("b", "ToDo", "later", 120 * MIN)],
      })
    );
    expect(plan.scheduled.map((s) => [s.title, s.partial])).toEqual([["due-today", true]]);
    expect(plan.overflow.map((c) => c.title)).toEqual(["later"]);
  });

  it("計測中の作業の残り見積もり分を先に確保する", () => {
    const running: DailyTask = {
      id: "r",
      date: TODAY,
      order: 0,
      category: "業務",
      name: "計測中",
      estimatedSeconds: 60 * MIN,
      status: "running",
      segments: [{ start: at("09:00") }],
      accumulatedMs: 0,
      isSpontaneous: true,
    };
    const plan = buildDayPlan(
      input({
        now: at("09:20"),
        dailyTasks: [running],
        todoTasks: [todo("next", { dueDate: TODAY })],
        masterTasks: [master("a", "ToDo", "next", 10 * MIN)],
      })
    );
    expect(plan.runningRemainingSeconds).toBe(40 * MIN);
    expect(plan.scheduled[0].startMs).toBe(at("10:00"));
  });

  it("数日先まで見ても期日までに収まらないものを「間に合わない見込み」にする", () => {
    // 1日の稼働は8時間。明日期限で合計20時間分あれば、今日(8h)+明日(8h)に収まらない
    const plan = buildDayPlan(
      input({
        todoTasks: [todo("a", { dueDate: "2026-09-30" }), todo("b", { dueDate: "2026-09-30" })],
        masterTasks: [master("a", "ToDo", "a", 10 * 3600), master("b", "ToDo", "b", 10 * 3600)],
      })
    );
    expect(plan.atRisk.map((r) => r.candidate.title)).toEqual(["b"]);
    expect(plan.atRisk[0].shortfallSeconds).toBe(4 * 3600);
  });

  it("終業後は計画できる時間がない", () => {
    const plan = buildDayPlan(input({ now: at("19:00"), todoTasks: [todo("a", { dueDate: TODAY })] }));
    expect(plan.remainingSeconds).toBe(0);
    expect(plan.scheduled).toHaveLength(0);
    expect(plan.overflow).toHaveLength(1);
  });
});
