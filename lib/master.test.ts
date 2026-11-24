import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deleteMasterTask, mergeMasterTasks, recomputeEstimateFromRecords, recomputeEstimatesForMasterTasks, renameMasterTask, restoreDeletedMasterTask, undoRenameMasterTask } from "./master";
import type { DailyTask, WorkRecord } from "./types";
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
  await Promise.all([db.masterTasks.clear(), db.records.clear(), db.dailyTasks.clear(), db.templateItems.clear(), db.trash.clear()]);
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

const rec = (id: string, o: Partial<WorkRecord> = {}): WorkRecord => ({
  id,
  date: "2026-11-23",
  category: "業務",
  name: "資料作成",
  masterTaskId: "a",
  seconds: 1800,
  startedAt: 0,
  endedAt: 1800000,
  excludedFromStats: false,
  ...o,
});
const dt = (id: string, o: Partial<DailyTask> = {}): DailyTask =>
  ({
    id,
    date: "2026-11-24",
    order: 0,
    masterTaskId: "a",
    category: "業務",
    name: "資料作成",
    estimatedSeconds: 600,
    status: "pending",
    segments: [],
    accumulatedMs: 0,
    isSpontaneous: false,
    ...o,
  }) as DailyTask;

describe("作業マスタの名前変更", () => {
  beforeEach(async () => {
    await db.masterTasks.bulkPut([m("a"), m("b", { category: "総務", name: "電話対応" })]);
    await db.records.bulkPut([rec("r1"), rec("r2", { date: "2026-11-01" }), rec("r3", { masterTaskId: "b", category: "総務", name: "電話対応" })]);
    await db.dailyTasks.bulkPut([dt("d1", { date: "2026-11-01", status: "done" }), dt("d2"), dt("d3", { masterTaskId: "b", category: "総務", name: "電話対応" })]);
    await db.templateItems.put({ id: "t1", weekday: 1, order: 0, masterTaskId: "a", category: "業務", name: "資料作成", estimatedSeconds: 0 });
  });

  it("マスタ・実績・本日の作業(過去も)・テンプレートを揃えて変え、別マスタには触れない", async () => {
    const res = await renameMasterTask("a", { name: " 報告書作成 " });
    expect(res.status).toBe("renamed");
    expect(await db.masterTasks.get("a")).toMatchObject({ category: "業務", name: "報告書作成" });
    for (const id of ["r1", "r2"]) expect((await db.records.get(id))!.name).toBe("報告書作成");
    for (const id of ["d1", "d2"]) expect((await db.dailyTasks.get(id))!.name).toBe("報告書作成");
    expect((await db.templateItems.get("t1"))!.name).toBe("報告書作成");
    expect((await db.records.get("r3"))!.name).toBe("電話対応");
    expect((await db.dailyTasks.get("d3"))!.name).toBe("電話対応");
  });

  it("同じ名前の別マスタがあれば変えずに知らせる(表記ゆれも同じとみなす)", async () => {
    const res = await renameMasterTask("a", { category: "総務", name: "電話対応 " });
    expect(res).toMatchObject({ status: "conflict", conflictWith: { id: "b" } });
    expect((await db.masterTasks.get("a"))!.name).toBe("資料作成");
    expect((await db.records.get("r1"))!.category).toBe("業務");
  });

  it("自分自身の表記ゆれ直しは衝突にしない。変化が無ければ unchanged", async () => {
    expect((await renameMasterTask("a", { name: "資料作成" })).status).toBe("unchanged");
    expect((await renameMasterTask("a", { name: "資料作成 " })).status).toBe("unchanged");
    expect((await renameMasterTask("a", { name: "" })).status).toBe("invalid");
  });

  it("元に戻すと、その後に変わっていない行だけ戻す", async () => {
    const res = await renameMasterTask("a", { category: "企画", name: "報告書作成" });
    if (res.status !== "renamed") throw new Error();
    // 名前変更の後に、r1 だけ別の名前へ直された
    await db.records.update("r1", { name: "手で直した" });
    expect(await undoRenameMasterTask(res.undo)).toBe(true);
    expect(await db.masterTasks.get("a")).toMatchObject({ category: "業務", name: "資料作成" });
    expect(await db.records.get("r1")).toMatchObject({ category: "企画", name: "手で直した" });
    expect(await db.records.get("r2")).toMatchObject({ category: "業務", name: "資料作成" });
    expect(await db.dailyTasks.get("d2")).toMatchObject({ category: "業務", name: "資料作成" });
    expect(await db.templateItems.get("t1")).toMatchObject({ category: "業務", name: "資料作成" });
  });

  it("マスタがその後さらに変わっていたら戻さない", async () => {
    const res = await renameMasterTask("a", { name: "報告書作成" });
    if (res.status !== "renamed") throw new Error();
    await renameMasterTask("a", { name: "週報作成" });
    expect(await undoRenameMasterTask(res.undo)).toBe(false);
    expect((await db.masterTasks.get("a"))!.name).toBe("週報作成");
    expect((await db.records.get("r1"))!.name).toBe("週報作成");
  });

  it("区分だけ変える時は、行ごとの作業名に触れない", async () => {
    await db.records.update("r2", { name: "資料作成(旧表記)" });
    await renameMasterTask("a", { category: "企画" });
    expect(await db.records.get("r2")).toMatchObject({ category: "企画", name: "資料作成(旧表記)" });
  });
});

describe("作業マスタの削除とゴミ箱", () => {
  it("削除するとゴミ箱に入り、元に戻すとゴミ箱から消える", async () => {
    await db.masterTasks.put(m("x", { category: "総務", name: "電話対応" }));
    const deleted = await deleteMasterTask("x");
    const items = await db.trash.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "master", label: "作業マスタ 総務 / 電話対応" });
    expect(deleted!.trashId).toBe(items[0].id);
    expect(await restoreDeletedMasterTask(deleted!)).toBe(true);
    expect(await db.trash.count()).toBe(0);
  });
});
