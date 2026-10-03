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
      { op: "updateStage", projectTitle: "A社見積", stageTitle: "見積作成", tag: "客先確認中" },
      { op: "updateSubtask", todoTitle: "B社対応", subtaskTitle: "資料送付", completed: true },
      { op: "updateTodo", todoId: "t1", appendNotes: "先方から返信あり" },
    ]);
    expect(p.operations.every((o) => o.ok)).toBe(true);
    const after = p.writes.projects.get("p1")!.after;
    const s2 = after.stages!.find((s) => s.id === "s2")!;
    expect(s2.completed).toBe(true);
    expect(new Date(s2.completedAt!).getDate()).toBe(2);
    expect(after.stages!.find((s) => s.id === "s3")).toMatchObject({ completedCount: 10, completed: true });
    expect(after.stages!.find((x) => x.id === "s2")!.tag).toBe("客先確認中");
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

  it("段階のある案件・サブタスクのあるToDoの対応状況は自動で決まるので、本体への変更はエラーにして段階・サブタスクを案内する", () => {
    const p = plan([
      { op: "updateProject", projectId: "p1", tag: "客先確認中" },
      { op: "updateTodo", todoId: "t1", tag: "客先確認中" },
      { op: "updateTodo", todoId: "t2", tag: "対応中" },
    ]);
    expect(p.operations.map((o) => o.ok)).toEqual([false, false, true]);
    expect(p.operations[0].error).toContain("updateStage");
    expect(p.operations[1].error).toContain("updateSubtask");
    const snap = buildSnapshot({ ...state(), now: NOW });
    expect(snap.projects[0].tagAuto).toBe(true);
    expect(snap.todos[0].tagAuto).toBe(true);
    expect(snap.todos[1].tagAuto).toBeUndefined();
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
    expect(documented).toEqual(["addProject", "addStage", "addSubtask", "addTodo", "planTimebox", "updateProject", "updateStage", "updateSubtask", "updateTodo"]);
    for (const op of documented) {
      const p = planProgressUpdate({ format: UPDATE_FORMAT, version: 1, operations: [{ op }] }, state(), NOW);
      expect(p.operations[0].error ?? "", op).not.toContain("知らない操作");
    }
    expect(spec).toContain(UPDATE_FORMAT);
  });
});

describe("時間割(planTimebox)", () => {
  const D = "2026-10-03";
  const daily = (id: string, o: Record<string, unknown> = {}) =>
    ({ id, date: D, order: 0, category: "業務", name: id, estimatedSeconds: 0, status: "pending", segments: [], accumulatedMs: 0, isSpontaneous: true, ...o }) as import("@/lib/types").DailyTask;
  const st = () => ({
    ...state(),
    dailyTasks: [
      daily("資料作成", { order: 2 }),
      daily("メール返信", { order: 0 }),
      daily("前の枠", { order: 1, scheduledTime: "08:00", timeboxEnd: "08:30" }),
      daily("会議", { order: 3, scheduledTime: "13:00" }),
    ],
    breaks: [{ start: "12:00", end: "13:00" }],
  });
  const at = (hm: string) => new Date(`${D}T${hm}:00`).getTime();

  it("枠を付け、枠に入れなかった作業の前の枠は外し、並びを時間割の順にそろえる", () => {
    const p = planProgressUpdate(
      { format: UPDATE_FORMAT, version: 1, operations: [{ op: "planTimebox", date: D, slots: [{ taskId: "メール返信", start: "16:30", end: "16:50" }, { taskId: "資料作成", start: "16:00", end: "16:25" }] }] },
      st(),
      at("15:00")
    );
    expect(p.operations[0]).toMatchObject({ ok: true, summary: `${D}の時間割: 2枠（16:00〜16:50）` });
    expect(p.operations[0].details).toEqual(["16:00〜16:25 業務 / 資料作成", "16:30〜16:50 業務 / メール返信", "時間割から外す: 前の枠"]);
    const after = (id: string) => p.writes.dailyTasks.get(id)!.after;
    expect(after("資料作成")).toMatchObject({ scheduledTime: "16:00", timeboxEnd: "16:25", order: 0, autoStartNotified: false });
    expect(after("メール返信")).toMatchObject({ order: 1 });
    expect(after("前の枠").timeboxEnd).toBeUndefined();
    // カレンダー予定(時刻だけ)は外さない
    expect(p.writes.dailyTasks.get("会議")?.after.scheduledTime ?? "13:00").toBe("13:00");
  });

  it("重なり・知らない作業・過ぎた日は失敗、休憩帯や過ぎた時刻は警告", () => {
    const run = (operations: unknown[], now = at("09:00")) => planProgressUpdate({ format: UPDATE_FORMAT, version: 1, operations }, st(), now).operations;
    expect(run([{ op: "planTimebox", date: D, slots: [{ taskId: "資料作成", start: "10:00", end: "10:30" }, { taskId: "メール返信", start: "10:20", end: "10:40" }] }])[0].error).toContain("重なって");
    expect(run([{ op: "planTimebox", date: D, slots: [{ taskId: "無い", start: "10:00", end: "10:30" }] }])[0].error).toContain("無い");
    expect(run([{ op: "planTimebox", date: "2026-10-02", slots: [{ taskId: "資料作成", start: "10:00", end: "10:30" }] }])[0].error).toContain("過ぎた日");
    const w = run([{ op: "planTimebox", date: D, slots: [{ taskId: "資料作成", start: "08:00", end: "08:30" }, { taskId: "メール返信", start: "12:10", end: "12:30" }] }])[0];
    expect(w.ok).toBe(true);
    expect(w.warnings.join("\n")).toContain("もう過ぎています");
    expect(w.warnings.join("\n")).toContain("休憩帯(12:00〜13:00)");
  });
});

describe("取り込みの取り消し", () => {
  it("反映で変えた項目だけを戻し、反映のあとに手で直した項目と、手で足した段階は残す", async () => {
    const { revertPatch } = await import("@/lib/progressSync");
    const before = { id: "t", tag: undefined as string | undefined, notes: "経緯", dueDate: "2026-10-10" };
    const after = { id: "t", tag: "客先確認中", notes: "経緯\n[10/3] 返事待ち", dueDate: "2026-10-10" };
    // 反映後に、メモを手で書き換えた
    const current = { ...after, notes: "手で直したメモ" };
    expect(revertPatch(before, after, current)).toEqual({ tag: undefined });

    const stage = (id: string, o: Record<string, unknown> = {}) => ({ id, title: id, completed: false, ...o });
    const p = revertPatch(
      { id: "p", stages: [stage("a"), stage("b")] },
      { id: "p", stages: [stage("a", { completed: true, completedAt: 1 }), stage("b"), stage("ai追加")] },
      { id: "p", stages: [stage("a", { completed: true, completedAt: 1 }), stage("b", { tag: "手で付けた" }), stage("ai追加"), stage("手で追加")] }
    );
    expect(p.stages).toEqual([stage("a", { completedAt: undefined }), stage("b", { tag: "手で付けた" }), stage("手で追加")]);
  });
});
