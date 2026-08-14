import type { WorkRecord } from "./types";
import { computeStreakDays } from "./streak";
import { todayStr } from "./time";

export type BadgeCategoryKey = "streak" | "hours" | "count";

export interface BadgeCategoryProgress {
  category: BadgeCategoryKey;
  icon: string;
  label: string;
  unit: string;
  currentValue: number;
  thresholds: number[];
  achievedThresholds: number[];
  nextThreshold: number | null;
}

const STREAK_THRESHOLDS = [3, 7, 30, 100];
const TOTAL_HOUR_THRESHOLDS = [10, 50, 100, 500, 1000];
const RECORD_COUNT_THRESHOLDS = [10, 50, 200, 1000];

// 連続記録日数・累計作業時間・累計記録件数の3軸で、達成済みのマイルストーンと
// 次の目標を算出する。演出テーマに関わらず使えるよう、絵文字アイコンのみで表現する
export function computeBadgeProgress(records: WorkRecord[], today: string = todayStr()): BadgeCategoryProgress[] {
  const streak = computeStreakDays(records, today);
  const totalHours = records.reduce((s, r) => s + r.seconds, 0) / 3600;
  const totalCount = records.length;

  function build(category: BadgeCategoryKey, icon: string, label: string, unit: string, value: number, thresholds: number[]): BadgeCategoryProgress {
    const achieved = thresholds.filter((t) => value >= t);
    const next = thresholds.find((t) => value < t) ?? null;
    return { category, icon, label, unit, currentValue: value, thresholds, achievedThresholds: achieved, nextThreshold: next };
  }

  return [
    build("streak", "🔥", "連続記録日数", "日", streak, STREAK_THRESHOLDS),
    build("hours", "⏱", "累計作業時間", "時間", Math.floor(totalHours), TOTAL_HOUR_THRESHOLDS),
    build("count", "📋", "累計記録件数", "件", totalCount, RECORD_COUNT_THRESHOLDS),
  ];
}
