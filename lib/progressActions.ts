import { db, uid } from "./db";
import { findOrCreateMasterTask } from "./master";
import { toggleProjectStage } from "./projectStage";
import { computeRemainingEstimatedSeconds } from "./tasks";
import { completeTodoTask } from "./todo";
import type { DailyTask } from "./types";

// 「📈 進捗」の行から、残りの手順(段階・サブタスク)をその場で片付けたり、
// 本日の作業へ入れたりする。各画面の「完了」「本日の作業に追加」と同じ紐付けで行う

export type ProgressTarget = { kind: "todo" | "project"; id: string };

/**
 * 残りの手順を完了にする。ToDoのサブタスク・サブタスクの無いToDo自身・案件の段階。
 * 取り消し用の関数を返す(繰り返しのToDoは次回へ進むだけなので取り消しは用意しない)。完了にしなかったらnull
 */
export async function completeProgressStep(
  target: ProgressTarget,
  stepId: string,
  today: string
): Promise<{ title: string; undo?: () => Promise<void> } | null> {
  if (target.kind === "todo") {
    const task = await db.todoTasks.get(stepId);
    if (!task || task.completed) return null;
    await completeTodoTask(task, today);
    if (task.recurrence) return { title: task.title };
    return { title: task.title, undo: async () => void (await db.todoTasks.update(task.id, { completed: false, completedAt: undefined })) };
  }
  const project = await db.projects.get(target.id);
  const stage = project?.stages?.find((s) => s.id === stepId);
  if (!project || !stage || stage.completed || stage.targetCount) return null;
  await toggleProjectStage(project, stepId);
  return {
    title: stage.title,
    undo: async () => {
      const latest = await db.projects.get(target.id);
      if (latest?.stages?.find((s) => s.id === stepId)?.completed) await toggleProjectStage(latest, stepId);
    },
  };
}

/**
 * 残りの手順を本日の作業(未着手)に入れる。同じ手順が今日まだ終わっていない作業として
 * 入っていれば重ねて追加しない。追加したらtrue
 */
export async function addProgressStepToToday(target: ProgressTarget, stepId: string, today: string): Promise<boolean> {
  let category: string;
  let name: string;
  const links: Pick<DailyTask, "projectId" | "stageId" | "todoTaskId"> = {};

  if (target.kind === "todo") {
    const step = await db.todoTasks.get(stepId);
    if (!step) return false;
    const parent = step.parentTaskId ? await db.todoTasks.get(step.parentTaskId) : undefined;
    const list = await db.todoLists.get(step.listId);
    category = parent?.category || step.category || list?.title || "ToDo";
    name = step.title;
    links.todoTaskId = step.id;
  } else {
    const project = await db.projects.get(target.id);
    const stage = project?.stages?.find((s) => s.id === stepId);
    if (!project || !stage) return false;
    category = project.category || project.title;
    name = stage.title;
    links.projectId = project.id;
    links.stageId = stage.id;
    // 案件がToDoから作られたものなら、元のToDoも紐付ける(案件画面の「本日の作業に追加」と同じ)
    const origin = (await db.todoTasks.toArray()).find((t) => t.projectId === project.id);
    if (origin) links.todoTaskId = origin.id;
  }

  const todayTasks = await db.dailyTasks.where("date").equals(today).toArray();
  const already = todayTasks.some(
    (t) =>
      t.status !== "done" &&
      (target.kind === "todo" ? t.todoTaskId === links.todoTaskId && !t.stageId : t.projectId === links.projectId && t.stageId === links.stageId)
  );
  if (already) return false;

  const master = await findOrCreateMasterTask(category, name, 0);
  const estimatedSeconds = await computeRemainingEstimatedSeconds(today, category, name, master.estimatedSeconds);
  await db.dailyTasks.add({
    id: uid(),
    date: today,
    order: todayTasks.length,
    masterTaskId: master.id,
    category,
    name,
    estimatedSeconds,
    status: "pending",
    segments: [],
    accumulatedMs: 0,
    isSpontaneous: true,
    ...links,
  });
  return true;
}

/** 本日の作業に、まだ終わっていない状態で入っている手順(段階・サブタスク・ToDo)の印 */
export function stepKeysInToday(tasks: DailyTask[]): Set<string> {
  const keys = new Set<string>();
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (t.stageId) keys.add(`stage:${t.stageId}`);
    else if (t.todoTaskId) keys.add(`todo:${t.todoTaskId}`);
  }
  return keys;
}
