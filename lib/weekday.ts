import type { WorkRecord } from "./types";

export interface WeekdayAverage {
  dow: number; // 0=日 ... 6=土
  label: string;
  avgSeconds: number;
  dayCount: number;
}

export const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 曜日ごとに、実績が記録されている日の合計時間を平均する（同曜日比較用）
export function computeWeekdayAverages(records: WorkRecord[]): WeekdayAverage[] {
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  }
  const byDow = new Map<number, { sum: number; count: number }>();
  for (const [date, seconds] of byDate) {
    const dow = new Date(date + "T12:00:00").getDay();
    if (!byDow.has(dow)) byDow.set(dow, { sum: 0, count: 0 });
    const entry = byDow.get(dow)!;
    entry.sum += seconds;
    entry.count += 1;
  }
  return Array.from({ length: 7 }, (_, dow) => {
    const entry = byDow.get(dow);
    return {
      dow,
      label: DOW_LABELS[dow],
      avgSeconds: entry ? entry.sum / entry.count : 0,
      dayCount: entry?.count ?? 0,
    };
  });
}
