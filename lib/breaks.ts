import type { BreakRange } from "./types";

export function parseBreakRanges(json: string): BreakRange[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is BreakRange => r && typeof r.start === "string" && typeof r.end === "string"
    );
  } catch {
    return [];
  }
}

export function serializeBreakRanges(ranges: BreakRange[]): string {
  return JSON.stringify(ranges);
}

export function timeToMsOfDay(dateStr: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

// 指定した日時(ms)を含む休憩帯を返す(無ければnull)。強制ストップ対象の絞り込み等、
// どの休憩帯かを特定してその内容(チェックリスト等)を参照したい場合に使う
export function findBreakRangeAt(ms: number, dateStr: string, ranges: BreakRange[]): BreakRange | null {
  for (const r of ranges) {
    const s = timeToMsOfDay(dateStr, r.start);
    const e = timeToMsOfDay(dateStr, r.end);
    if (e <= s) continue;
    if (ms >= s && ms < e) return r;
  }
  return null;
}

// 休憩帯を一意に識別するためのキー(「本日この休憩帯はもう処理済み」等の判定に使う)
export function breakRangeKey(r: BreakRange): string {
  return `${r.start}-${r.end}`;
}

// 指定日における各休憩帯の[開始ms, 終了ms]。終了が開始より前（日をまたぐ設定）の場合は無視する
function breakRangesToMs(dateStr: string, ranges: BreakRange[]): [number, number][] {
  return ranges
    .map((r) => [timeToMsOfDay(dateStr, r.start), timeToMsOfDay(dateStr, r.end)] as [number, number])
    .filter(([s, e]) => e > s);
}

export function isWithinBreak(ms: number, dateStr: string, ranges: BreakRange[]): boolean {
  return breakRangesToMs(dateStr, ranges).some(([s, e]) => ms >= s && ms < e);
}

// 未計測の開始起点(stopMs)からnowMsまでの間に休憩帯が含まれる場合、その休憩帯の終了時刻まで
// 起点を後ろにずらす（休憩時間を未計測やさかのぼって開始/再開の対象に含めないため）
export function adjustStopTimeForBreaks(stopMs: number, nowMs: number, dateStr: string, ranges: BreakRange[]): number {
  let adjusted = stopMs;
  const sorted = breakRangesToMs(dateStr, ranges).sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    // 起点(adjusted)が休憩帯の途中にある場合(s <= adjusted < e)も、
    // 休憩帯がまだ起点より先にある場合(adjusted <= s < nowMs)も、どちらも終了時刻まで送る
    if (e > adjusted && s < nowMs) {
      adjusted = Math.max(adjusted, e);
    }
  }
  return Math.min(adjusted, nowMs);
}

// stopMsからnowMsまでの間で、休憩帯と重なっている時間の合計(ms)
function totalBreakOverlapMs(stopMs: number, nowMs: number, dateStr: string, ranges: BreakRange[]): number {
  let overlap = 0;
  for (const [s, e] of breakRangesToMs(dateStr, ranges)) {
    const overlapStart = Math.max(s, stopMs);
    const overlapEnd = Math.min(e, nowMs);
    if (overlapEnd > overlapStart) overlap += overlapEnd - overlapStart;
  }
  return overlap;
}

// stopMsからnowMsまでの経過時間から休憩帯と重なる時間を差し引いた、正味の経過時間(ms)。
// 未計測の自動開始のしきい値判定に使う。休憩をまたいでも、休憩前に既に経過していた
// 待ち時間を無駄にせず、休憩が終わった時点で正しく閾値超過を判定できるようにする
export function computeEffectiveElapsedMs(stopMs: number, nowMs: number, dateStr: string, ranges: BreakRange[]): number {
  const raw = Math.max(0, nowMs - stopMs);
  return Math.max(0, raw - totalBreakOverlapMs(stopMs, nowMs, dateStr, ranges));
}
