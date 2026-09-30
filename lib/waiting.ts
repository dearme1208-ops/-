import { effectiveTag } from "./todo";
import { summarizePostpones, waitingInfo, type PostponeSummary, type WaitingInfo } from "./changeTracking";
import type { ProjectItem, TodoTask } from "./types";

// ToDo・案件の一覧で使う「相手待ち」「延期」の判定。ToDoは、サブタスクを持つ場合に
// 対応状況がサブタスクから自動で決まる(effectiveTag)ので、日数もそれに合わせる

/**
 * ToDoの相手待ち情報。サブタスクを持つ場合は、親に出ている対応状況と同じ状況の
 * サブタスクのうち、一番長くその状況にあるもの(=一番待たされているもの)の日数を使う
 */
export function todoWaitingInfo(
  task: TodoTask,
  subtasks: TodoTask[],
  priorityOrder: string[],
  waitingTags: string[],
  nudgeDays: number,
  now: number
): WaitingInfo | null {
  const tag = effectiveTag(task, subtasks, priorityOrder);
  if (subtasks.length === 0) return waitingInfo(task, waitingTags, nudgeDays, now);
  const open = subtasks.filter((s) => !s.completed && s.tag === tag);
  const pool = open.length > 0 ? open : subtasks.filter((s) => s.tag === tag);
  const since = pool.map((s) => s.tagChangedAt).filter((v): v is number => v !== undefined);
  return waitingInfo({ tag, tagChangedAt: since.length > 0 ? Math.min(...since) : undefined }, waitingTags, nudgeDays, now);
}

/** ToDoの延期。親の期日と未完了サブタスクの期日の延期を合わせて数える */
export function todoPostpones(task: TodoTask, subtasks: TodoTask[]): PostponeSummary {
  const all = [task, ...subtasks.filter((s) => !s.completed)].map((t) => summarizePostpones(t.dueHistory));
  return all.reduce((a, b) => ({ count: a.count + b.count, totalDays: a.totalDays + b.totalDays }), { count: 0, totalDays: 0 });
}

/**
 * 案件の相手待ち情報。段階を持たない案件は案件そのものの対応状況、段階を持つ案件は
 * 未完了の段階の対応状況のうち、相手待ちで一番長く待たされているものを返す
 * (どの段階か分かるようstageTitleを添える)
 */
export function projectWaitingInfo(
  project: ProjectItem,
  waitingTags: string[],
  nudgeDays: number,
  now: number
): (WaitingInfo & { stageTitle?: string }) | null {
  const candidates: (WaitingInfo & { stageTitle?: string })[] = [];
  // 段階を持つ案件の対応状況は段階から自動で決まり、案件自体に残っている値は使われない
  // (effectiveProjectTag)。その値で「待ち」と数えると画面の表示と食い違うため、段階だけを見る
  if ((project.stages ?? []).length === 0) {
    const own = waitingInfo(project, waitingTags, nudgeDays, now);
    if (own) candidates.push(own);
  }
  for (const s of project.stages ?? []) {
    if (s.completed) continue;
    const w = waitingInfo(s, waitingTags, nudgeDays, now);
    if (w) candidates.push({ ...w, stageTitle: s.title });
  }
  if (candidates.length === 0) return null;
  // 日数の分かるものの中で一番長いもの。どれも日数が不明なら先頭(案件自体を優先)
  return candidates.reduce((a, b) => ((b.days ?? -1) > (a.days ?? -1) ? b : a));
}

/** 設定値(JSON配列)から相手待ちの対応状況を読む。壊れていれば既定値 */
export function parseWaitingTags(json: string, fallback: string[]): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string" && v.trim() !== "") : fallback;
  } catch {
    return fallback;
  }
}


export interface WaitingItem {
  kind: "todo" | "project";
  id: string;
  /** 表示名。案件の段階が待ちの場合は「案件 › 段階」 */
  label: string;
  tag: string;
  days: number | null;
  overdue: boolean;
}

/**
 * 日報・週報に載せる「相手の返事待ち」の一覧。未完了・未アーカイブのToDo(親単位。サブタスクの
 * 待ちは親の行にまとめる)と案件(段階の待ちを含む)を、待たされている日数の長い順に並べる
 */
export function collectWaitingItems(
  todoTasks: TodoTask[],
  projects: ProjectItem[],
  priorityOrder: string[],
  waitingTags: string[],
  nudgeDays: number,
  now: number
): WaitingItem[] {
  const subtasksByParent = new Map<string, TodoTask[]>();
  for (const t of todoTasks) {
    if (!t.parentTaskId) continue;
    subtasksByParent.set(t.parentTaskId, [...(subtasksByParent.get(t.parentTaskId) ?? []), t]);
  }
  const items: WaitingItem[] = [];
  for (const t of todoTasks) {
    if (t.parentTaskId || t.completed || t.archived) continue;
    const w = todoWaitingInfo(t, subtasksByParent.get(t.id) ?? [], priorityOrder, waitingTags, nudgeDays, now);
    if (w) items.push({ kind: "todo", id: t.id, label: t.title, tag: w.tag, days: w.days, overdue: w.overdue });
  }
  for (const p of projects) {
    if (p.completedAt) continue;
    const w = projectWaitingInfo(p, waitingTags, nudgeDays, now);
    if (w) {
      items.push({
        kind: "project",
        id: p.id,
        label: w.stageTitle ? `${p.title} › ${w.stageTitle}` : p.title,
        tag: w.tag,
        days: w.days,
        overdue: w.overdue,
      });
    }
  }
  return items.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
}

/** 報告用の1行表記: 「客先確認中 5日目 ⏰ A社見積」 */
export function waitingItemLine(item: WaitingItem): string {
  const days = item.days != null ? ` ${item.days}日目` : "";
  return `${item.tag}${days}${item.overdue ? " ⏰" : ""} ${item.kind === "project" ? "［案件］" : ""}${item.label}`;
}

export interface PostponedItem {
  kind: "todo" | "project";
  id: string;
  label: string;
  count: number;
  totalDays: number;
}

/**
 * 期日を何度も後ろへずらしている未完了のToDo・案件(minCount回以上)。回数の多い順。
 * 要注意リストと週次レビューで、「分けるか・やめるか・頼むか」を考えるきっかけにする
 */
export function collectFrequentlyPostponed(todoTasks: TodoTask[], projects: ProjectItem[], minCount: number): PostponedItem[] {
  const subtasksByParent = new Map<string, TodoTask[]>();
  for (const t of todoTasks) {
    if (!t.parentTaskId) continue;
    subtasksByParent.set(t.parentTaskId, [...(subtasksByParent.get(t.parentTaskId) ?? []), t]);
  }
  const items: PostponedItem[] = [];
  for (const t of todoTasks) {
    if (t.parentTaskId || t.completed || t.archived) continue;
    const s = todoPostpones(t, subtasksByParent.get(t.id) ?? []);
    if (s.count >= minCount) items.push({ kind: "todo", id: t.id, label: t.title, ...s });
  }
  for (const p of projects) {
    if (p.completedAt) continue;
    const s = summarizePostpones(p.dueHistory);
    if (s.count >= minCount) items.push({ kind: "project", id: p.id, label: p.title, ...s });
  }
  return items.sort((a, b) => b.count - a.count || b.totalDays - a.totalDays);
}
