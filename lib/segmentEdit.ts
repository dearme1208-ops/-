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

const DAY_MS = 86400000;

/**
 * 完了した作業の時刻を「時:分」だけの入力欄で直した時に、どの日の時刻として保存するかを決める。
 * rawStart/rawEnd は、編集した側なら入力欄の時刻を作業の日付にあてはめた値、編集していない側なら元の値。
 * 編集した側は「その日」と「1日ずらした日」(開始は前日、終了は翌日)を候補にし、終了が開始より後になる
 * 組み合わせのうち、元の開始・終了にいちばん近いものを返す(該当が無ければ null)。
 *  - 前日20:40〜当日0:12 のように前日から始まっていた作業は、開始を前日にずらす
 *  - 23:30〜翌0:20 の作業の終了を 0:30 に直した時は、終了を翌日の0:30にする。以前は開始だけを前日へ
 *    ずらしていたため、終了だけ直すと保存できず、両方直すと作業が丸1日前へずれていた
 */
export function resolveEditedTimes(
  original: { start: number; end: number },
  rawStart: number,
  rawEnd: number,
  startTouched: boolean,
  endTouched: boolean
): { start: number; end: number } | null {
  const starts = startTouched ? [rawStart, rawStart - DAY_MS] : [rawStart];
  const ends = endTouched ? [rawEnd, rawEnd + DAY_MS] : [rawEnd];
  let best: { start: number; end: number } | null = null;
  let bestCost = Infinity;
  for (const start of starts) {
    for (const end of ends) {
      // NaN(入力欄が空)は比較がすべてfalseになるので、ここで弾く
      if (!(end > start)) continue;
      const cost = Math.abs(start - original.start) + Math.abs(end - original.end);
      if (cost < bestCost) {
        bestCost = cost;
        best = { start, end };
      }
    }
  }
  return best;
}
