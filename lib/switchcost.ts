import type { WorkRecord } from "./types";

export interface SwitchCostBucket {
  label: string;
  dayCount: number;
  avgTaskCount: number;
  avgPerTaskSeconds: number;
  avgDailyTotalSeconds: number;
}

export interface SwitchCostResult {
  low: SwitchCostBucket | null;
  high: SwitchCostBucket | null;
}

const MIN_DAYS = 4;

// 1日あたりの取り組んだ作業の種類数（切り替え回数の目安）を中央値で二分し、
// 「切り替えが少ない日」と「多い日」で、作業1件あたりの平均時間・1日の合計時間に差が出ているかを比較する
export function computeSwitchCostAnalysis(records: WorkRecord[]): SwitchCostResult {
  const byDate = new Map<string, WorkRecord[]>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  const dayStats = [...byDate.entries()].map(([date, recs]) => {
    const taskCount = recs.length;
    const totalSeconds = recs.reduce((s, r) => s + r.seconds, 0);
    return { date, taskCount, totalSeconds, avgPerTask: totalSeconds / taskCount };
  });

  if (dayStats.length < MIN_DAYS) return { low: null, high: null };

  const sortedByCount = [...dayStats].sort((a, b) => a.taskCount - b.taskCount);
  const median = sortedByCount[Math.floor(sortedByCount.length / 2)].taskCount;

  const lowDays = dayStats.filter((d) => d.taskCount <= median);
  const highDays = dayStats.filter((d) => d.taskCount > median);

  function bucket(label: string, days: typeof dayStats): SwitchCostBucket | null {
    if (days.length === 0) return null;
    return {
      label,
      dayCount: days.length,
      avgTaskCount: days.reduce((s, d) => s + d.taskCount, 0) / days.length,
      avgPerTaskSeconds: days.reduce((s, d) => s + d.avgPerTask, 0) / days.length,
      avgDailyTotalSeconds: days.reduce((s, d) => s + d.totalSeconds, 0) / days.length,
    };
  }

  return {
    low: bucket("切り替えの少ない日", lowDays),
    high: bucket("切り替えの多い日", highDays),
  };
}
