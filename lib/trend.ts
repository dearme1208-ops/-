import type { WorkRecord } from "./types";
import { todayStr } from "./time";

export type TrendGranularity = "day" | "week" | "month";

export interface TrendPoint {
  key: string;
  label: string;
  totalSeconds: number;
}

export function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const WINDOW_COUNT: Record<TrendGranularity, number> = {
  day: 14,
  week: 12,
  month: 12,
};

export function buildTrend(records: WorkRecord[], granularity: TrendGranularity): TrendPoint[] {
  const sums = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const d = new Date(r.date + "T12:00:00");
    const key = granularity === "day" ? r.date : granularity === "week" ? isoWeekKey(d) : r.date.slice(0, 7);
    sums.set(key, (sums.get(key) ?? 0) + r.seconds);
  }

  const windowCount = WINDOW_COUNT[granularity];
  const now = new Date();
  const points: TrendPoint[] = [];
  for (let i = windowCount - 1; i >= 0; i--) {
    if (granularity === "day") {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = todayStr(d);
      points.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, totalSeconds: sums.get(key) ?? 0 });
    } else if (granularity === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const key = isoWeekKey(d);
      points.push({ key, label: key.slice(6), totalSeconds: sums.get(key) ?? 0 });
    } else {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      points.push({ key, label: `${d.getMonth() + 1}月`, totalSeconds: sums.get(key) ?? 0 });
    }
  }
  return points;
}

export const TREND_GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  day: "日別（直近14日）",
  week: "週別（直近12週）",
  month: "月別（直近12ヶ月）",
};
