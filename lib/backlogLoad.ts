// ToDo・案件を抱えすぎて期限切れが常態化する問題に対処するための2つの計算:
// ①期日入力時に「この日は既に混んでいる」と気づける読み込み具合(load)
// ②積み上がり(バックログ)が日々増えているか減っているかの俯瞰
import type { ProjectItem, TodoTask } from "./types";
import { shiftDateStr, todayStr } from "./time";

export interface DueDateLoad {
  todoCount: number;
  projectCount: number;
  total: number;
}

// 指定した日付(YYYY-MM-DD)に既に期限が入っている、未完了のToDo・案件の件数。
// 期日入力欄で「この日はもう混んでいる」を警告するために使う。編集中の項目自体は
// 数えないよう、excludeで自分自身のIDを除外できる
export function computeDueDateLoad(
  todoTasks: TodoTask[],
  projects: ProjectItem[],
  dateStr: string,
  exclude?: { todoId?: string; projectId?: string }
): DueDateLoad {
  const todoCount = todoTasks.filter(
    (t) => !t.completed && t.dueDate === dateStr && t.id !== exclude?.todoId
  ).length;
  const projectCount = projects.filter(
    (p) => !p.completedAt && p.dueDate === dateStr && p.id !== exclude?.projectId
  ).length;
  return { todoCount, projectCount, total: todoCount + projectCount };
}

export interface BacklogTrendPoint {
  date: string;
  label: string;
  created: number;
  completed: number;
  backlogSize: number;
}

function dateStrOfMs(epochMs: number): string {
  return todayStr(new Date(epochMs));
}

// 直近days日間の「新規に増えた件数」「完了した件数」の推移と、その差分の累積である
// 未完了バックログ件数の推移を求める。日次スナップショットを別途保存しなくても、
// 既存のcreatedAt/completedAtから逆算できる(サブタスクも1件として数える)
export function computeBacklogTrend(
  todoTasks: TodoTask[],
  projects: ProjectItem[],
  days: number,
  today: string = todayStr()
): BacklogTrendPoint[] {
  const startDate = shiftDateStr(today, -(days - 1));
  const items: { createdAt: number; completedAt?: number }[] = [
    ...todoTasks.map((t) => ({ createdAt: t.createdAt, completedAt: t.completedAt })),
    ...projects.map((p) => ({ createdAt: p.createdAt, completedAt: p.completedAt })),
  ];

  // 集計開始日の時点で、まだ残っていた(作成済みで、その時点でまだ完了していない)件数を
  // バックログの初期値にする
  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  let backlogSize = items.filter(
    (it) => it.createdAt < startMs && (it.completedAt === undefined || it.completedAt >= startMs)
  ).length;

  const createdByDate = new Map<string, number>();
  const completedByDate = new Map<string, number>();
  for (const it of items) {
    const createdDate = dateStrOfMs(it.createdAt);
    if (createdDate >= startDate && createdDate <= today) {
      createdByDate.set(createdDate, (createdByDate.get(createdDate) ?? 0) + 1);
    }
    if (it.completedAt !== undefined) {
      const completedDate = dateStrOfMs(it.completedAt);
      if (completedDate >= startDate && completedDate <= today) {
        completedByDate.set(completedDate, (completedByDate.get(completedDate) ?? 0) + 1);
      }
    }
  }

  const result: BacklogTrendPoint[] = [];
  let cursor = startDate;
  for (let i = 0; i < days; i++) {
    const created = createdByDate.get(cursor) ?? 0;
    const completed = completedByDate.get(cursor) ?? 0;
    backlogSize = Math.max(0, backlogSize + created - completed);
    const d = new Date(`${cursor}T00:00:00`);
    result.push({ date: cursor, label: `${d.getMonth() + 1}/${d.getDate()}`, created, completed, backlogSize });
    cursor = shiftDateStr(cursor, 1);
  }
  return result;
}

export interface BacklogBreakdownRow {
  label: string;
  count: number;
}

export interface BacklogBreakdown {
  todoByCategory: BacklogBreakdownRow[];
  projectByCategory: BacklogBreakdownRow[];
}

function tally(labels: string[]): BacklogBreakdownRow[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// 現在の期限切れの内訳。「何(どの分類)が原因で溜まっているか」に気づけるよう、
// ToDo・案件それぞれ分類(category)別に集計する
export function computeBacklogBreakdown(
  todoTasks: TodoTask[],
  projects: ProjectItem[],
  today: string = todayStr()
): BacklogBreakdown {
  const todoLabels = todoTasks
    .filter((t) => !t.completed && t.dueDate && t.dueDate < today)
    .map((t) => t.category?.trim() || "分類なし");
  const projectLabels = projects.filter((p) => !p.completedAt && p.dueDate < today).map((p) => p.category?.trim() || "分類なし");
  return { todoByCategory: tally(todoLabels), projectByCategory: tally(projectLabels) };
}
