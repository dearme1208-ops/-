import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deleteRecordToTrash, recordTrashLabel, relinkRecordToMaster, undoDeleteRecord } from "./records";
import type { DailyTask, MasterTask, WorkRecord } from "./types";

const m = (id: string, category: string, name: string): MasterTask => ({
  id, category, name, estimatedSeconds: 600, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0,
});
const rec: WorkRecord = {
  id: "r1", date: "2026-11-23", category: "業務", name: "資料作成", masterTaskId: "a",
  seconds: 1800, startedAt: 0, endedAt: 1800000, excludedFromStats: false,
};
const dt = (id: string, o: Partial<DailyTask> = {}): DailyTask => ({
  id, date: "2026-11-23", order: 0, masterTaskId: "a", category: "業務", name: "資料作成", estimatedSeconds: 600,
  status: "done", segments: [], accumulatedMs: 1800000, isSpontaneous: false, ...o,
});

beforeEach(async () => {
  await Promise.all([db.masterTasks.clear(), db.records.clear(), db.dailyTasks.clear(), db.trash.clear()]);
  await db.masterTasks.bulkPut([m("a", "業務", "資料作成"), m("b", "総務", "電話対応")]);
  await db.records.put(rec);
  await db.dailyTasks.bulkPut([
    dt("same"),
    dt("otherDay", { date: "2026-11-22" }),
    dt("notDone", { status: "pending" }),
    dt("otherProject", { projectId: "p1" }),
  ]);
});

describe("実績1件の繋ぎ変え", () => {
  it("実績と、元になった完了済みの作業(同じ日・同じマスタ・同じ案件)だけを繋ぎ変える", async () => {
    const res = await relinkRecordToMaster("r1", "総務", "電話対応 ");
    expect(res).toMatchObject({ status: "relinked", oldMasterId: "a", newMasterId: "b", movedDailyTasks: 1 });
    expect(await db.records.get("r1")).toMatchObject({ masterTaskId: "b", category: "総務", name: "電話対応" });
    expect(await db.dailyTasks.get("same")).toMatchObject({ masterTaskId: "b", name: "電話対応" });
    for (const id of ["otherDay", "notDone", "otherProject"]) expect((await db.dailyTasks.get(id))!.masterTaskId).toBe("a");
    expect((await db.masterTasks.get("b"))!.sampleCount).toBe(1);
  });

  it("無いマスタなら作って繋ぐ。同じなら何もしない", async () => {
    expect((await relinkRecordToMaster("r1", "業務", "資料作成")).status).toBe("unchanged");
    const res = await relinkRecordToMaster("r1", "業務", "新しい作業");
    if (res.status !== "relinked") throw new Error();
    expect(res.newMasterId).not.toBe("a");
    expect((await db.masterTasks.get(res.newMasterId))!.name).toBe("新しい作業");
    expect((await db.dailyTasks.get("same"))!.masterTaskId).toBe(res.newMasterId);
  });
});

describe("実績の削除とゴミ箱", () => {
  it("ゴミ箱に入れ、元に戻すとゴミ箱から消える。作り直された行は上書きしない", async () => {
    expect(recordTrashLabel({ date: "2026-11-23", category: "総務", name: "電話対応", seconds: 1800 })).toBe("実績 11/23 総務 / 電話対応 0:30");
    const d = (await deleteRecordToTrash("r1"))!;
    expect(await db.records.get("r1")).toBeUndefined();
    expect(await db.trash.toArray()).toMatchObject([{ kind: "record", label: "実績 11/23 業務 / 資料作成 0:30" }]);
    expect(await undoDeleteRecord(d)).toBe(true);
    expect(await db.records.get("r1")).toBeDefined();
    expect(await db.trash.count()).toBe(0);
    const d2 = (await deleteRecordToTrash("r1"))!;
    await db.records.put({ ...rec, seconds: 60 });
    expect(await undoDeleteRecord(d2)).toBe(false);
    expect((await db.records.get("r1"))!.seconds).toBe(60);
  });
});
