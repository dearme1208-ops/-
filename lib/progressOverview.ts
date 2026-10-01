import { computeProjectProgress, isStageDone } from "./projectStage";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";
import type { ProjectItem, TodoTask } from "./types";

// ToDo・案件を1件ずつ「どこまで進んだか」「期日に対して間に合うペースか」「止まっていないか」で
// 並べて見るための集計(統合ボードの「📈 進捗」表示)。
// ペースは、登録日から期日までのうち経過した割合(時間の進み)と、段階・サブタスクの完了割合
// (仕事の進み)を突き合わせて見る。時間の進みに対して仕事が大きく遅れていれば「遅れ気味」

export type ProgressStatus = "overdue" | "behind" | "stalled" | "onTrack" | "noDue";

export const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  overdue: "期限切れ",
  behind: "遅れ気味",
  stalled: "停滞",
  onTrack: "順調",
  noDue: "期日なし",
};

// 危ない順(並べ替え・集計の表示順)
export const PROGRESS_STATUS_ORDER: ProgressStatus[] = ["overdue", "behind", "stalled", "onTrack", "noDue"];

/** 時間の進みに対して、仕事の進みがこれ以上遅れていたら「遅れ気味」 */
export const BEHIND_MARGIN = 0.2;
/** この日数以上、段階・サブタスクの完了も対応状況の変更も無ければ「停滞」 */
export const STALL_DAYS = 14;
/** 動きを点で見せる日数 */
export const ACTIVITY_DAYS = 14;

export interface ProgressRow {
  key: string;
  kind: "todo" | "project";
  id: string;
  title: string;
  /** 0〜1。段階・サブタスクが無いToDoは0(完了すれば一覧から消える) */
  progress: number;
  done: number;
  total: number;
  /** 0〜1。登録日から期日までのうち経過した割合。期日が無ければundefined */
  elapsed?: number;
  dueDate?: string;
  daysLeft?: number;
  status: ProgressStatus;
  /** 最後に動いた(段階・サブタスクの完了、対応状況の変更、登録)日からの日数 */
  idleDays: number;
  /** 直近ACTIVITY_DAYS日の、日ごとの完了数(古い順) */
  activity: number[];
  /** 次に片付けるもの(未完了の最初の段階・サブタスク) */
  next?: string;
}

function dateOf(ms: number): string {
  return todayStr(new Date(ms));
}

function elapsedFraction(createdAt: number, dueDate: string, today: string): number {
  const start = dateOf(createdAt);
  const span = daysBetweenDateStrs(start, dueDate);
  if (span <= 0) return today >= dueDate ? 1 : 0;
  return Math.min(1, Math.max(0, daysBetweenDateStrs(start, today) / span));
}

function activityOf(completedAts: number[], today: string): number[] {
  const first = shiftDateStr(today, -(ACTIVITY_DAYS - 1));
  const counts = new Array(ACTIVITY_DAYS).fill(0);
  for (const at of completedAts) {
    const d = dateOf(at);
    if (d < first || d > today) continue;
    counts[daysBetweenDateStrs(first, d)]++;
  }
  return counts;
}

function statusOf(row: Pick<ProgressRow, "progress" | "elapsed" | "dueDate" | "idleDays" | "total">, today: string): ProgressStatus {
  if (row.dueDate && row.dueDate < today) return "overdue";
  // 段階・サブタスクが無いものは仕事の進みを測れないので、ペースでは判定しない
  if (row.total > 0 && row.elapsed !== undefined && row.elapsed - row.progress > BEHIND_MARGIN) return "behind";
  if (row.idleDays >= STALL_DAYS) return "stalled";
  if (!row.dueDate) return "noDue";
  return "onTrack";
}

function finish(row: Omit<ProgressRow, "status">, today: string): ProgressRow {
  return { ...row, status: statusOf(row, today) };
}

export function buildProgressRows({
  todos,
  subtasksByParent,
  projects,
  today = todayStr(),
}: {
  /** 未完了の親タスク(サブタスクを含めない) */
  todos: TodoTask[];
  subtasksByParent: Map<string, TodoTask[]>;
  /** 未完了の案件 */
  projects: ProjectItem[];
  today?: string;
}): ProgressRow[] {
  const rows: ProgressRow[] = [];

  for (const t of todos) {
    const subs = subtasksByParent.get(t.id) ?? [];
    const done = subs.filter((s) => s.completed).length;
    const completedAts = subs.flatMap((s) => (s.completed && s.completedAt ? [s.completedAt] : []));
    const lastMove = Math.max(t.createdAt, t.tagChangedAt ?? 0, ...completedAts);
    rows.push(
      finish(
        {
          key: `todo:${t.id}`,
          kind: "todo",
          id: t.id,
          title: t.title,
          progress: subs.length > 0 ? done / subs.length : 0,
          done,
          total: subs.length,
          elapsed: t.dueDate ? elapsedFraction(t.createdAt, t.dueDate, today) : undefined,
          dueDate: t.dueDate,
          daysLeft: t.dueDate ? daysBetweenDateStrs(today, t.dueDate) : undefined,
          idleDays: Math.max(0, daysBetweenDateStrs(dateOf(lastMove), today)),
          activity: activityOf(completedAts, today),
          next: subs.find((s) => !s.completed)?.title,
        },
        today
      )
    );
  }

  for (const p of projects) {
    const stages = p.stages ?? [];
    const done = stages.filter(isStageDone).length;
    const completedAts = stages.flatMap((s) => (isStageDone(s) && s.completedAt ? [s.completedAt] : []));
    const lastMove = Math.max(p.createdAt, p.tagChangedAt ?? 0, ...completedAts);
    const dueDate = p.dueDate || undefined;
    rows.push(
      finish(
        {
          key: `project:${p.id}`,
          kind: "project",
          id: p.id,
          title: p.groupName ? `${p.groupName} ${p.title}` : p.title,
          progress: computeProjectProgress(stages) ?? 0,
          done,
          total: stages.length,
          elapsed: dueDate ? elapsedFraction(p.createdAt, dueDate, today) : undefined,
          dueDate,
          daysLeft: dueDate ? daysBetweenDateStrs(today, dueDate) : undefined,
          idleDays: Math.max(0, daysBetweenDateStrs(dateOf(lastMove), today)),
          activity: activityOf(completedAts, today),
          next: stages.find((s) => !isStageDone(s))?.title,
        },
        today
      )
    );
  }

  return rows;
}

export type ProgressSort = "risk" | "due" | "progress" | "idle";

export function sortProgressRows(rows: ProgressRow[], sort: ProgressSort): ProgressRow[] {
  const dueKey = (r: ProgressRow) => r.dueDate ?? "9999-12-31";
  const byRisk = (a: ProgressRow, b: ProgressRow) =>
    PROGRESS_STATUS_ORDER.indexOf(a.status) - PROGRESS_STATUS_ORDER.indexOf(b.status) ||
    // 同じ状態の中では、時間の進みに対する仕事の遅れが大きいもの・期日が近いものを先に
    ((b.elapsed ?? 0) - b.progress) - ((a.elapsed ?? 0) - a.progress) ||
    dueKey(a).localeCompare(dueKey(b));
  const sorted = [...rows];
  if (sort === "risk") sorted.sort(byRisk);
  if (sort === "due") sorted.sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || byRisk(a, b));
  if (sort === "progress") sorted.sort((a, b) => a.progress - b.progress || byRisk(a, b));
  if (sort === "idle") sorted.sort((a, b) => b.idleDays - a.idleDays || byRisk(a, b));
  return sorted;
}

export interface ProgressSummary {
  counts: Record<ProgressStatus, number>;
  /** 段階・サブタスク・ToDo・案件を合わせた、日ごとの完了数(直近ACTIVITY_DAYS日・古い順) */
  daily: number[];
  thisWeek: number;
  lastWeek: number;
}

/** 全体のまとめ。完了したもの(一覧から消えたToDo・案件)も「片付いた数」には含める */
export function summarizeProgress({
  rows,
  allTodos,
  allProjects,
  today = todayStr(),
}: {
  rows: ProgressRow[];
  allTodos: TodoTask[];
  allProjects: ProjectItem[];
  today?: string;
}): ProgressSummary {
  const counts = Object.fromEntries(PROGRESS_STATUS_ORDER.map((s) => [s, 0])) as Record<ProgressStatus, number>;
  for (const r of rows) counts[r.status]++;

  const at: number[] = [];
  for (const t of allTodos) if (t.completed && t.completedAt) at.push(t.completedAt);
  for (const p of allProjects) {
    if (p.completedAt) at.push(p.completedAt);
    for (const s of p.stages ?? []) if (isStageDone(s) && s.completedAt) at.push(s.completedAt);
  }
  const weekStart = shiftDateStr(today, -6);
  const lastWeekStart = shiftDateStr(today, -13);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const ms of at) {
    const d = dateOf(ms);
    if (d >= weekStart && d <= today) thisWeek++;
    else if (d >= lastWeekStart && d < weekStart) lastWeek++;
  }
  return { counts, daily: activityOf(at, today), thisWeek, lastWeek };
}
