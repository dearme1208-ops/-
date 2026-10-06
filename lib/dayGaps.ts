import type { BreakRange, DailyTask } from "./types";

// 「今日の抜けを埋める」: 1日の記録を見渡して、埋めた方がよい所を拾い出す。
//  - 抜け: 最初に計測を始めてから最後に止めるまでの間で、どの作業も計測していない時間(休憩時間を除く)
//  - 長すぎる計測: 1回で3時間以上続いた区間(止め忘れの疑い)

export interface DayGap {
  start: number;
  end: number;
}

export interface LongSpan {
  taskId: string;
  name: string;
  start: number;
  end: number;
  running: boolean;
}

const MIN = 60_000;

function hmToMs(date: string, hm: string): number {
  return new Date(`${date}T${hm.length === 5 ? hm : hm.padStart(5, "0")}:00`).getTime();
}

/** 区間を時刻順に並べ、重なりをまとめる */
function mergeIntervals(list: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** 計測していない時間(minMinutes分以上)。仮計測は「計っている時間」として扱う(別の欄で割り当てられるため) */
export function findDayGaps(
  tasks: DailyTask[],
  date: string,
  breaks: BreakRange[],
  now: number,
  minMinutes = 10
): DayGap[] {
  const covered = mergeIntervals(
    tasks.flatMap((t) => t.segments.map((s) => ({ start: s.start, end: s.end ?? now })))
  );
  if (covered.length < 2) return [];
  const breakIntervals = breaks.map((b) => ({ start: hmToMs(date, b.start), end: hmToMs(date, b.end) }));
  const gaps: DayGap[] = [];
  for (let i = 0; i < covered.length - 1; i++) {
    // 休憩時間を差し引いた残りを抜けとする
    let pieces = [{ start: covered[i].end, end: covered[i + 1].start }];
    for (const b of breakIntervals) {
      pieces = pieces.flatMap((p) => {
        if (b.end <= p.start || b.start >= p.end) return [p];
        const rest = [];
        if (b.start > p.start) rest.push({ start: p.start, end: b.start });
        if (b.end < p.end) rest.push({ start: b.end, end: p.end });
        return rest;
      });
    }
    for (const p of pieces) if (p.end - p.start >= minMinutes * MIN) gaps.push(p);
  }
  return gaps;
}

/** 1回の区間が thresholdHours 時間以上続いたもの(止め忘れの疑い) */
export function findLongSpans(tasks: DailyTask[], now: number, thresholdHours = 3): LongSpan[] {
  const out: LongSpan[] = [];
  for (const t of tasks) {
    if (t.isProvisional) continue;
    for (const s of t.segments) {
      const end = s.end ?? now;
      if (end - s.start >= thresholdHours * 60 * MIN) {
        out.push({ taskId: t.id, name: t.name, start: s.start, end, running: s.end === undefined });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 抜けを「記録しない」にした印のキー(同じ抜けを何度も聞かないため) */
export const gapKey = (g: DayGap) => `${g.start}-${g.end}`;
