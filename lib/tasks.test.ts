import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { addProvisionalTaskIfIdle, findMergeTargetRecord, finishDailyTask, pauseDailyTask } from "./tasks";
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

describe("完了後に「続きから」再開した作業", () => {
  it("2回目の完了では新しく増えた区間と加算分だけを実績に足す", async () => {
    const first = await finish(task({ id: "c1", manualAdjustmentMs: 5 * MIN }), { endAtMs: T0 + 10 * MIN });
    expect(first.records[0].seconds).toBe(15 * 60);
    expect(first.daily.accumulatedMs).toBe(15 * MIN);

    // 「続きから」再開(区間を追加して計測中に戻す)
    const reopened: DailyTask = {
      ...first.daily,
      status: "running",
      segments: [...first.daily.segments, { start: T0 + 30 * MIN }],
      endedAt: undefined,
    };
    const second = await finish(reopened, { endAtMs: T0 + 35 * MIN });
    expect(second.records).toHaveLength(1);
    expect(second.records[0].seconds).toBe(20 * 60);
    // 作業全体の合計は、前回の加算分(5分)も含めて10+5+5=20分
    expect(second.daily.accumulatedMs).toBe(20 * MIN);
  });
});

describe("同時に操作された場合", () => {
  it("同じ作業の完了が2回同時に走っても、実績は1回分だけ加算される", async () => {
    const t = task({ id: "dup" });
    await db.dailyTasks.put(t);
    const results = await Promise.all([
      finishDailyTask(t, { endAtMs: T0 + 30 * MIN }),
      finishDailyTask(t, { endAtMs: T0 + 30 * MIN }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const records = await db.records.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].seconds).toBe(30 * 60);
  });

  it("仮計測の追加が同時に走っても、1件しか作られない", async () => {
    const base = { date: DATE, category: "未分類", name: "仮計測中", estimatedSeconds: 0, status: "running" as const, segments: [{ start: T0 }], accumulatedMs: 0, isSpontaneous: true, isProvisional: true };
    const results = await Promise.all([
      addProvisionalTaskIfIdle({ ...base, id: "p1" }),
      addProvisionalTaskIfIdle({ ...base, id: "p2" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.dailyTasks.toArray()).toHaveLength(1);
  });

  it("計測中の作業があれば仮計測は追加しない", async () => {
    await db.dailyTasks.put(task({ id: "r" }));
    const added = await addProvisionalTaskIfIdle({ id: "p", date: DATE, category: "未分類", name: "仮計測中", estimatedSeconds: 0, status: "running", segments: [{ start: T0 }], accumulatedMs: 0, isSpontaneous: true, isProvisional: true });
    expect(added).toBe(false);
  });
});

describe("一時停止(pauseDailyTask)", () => {
  it("合計は、それまでの合計に今閉じた区間を足す", async () => {
    const t = task({ id: "p1", segments: [{ start: T0, end: T0 + 10 * MIN }, { start: T0 + 20 * MIN }], accumulatedMs: 10 * MIN });
    await db.dailyTasks.put(t);
    await pauseDailyTask(t, T0 + 35 * MIN);
    const d = (await db.dailyTasks.get("p1"))!;
    expect(d.status).toBe("paused");
    expect(d.accumulatedMs).toBe(25 * MIN);
    expect(d.segments[1].end).toBe(T0 + 35 * MIN);
  });

  it("完了後に「続きから」再開して一時停止しても、前回の完了時に足した「時間を加算」の分が消えない", async () => {
    // 30分計測 + 10分を加算して完了 → 合計40分
    const { daily } = await finish(task({ id: "p2", segments: [{ start: T0, end: T0 + 30 * MIN }], status: "paused", accumulatedMs: 30 * MIN, manualAdjustmentMs: 10 * MIN }));
    expect(daily.accumulatedMs).toBe(40 * MIN);
    // 続きから再開して5分で一時停止 → 45分
    const resumed = { ...daily, status: "running" as const, segments: [...daily.segments, { start: T0 + 60 * MIN }] };
    await db.dailyTasks.put(resumed);
    await pauseDailyTask(resumed, T0 + 65 * MIN);
    expect((await db.dailyTasks.get("p2"))!.accumulatedMs).toBe(45 * MIN);
  });

  it("計測中でなければ何もしない", async () => {
    const t = task({ id: "p3", status: "paused", segments: [{ start: T0, end: T0 + MIN }], accumulatedMs: MIN });
    await db.dailyTasks.put(t);
    await pauseDailyTask(t, T0 + 99 * MIN);
    expect((await db.dailyTasks.get("p3"))!.accumulatedMs).toBe(MIN);
  });
});

describe("作業マスタの照合", () => {
  it("全角/半角・空白・大文字小文字の違いだけなら同じマスタを使う", async () => {
    const { findOrCreateMasterTask, normalizeMasterKey, findDuplicateMasterGroups } = await import("./master");
    expect(normalizeMasterKey(" ＮＴＥ　 ")).toBe("nte");
    await db.masterTasks.put({ id: "g1", category: "ゲーム", name: "NTE", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
    const m = await findOrCreateMasterTask("ゲーム ", "ＮＴＥ");
    expect(m.id).toBe("g1");
    const groups = findDuplicateMasterGroups([
      { id: "a", category: "ゲーム", name: "NTE", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 },
      { id: "b", category: "ゲーム", name: "ｎｔｅ", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 },
    ]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([["a", "b"]]);
  });
});

describe("実績側の時刻編集を本日の作業へ反映(syncDailyTaskBoundaryFromRecord)", () => {
  it("終了時刻を延ばしても、完了時に織り込んだ「時間を加算」の分は残る", async () => {
    const { syncDailyTaskBoundaryFromRecord } = await import("./tasks");
    // 30分計測 + 10分加算 → 合計40分で完了
    const { daily } = await finish(task({ id: "s1", segments: [{ start: T0, end: T0 + 30 * MIN }], status: "paused", accumulatedMs: 30 * MIN, manualAdjustmentMs: 10 * MIN }));
    expect(daily.accumulatedMs).toBe(40 * MIN);
    await syncDailyTaskBoundaryFromRecord({ date: DATE, masterTaskId: "m1" }, "end", T0 + 35 * MIN);
    const d = (await db.dailyTasks.get("s1"))!;
    expect(d.accumulatedMs).toBe(45 * MIN);
    expect(d.recordedMs).toBe(45 * MIN);
  });
});
