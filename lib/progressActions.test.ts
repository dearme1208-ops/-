import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { addProgressStepToToday, addProjectToToday, completeTodoWithUndo } from "./progressActions";
import type { ProjectItem, TodoTask } from "./types";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const TODAY = "2026-11-24";
const project: ProjectItem = {
  id: "p1",
  title: "A社案件",
  category: "",
  workName: "本体",
  dueDate: "2026-12-10",
  createdAt: 0,
  stages: [{ id: "s1", title: "設計", completed: false }],
};
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

describe("案件を本日の作業に入れる(addProjectToToday)", () => {
  it("業務区分が空なら件名で代用し、元のToDoを紐付け、同じ段階は重ねて入れない", async () => {
    await db.projects.add(project);
    await db.todoTasks.add(todo("origin", { projectId: "p1" }));
    const r = await addProjectToToday({ projectId: "p1", stageId: "s1", today: TODAY });
    expect(r.status).toBe("added");
    if (r.status !== "added") return;
    expect(r.task).toMatchObject({ category: "A社案件", name: "設計", projectId: "p1", stageId: "s1", todoTaskId: "origin" });
    // 📈進捗から同じ段階を入れても重ならない
    expect(await addProgressStepToToday({ kind: "project", id: "p1" }, "s1", TODAY)).toBe(false);
    expect(await db.dailyTasks.count()).toBe(1);
  });

  it("すぐ始める指定で既に入っていれば、それを再開する", async () => {
    await db.projects.add(project);
    await addProjectToToday({ projectId: "p1", stageId: "s1", today: TODAY });
    const r = await addProjectToToday({ projectId: "p1", stageId: "s1", today: TODAY, startNow: true });
    expect(r.status).toBe("started");
    const all = await db.dailyTasks.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("running");
  });

  it("連打して並行に入れても、同じ段階は1件だけ", async () => {
    await db.projects.add(project);
    const rs = await Promise.all([
      addProjectToToday({ projectId: "p1", stageId: "s1", today: TODAY }),
      addProjectToToday({ projectId: "p1", stageId: "s1", today: TODAY }),
    ]);
    expect(rs.filter((r) => r.status === "added")).toHaveLength(1);
    expect(await db.dailyTasks.count()).toBe(1);
  });
});

describe("ToDoの完了と取り消し(completeTodoWithUndo)", () => {
  it("繰り返しのToDoは次回へ進み、取り消しで元の期日とサブタスクの完了に戻る", async () => {
    await db.todoTasks.bulkAdd([
      todo("r", { dueDate: "2026-11-24", recurrence: { type: "daily", interval: 1 } }),
      todo("sub", { parentTaskId: "r", completed: true, completedAt: 5 }),
    ]);
    const done = await completeTodoWithUndo((await db.todoTasks.get("r"))!, TODAY);
    expect((await db.todoTasks.get("r"))!.dueDate).toBe("2026-11-25");
    expect((await db.todoTasks.get("sub"))!.completed).toBe(false);
    await done!.undo();
    expect((await db.todoTasks.get("r"))!.dueDate).toBe("2026-11-24");
    expect((await db.todoTasks.get("sub"))!).toMatchObject({ completed: true, completedAt: 5 });
  });

  it("取り消しは、そのあと未完了に戻して付け直したものを上書きしない", async () => {
    await db.todoTasks.add(todo("t"));
    const done = await completeTodoWithUndo((await db.todoTasks.get("t"))!, TODAY);
    expect((await db.todoTasks.get("t"))!.completed).toBe(true);
    await db.todoTasks.update("t", { completedAt: 999 });
    await done!.undo();
    expect((await db.todoTasks.get("t"))!.completed).toBe(true);
  });
});
