import type { WorkRecord } from "./types";
import { computeRecordOutliers } from "./outliers";

export interface ExcludedOvertimeRecord {
  date: string;
  category: string;
  name: string;
  seconds: number;
}

export interface MonthlyOvertimeRow {
  month: string; // YYYY-MM
  autoOvertimeSeconds: number; // 所定時間を超えた分の概算残業（日ごとの超過分を合算、外れ値の実績は除く）
  totalTrackedSeconds: number; // その月の実績合計（外れ値も含む、純粋な合計）
  excludedRecords: ExcludedOvertimeRecord[]; // 外れ値として概算から除外した個々の実績
}

// 実績を日ごとに合算し、所定時間を超えた分を概算残業として月単位で積み上げる。
// 「1日をまるごと」ではなく、個々の実績を同じ作業の他の日・平均と比較してIQRで
// 外れ値判定し(タイマーの消し忘れなどが原因のことが多い)、その実績分だけを概算から
// 除外する。同じ日の他の（外れ値でない）作業はそのまま概算に含まれる
// （実績合計には外れ値も含めたまま表示し、透明性を保つ）
export function computeMonthlyOvertime(
  records: WorkRecord[],
  standardDailySeconds: number
): Map<string, MonthlyOvertimeRow> {
  const outlierFlags = computeRecordOutliers(records);

  const totalByDate = new Map<string, number>();
  const netByDate = new Map<string, number>();
  for (const r of records) {
    totalByDate.set(r.date, (totalByDate.get(r.date) ?? 0) + r.seconds);
    if (!outlierFlags.get(r.id)) {
      netByDate.set(r.date, (netByDate.get(r.date) ?? 0) + r.seconds);
    }
  }

  const result = new Map<string, MonthlyOvertimeRow>();
  for (const [date, totalSeconds] of totalByDate) {
    const month = date.slice(0, 7);
    if (!result.has(month)) {
      result.set(month, { month, autoOvertimeSeconds: 0, totalTrackedSeconds: 0, excludedRecords: [] });
    }
    const row = result.get(month)!;
    row.totalTrackedSeconds += totalSeconds;
    const netSeconds = netByDate.get(date) ?? 0;
    row.autoOvertimeSeconds += Math.max(0, netSeconds - standardDailySeconds);
  }
  for (const r of records) {
    if (!outlierFlags.get(r.id)) continue;
    const row = result.get(r.date.slice(0, 7));
    row?.excludedRecords.push({ date: r.date, category: r.category, name: r.name, seconds: r.seconds });
  }
  for (const row of result.values()) {
    row.excludedRecords.sort((a, b) => a.date.localeCompare(b.date) || b.seconds - a.seconds);
  }
  return result;
}

export interface BreakdownRow {
  key: string;
  label: string;
  sublabel?: string;
  seconds: number;
}

// 業務区分別: 大項目（category）と詳細作業名（name）の組み合わせごとに内訳を出す。
// トラブル対応など「ポイント」が付いた実績は、詳細作業名が実績ごとに異なっていても大項目でまとめる
export function breakdownByCategory(records: WorkRecord[]): BreakdownRow[] {
  const map = new Map<string, { category: string; name: string; seconds: number }>();
  for (const r of records) {
    const key = r.isTrouble ? `__trouble__::${r.category}` : `${r.category}::${r.name}`;
    if (!map.has(key)) map.set(key, { category: r.category, name: r.isTrouble ? "（全件合計）" : r.name, seconds: 0 });
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

export interface AfterHoursResult {
  totalSeconds: number;
  byTask: BreakdownRow[];
}

// 各実績(startedAt〜endedAt)のうち、その日の「定時(cutoffTime)」より後にかかっている時間だけを積み上げる。
// 所定労働時間による概算残業（computeMonthlyOvertime）とは異なり、実際に働いていた時刻ベースで判定する
export function computeAfterHoursBreakdown(records: WorkRecord[], cutoffTime: string): AfterHoursResult {
  const [hh, mm] = cutoffTime.split(":").map((v) => Number(v));
  const cutoffMinutes = (Number.isFinite(hh) ? hh : 18) * 60 + (Number.isFinite(mm) ? mm : 0);

  let totalSeconds = 0;
  const byKey = new Map<string, { category: string; name: string; seconds: number }>();

  for (const r of records) {
    if (!r.startedAt || !r.endedAt || r.endedAt <= r.startedAt) continue;
    const dayStart = new Date(r.date + "T00:00:00").getTime();
    const cutoffMs = dayStart + cutoffMinutes * 60000;
    const dayEndMs = dayStart + 86400000;
    const overlapStart = Math.max(r.startedAt, cutoffMs);
    const overlapEnd = Math.min(r.endedAt, dayEndMs);
    const overlapSeconds = Math.max(0, (overlapEnd - overlapStart) / 1000);
    if (overlapSeconds <= 0) continue;

    totalSeconds += overlapSeconds;
    const key = `${r.category}::${r.name}`;
    if (!byKey.has(key)) byKey.set(key, { category: r.category, name: r.name, seconds: 0 });
    byKey.get(key)!.seconds += overlapSeconds;
  }

  const byTask = [...byKey.values()]
    .map((v) => ({ key: `${v.category}::${v.name}`, label: v.name, sublabel: v.category, seconds: v.seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  return { totalSeconds, byTask };
}
