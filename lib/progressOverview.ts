import { isStageDone, stageProgressFraction } from "./projectStage";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";
import { summarizePostpones, type DueChange } from "./changeTracking";
import type { ProjectItem, TodoTask } from "./types";

// ToDo・案件を1件ずつ「どこまで進んだか」「期日に対して間に合うペースか」「止まっていないか」で
// 並べて見るための集計(統合ボードの「📈 進捗」表示)。
// ペースは2つの見方を合わせる:
//  ・時間の進み: 登録日から期日までのうち経過した割合に対して、段階・サブタスクの完了割合が大きく遅れていないか
//  ・見込み: これまでの片付けるペースが続いたとき、残りが期日までに終わるか
// 期日を守るために「次にどれへ手を付けるか」を決め、その場で動ける(完了・今日やる)ようにするのが目的

export type ProgressStatus = "overdue" | "behind" | "waiting" | "stalled" | "onTrack" | "noDue";

export const PROGRESS_STATUS_LABELS: Record<ProgressStatus, string> = {
  overdue: "期限切れ",
  behind: "遅れ気味",
  waiting: "相手待ち",
  stalled: "停滞",
  onTrack: "順調",
  noDue: "期日なし",
};

// 危ない順(並べ替え・集計の表示順)
export const PROGRESS_STATUS_ORDER: ProgressStatus[] = ["overdue", "behind", "waiting", "stalled", "onTrack", "noDue"];

/** 時間の進みに対して、仕事の進みがこれ以上遅れていたら「遅れ気味」 */
export const BEHIND_MARGIN = 0.2;
/** この日数以上、段階・サブタスクの完了も対応状況の変更も無ければ「停滞」 */
export const STALL_DAYS = 14;
/** 動きを点で見せる日数 */
export const ACTIVITY_DAYS = 14;

/** 段階・サブタスク(残りの手順)。ToDoでサブタスクが無ければToDo自身を1つの手順として扱う */
export interface ProgressStep {
  id: string;
  title: string;
  done: boolean;
  completedAt?: number;
  dueDate?: string;
  /** 件数で進捗を管理する段階(完了操作は案件の画面で件数を入れる) */
  countLabel?: string;
}

export interface ProgressRow {
  key: string;
  kind: "todo" | "project";
  id: string;
  title: string;
  /** 0〜1。段階・サブタスクが無いToDoは0(完了すれば一覧から消える) */
  progress: number;
  done: number;
  total: number;
  /** 登録日(YYYY-MM-DD) */
  start: string;
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
  steps: ProgressStep[];
  /** これまでのペースが続いた場合に、残りが片付く見込みの日。1件も片付いていなければundefined */
  forecastDate?: string;
  /** 期日までに残りを片付けるのに必要な、1週間あたりの件数 */
  neededPerWeek?: number;
  /** これまでの1週間あたりの片付けた件数 */
  pacePerWeek?: number;
  /** 相手待ちの対応状況なら、その状況名と待っている日数 */
  waiting?: { tag: string; days?: number; nudge: boolean };
  /** 期日を延ばした回数 */
  postponeCount: number;
}

export interface WaitingLookup {
  todo: (t: TodoTask, subtasks: TodoTask[]) => { tag: string; days: number | null; overdue: boolean } | null;
  project: (p: ProjectItem) => { tag: string; days: number | null; overdue: boolean } | null;
}

function dateOf(ms: number): string {
  return todayStr(new Date(ms));
}

function elapsedFraction(start: string, dueDate: string, today: string): number {
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

/** これまでのペース(登録日から今日まで)と、そのペースでの完了見込み日・期日までに必要なペース */
function paceOf(start: string, today: string, done: number, total: number, dueDate: string | undefined) {
  const remaining = total - done;
  if (total === 0 || remaining <= 0) return {};
  // 登録した当日に片付けた分で「1日に何件も」と見積もらないよう、最低でも1週間として割る
  const days = Math.max(7, daysBetweenDateStrs(start, today) + 1);
  const perDay = done / days;
  const daysLeft = dueDate ? daysBetweenDateStrs(today, dueDate) : undefined;
  return {
    pacePerWeek: perDay * 7,
    forecastDate: perDay > 0 ? shiftDateStr(today, Math.ceil(remaining / perDay)) : undefined,
    neededPerWeek: daysLeft !== undefined && daysLeft >= 0 ? (remaining / Math.max(1, daysLeft + 1)) * 7 : undefined,
  };
}

function statusOf(row: Omit<ProgressRow, "status">, today: string): ProgressStatus {
  if (row.dueDate && row.dueDate < today) return "overdue";
  if (row.total > 0 && row.dueDate) {
    // 段階・サブタスクが無いものは仕事の進みを測れないので、ペースでは判定しない
    if (row.elapsed !== undefined && row.elapsed - row.progress > BEHIND_MARGIN) return "behind";
    // まだ時間の割合では遅れていなくても、今のペースだと期日に間に合わない
    // (見込みは粗いので、期日の数日後程度の超過は見逃す。登録日〜期日の15%か3日の大きい方まで)
    if (row.done > 0 && row.forecastDate && (row.elapsed ?? 0) >= 0.3) {
      const grace = Math.max(3, Math.round(daysBetweenDateStrs(row.start, row.dueDate) * 0.15));
      if (row.forecastDate > shiftDateStr(row.dueDate, grace)) return "behind";
    }
  }
  // 相手の返事を待っているだけなら「停滞」とは別に数える(自分の手で動かせない)
  if (row.waiting) return "waiting";
  if (row.idleDays >= STALL_DAYS) return "stalled";
  if (!row.dueDate) return "noDue";
  return "onTrack";
}

function finish(row: Omit<ProgressRow, "status">, today: string): ProgressRow {
  return { ...row, status: statusOf(row, today) };
}

function postponeCountOf(history: DueChange[] | undefined): number {
  return summarizePostpones(history).count;
}

export function buildProgressRows({
  todos,
  subtasksByParent,
  projects,
  today = todayStr(),
  waiting,
}: {
  /** 未完了の親タスク(サブタスクを含めない) */
  todos: TodoTask[];
  subtasksByParent: Map<string, TodoTask[]>;
  /** 未完了の案件 */
  projects: ProjectItem[];
  today?: string;
  waiting?: WaitingLookup;
}): ProgressRow[] {
  const rows: ProgressRow[] = [];

  for (const t of todos) {
    const subs = subtasksByParent.get(t.id) ?? [];
    const done = subs.filter((s) => s.completed).length;
    const completedAts = subs.flatMap((s) => (s.completed && s.completedAt ? [s.completedAt] : []));
    const lastMove = Math.max(t.createdAt, t.tagChangedAt ?? 0, ...completedAts, ...subs.map((s) => s.tagChangedAt ?? 0));
    const start = dateOf(t.createdAt);
    const w = waiting?.todo(t, subs);
    const steps: ProgressStep[] =
      subs.length > 0
        ? subs.map((s) => ({ id: s.id, title: s.title, done: s.completed, completedAt: s.completedAt, dueDate: s.dueDate }))
        : [{ id: t.id, title: t.title, done: false, dueDate: t.dueDate }];
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
          start,
          elapsed: t.dueDate ? elapsedFraction(start, t.dueDate, today) : undefined,
          dueDate: t.dueDate,
          daysLeft: t.dueDate ? daysBetweenDateStrs(today, t.dueDate) : undefined,
          idleDays: Math.max(0, daysBetweenDateStrs(dateOf(lastMove), today)),
          activity: activityOf(completedAts, today),
          next: subs.find((s) => !s.completed)?.title,
          steps,
          ...paceOf(start, today, done, subs.length, t.dueDate),
          waiting: w ? { tag: w.tag, days: w.days ?? undefined, nudge: w.overdue } : undefined,
          postponeCount: postponeCountOf(t.dueHistory) + subs.filter((s) => !s.completed).reduce((n, s) => n + postponeCountOf(s.dueHistory), 0),
        },
        today
      )
    );
  }

  for (const p of projects) {
    const stages = p.stages ?? [];
    const done = stages.filter(isStageDone).length;
    const completedAts = stages.flatMap((s) => (isStageDone(s) && s.completedAt ? [s.completedAt] : []));
    const lastMove = Math.max(p.createdAt, p.tagChangedAt ?? 0, ...completedAts, ...stages.map((s) => s.tagChangedAt ?? 0));
    const dueDate = p.dueDate || undefined;
    const start = dateOf(p.createdAt);
    const w = waiting?.project(p);
    const progress = stages.length > 0 ? stages.reduce((sum, s) => sum + stageProgressFraction(s), 0) / stages.length : 0;
    rows.push(
      finish(
        {
          key: `project:${p.id}`,
          kind: "project",
          id: p.id,
          title: p.groupName ? `${p.groupName} ${p.title}` : p.title,
          progress,
          done,
          total: stages.length,
          start,
          elapsed: dueDate ? elapsedFraction(start, dueDate, today) : undefined,
          dueDate,
          daysLeft: dueDate ? daysBetweenDateStrs(today, dueDate) : undefined,
          idleDays: Math.max(0, daysBetweenDateStrs(dateOf(lastMove), today)),
          activity: activityOf(completedAts, today),
          next: stages.find((s) => !isStageDone(s))?.title,
          steps: stages.map((s) => ({
            id: s.id,
            title: s.title,
            done: isStageDone(s),
            completedAt: s.completedAt,
            dueDate: s.dueDate,
            countLabel: s.targetCount ? `${s.completedCount ?? 0}/${s.targetCount}件` : undefined,
          })),
          ...paceOf(start, today, done, stages.length, dueDate),
          waiting: w ? { tag: w.tag, days: w.days ?? undefined, nudge: w.overdue } : undefined,
          postponeCount: postponeCountOf(p.dueHistory),
        },
        today
      )
    );
  }

  return rows;
}

export interface BurnupPoint {
  date: string;
  /** その日までに片付いた累計。未来の日はundefined */
  done?: number;
  /** 登録日に0、期日に全件となる理想の線 */
  ideal?: number;
}

/**
 * 1件の累計の片付き(バーンアップ)。登録日から、期日と今日の遅い方(見込み日が後ならそこ)まで。
 * 完了時刻の分からない片付いた手順は登録日に片付いたものとして数える
 */
export function buildBurnup(row: ProgressRow, today: string): BurnupPoint[] {
  const end = [row.dueDate, row.forecastDate, today].filter((d): d is string => !!d).sort().at(-1)!;
  // 長すぎる期間は日数を間引かずそのまま描くと重いので、上限を設ける
  const span = Math.min(366, Math.max(1, daysBetweenDateStrs(row.start, end)));
  const doneDates = row.steps.filter((s) => s.done).map((s) => (s.completedAt ? dateOf(s.completedAt) : row.start)).sort();
  const dueSpan = row.dueDate ? Math.max(1, daysBetweenDateStrs(row.start, row.dueDate)) : undefined;
  const points: BurnupPoint[] = [];
  let k = 0;
  for (let i = 0; i <= span; i++) {
    const date = shiftDateStr(row.start, i);
    while (k < doneDates.length && doneDates[k] <= date) k++;
    points.push({
      date,
      done: date <= today ? k : undefined,
      ideal: dueSpan !== undefined && i <= dueSpan ? (row.total * i) / dueSpan : undefined,
    });
  }
  return points;
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
  /** 期日まで7日以内(期限切れを含む)の、残りの段階・サブタスク・ToDoの数 */
  dueSoonRemaining: number;
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
  const soon = shiftDateStr(today, 7);
  const dueSoonRemaining = rows
    .filter((r) => r.dueDate && r.dueDate <= soon)
    .reduce((n, r) => n + r.steps.filter((s) => !s.done).length, 0);
  return { counts, daily: activityOf(at, today), thisWeek, lastWeek, dueSoonRemaining };
}
