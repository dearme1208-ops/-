import { summarizePostpones } from "./changeTracking";
import type { ProjectItem, TodoTask } from "./types";
import { daysBetweenDateStrs, todayStr } from "./time";

// 停滞している項目を1件ずつ見せて「今日やる/期日を変える/アーカイブ」を決めていく
// 週次レビュー用の対象抽出。件数が多いほど個々の項目が埋もれて見逃されがちなため、
// 一括選択ではなく中身を見ながら1件ずつ判断する棚卸しの入口になる

export type ReviewItemKind = "todo" | "project";
export type ReviewReason = "overdue" | "stale" | "postponed";

export interface ReviewItem {
  kind: ReviewItemKind;
  id: string;
  title: string;
  subtitle?: string; // ToDoの分類/客先、案件の詳細作業名など
  dueDate?: string;
  reason: ReviewReason;
  daysOverdue?: number; // reason==="overdue"の時のみ
  daysSinceCreated?: number; // reason==="stale"の時のみ
  // これまでに期日を後ろへずらした回数・日数の合計(lib/changeTracking.ts)。0回なら未設定
  postponeCount?: number;
  postponeDays?: number;
}

// 期日が無いまま何日以上放置されていれば「停滞」とみなすか
export const STALE_DAYS_THRESHOLD = 14;
// 期日はまだ先でも、何回以上延期していればレビューの対象にするか
export const POSTPONED_REVIEW_THRESHOLD = 3;

function postponeFields(history: TodoTask["dueHistory"]): Pick<ReviewItem, "postponeCount" | "postponeDays"> {
  const { count, totalDays } = summarizePostpones(history);
  return count > 0 ? { postponeCount: count, postponeDays: totalDays } : {};
}

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
          ...postponeFields(t.dueHistory),
        });
      } else if (summarizePostpones(t.dueHistory).count >= POSTPONED_REVIEW_THRESHOLD) {
        // 期日は守れているように見えても、延ばし続けているだけのものは棚卸しの対象にする
        items.push({
          kind: "todo",
          id: t.id,
          title: t.title,
          subtitle: [t.category, t.customer].filter(Boolean).join(" / ") || undefined,
          dueDate: t.dueDate,
          reason: "postponed",
          ...postponeFields(t.dueHistory),
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
        ...postponeFields(p.dueHistory),
      });
    } else if (summarizePostpones(p.dueHistory).count >= POSTPONED_REVIEW_THRESHOLD) {
      items.push({
        kind: "project",
        id: p.id,
        title: p.title,
        subtitle: [p.category, p.workName].filter(Boolean).join(" / ") || undefined,
        dueDate: p.dueDate,
        reason: "postponed",
        ...postponeFields(p.dueHistory),
      });
    }
  }

  // 超過が大きい/放置が長いものほど先に見せる。延期だけが理由のものは、その後にまとめる
  const weight = (i: ReviewItem) => (i.reason === "postponed" ? -1000 + (i.postponeCount ?? 0) : (i.daysOverdue ?? i.daysSinceCreated ?? 0));
  return items.sort((a, b) => weight(b) - weight(a));
}
