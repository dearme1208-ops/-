import type { WorkRecord } from "./types";
import { computeIqrBounds } from "./stats";

export interface MonthlyOvertimeRow {
  month: string; // YYYY-MM
  autoOvertimeSeconds: number; // 所定時間を超えた分の概算残業（日ごとの超過分を合算、外れ値の日は除く）
  totalTrackedSeconds: number; // その月の実績合計（外れ値も含む、純粋な合計）
  excludedOutlierDays: number; // 外れ値として概算から除外した日数
}

// 実績を日ごとに合算し、所定時間を超えた分を概算残業として月単位で積み上げる。
// タイマーの消し忘れなど突出して大きい日はIQRで外れ値判定し、概算残業の計算からは除く
// （実績合計には含めたまま表示し、透明性を保つ）
export function computeMonthlyOvertime(
  records: WorkRecord[],
  standardDailySeconds: number
): Map<string, MonthlyOvertimeRow> {
  const byDate = new Map<string, number>();
  for (const r of records) {
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  }
  const bounds = computeIqrBounds([...byDate.values()]);

  const result = new Map<string, MonthlyOvertimeRow>();
  for (const [date, seconds] of byDate) {
    const month = date.slice(0, 7);
    if (!result.has(month)) {
      result.set(month, { month, autoOvertimeSeconds: 0, totalTrackedSeconds: 0, excludedOutlierDays: 0 });
    }
    const row = result.get(month)!;
    row.totalTrackedSeconds += seconds;
    // 高すぎる日（上振れの外れ値）のみ除外する。低い日は超過分が0なので元々概算に影響しない
    if (bounds !== null && seconds > bounds.upper) {
      row.excludedOutlierDays += 1;
    } else {
      row.autoOvertimeSeconds += Math.max(0, seconds - standardDailySeconds);
    }
  }
  return result;
}

export interface BreakdownRow {
  key: string;
  label: string;
  sublabel?: string;
  seconds: number;
}

// 業務区分別: 大項目（category）と詳細作業名（name）の組み合わせごとに内訳を出す
export function breakdownByCategory(records: WorkRecord[]): BreakdownRow[] {
  const map = new Map<string, { category: string; name: string; seconds: number }>();
  for (const r of records) {
    const key = `${r.category}::${r.name}`;
    if (!map.has(key)) map.set(key, { category: r.category, name: r.name, seconds: 0 });
    map.get(key)!.seconds += r.seconds;
  }
  return [...map.values()]
    .map((v) => ({ key: `${v.category}::${v.name}`, label: v.name, sublabel: v.category, seconds: v.seconds }))
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
