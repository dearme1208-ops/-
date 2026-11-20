import type { TimeSegment } from "./types";

// 作業の開始・終了時刻を直した時の区間の組み直し。
// 一時停止を挟んで区間が分かれた作業(例: 10:10〜12:00 と 12:40〜12:50)で開始を 12:40 にすると、
// 以前は「途中の一時停止区間と矛盾しています」で直せなかった。新しい開始より前の区間は落とし、
// またぐ区間は切る(終了を早めた時も同じ)。開始を早める・終了を遅らせる時は、端の区間を延ばす

/** 区間を [newStart, newEnd] に合わせて組み直す。範囲がおかしい(区間が残らない)時は null。計測中の区間(end なし)はそのまま残す */
export function retimeSegments(segments: TimeSegment[], newStart?: number, newEnd?: number): TimeSegment[] | null {
  let segs = segments.map((s) => ({ ...s }));
  if (segs.length === 0) return null;
  if (newStart !== undefined) {
    segs = segs.filter((s) => (s.end ?? Infinity) > newStart).map((s) => ({ ...s, start: Math.max(s.start, newStart) }));
    if (segs.length === 0) return null;
    segs[0].start = newStart;
  }
  if (newEnd !== undefined) {
    segs = segs.filter((s) => s.start < newEnd).map((s) => ({ ...s, end: Math.min(s.end ?? newEnd, newEnd) }));
    if (segs.length === 0) return null;
    segs[segs.length - 1].end = newEnd;
  }
  if (segs.some((s) => s.end !== undefined && s.end <= s.start)) return null;
  return segs;
}

/** 閉じた区間の合計(ms) */
export function closedMs(segments: TimeSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end !== undefined ? s.end - s.start : 0), 0);
}
