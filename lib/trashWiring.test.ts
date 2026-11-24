import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deleteProjectCascade } from "./projects";
import { todoTrashLabel, trashTodos } from "./todo";
import { restoreFromTrash } from "./trash";
import type { ProjectItem, TodoTask } from "./types";

// 各画面の削除がゴミ箱に入り、そこから戻せること
const todo = (id: string, extra: Partial<TodoTask> = {}): TodoTask => ({
  id,
  listId: "l",
  title: id,
  important: false,
  completed: false,
  order: 0,
  createdAt: 0,
  ...extra,
});
const project: ProjectItem = { id: "p1", title: "A社サイト", category: "c", workName: "w", dueDate: "2026-12-10", createdAt: 0 };

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("ToDoのゴミ箱の名前", () => {
  it("親とサブタスク・サブタスク単体・複数", () => {
    expect(todoTrashLabel([todo("x", { title: "見積もり作成" })], 2)).toBe("ToDo「見積もり作成」とサブタスク2件");
    expect(todoTrashLabel([todo("x", { title: "見積もり作成" })])).toBe("ToDo「見積もり作成」");
    expect(todoTrashLabel([todo("s", { title: "確認", parentTaskId: "x" })])).toBe("サブタスク「確認」");
    expect(todoTrashLabel([todo("a"), todo("b"), todo("c")], 1)).toBe("ToDo「a」ほか2件とサブタスク1件");
  });
});

describe("ゴミ箱への出し入れ", () => {
  it("消したToDoとサブタスク・リストを戻せる", async () => {
    const tasks = [todo("a"), todo("s", { parentTaskId: "a" })];
    const id = await trashTodos("ToDo「a」とサブタスク1件", tasks, [{ id: "l", title: "仕事", order: 0, createdAt: 0 }]);
    expect(await restoreFromTrash(id!)).toEqual({ restored: 3, skipped: 0 });
    expect((await db.todoTasks.toArray()).map((t) => t.id).sort()).toEqual(["a", "s"]);
    expect(await db.todoLists.get("l")).toBeTruthy();
  });

  it("案件の削除は案件とWBSをゴミ箱に入れ、取り消すとゴミ箱からは消える", async () => {
    await db.projects.add(project);
    await db.wbsNodes.add({ id: "n1", projectId: "p1", order: 0, title: "n1", progress: 0, createdAt: 0, updatedAt: 0 });
    await db.todoTasks.add(todo("t1", { projectId: "p1" }));
    const del = await deleteProjectCascade("p1");
    const [item] = await db.trash.toArray();
    expect(item.kind).toBe("project");
    expect(item.label).toBe("案件「A社サイト」とWBS1件");
    // ToDoの紐づけ外しは削除ではないので入れない
    expect(item.rows.map((r) => r.table).sort()).toEqual(["projects", "wbsNodes"]);
    await del!.undo();
    expect(await db.trash.count()).toBe(0);
  });

  it("ゴミ箱から戻した案件はWBSも戻るが、ToDoとのつながりは戻らない", async () => {
    await db.projects.add(project);
    await db.wbsNodes.add({ id: "n1", projectId: "p1", order: 0, title: "n1", progress: 0, createdAt: 0, updatedAt: 0 });
    await db.todoTasks.add(todo("t1", { projectId: "p1" }));
    await deleteProjectCascade("p1");
    const [item] = await db.trash.toArray();
    expect(await restoreFromTrash(item.id)).toEqual({ restored: 2, skipped: 0 });
    expect(await db.projects.get("p1")).toBeTruthy();
    expect(await db.wbsNodes.get("n1")).toBeTruthy();
    expect((await db.todoTasks.get("t1"))!.projectId).toBeUndefined();
  });
});
