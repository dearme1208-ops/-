import type { ProjectItem, TodoTask } from "./types";
import { daysBetweenDateStrs, todayStr } from "./time";

// 停滞している項目を1件ずつ見せて「今日やる/期日を変える/アーカイブ」を決めていく
// 週次レビュー用の対象抽出。件数が多いほど個々の項目が埋もれて見逃されがちなため、
// 一括選択ではなく中身を見ながら1件ずつ判断する棚卸しの入口になる

export type ReviewItemKind = "todo" | "project";
export type ReviewReason = "overdue" | "stale";

export interface ReviewItem {
  kind: ReviewItemKind;
  id: string;
  title: string;
  subtitle?: string; // ToDoの分類/客先、案件の詳細作業名など
  dueDate?: string;
  reason: ReviewReason;
  daysOverdue?: number; // reason==="overdue"の時のみ
  daysSinceCreated?: number; // reason==="stale"の時のみ
}

// 期日が無いまま何日以上放置されていれば「停滞」とみなすか
export const STALE_DAYS_THRESHOLD = 14;

export function buildWeeklyReviewQueue(
  todoTasks: TodoTask[],
  projects: ProjectItem[],
  today: string = todayStr(),
  staleDays: number = STALE_DAYS_THRESHOLD
): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const t of todoTasks) {
    if (t.parentTaskId || t.completed || t.archived) continue;
    if (t.dueDate) {
      if (t.dueDate < today) {
        items.push({
          kind: "todo",
          id: t.id,
          title: t.title,
          subtitle: [t.category, t.customer].filter(Boolean).join(" / ") || undefined,
          dueDate: t.dueDate,
          reason: "overdue",
          daysOverdue: daysBetweenDateStrs(t.dueDate, today),
        });
      }
      continue;
    }
    const daysSinceCreated = daysBetweenDateStrs(todayStr(new Date(t.createdAt)), today);
    if (daysSinceCreated >= staleDays) {
      items.push({
        kind: "todo",
        id: t.id,
        title: t.title,
        subtitle: [t.category, t.customer].filter(Boolean).join(" / ") || undefined,
        reason: "stale",
        daysSinceCreated,
      });
    }
  }

  for (const p of projects) {
    if (p.completedAt || p.archived) continue;
    if (p.dueDate < today) {
      items.push({
        kind: "project",
        id: p.id,
        title: p.title,
        subtitle: [p.category, p.workName].filter(Boolean).join(" / ") || undefined,
        dueDate: p.dueDate,
        reason: "overdue",
        daysOverdue: daysBetweenDateStrs(p.dueDate, today),
      });
    }
  }

  // 超過が大きい/放置が長いものほど先に見せる
  return items.sort((a, b) => (b.daysOverdue ?? b.daysSinceCreated ?? 0) - (a.daysOverdue ?? a.daysSinceCreated ?? 0));
}
