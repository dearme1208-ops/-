import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { purgeOldTrash, putInTrash, restoreFromTrash } from "./trash";

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
});
