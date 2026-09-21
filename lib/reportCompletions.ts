import type { ProjectItem, TodoTask } from "./types";
import { isStageDone } from "./projectStage";

// 日報・週報に「実際に何が終わったか」を載せるための集計。
//
// これまで報告に出ていたのは作業時間(実績)と、ToDoの件数の増減だけだった。
// ただ日報に書きたいのは「案件のどの段階まで進んだか」「どのサブタスクを片付けたか」で、
// そこは完了時刻(completedAt)を持っているのに、どこにも出していなかった。
//
// サブタスクは単体では何のことか分からないため、必ず親タスク名とセットで返す。
// 同じ理由で段階も案件名とセットにする。
export interface CompletedStageEntry {
  projectTitle: string;
  stageTitle: string;
  completedAt: number;
}

export interface CompletedTodoEntry {
  title: string;
  /** サブタスクの場合の親タスク名。単独のタスクでは未設定 */
  parentTitle?: string;
  completedAt: number;
}

export interface PeriodCompletions {
  /** 完了した案件の段階 */
  stages: CompletedStageEntry[];
  /** 完了した単独タスク(サブタスクを持たない/親そのもの) */
  todos: CompletedTodoEntry[];
  /** 完了したサブタスク */
  subtasks: CompletedTodoEntry[];
}

const inRange = (at: number | undefined, startMs: number, endMs: number): at is number =>
  at !== undefined && at >= startMs && at < endMs;

export function collectPeriodCompletions(
  todoTasks: TodoTask[],
  projects: ProjectItem[],
  startMs: number,
  endMs: number
): PeriodCompletions {
  const titleById = new Map(todoTasks.map((t) => [t.id, t.title]));

  const todos: CompletedTodoEntry[] = [];
  const subtasks: CompletedTodoEntry[] = [];
  for (const t of todoTasks) {
    if (!t.completed || !inRange(t.completedAt, startMs, endMs)) continue;
    if (t.parentTaskId) {
      subtasks.push({
        title: t.title,
        parentTitle: titleById.get(t.parentTaskId),
        completedAt: t.completedAt,
      });
    } else {
      todos.push({ title: t.title, completedAt: t.completedAt });
    }
  }

  const stages: CompletedStageEntry[] = [];
  for (const p of projects) {
    for (const s of p.stages ?? []) {
      // 件数管理の段階は「目標件数に達したか」で完了を判定する(isStageDoneに合わせる)
      if (!isStageDone(s) || !inRange(s.completedAt, startMs, endMs)) continue;
      stages.push({ projectTitle: p.title, stageTitle: s.title, completedAt: s.completedAt });
    }
  }

  const byTime = (a: { completedAt: number }, b: { completedAt: number }) => a.completedAt - b.completedAt;
  return {
    stages: stages.sort(byTime),
    todos: todos.sort(byTime),
    subtasks: subtasks.sort(byTime),
  };
}

export function hasAnyCompletion(c: PeriodCompletions): boolean {
  return c.stages.length > 0 || c.todos.length > 0 || c.subtasks.length > 0;
}

/** サブタスクを「親 › 子」の形にする。親が消えている場合は子の名前だけ返す */
export function completionLabel(entry: CompletedTodoEntry): string {
  return entry.parentTitle ? `${entry.parentTitle} › ${entry.title}` : entry.title;
}
