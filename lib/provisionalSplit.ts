import type { TimeSegment } from "./types";

// 仮計測(まだ何の作業か決めていない計測)を、途中の時刻で2つに分けて別々の作業へ割り当てるための計算。
// 「15:20までは資料作成、そこからは電話対応」のように、1つの未計測時間に複数の作業が入っていた時に使う

/** 区間を at で前後に分ける。前は全て閉じた区間、後は計測中の区間(end なし)をそのまま残す */
export function splitSegmentsAt(segments: TimeSegment[], at: number): { before: TimeSegment[]; after: TimeSegment[] } {
  const before: TimeSegment[] = [];
  const after: TimeSegment[] = [];
  for (const s of segments) {
    const end = s.end;
    if (end !== undefined && end <= at) before.push(s);
    else if (s.start >= at) after.push(s);
    else {
      // at をまたぐ区間は at で切る
      before.push({ start: s.start, end: at });
      after.push(end === undefined ? { start: at } : { start: at, end });
    }
  }
  return { before: before.filter((s) => s.end! > s.start), after };
}

/** 閉じた区間の合計(ms)。計測中の区間は数えない */
export function closedSegmentsMs(segments: TimeSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end !== undefined ? s.end - s.start : 0), 0);
}

/** 計測中の区間を now で閉じる */
export function closeSegmentsAt(segments: TimeSegment[], now: number): TimeSegment[] {
  return segments.map((s) => (s.end === undefined ? { start: s.start, end: Math.max(s.start, now) } : s)).filter((s) => s.end! > s.start);
}

/** "HH:MM" を、date の日のその時刻(ms)にする */
export function clockOnDate(date: string, hm: string): number {
  return new Date(`${date}T${hm.padStart(5, "0")}:00`).getTime();
}

/** 区切る時刻の初期値: 始まりと今の真ん中を、分に丸めたもの */
export function defaultSplitAt(start: number, now: number): number {
  const mid = start + (now - start) / 2;
  return Math.round(mid / 60_000) * 60_000;
}
