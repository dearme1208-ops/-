import { describe, expect, it } from "vitest";
import {
  activityTrail, causeLinks, diaryAlbum, findOverruns, injuryRisk, monthHomework, mountainPlan, overdueTodos, seasonRecord, yearCard,
} from "@/lib/modeExtras";
import type { DailyTask, MasterTask, ProjectItem, TodoTask, WorkRecord } from "@/lib/types";

const T = "2026-10-03";
const at = (hm: string, date = T) => new Date(`${date}T${hm}:00`).getTime();
const task = (t: Partial<DailyTask>): DailyTask => ({
  id: "t", date: T, order: 0, category: "業務", name: "作業", estimatedSeconds: 3600, hasPlan: false, status: "pending",
  segments: [], accumulatedMs: 0, isSpontaneous: false, ...t,
} as DailyTask);
const rec = (id: string, date: string, hours: number, extra: Partial<WorkRecord> = {}): WorkRecord => ({
  id, date, category: "業務", name: "資料", seconds: hours * 3600, startedAt: at("09:00", date), endedAt: 0, excludedFromStats: false, ...extra,
});
const todo = (t: Partial<TodoTask>): TodoTask => ({ id: "x", listId: "l", title: "t", important: false, completed: false, order: 0, createdAt: 0, ...t });

describe("登山", () => {
  it("日没までに下りられなければ、後ろの未着手から明日へ回す候補にする", () => {
    const tasks = [
      task({ id: "a", order: 0, status: "running", segments: [{ start: at("15:00") }] }),
      task({ id: "b", order: 1 }),
      task({ id: "c", order: 2 }),
    ];
    const p = mountainPlan(tasks, at("16:00"), at("18:00"));
    expect(p.remainingMs).toBe(2 * 3600_000);
    expect(p.turnBack).toEqual([]);
    const late = mountainPlan(tasks, at("17:00"), at("18:00"));
    expect(late.turnBack.map((t) => t.id)).toEqual(["c"]);
    expect(mountainPlan(tasks, at("17:30"), at("18:00")).turnBack.map((t) => t.id)).toEqual(["c", "b"]);
  });
  it("活動日記は計測区間を時刻順に", () => {
    const trail = activityTrail([task({ id: "a", segments: [{ start: at("10:00"), end: at("11:00") }] }), task({ id: "b", name: "会議", segments: [{ start: at("09:00"), end: at("09:30") }] })], at("12:00"));
    expect(trail.map((s) => s.label)).toEqual(["業務 / 会議", "業務 / 作業"]);
  });
});

describe("パワプロ", () => {
  it("9時間以上の日が続くとケガの危険が上がる", () => {
    const r = [rec("1", "2026-10-02", 10), rec("2", "2026-10-01", 9.5), rec("3", "2026-09-30", 11)];
    expect(injuryRisk(r, T)).toMatchObject({ level: 2, streak: 3 });
    expect(injuryRisk([rec("1", "2026-10-02", 10)], T)).toMatchObject({ level: 0, streak: 1 });
  });
  it("期日までに終えたら勝ち、過ぎたら負け、今日が期日なら本日の試合", () => {
    const projects = [{ id: "p", title: "A", dueDate: "2026-10-01", completedAt: at("10:00", "2026-09-30") } as ProjectItem];
    const todos = [todo({ id: "1", title: "B", dueDate: "2026-10-02" }), todo({ id: "2", title: "C", dueDate: T })];
    expect(seasonRecord(projects, todos, T)).toEqual({ wins: 1, losses: 1, todaysGames: ["C"] });
  });
});

describe("流行り神", () => {
  it("想定より2割以上長い実績と、原因の集計", () => {
    const masters = [{ id: "m", estimatedSeconds: 3600 } as MasterTask];
    const r = [rec("a", T, 1.5, { masterTaskId: "m" }), rec("b", T, 1.1, { masterTaskId: "m" })];
    expect(findOverruns(r, masters, T).map((o) => [o.record.id, o.overMin])).toEqual([["a", 30]]);
    expect(causeLinks({ a: "割り込み" }, r)).toEqual([{ cause: "割り込み", count: 1, works: [{ label: "業務 / 資料", count: 1 }] }]);
  });
});

describe("期限切れ・宿題・アルバム・蔵書票", () => {
  it("期限を過ぎたToDoを古い順に", () => {
    const o = overdueTodos([todo({ id: "1", dueDate: "2026-09-30" }), todo({ id: "2", dueDate: "2026-10-02" }), todo({ id: "3", dueDate: T })], T);
    expect(o.map((x) => [x.todo.id, x.daysOver])).toEqual([["1", 3], ["2", 1]]);
  });
  it("今月が期限のToDoを宿題に", () => {
    const h = monthHomework([todo({ id: "1", dueDate: "2026-10-20" }), todo({ id: "2", dueDate: "2026-10-05", completed: true }), todo({ id: "3", dueDate: "2026-11-01" })], T);
    expect(h).toMatchObject({ monthEnd: "2026-10-31", daysLeft: 28 });
    expect(h.open.map((t) => t.id)).toEqual(["1"]);
    expect(h.done.map((t) => t.id)).toEqual(["2"]);
  });
  it("アルバムはその日いちばん時間を使った作業", () => {
    const a = diaryAlbum([rec("1", T, 1, { name: "掃除" }), rec("2", T, 2, { name: "料理" })], T, 3);
    expect(a[2]).toEqual({ date: T, hours: 3, top: "料理" });
    expect(a[0].hours).toBe(0);
  });
  it("蔵書票は直近12か月", () => {
    const y = yearCard([rec("1", T, 2, { masterTaskId: "a" }), rec("2", "2025-11-03", 1, { masterTaskId: "b" }), rec("3", "2025-09-01", 5)], T);
    expect(y.months[11]).toEqual({ ym: "2026-10", hours: 2 });
    expect(y.months[0]).toEqual({ ym: "2025-11", hours: 1 });
    expect(y.titles).toBe(2);
  });
});
