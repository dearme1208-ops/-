import { summarizePostpones } from "./changeTracking";
import type { ProjectItem, TodoList, TodoTask } from "./types";
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
  // 件名だけでは何のことか分からない(「42~50」「確認」など)ため、どこに属する項目かを添える
  /** ToDoの入っているリスト名 */
  listTitle?: string;
  /** サブタスクの場合の親タスク名 */
  parentTitle?: string;
  /** ToDoが反映されている案件の件名 */
  projectTitle?: string;
  /** 案件の場合: グループ名と、まだ終わっていない段階(先頭から最大3つ) */
  groupName?: string;
  openStages?: string[];
}

export interface ReviewContextSources {
  lists?: TodoList[];
}

function todoContext(t: TodoTask, todoById: Map<string, TodoTask>, projectById: Map<string, ProjectItem>, listById: Map<string, TodoList>) {
  const parent = t.parentTaskId ? todoById.get(t.parentTaskId) : undefined;
  // サブタスク自身が案件に反映されていなくても、親が反映されていればその案件の一部とみなす
  const projectId = t.projectId ?? parent?.projectId;
  return {
    listTitle: listById.get(t.listId)?.title,
    parentTitle: parent?.title,
    projectTitle: projectId ? projectById.get(projectId)?.title : undefined,
  };
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
  staleDays: number = STALE_DAYS_THRESHOLD,
  sources: ReviewContextSources = {}
): ReviewItem[] {
  const items: ReviewItem[] = [];
  const todoById = new Map(todoTasks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const listById = new Map((sources.lists ?? []).map((l) => [l.id, l]));
  const ctx = (t: TodoTask) => todoContext(t, todoById, projectById, listById);
  const projectCtx = (p: ProjectItem) => ({
    groupName: p.groupName,
    openStages: (p.stages ?? []).filter((s) => !s.completed).slice(0, 3).map((s) => s.title),
  });

  for (const t of todoTasks) {
    if (t.parentTaskId || t.completed || t.archived) continue;
    if (t.dueDate) {
      if (t.dueDate < today) {
        items.push({
          kind: "todo",
          id: t.id,
          title: t.title,
          ...ctx(t),
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
          ...ctx(t),
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
        ...ctx(t),
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
        ...projectCtx(p),
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
        ...projectCtx(p),
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
