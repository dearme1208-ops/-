import { aggregateKey } from "./aggregate";
import type { TodoTask, WorkRecord } from "./types";

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

// 作業時間ランキングなどの集計行(実績を作業ごとにまとめたもの)向け。サブタスクから
// 「本日の作業」に追加した作業は、作業名が既定でサブタスク名のままになるため、
// 報告に「業務 / 見積作成」とだけ出て何の見積か分からなかった。実績に残っている
// todoTaskIdから親タスク名を引き、集計行の作業名を「親 › 作業名」にする。
// 1つの行に異なる親が混ざる場合は「・」でつなぐ。作業名に既に親の名前が入っていれば付けない
export function withSubtaskParentNames<T extends { key: string; name: string }>(
  rows: T[],
  records: Pick<WorkRecord, "todoTaskId" | "isTrouble" | "masterTaskId" | "category" | "name">[],
  todoTasks: Pick<TodoTask, "id" | "title" | "parentTaskId">[]
): T[] {
  const byId = new Map(todoTasks.map((t) => [t.id, t]));
  const parentsByKey = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.todoTaskId) continue;
    const todo = byId.get(r.todoTaskId);
    const parent = todo ? todoParentTitle(todo, byId) : undefined;
    if (!parent) continue;
    const key = aggregateKey(r as WorkRecord);
    if (!parentsByKey.has(key)) parentsByKey.set(key, new Set());
    parentsByKey.get(key)!.add(parent);
  }
  return rows.map((row) => {
    const parents = [...(parentsByKey.get(row.key) ?? [])].filter((p) => !row.name.includes(p));
    return parents.length > 0 ? { ...row, name: `${parents.join("・")} › ${row.name}` } : row;
  });
}
