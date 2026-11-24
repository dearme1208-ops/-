import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { isTrashItemGone, purgeOldTrash, putInTrash, restoreFromTrash } from "./trash";
import { deleteRecordToTrash, undoDeleteRecord } from "./records";
import { deleteMasterTask, restoreDeletedMasterTask } from "./master";

describe("trash", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });
  it("消した行をゴミ箱から戻せる。同じidが既にある行は上書きしない", async () => {
    const a = { id: "a", listId: "l", title: "A", completed: false, important: false, order: 0, createdAt: 0 };
    const b = { ...a, id: "b", title: "B" };
    const id = (await putInTrash("todo", "ToDo「A」", { todoTasks: [a, b] }))!;
    await db.todoTasks.add({ ...b, title: "作り直したB" });
    const r = await restoreFromTrash(id);
    expect(r).toEqual({ restored: 1, skipped: 1 });
    expect((await db.todoTasks.get("a"))?.title).toBe("A");
    expect((await db.todoTasks.get("b"))?.title).toBe("作り直したB");
    expect(await db.trash.count()).toBe(0);
  });
  it("7日より古いものだけ消す", async () => {
    await putInTrash("todo", "x", { todoTasks: [{ id: "x" }] });
    const old = await db.trash.toArray();
    await db.trash.update(old[0].id, { deletedAt: Date.now() - 8 * 86400000 });
    await putInTrash("todo", "y", { todoTasks: [{ id: "y" }] });
    expect(await purgeOldTrash()).toBe(1);
    expect(await db.trash.count()).toBe(1);
  });
  it("空なら入れない", async () => {
    expect(await putInTrash("todo", "x", { todoTasks: [] })).toBeNull();
  });
  it("実績を戻すと、その作業マスタの想定時間を数え直す", async () => {
    await db.masterTasks.add({ id: "m", category: "業務", name: "資料", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
    const rec = { id: "r1", date: "2026-11-24", category: "業務", name: "資料", masterTaskId: "m", seconds: 1800, createdAt: 0 };
    await db.records.add(rec as never);
    const del = (await deleteRecordToTrash("r1"))!;
    expect((await db.masterTasks.get("m"))!.sampleCount).toBe(0);
    await restoreFromTrash(del.trashId!);
    const m = (await db.masterTasks.get("m"))!;
    expect(m.sampleCount).toBe(1);
    expect(m.estimatedSeconds).toBe(1800);
  });
  it("ゴミ箱から戻した後の「元に戻す」は何もしない", async () => {
    const rec = { id: "r1", date: "2026-11-24", category: "業務", name: "資料", seconds: 600, createdAt: 0 };
    await db.records.add(rec as never);
    const del = (await deleteRecordToTrash("r1"))!;
    expect(await isTrashItemGone(del.trashId)).toBe(false);
    await restoreFromTrash(del.trashId!);
    expect(await isTrashItemGone(del.trashId)).toBe(true);
    expect(await undoDeleteRecord(del)).toBe(false);
    expect(await db.records.count()).toBe(1);
  });
  it("作業マスタをゴミ箱から戻して直した後、「元に戻す」で古い控えに戻さない", async () => {
    await db.masterTasks.add({ id: "m", category: "業務", name: "資料", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
    const del = (await deleteMasterTask("m"))!;
    await restoreFromTrash(del.trashId!);
    await db.masterTasks.delete("m");
    // ゴミ箱から戻した後にまた消した: 「元に戻す」で蘇らせない
    expect(await restoreDeletedMasterTask(del)).toBe(false);
    expect(await db.masterTasks.get("m")).toBeUndefined();
  });
});
