import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";
import { shiftDateStr } from "./time";
import { isStageDone } from "./projectStage";

// 数字を読まなくても、見た瞬間に分かる「可視化」のための材料をまとめて作る。
// 描くのは components/viz/*。ここは画面に依らない計算だけを置く(単体テストで確かめる)

const MIN = 60_000;

// ---- 色の割り当て(区分) ----
/** 期間中の時間の多い順に、上位4区分へ色の枠(1〜4)を割り当てる。残りは「その他」(0) */
export function categorySlots(items: { category: string; ms: number }[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const i of items) total.set(i.category, (total.get(i.category) ?? 0) + i.ms);
  const order = [...total.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return new Map(order.map((c, i) => [c, i < 4 ? i + 1 : 0]));
}

// ---- 1. 今日のリング ----
export interface RingSegment {
  start: number;
  end: number;
  category: string;
  name: string;
  running: boolean;
}

/** その日に計った区間(仮計測を除く)を時刻順に。計測中の区間は今まで */
export function dayRingSegments(tasks: DailyTask[], now: number): RingSegment[] {
  return tasks
    .filter((t) => !t.isProvisional)
    .flatMap((t) =>
      t.segments.map((s) => ({ start: s.start, end: s.end ?? now, category: t.category, name: t.name, running: s.end === undefined }))
    )
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

// ---- 2. 終業までの砂時計 ----
export interface Hourglass {
  /** 今から終業までの残り(ms)。終業を過ぎていれば0 */
  leftMs: number;
  /** まだ終わっていない作業の残りの見込みの合計(ms) */
  needMs: number;
  /** 見込みの立たない(予測なし)作業の数 */
  unknownCount: number;
}

export function hourglass(
  tasks: DailyTask[],
  predictedSecondsByTaskId: Map<string, number>,
  elapsedMsOf: (t: DailyTask) => number,
  now: number,
  workEndMs: number
): Hourglass {
  let needMs = 0;
  let unknownCount = 0;
  for (const t of tasks) {
    if (t.isProvisional || t.status === "done") continue;
    const pred = (predictedSecondsByTaskId.get(t.id) ?? 0) * 1000;
    if (pred <= 0) {
      unknownCount++;
      continue;
    }
    needMs += Math.max(0, pred - elapsedMsOf(t));
  }
  return { leftMs: Math.max(0, workEndMs - now), needMs, unknownCount };
}

// ---- 3. 次の予定まで ----
/** 今より後に予定の時刻がある、まだ始めていない作業のうち一番近いもの */
export function nextScheduled(tasks: DailyTask[], date: string, now: number): { task: DailyTask; at: number } | null {
  let best: { task: DailyTask; at: number } | null = null;
  for (const t of tasks) {
    if (t.status !== "pending" || !t.scheduledTime) continue;
    const at = new Date(`${date}T${t.scheduledTime.padStart(5, "0")}:00`).getTime();
    if (at <= now) continue;
    if (!best || at < best.at) best = { task: t, at };
  }
  return best;
}

// ---- 4. いつもの所要時間の幅 ----
export interface DurationRange {
  low: number; // 短い時(下から1割)
  mid: number; // 真ん中
  high: number; // 長い時(上から1割)
  count: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 作業マスタごとの、これまでに終えた回の所要時間の幅(3回以上やったものだけ) */
export function durationRanges(doneTasks: DailyTask[]): Map<string, DurationRange> {
  const by = new Map<string, number[]>();
  for (const t of doneTasks) {
    if (t.status !== "done" || t.isProvisional || !t.masterTaskId || t.accumulatedMs < MIN) continue;
    by.set(t.masterTaskId, [...(by.get(t.masterTaskId) ?? []), t.accumulatedMs]);
  }
  const out = new Map<string, DurationRange>();
  for (const [id, xs] of by) {
    if (xs.length < 3) continue;
    const s = [...xs].sort((a, b) => a - b);
    out.set(id, { low: quantile(s, 0.1), mid: quantile(s, 0.5), high: quantile(s, 0.9), count: s.length });
  }
  return out;
}

// ---- 6. 1週間の積み木 ----
export interface DayStack {
  date: string;
  parts: { category: string; ms: number }[];
  totalMs: number;
}

/** 今日を含む直近7日の、日ごと・区分ごとの記録時間 */
export function weekStacks(records: WorkRecord[], today: string): DayStack[] {
  const from = shiftDateStr(today, -6);
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDateStr(from, i);
    const by = new Map<string, number>();
    for (const r of records) {
      if (r.date !== date || r.excludedFromStats) continue;
      by.set(r.category, (by.get(r.category) ?? 0) + r.seconds * 1000);
    }
    const parts = [...by.entries()].map(([category, ms]) => ({ category, ms })).sort((a, b) => b.ms - a.ms);
    return { date, parts, totalMs: parts.reduce((s, p) => s + p.ms, 0) };
  });
}

// ---- 7. 案件の山登り ----
export interface ProjectClimb {
  project: ProjectItem;
  /** 段階の進み具合(0〜1)。段階がなければ undefined */
  progress?: number;
  /** 登録から期日までのうち、今日がどこか(0〜1、期日を過ぎると1より大きい) */
  timeUsed: number;
  /** 期日に間に合いそうにない(時間の進みに対して段階が遅れている) */
  behind: boolean;
}

export function projectClimbs(projects: ProjectItem[], today: string): ProjectClimb[] {
  const day = (d: string) => new Date(`${d}T00:00:00`).getTime();
  return projects
    .filter((p) => !p.completedAt && !p.archived && p.dueDate)
    .map((p) => {
      const stages = p.stages ?? [];
      const progress = stages.length > 0 ? stages.filter((s) => isStageDone(s)).length / stages.length : undefined;
      const created = new Date(p.createdAt);
      const createdDay = day(`${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`);
      const span = Math.max(1, day(p.dueDate) - createdDay);
      const timeUsed = (day(today) - createdDay) / span;
      const behind = timeUsed > 1 || (progress !== undefined && timeUsed - progress > 0.25);
      return { project: p, progress, timeUsed, behind };
    })
    .sort((a, b) => a.project.dueDate.localeCompare(b.project.dueDate));
}

// ---- 9. 時間帯ごとの調子 ----
export const HEAT_BLOCKS = [
  { from: 6, to: 9, label: "6時" },
  { from: 9, to: 12, label: "9時" },
  { from: 12, to: 15, label: "12時" },
  { from: 15, to: 18, label: "15時" },
  { from: 18, to: 21, label: "18時" },
  { from: 21, to: 24, label: "21時" },
];
export const HEAT_DAYS = ["月", "火", "水", "木", "金", "土", "日"];

export interface HeatCell {
  /** 予定(見積もり)の1.1倍以内に終えた割合 */
  onTime: number;
  count: number;
}

/** 曜日×時間帯ごとに、見積もりのあった作業を予定どおりに終えた割合(始めた時刻で振り分け) */
export function conditionHeatmap(doneTasks: DailyTask[]): (HeatCell | null)[][] {
  const grid: { ok: number; n: number }[][] = HEAT_DAYS.map(() => HEAT_BLOCKS.map(() => ({ ok: 0, n: 0 })));
  for (const t of doneTasks) {
    if (t.status !== "done" || t.isProvisional || !t.estimatedSeconds || !t.segments[0]) continue;
    const s = new Date(t.segments[0].start);
    const dow = (s.getDay() + 6) % 7;
    const bi = HEAT_BLOCKS.findIndex((b) => s.getHours() >= b.from && s.getHours() < b.to);
    if (bi < 0) continue;
    grid[dow][bi].n++;
    if (t.accumulatedMs <= t.estimatedSeconds * 1000 * 1.1) grid[dow][bi].ok++;
  }
  return grid.map((row) => row.map((c) => (c.n === 0 ? null : { onTime: c.ok / c.n, count: c.n })));
}

// ---- 10. 期日の山 ----
export interface DueDay {
  date: string;
  todos: string[];
  projects: string[];
}

/** 今日から days 日分の、日ごとの期日(ToDo・案件・案件の段階) */
export function dueTerrain(todos: TodoTask[], projects: ProjectItem[], today: string, days = 14): DueDay[] {
  const out = Array.from({ length: days }, (_, i) => ({ date: shiftDateStr(today, i), todos: [] as string[], projects: [] as string[] }));
  const at = new Map(out.map((d) => [d.date, d]));
  for (const t of todos) {
    if (t.completed || t.archived || t.parentTaskId || !t.dueDate) continue;
    at.get(t.dueDate)?.todos.push(t.title);
  }
  for (const p of projects) {
    if (p.completedAt || p.archived) continue;
    at.get(p.dueDate)?.projects.push(p.title);
    for (const s of p.stages ?? []) if (!isStageDone(s) && s.dueDate) at.get(s.dueDate)?.projects.push(`${p.title}／${s.title}`);
  }
  return out;
}

// ---- 相手待ちの砂時計 ----
export interface WaitingSand {
  /** 上の砂の残り(1=待ち始め、0=催促の目安に着いた) */
  sandLeft: number;
  /** 棒の長さ(0〜1、全体の目盛りに対して) */
  bar: number;
  /** 催促の目安の位置(0〜1) */
  nudgeAt: number;
}

/** 待った日数を、催促の目安までの砂時計と、目盛りをそろえた棒に直す。日数不明は null */
export function waitingSand(days: (number | null)[], nudgeDays: number): (WaitingSand | null)[] {
  const known = days.filter((d): d is number => d !== null);
  // 目安の線が右端に張り付かないよう、目盛りは最低でも目安の1.5倍まで取る
  const scale = Math.max(nudgeDays * 1.5, ...known, 1);
  return days.map((d) =>
    d === null ? null : { sandLeft: Math.max(0, 1 - d / nudgeDays), bar: d / scale, nudgeAt: nudgeDays / scale }
  );
}
