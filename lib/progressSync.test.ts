import { describe, expect, it } from "vitest";
import { buildSnapshot, planProgressUpdate, UPDATE_FORMAT } from "@/lib/progressSync";
import type { ProjectItem, TodoList, TodoTask } from "@/lib/types";

const NOW = new Date("2026-10-03T15:00:00").getTime();
const lists: TodoList[] = [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }];
const project = (): ProjectItem => ({
  id: "p1",
  title: "A社見積",
  category: "営業",
  workName: "見積",
  dueDate: "2026-10-20",
  createdAt: new Date("2026-09-20T09:00:00").getTime(),
  stages: [
    { id: "s1", title: "ヒアリング", completed: true, completedAt: new Date("2026-09-25T10:00:00").getTime() },
    { id: "s2", title: "見積作成", completed: false, dueDate: "2026-10-10" },
    { id: "s3", title: "部品手配", completed: false, targetCount: 10, completedCount: 3 },
  ],
});
const todos = (): TodoTask[] => [
  { id: "t1", listId: "l1", title: "B社対応", important: false, completed: false, order: 0, createdAt: 0, notes: "前回の経緯" },
  { id: "t1a", listId: "l1", parentTaskId: "t1", title: "資料送付", important: false, completed: false, order: 0, createdAt: 0 },
  { id: "t2", listId: "l1", title: "月次報告", important: false, completed: false, order: 1, createdAt: 0, dueDate: "2026-10-03", recurrence: { type: "monthlyDate", interval: 1, day: 3 } },
  { id: "done", listId: "l1", title: "終わったこと", important: false, completed: true, order: 2, createdAt: 0 },
];
const state = () => ({ projects: [project()], todoTasks: todos(), todoLists: lists, tagOptions: ["対応中", "客先確認中"] });
const plan = (operations: unknown[]) => planProgressUpdate({ format: UPDATE_FORMAT, version: 1, operations }, state(), NOW);

describe("外部AIとの進捗のやり取り", () => {
  it("書き出しは未完了の案件・ToDoだけを、段階・サブタスクとIDつきで出す", () => {
    const s = buildSnapshot({ ...state(), now: NOW });
    expect(s.projects[0].stages.map((x) => [x.id, x.completed, x.completedDate ?? null, x.completedCount ?? null])).toEqual([
      ["s1", true, "2026-09-25", null],
      ["s2", false, null, null],
      ["s3", false, null, 3],
    ]);
    expect(s.todos.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(s.todos[0].subtasks[0]).toEqual({ id: "t1a", title: "資料送付", completed: false });
    expect(s.todos[1].recurring).toBe(true);
  });

  it("段階の完了(完了日つき)・件数・対応状況、ToDoの完了・メモ追記を、書いた項目だけ変える", () => {
    const p = plan([
      { op: "updateStage", projectTitle: "A社見積", stageTitle: "見積作成", completed: true, completedDate: "2026-10-02" },
      { op: "updateStage", projectId: "p1", stageId: "s3", completedCount: 10 },
      { op: "updateProject", projectTitle: "A社見積", tag: "客先確認中" },
      { op: "updateSubtask", todoTitle: "B社対応", subtaskTitle: "資料送付", completed: true },
      { op: "updateTodo", todoId: "t1", appendNotes: "先方から返信あり" },
    ]);
    expect(p.operations.every((o) => o.ok)).toBe(true);
    const after = p.writes.projects.get("p1")!.after;
    const s2 = after.stages!.find((s) => s.id === "s2")!;
    expect(s2.completed).toBe(true);
    expect(new Date(s2.completedAt!).getDate()).toBe(2);
    expect(after.stages!.find((s) => s.id === "s3")).toMatchObject({ completedCount: 10, completed: true });
    expect(after.tag).toBe("客先確認中");
    expect(after.dueDate).toBe("2026-10-20");
    expect(p.writes.todos.get("t1a")!.after.completed).toBe(true);
    expect(p.writes.todos.get("t1")!.after.notes).toBe("前回の経緯\n[2026-10-03] 先方から返信あり");
  });

  it("繰り返しのToDoは完了にすると次回の期日へ進む。追加したToDoへ同じファイルの中でサブタスクを足せる", () => {
    const p = plan([
      { op: "updateTodo", todoTitle: "月次報告", completed: true },
      { op: "addTodo", list: "新規リスト", title: "C社提案", dueDate: "2026-10-31", subtasks: [{ title: "構成案" }] },
      { op: "addSubtask", todoTitle: "C社提案", title: "見積添付", tag: "対応中" },
    ]);
    expect(p.operations.map((o) => o.ok)).toEqual([true, true, true]);
    expect(p.writes.todos.get("t2")!.after).toMatchObject({ completed: false, dueDate: "2026-11-03" });
    expect(p.writes.lists.map((l) => l.title)).toEqual(["新規リスト"]);
    expect(p.operations[1].warnings[0]).toContain("新しく作ります");
    const added = [...p.writes.todos.values()].map((w) => w.after).filter((t) => !w0(t));
    expect(added.map((t) => t.title).sort()).toEqual(["C社提案", "構成案", "見積添付"].sort());
  });

  it("見つからない・曖昧・形式違いはその操作だけ失敗にし、途中まで書き換えた分も残さない", () => {
    const p = plan([
      { op: "updateStage", projectTitle: "無い案件", stageTitle: "x", completed: true },
      { op: "updateTodo", todoTitle: "B社対応", dueDate: "2026/10/10" },
      { op: "updateProject", projectTitle: "A社見積", dueDate: "2026-10-25", tag: 5 },
      { op: "addTodo", list: "タスク", title: "D社", subtasks: [{ title: "" }] },
      { op: "updateStage", projectTitle: "A社見積", stageTitle: "見積作成", completedCount: 3 },
      { op: "deleteTodo", todoId: "t1" },
      { op: "updateTodo", todoTitle: "終わったこと", completed: false },
    ]);
    expect(p.operations.map((o) => o.ok)).toEqual([false, false, false, false, false, false, false]);
    expect(p.operations[0].error).toContain("無い案件");
    expect(p.operations[1].error).toContain("YYYY-MM-DD");
    expect(p.operations[4].error).toContain("件数で進める段階ではありません");
    expect(p.operations[5].error).toContain("知らない操作");
    expect(p.writes.projects.size).toBe(0);
    expect(p.writes.todos.size).toBe(0);
  });

  it("ファイルの形式が違えば何もしない", () => {
    expect(planProgressUpdate({ format: "x", version: 1, operations: [] }, state(), NOW).fatal).toContain("format");
    expect(planProgressUpdate([], state(), NOW).fatal).toBeTruthy();
  });
});

function w0(t: TodoTask) {
  return ["t1", "t1a", "t2", "done"].includes(t.id);
}

describe("仕様書(public/progress-sync-spec.md)とのずれ", () => {
  it("仕様書に書いた操作はすべて受け付け、書いていない操作は受け付けない", async () => {
    const { readFileSync } = await import("fs");
    const spec = readFileSync("public/progress-sync-spec.md", "utf-8");
    const documented = [...spec.matchAll(/^#### (\w+) — /gm)].map((m) => m[1]).sort();
    expect(documented).toEqual(["addProject", "addStage", "addSubtask", "addTodo", "updateProject", "updateStage", "updateSubtask", "updateTodo"]);
    for (const op of documented) {
      const p = planProgressUpdate({ format: UPDATE_FORMAT, version: 1, operations: [{ op }] }, state(), NOW);
      expect(p.operations[0].error ?? "", op).not.toContain("知らない操作");
    }
    expect(spec).toContain(UPDATE_FORMAT);
  });
});
