import { db, uid } from "./db";
import { findOrCreateMasterTask } from "./master";
import { toggleProjectStage } from "./projectStage";
import { findOriginTodo, projectCategoryFor } from "./projects";
import { computeRemainingEstimatedSeconds, pauseDailyTask, startDailyTaskNow } from "./tasks";
import { completeTodoTask } from "./todo";
import { formatDateJp } from "./time";
import { showUndoToast } from "./toast";
import type { DailyTask, TodoTask } from "./types";

// 「📈 進捗」の行から、残りの手順(段階・サブタスク)をその場で片付けたり、
// 本日の作業へ入れたりする。各画面の「完了」「本日の作業に追加」と同じ紐付けで行う

export type ProgressTarget = { kind: "todo" | "project"; id: string };

/**
 * ToDoを完了にする(繰り返しは次回へ進める)。取り消し用の関数を返す。
 * 取り消しは、そのあと別の操作で状態が変わっていなければ戻す(新しい変更は上書きしない)
 */
export async function completeTodoWithUndo(
  task: TodoTask,
  today: string
): Promise<{ message: string; undo: () => Promise<void> } | null> {
  const before = await db.todoTasks.get(task.id);
  if (!before || before.completed) return null;
  const subsBefore = before.recurrence ? await db.todoTasks.where("parentTaskId").equals(before.id).toArray() : [];
  await completeTodoTask(before, today);
  const after = await db.todoTasks.get(before.id);
  if (!after) return null;
  if (before.recurrence) {
    const subsAfter = await db.todoTasks.where("parentTaskId").equals(before.id).toArray();
    const subAfterById = new Map(subsAfter.map((x) => [x.id, x]));
    // 次回送りで変わる項目(サブタスクの完了・期日・通知も一緒に進む)
    const SUB_KEYS = ["completed", "completedAt", "dueDate", "lastRecurrenceAt", "reminderAt", "reminderFiredAt"] as const;
    const pick = (t: TodoTask) => Object.fromEntries(SUB_KEYS.map((k) => [k, t[k]])) as Partial<TodoTask>;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    return {
      message: `「${before.title}」を済みにしました。次回は${after.dueDate ? formatDateJp(after.dueDate) : "未定"}です`,
      undo: async () => {
        await db.transaction("rw", db.todoTasks, async () => {
          const cur = await db.todoTasks.get(before.id);
          if (!cur || cur.dueDate !== after.dueDate || cur.lastRecurrenceAt !== after.lastRecurrenceAt) return;
          await db.todoTasks.update(before.id, {
            dueDate: before.dueDate,
            lastRecurrenceAt: before.lastRecurrenceAt,
            myDayDate: before.myDayDate,
            reminderAt: before.reminderAt,
            reminderFiredAt: before.reminderFiredAt,
          });
          // 次回送りで変えたサブタスクを、そのあと手を入れていなければ元に戻す
          for (const sb of subsBefore) {
            const sa = subAfterById.get(sb.id);
            const curSub = await db.todoTasks.get(sb.id);
            if (!sa || !curSub || !same(pick(curSub), pick(sa)) || same(pick(sa), pick(sb))) continue;
            await db.todoTasks.update(sb.id, pick(sb));
          }
        });
      },
    };
  }
  return {
    message: `「${before.title}」を完了にしました`,
    undo: async () => {
      const cur = await db.todoTasks.get(before.id);
      if (!cur || !cur.completed || cur.completedAt !== after.completedAt) return;
      await db.todoTasks.update(before.id, { completed: false, completedAt: undefined });
    },
  };
}

/** ToDoを完了にして「元に戻す」付きの知らせを出す(各画面のチェックボックス用) */
export async function completeTodoWithUndoToast(task: TodoTask, today: string): Promise<boolean> {
  const done = await completeTodoWithUndo(task, today);
  if (!done) return false;
  showUndoToast(done.message, done.undo);
  return true;
}

/**
 * 残りの手順を完了にする。ToDoのサブタスク・サブタスクの無いToDo自身・案件の段階。
 * 取り消し用の関数を返す。完了にしなかったらnull。
 * offerProjectCompletion: 段階を済ませたことで全段階が済んだ(「案件も完了にしますか」を出す)
 */
export async function completeProgressStep(
  target: ProgressTarget,
  stepId: string,
  today: string
): Promise<{ title: string; undo?: () => Promise<void>; offerProjectCompletion?: boolean } | null> {
  if (target.kind === "todo") {
    const task = await db.todoTasks.get(stepId);
    if (!task || task.completed) return null;
    const done = await completeTodoWithUndo(task, today);
    if (!done) return null;
    return { title: task.title, undo: done.undo };
  }
  const project = await db.projects.get(target.id);
  const stage = project?.stages?.find((s) => s.id === stepId);
  if (!project || !stage || stage.completed || stage.targetCount) return null;
  const result = await toggleProjectStage(project, stepId);
  return {
    title: stage.title,
    offerProjectCompletion: result?.offerProjectCompletion,
    undo: async () => {
      const latest = await db.projects.get(target.id);
      if (latest?.stages?.find((s) => s.id === stepId)?.completed) await toggleProjectStage(latest, stepId);
    },
  };
}

export type AddProjectToTodayResult =
  | { status: "added"; task: DailyTask }
  | { status: "started"; task: DailyTask } // 既に入っていた同じ作業を、そのまま始めた
  | { status: "already"; task: DailyTask } // 既に入っている(重ねて追加しない)
  | { status: "missing" };

/**
 * 案件(または段階)を本日の作業に入れる。案件タブ・📈進捗・各画面で共通の入口。
 * ・同じ段階(段階なしなら同じ案件・同じ作業名)が今日まだ終わっていなければ重ねて追加しない
 * ・案件がToDoから作られたものなら、元のToDoも紐付ける
 * ・業務区分は指定 → 案件の業務区分 → 件名 の順
 * startNow なら計測中の作業を一時停止してから始める(既に入っていればそれを再開する)
 */
export async function addProjectToToday(opts: {
  projectId: string;
  stageId?: string;
  category?: string;
  name?: string;
  startNow?: boolean;
  today: string;
}): Promise<AddProjectToTodayResult> {
  const project = await db.projects.get(opts.projectId);
  if (!project) return { status: "missing" };
  const stage = opts.stageId ? project.stages?.find((s) => s.id === opts.stageId) : undefined;
  if (opts.stageId && !stage) return { status: "missing" };
  const category = opts.category?.trim() || projectCategoryFor(project);
  const name = opts.name?.trim() || stage?.title || project.workName || project.title;

  const todayTasks = await db.dailyTasks.where("date").equals(opts.today).toArray();
  const existing = todayTasks.find(
    (t) => t.status !== "done" && t.projectId === project.id && (stage ? t.stageId === stage.id : !t.stageId && t.name === name)
  );
  const nowMs = Date.now();
  const pauseRunning = async (exceptId?: string) => {
    const running = todayTasks.find((t) => t.status === "running" && t.id !== exceptId);
    if (running) await pauseDailyTask(running, nowMs);
  };
  if (existing) {
    if (!opts.startNow || existing.status === "running") return { status: "already", task: existing };
    await pauseRunning(existing.id);
    await startDailyTaskNow(existing.id, nowMs);
    return { status: "started", task: (await db.dailyTasks.get(existing.id)) ?? existing };
  }
  if (opts.startNow) await pauseRunning();

  const origin = await findOriginTodo(project.id);
  const master = await findOrCreateMasterTask(category, name, 0);
  const estimatedSeconds = await computeRemainingEstimatedSeconds(opts.today, category, name, master.estimatedSeconds);
  const task: DailyTask = {
    id: uid(),
    date: opts.today,
    order: todayTasks.length,
    masterTaskId: master.id,
    category,
    name,
    estimatedSeconds,
    status: opts.startNow ? "running" : "pending",
    segments: opts.startNow ? [{ start: nowMs }] : [],
    accumulatedMs: 0,
    startedAt: opts.startNow ? nowMs : undefined,
    isSpontaneous: true,
    projectId: project.id,
    stageId: stage?.id,
    todoTaskId: origin?.id,
  };
  // 上の確認から追加までの間に(ボタンの連打などで)同じ作業が入っていたら重ねない
  const raced = await db.transaction("rw", db.dailyTasks, async () => {
    const dup = (await db.dailyTasks.where("date").equals(opts.today).toArray()).find(
      (t) => t.status !== "done" && t.projectId === project.id && (stage ? t.stageId === stage.id : !t.stageId && t.name === name)
    );
    if (dup) return dup;
    await db.dailyTasks.add(task);
    return null;
  });
  if (raced) return { status: "already", task: raced };
  return { status: "added", task };
}

/**
 * 残りの手順を本日の作業(未着手)に入れる。同じ手順が今日まだ終わっていない作業として
 * 入っていれば重ねて追加しない。追加したらtrue
 */
export async function addProgressStepToToday(target: ProgressTarget, stepId: string, today: string): Promise<boolean> {
  if (target.kind === "project") {
    const r = await addProjectToToday({ projectId: target.id, stageId: stepId, today });
    return r.status === "added";
  }

  const step = await db.todoTasks.get(stepId);
  if (!step) return false;
  const parent = step.parentTaskId ? await db.todoTasks.get(step.parentTaskId) : undefined;
  const list = await db.todoLists.get(step.listId);
  const category = parent?.category || step.category || list?.title || "ToDo";
  const name = step.title;

  const todayTasks = await db.dailyTasks.where("date").equals(today).toArray();
  if (todayTasks.some((t) => t.status !== "done" && t.todoTaskId === step.id && !t.stageId)) return false;

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
    todoTaskId: step.id,
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
