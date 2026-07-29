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

function timeToMsOfDay(dateStr: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
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
