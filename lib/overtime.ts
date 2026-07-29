import type { WorkRecord } from "./types";

export interface MonthlyOvertimeRow {
  month: string; // YYYY-MM
  autoOvertimeSeconds: number; // 所定時間を超えた分の概算残業（日ごとの超過分を合算）
  totalTrackedSeconds: number; // その月の実績合計
}

// 実績を日ごとに合算し、所定時間を超えた分を概算残業として月単位で積み上げる
export function computeMonthlyOvertime(
  records: WorkRecord[],
  standardDailySeconds: number
): Map<string, MonthlyOvertimeRow> {
  const byDate = new Map<string, number>();
  for (const r of records) {
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  }
  const result = new Map<string, MonthlyOvertimeRow>();
  for (const [date, seconds] of byDate) {
    const month = date.slice(0, 7);
    if (!result.has(month)) {
      result.set(month, { month, autoOvertimeSeconds: 0, totalTrackedSeconds: 0 });
    }
    const row = result.get(month)!;
    row.autoOvertimeSeconds += Math.max(0, seconds - standardDailySeconds);
    row.totalTrackedSeconds += seconds;
  }
  return result;
}

export interface BreakdownRow {
  key: string;
  label: string;
  seconds: number;
}

export function breakdownByCategory(records: WorkRecord[]): BreakdownRow[] {
  const map = new Map<string, number>();
  for (const r of records) {
    map.set(r.category, (map.get(r.category) ?? 0) + r.seconds);
  }
  return [...map.entries()]
    .map(([key, seconds]) => ({ key, label: key, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function breakdownByProject(records: WorkRecord[], projectTitleById: Map<string, string>): BreakdownRow[] {
  const NO_PROJECT_KEY = "__none__";
  const map = new Map<string, number>();
  for (const r of records) {
    const key = r.projectId ?? NO_PROJECT_KEY;
    map.set(key, (map.get(key) ?? 0) + r.seconds);
  }
  return [...map.entries()]
    .map(([key, seconds]) => ({
      key,
      label: key === NO_PROJECT_KEY ? "案件外" : (projectTitleById.get(key) ?? "（削除済みの案件）"),
      seconds,
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function formatHoursJp(seconds: number): string {
  return `${(seconds / 3600).toFixed(2)} 時間`;
}
