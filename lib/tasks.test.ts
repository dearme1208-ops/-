import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { findMergeTargetRecord, finishDailyTask } from "./tasks";
import type { DailyTask, WorkRecord } from "./types";

const DATE = "2026-09-29";
const T0 = new Date(`${DATE}T09:00:00`).getTime();
const MIN = 60_000;

function task(overrides: Partial<DailyTask> = {}): DailyTask {
  return {
    id: overrides.id ?? `t-${Math.random()}`,
    date: DATE,
    order: 0,
    masterTaskId: "m1",
    category: "業務",
    name: "資料作成",
    estimatedSeconds: 0,
    status: "running",
    segments: [{ start: T0 }],
    accumulatedMs: 0,
    startedAt: T0,
    isSpontaneous: true,
    ...overrides,
  };
}

async function finish(t: DailyTask, opts?: Parameters<typeof finishDailyTask>[1]) {
  await db.dailyTasks.put(t);
  await finishDailyTask(t, opts);
  return { daily: (await db.dailyTasks.get(t.id))!, records: await db.records.toArray() };
}

beforeEach(async () => {
  await Promise.all([db.dailyTasks.clear(), db.records.clear(), db.masterTasks.clear()]);
  await db.masterTasks.put({
    id: "m1",
    category: "業務",
    name: "資料作成",
    estimatedSeconds: 0,
    isFavorite: false,
    sampleCount: 0,
    createdAt: 0,
    updatedAt: 0,
  });
});

describe("finishDailyTask", () => {
  it("「時間を加算」分を実績に含め、加算分はクリアする", async () => {
    const { daily, records } = await finish(task({ manualAdjustmentMs: 10 * MIN }), { endAtMs: T0 + 30 * MIN });
    expect(records).toHaveLength(1);
    expect(records[0].seconds).toBe(40 * 60);
    expect(daily.accumulatedMs).toBe(40 * MIN);
    expect(daily.manualAdjustmentMs).toBe(0);
  });

  it("兼務の追加案件タグを実績へ引き継ぐ", async () => {
    const { records } = await finish(task({ projectId: "p1", secondaryProjectIds: ["p2"] }), { endAtMs: T0 + MIN });
    expect(records[0].secondaryProjectIds).toEqual(["p2"]);
  });

  it("一時停止中の作業を後から完了しても、終了時刻は実際に止めた時刻になる", async () => {
    const paused = task({ status: "paused", segments: [{ start: T0, end: T0 + 20 * MIN }] });
    const { daily, records } = await finish(paused);
    expect(daily.endedAt).toBe(T0 + 20 * MIN);
    expect(records[0].endedAt).toBe(T0 + 20 * MIN);
    expect(records[0].seconds).toBe(20 * 60);
  });

  it("終了時刻をさかのぼって指定すると区間・実績はその時刻で閉じ、操作時刻(stoppedAt)は現在のまま", async () => {
    const before = Date.now();
    const { daily, records } = await finish(task(), { endAtMs: T0 + 15 * MIN });
    expect(daily.segments[0].end).toBe(T0 + 15 * MIN);
    expect(daily.endedAt).toBe(T0 + 15 * MIN);
    expect(daily.stoppedAt).toBeGreaterThanOrEqual(before);
    expect(records[0].seconds).toBe(15 * 60);
  });

  it("区間を直接渡した場合(手動で記録)はその長さだけを所要時間にする", async () => {
    const segments = [{ start: T0, end: T0 + 25 * MIN }];
    const { records } = await finish(task({ status: "pending", segments: [], manualAdjustmentMs: 5 * MIN }), {
      segments,
      startedAt: T0,
    });
    expect(records[0].seconds).toBe(25 * 60);
  });

  it("同じ帰属先の2回目は同じ実績へ合算する", async () => {
    await finish(task({ id: "a", projectId: "p1", stageId: "s1" }), { endAtMs: T0 + 10 * MIN });
    const { records } = await finish(
      task({ id: "b", projectId: "p1", stageId: "s1", segments: [{ start: T0 + 60 * MIN }], startedAt: T0 + 60 * MIN }),
      { endAtMs: T0 + 80 * MIN }
    );
    expect(records).toHaveLength(1);
    expect(records[0].seconds).toBe(30 * 60);
    expect(records[0].startedAt).toBe(T0);
    expect(records[0].endedAt).toBe(T0 + 80 * MIN);
  });

  it("ToDoが違えば同じ作業マスタでも別の実績にする", async () => {
    await finish(task({ id: "a", todoTaskId: "todo1" }), { endAtMs: T0 + 10 * MIN });
    const { records } = await finish(task({ id: "b", todoTaskId: "todo2" }), { endAtMs: T0 + 20 * MIN });
    expect(records.map((r) => r.todoTaskId).sort()).toEqual(["todo1", "todo2"]);
  });

  it("手段が違えば別の実績にする(手段別の比較が先の手段へ寄らないように)", async () => {
    await finish(task({ id: "a", method: "Excel" }), { endAtMs: T0 + 10 * MIN });
    const { records } = await finish(task({ id: "b", method: "Claude" }), { endAtMs: T0 + 20 * MIN });
    expect(records.map((r) => r.method).sort()).toEqual(["Claude", "Excel"]);
  });

  it("案件の段階が違えば別の実績にする", async () => {
    await finish(task({ id: "a", projectId: "p1", stageId: "s1" }), { endAtMs: T0 + 10 * MIN });
    const { records } = await finish(task({ id: "b", projectId: "p1", stageId: "s2" }), { endAtMs: T0 + 20 * MIN });
    expect(records).toHaveLength(2);
  });
});

describe("findMergeTargetRecord", () => {
  it("未設定(undefined)と空文字を同じ帰属先とみなす", async () => {
    const r: WorkRecord = {
      id: "r1",
      date: DATE,
      category: "業務",
      name: "資料作成",
      masterTaskId: "m1",
      seconds: 60,
      startedAt: T0,
      endedAt: T0 + MIN,
      excludedFromStats: false,
      method: "",
    };
    await db.records.put(r);
    expect((await findMergeTargetRecord(DATE, "m1", {}))?.id).toBe("r1");
    expect(await findMergeTargetRecord(DATE, "m1", { method: "Claude" })).toBeUndefined();
  });
});
