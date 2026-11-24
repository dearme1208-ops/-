import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deleteMasterTask, mergeMasterTasks, recomputeEstimateFromRecords, recomputeEstimatesForMasterTasks, restoreDeletedMasterTask } from "./master";
import type { MasterTask } from "./types";

const m = (id: string, o: Partial<MasterTask> = {}): MasterTask => ({
  id,
  category: "業務",
  name: "資料作成",
  estimatedSeconds: 600,
  isFavorite: false,
  sampleCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...o,
});

beforeEach(async () => {
  await Promise.all([db.masterTasks.clear(), db.records.clear(), db.dailyTasks.clear(), db.templateItems.clear()]);
});

describe("作業マスタの統合・削除と曜日別テンプレート", () => {
  it("統合すると、テンプレートの項目も残すマスタへ繋ぎ直す", async () => {
    await db.masterTasks.bulkPut([m("keep"), m("dup", { name: "資料作成 " })]);
    await db.templateItems.put({ id: "t1", weekday: 1, order: 0, masterTaskId: "dup", category: "業務", name: "資料作成 ", estimatedSeconds: 0 });
    const res = await mergeMasterTasks("keep", ["dup"]);
    expect(res.movedTemplateItems).toBe(1);
    expect(await db.templateItems.get("t1")).toMatchObject({ masterTaskId: "keep", name: "資料作成" });
  });

  it("削除するとテンプレートの紐付けを外し、戻すと繋ぎ直す", async () => {
    await db.masterTasks.put(m("x"));
    await db.templateItems.put({ id: "t1", weekday: 1, order: 0, masterTaskId: "x", category: "業務", name: "資料作成", estimatedSeconds: 0 });
    const deleted = await deleteMasterTask("x");
    expect(await db.masterTasks.get("x")).toBeUndefined();
    expect((await db.templateItems.get("t1"))!.masterTaskId).toBeUndefined();
    expect(await restoreDeletedMasterTask(deleted!)).toBe(true);
    expect((await db.templateItems.get("t1"))!.masterTaskId).toBe("x");
    expect(await restoreDeletedMasterTask(deleted!)).toBe(false);
  });
});

describe("実績が無くなった時の想定時間", () => {
  it("件数は0に戻し、想定時間は残す", async () => {
    await db.masterTasks.bulkPut([m("a", { sampleCount: 3, estimatedSeconds: 900 }), m("b", { sampleCount: 2, estimatedSeconds: 300 })]);
    await recomputeEstimateFromRecords("a");
    expect(await db.masterTasks.get("a")).toMatchObject({ sampleCount: 0, estimatedSeconds: 900 });
    await recomputeEstimatesForMasterTasks(["b"]);
    expect(await db.masterTasks.get("b")).toMatchObject({ sampleCount: 0, estimatedSeconds: 300 });
  });
});
