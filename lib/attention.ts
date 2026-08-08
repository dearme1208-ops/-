import type { MasterTask, WorkRecord } from "./types";
import { isDateStrInRange } from "./period";

export interface AttentionRow {
  masterTaskId: string;
  category: string;
  name: string;
  estimatedSeconds: number;
  avgSeconds: number;
  overRatio: number; // 例: 0.35 = 35%超過
  sampleCount: number;
}

const THRESHOLD = 0.3;

export function computeAttentionList(masterTasks: MasterTask[], records: WorkRecord[]): AttentionRow[] {
  const byMaster = new Map<string, WorkRecord[]>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId) continue;
    if (!byMaster.has(r.masterTaskId)) byMaster.set(r.masterTaskId, []);
    byMaster.get(r.masterTaskId)!.push(r);
  }

  const rows: AttentionRow[] = [];
  for (const task of masterTasks) {
    const recs = byMaster.get(task.id);
    if (!recs || recs.length === 0 || task.estimatedSeconds <= 0) continue;
    const avgSeconds = recs.reduce((s, r) => s + r.seconds, 0) / recs.length;
    const overRatio = avgSeconds / task.estimatedSeconds - 1;
    if (overRatio >= THRESHOLD) {
      rows.push({
        masterTaskId: task.id,
        category: task.category,
        name: task.name,
        estimatedSeconds: task.estimatedSeconds,
        avgSeconds,
        overRatio,
        sampleCount: recs.length,
      });
    }
  }
  return rows.sort((a, b) => b.overRatio - a.overRatio);
}

export interface EstimationAccuracyPoint {
  key: string;
  label: string;
  value: number; // 平均超過率(%)。0=想定通り、+20=平均20%超過、-10=平均10%早く終わった
}

// 想定時間が設定されている作業の「実績/想定 - 1」を月ごとに平均し、見積り精度の推移を出す
export function computeEstimationAccuracyTrend(
  masterTasks: MasterTask[],
  records: WorkRecord[],
  monthsCount = 6
): EstimationAccuracyPoint[] {
  const estimatedByMaster = new Map<string, number>();
  for (const task of masterTasks) {
    if (task.estimatedSeconds > 0) estimatedByMaster.set(task.id, task.estimatedSeconds);
  }

  const byMonth = new Map<string, { sumRatio: number; count: number }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId) continue;
    const estimatedSeconds = estimatedByMaster.get(r.masterTaskId);
    if (!estimatedSeconds) continue;
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { sumRatio: 0, count: 0 });
    const entry = byMonth.get(month)!;
    entry.sumRatio += r.seconds / estimatedSeconds - 1;
    entry.count += 1;
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-monthsCount)
    .map(([month, { sumRatio, count }]) => ({
      key: month,
      label: month.slice(5) + "月",
      value: Math.round((sumRatio / count) * 1000) / 10,
    }));
}

export type AvgComparePeriodType = "year" | "h1" | "h2";

export interface AvgComparePeriod {
  type: AvgComparePeriodType;
  fiscalYear: number;
}

function avgComparePeriodRange(period: AvgComparePeriod): { start: Date; end: Date } {
  const fy = period.fiscalYear;
  if (period.type === "year") return { start: new Date(fy, 3, 1, 0, 0, 0), end: new Date(fy + 1, 2, 31, 23, 59, 59) };
  if (period.type === "h1") return { start: new Date(fy, 3, 1, 0, 0, 0), end: new Date(fy, 8, 30, 23, 59, 59) };
  return { start: new Date(fy, 9, 1, 0, 0, 0), end: new Date(fy + 1, 2, 31, 23, 59, 59) };
}

// 指定した期の自然な「前期」を決める（年度なら前年度、半期なら前の半期）
export function defaultAvgComparePeriod(period: AvgComparePeriod): AvgComparePeriod {
  if (period.type === "year") return { type: "year", fiscalYear: period.fiscalYear - 1 };
  return period.type === "h1"
    ? { type: "h2", fiscalYear: period.fiscalYear - 1 }
    : { type: "h1", fiscalYear: period.fiscalYear };
}

export interface AvgTimeComparisonRow {
  key: string;
  category: string;
  name: string;
  avgSeconds: number;
  prevAvgSeconds: number;
  deltaSeconds: number; // 現在の期の平均 - 比較先の期の平均。負なら短縮（改善）、正なら増加（要改善）
  count: number;
}

function avgByKeyInRange(records: WorkRecord[], range: { start: Date; end: Date }): Map<string, AvgTimeComparisonRow> {
  const inRange = records.filter((r) => !r.excludedFromStats && isDateStrInRange(r.date, range));
  const totals = new Map<string, { category: string; name: string; total: number; count: number }>();
  for (const r of inRange) {
    const key = r.isTrouble ? `__trouble__::${r.category}` : (r.masterTaskId ?? `${r.category}::${r.name}`);
    if (!totals.has(key)) {
      totals.set(key, { category: r.category, name: r.isTrouble ? "（全件合計）" : r.name, total: 0, count: 0 });
    }
    const entry = totals.get(key)!;
    entry.total += r.seconds;
    entry.count += 1;
  }
  const out = new Map<string, AvgTimeComparisonRow>();
  for (const [key, { category, name, total, count }] of totals) {
    out.set(key, { key, category, name, avgSeconds: total / count, prevAvgSeconds: 0, deltaSeconds: 0, count });
  }
  return out;
}

// 2つの期(年度どうし、または半期どうし)の間で、1件あたりの平均作業時間がどう
// 変化したかを作業ごとに比較する。両方の期に一定件数の実績がある作業のみが対象
export function computeAverageTimeComparison(
  records: WorkRecord[],
  current: AvgComparePeriod,
  compareTo: AvgComparePeriod,
  minSampleCount = 2
): { improved: AvgTimeComparisonRow[]; regressed: AvgTimeComparisonRow[] } {
  const currentMap = avgByKeyInRange(records, avgComparePeriodRange(current));
  const prevMap = avgByKeyInRange(records, avgComparePeriodRange(compareTo));

  const rows: AvgTimeComparisonRow[] = [];
  for (const [key, cur] of currentMap) {
    const prev = prevMap.get(key);
    if (!prev || cur.count < minSampleCount || prev.count < minSampleCount) continue;
    rows.push({ ...cur, prevAvgSeconds: prev.avgSeconds, deltaSeconds: cur.avgSeconds - prev.avgSeconds });
  }

  return {
    improved: rows.filter((r) => r.deltaSeconds < 0).sort((a, b) => a.deltaSeconds - b.deltaSeconds),
    regressed: rows.filter((r) => r.deltaSeconds > 0).sort((a, b) => b.deltaSeconds - a.deltaSeconds),
  };
}
