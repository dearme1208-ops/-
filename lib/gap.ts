import type { DailyTask } from "./types";

// 基本労働時間(workStart〜workEnd)のうち、今この瞬間までで、どの作業のセグメントにも
// 覆われていない「未計測」の時間の合計（秒）を求める。作業を完了せずに実績時間へ手動で
// 加算する際の目安に使う
export function computeUntrackedGapSeconds(
  tasks: DailyTask[],
  date: string,
  workStart: string,
  workEnd: string,
  now: number
): number {
  const dayStart = new Date(date + "T00:00:00").getTime();
  const [sh, sm] = workStart.split(":").map(Number);
  const [eh, em] = workEnd.split(":").map(Number);
  const windowStart = dayStart + ((Number.isFinite(sh) ? sh : 8) * 60 + (Number.isFinite(sm) ? sm : 0)) * 60000;
  const windowEndRaw = dayStart + ((Number.isFinite(eh) ? eh : 17) * 60 + (Number.isFinite(em) ? em : 0)) * 60000;
  const windowEnd = Math.min(windowEndRaw, now);
  if (windowEnd <= windowStart) return 0;

  const intervals: [number, number][] = [];
  for (const t of tasks) {
    for (const seg of t.segments) {
      const s = Math.max(seg.start, windowStart);
      const e = Math.min(seg.end ?? now, windowEnd);
      if (e > s) intervals.push([s, e]);
    }
  }

  if (intervals.length === 0) return Math.round((windowEnd - windowStart) / 1000);

  intervals.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let [curStart, curEnd] = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      covered += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  covered += curEnd - curStart;

  return Math.max(0, Math.round((windowEnd - windowStart - covered) / 1000));
}
