import type { TodoTask } from "./types";

// サブタスクは単体の名前では何のことか分からない(「見積作成」「確認」など)ため、
// ToDoタブの外(本日の作業・通知・検索・報告など)で名前を出すときは親タスク名を添える。
// 表記は日報・週報の「完了したこと」(reportCompletions.completionLabel)と揃えて「親 › 子」にする

type Lookup = Map<string, Pick<TodoTask, "title">> | ((id: string) => Pick<TodoTask, "title"> | undefined);

function parentOf(task: Pick<TodoTask, "parentTaskId">, lookup: Lookup): Pick<TodoTask, "title"> | undefined {
  if (!task.parentTaskId) return undefined;
  return typeof lookup === "function" ? lookup(task.parentTaskId) : lookup.get(task.parentTaskId);
}

/** サブタスクなら親タスク名、そうでなければundefined(親が削除済みの場合もundefined) */
export function todoParentTitle(task: Pick<TodoTask, "parentTaskId">, lookup: Lookup): string | undefined {
  return parentOf(task, lookup)?.title;
}

/** 「親 › 子」の1行表記。サブタスクでない・親が見つからない場合は自身の名前だけ */
export function todoLabel(task: Pick<TodoTask, "title" | "parentTaskId">, lookup: Lookup): string {
  const parent = todoParentTitle(task, lookup);
  return parent ? `${parent} › ${task.title}` : task.title;
}
