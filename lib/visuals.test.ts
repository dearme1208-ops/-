import { describe, expect, it } from "vitest";
import { categorySlots, conditionHeatmap, dayRingSegments, dueTerrain, durationRanges, hourglass, nextScheduled, projectClimbs, waitingSand, weekStacks } from "./visuals";
import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";

const D = "2026-10-07"; // 水曜
const at = (hm: string, d = D) => new Date(`${d}T${hm}:00`).getTime();
const MIN = 60_000;
const task = (o: Partial<DailyTask>): DailyTask =>
  ({ id: "t", date: D, order: 0, category: "業務", name: "x", estimatedSeconds: 0, status: "done", segments: [], accumulatedMs: 0, isSpontaneous: true, ...o }) as DailyTask;

describe("可視化の材料", () => {
  it("区分の色は時間の多い順に1〜4、残りはその他", () => {
    const m = categorySlots([
      { category: "a", ms: 1 }, { category: "b", ms: 9 }, { category: "c", ms: 5 }, { category: "d", ms: 3 }, { category: "e", ms: 2 }, { category: "b", ms: 1 },
    ]);
    expect([m.get("b"), m.get("c"), m.get("d"), m.get("e"), m.get("a")]).toEqual([1, 2, 3, 4, 0]);
  });

  it("今日のリング: 仮計測を除き、計測中は今まで", () => {
    const segs = dayRingSegments(
      [task({ segments: [{ start: at("09:00"), end: at("10:00") }] }), task({ status: "running", segments: [{ start: at("10:30") }] }), task({ isProvisional: true, segments: [{ start: at("10:00"), end: at("10:30") }] })],
      at("11:00")
    );
    expect(segs.map((s) => [s.start, s.end, s.running])).toEqual([[at("09:00"), at("10:00"), false], [at("10:30"), at("11:00"), true]]);
  });

  it("砂時計: 終業までの残りと、終わっていない作業の残りの見込み", () => {
    const tasks = [task({ id: "a", status: "running" }), task({ id: "b", status: "pending" }), task({ id: "c", status: "pending" }), task({ id: "d" })];
    const h = hourglass(tasks, new Map([["a", 3600], ["b", 1800], ["d", 999]]), (t) => (t.id === "a" ? 20 * MIN : 0), at("16:00"), at("18:00"));
    expect(h).toEqual({ leftMs: 120 * MIN, needMs: 40 * MIN + 30 * MIN, unknownCount: 1 });
  });

  it("次の予定: 今より後で一番近い未着手の予定", () => {
    const n = nextScheduled([task({ id: "a", status: "pending", scheduledTime: "09:00" }), task({ id: "b", status: "pending", scheduledTime: "15:00" }), task({ id: "c", status: "pending", scheduledTime: "14:00" })], D, at("10:00"));
    expect(n?.task.id).toBe("c");
  });

  it("いつもの幅: 3回以上やった作業だけ、短い時・真ん中・長い時", () => {
    const done = [10, 20, 30, 40, 50].map((m, i) => task({ id: "x" + i, masterTaskId: "m1", accumulatedMs: m * MIN }));
    const r = durationRanges([...done, task({ masterTaskId: "m2", accumulatedMs: 10 * MIN })]);
    expect(r.get("m1")).toEqual({ low: 14 * MIN, mid: 30 * MIN, high: 46 * MIN, count: 5 });
    expect(r.has("m2")).toBe(false);
  });

  it("1週間の積み木: 直近7日の日ごと・区分ごと", () => {
    const rec = (date: string, category: string, seconds: number): WorkRecord => ({ id: date + category, date, category, name: "x", masterTaskId: "m", seconds, startedAt: 0, endedAt: 0, excludedFromStats: false });
    const w = weekStacks([rec("2026-10-07", "業務", 3600), rec("2026-10-07", "家事", 1800), rec("2026-10-01", "業務", 60), rec("2026-09-30", "業務", 9999)], D);
    expect(w).toHaveLength(7);
    expect(w[0].date).toBe("2026-10-01");
    expect(w[6]).toEqual({ date: D, parts: [{ category: "業務", ms: 3600_000 }, { category: "家事", ms: 1800_000 }], totalMs: 5400_000 });
  });

  it("案件の山登り: 時間の進みに対して段階が遅れていれば遅れの印", () => {
    const p = (id: string, done: number, total: number, created: string, due: string): ProjectItem =>
      ({ id, title: id, dueDate: due, createdAt: at("09:00", created), stages: Array.from({ length: total }, (_, i) => ({ id: `${id}${i}`, title: "s", completed: i < done })) }) as ProjectItem;
    const res = projectClimbs([p("遅れ", 0, 4, "2026-10-01", "2026-10-09"), p("順調", 3, 4, "2026-10-01", "2026-10-09")], D);
    expect(res.map((r) => [r.project.id, r.behind])).toEqual([["遅れ", true], ["順調", false]]);
  });

  it("時間帯ごとの調子: 曜日×時間帯で予定どおりに終えた割合", () => {
    const g = conditionHeatmap([
      task({ estimatedSeconds: 1800, accumulatedMs: 30 * MIN, segments: [{ start: at("09:30"), end: at("10:00") }] }),
      task({ estimatedSeconds: 1800, accumulatedMs: 60 * MIN, segments: [{ start: at("10:00"), end: at("11:00") }] }),
    ]);
    expect(g[2][1]).toEqual({ onTime: 0.5, count: 2 }); // 水曜・9時台
    expect(g[0][0]).toBeNull();
  });

  it("期日の山: 今日から14日の日ごとの期日(ToDo・案件・段階)", () => {
    const d = dueTerrain(
      [{ id: "t", listId: "l", title: "請求書", completed: false, important: false, order: 0, createdAt: 0, dueDate: "2026-10-09" }] as TodoTask[],
      [{ id: "p", title: "提案", dueDate: "2026-10-09", createdAt: 0, stages: [{ id: "s", title: "下書き", completed: false, dueDate: "2026-10-08" }] }] as ProjectItem[],
      D
    );
    expect(d).toHaveLength(14);
    expect(d[1].projects).toEqual(["提案／下書き"]);
    expect(d[2]).toMatchObject({ todos: ["請求書"], projects: ["提案"] });
  });
});

describe("waitingSand", () => {
  it("目安まで砂が落ち、目盛りは最長の待ちか目安の1.5倍にそろう", () => {
    const [a, b, c] = waitingSand([0, 3, null], 3);
    expect(a).toEqual({ sandLeft: 1, bar: 0, nudgeAt: 3 / 4.5 });
    expect(b!.sandLeft).toBe(0);
    expect(c).toBeNull();
    const [long] = waitingSand([9], 3);
    expect(long).toEqual({ sandLeft: 0, bar: 1, nudgeAt: 1 / 3 });
  });
});
