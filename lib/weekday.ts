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

export interface WeekdayBreakdownRow {
  key: string;
  category: string;
  name: string;
  avgSeconds: number; // その曜日の日数(dayCount)を分母にした1日あたりの平均
  totalSeconds: number;
  count: number;
}

// 指定した曜日(dow: 0=日...6=土)について、大項目・詳細作業名ごとの内訳を求める。
// トラブル対応は集計・ランキングタブの他の集計と同様、大項目でひとまとめにする。
// avgSecondsはcomputeWeekdayAveragesのavgSecondsと同じ分母(dayCount)を使うため、
// 全行を合計すればその曜日のavgSecondsにほぼ一致する(内訳として筋が通る)
export function computeWeekdayBreakdown(records: WorkRecord[], dow: number, dayCount: number): WeekdayBreakdownRow[] {
  const map = new Map<string, WeekdayBreakdownRow>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    if (new Date(r.date + "T12:00:00").getDay() !== dow) continue;
    const key = r.isTrouble ? `__trouble__::${r.category}` : (r.masterTaskId ?? `${r.category}::${r.name}`);
    if (!map.has(key)) {
      map.set(key, {
        key,
        category: r.category,
        name: r.isTrouble ? "（トラブル対応 合計）" : r.name,
        avgSeconds: 0,
        totalSeconds: 0,
        count: 0,
      });
    }
    const row = map.get(key)!;
    row.totalSeconds += r.seconds;
    row.count += 1;
  }
  const rows = [...map.values()];
  for (const row of rows) row.avgSeconds = dayCount > 0 ? row.totalSeconds / dayCount : 0;
  rows.sort((a, b) => b.totalSeconds - a.totalSeconds);
  return rows;
}
