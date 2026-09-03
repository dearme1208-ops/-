import type { WorkRecord } from "./types";
import { currentFiscalYear, isDateStrInRange, type PeriodFilter, getPeriodRange } from "./period";

export interface AggregateRow {
  key: string;
  category: string;
  name: string;
  totalSeconds: number;
  avgSeconds: number;
  count: number;
}

export type SortMetric = "total" | "avg" | "count";

// トラブル対応など「ポイント」が付いた実績は、実績ごとに詳細作業名が異なっていても
// 大項目（category）でひとつにまとめて集計する
export function aggregateKey(r: WorkRecord): string {
  return r.isTrouble ? `__trouble__::${r.category}` : (r.masterTaskId ?? `${r.category}::${r.name}`);
}

export function aggregateRecords(
  records: WorkRecord[],
  filter: PeriodFilter,
  sortBy: SortMetric,
  includeExcluded = false,
  now: Date = new Date()
): AggregateRow[] {
  const range = getPeriodRange(filter, now);
  const inPeriod = records.filter(
    (r) => isDateStrInRange(r.date, range) && (includeExcluded || !r.excludedFromStats)
  );
  const map = new Map<string, AggregateRow>();
  for (const r of inPeriod) {
    const key = aggregateKey(r);
    if (!map.has(key)) {
      map.set(key, {
        key,
        category: r.category,
        name: r.isTrouble ? "（全件合計）" : r.name,
        totalSeconds: 0,
        avgSeconds: 0,
        count: 0,
      });
    }
    const row = map.get(key)!;
    row.totalSeconds += r.seconds;
    row.count += 1;
  }
  const rows = [...map.values()].map((r) => ({ ...r, avgSeconds: r.totalSeconds / r.count }));
  const metricKey: Record<SortMetric, keyof AggregateRow> = {
    total: "totalSeconds",
    avg: "avgSeconds",
    count: "count",
  };
  rows.sort((a, b) => (b[metricKey[sortBy]] as number) - (a[metricKey[sortBy]] as number));
  return rows;
}

export interface HalfYearComparisonRow extends AggregateRow {
  prevTotalSeconds: number;
  delta: number;
}

export interface HalfYearPeriod {
  type: "h1" | "h2";
  fiscalYear: number;
}

// 指定した半期どうしを自然な「前期」として決める（例: 2026年度上期 の前期は 2025年度下期）
export function defaultComparePeriod(period: HalfYearPeriod): HalfYearPeriod {
  return period.type === "h1"
    ? { type: "h2", fiscalYear: period.fiscalYear - 1 }
    : { type: "h1", fiscalYear: period.fiscalYear };
}

// 任意の2つの半期を比較し、増加/減少しているものをランキングする。
// 比較先の期にも実績（母数1件以上）がある業務だけを対象にする（新規に始めた/やめた業務は対象外）
export function computeHalfYearComparison(
  records: WorkRecord[],
  current: HalfYearPeriod,
  compareTo: HalfYearPeriod
): { increased: HalfYearComparisonRow[]; decreased: HalfYearComparisonRow[] } {
  const currentRows = aggregateRecords(records, { type: current.type, fiscalYear: current.fiscalYear }, "total");
  const previousRows = aggregateRecords(records, { type: compareTo.type, fiscalYear: compareTo.fiscalYear }, "total");
  const previousByKey = new Map(previousRows.map((r) => [r.key, r.totalSeconds]));

  const comparisonRows: HalfYearComparisonRow[] = currentRows
    .filter((r) => previousByKey.has(r.key))
    .map((r) => {
      const prevTotalSeconds = previousByKey.get(r.key)!;
      return { ...r, prevTotalSeconds, delta: r.totalSeconds - prevTotalSeconds };
    });

  return {
    increased: comparisonRows.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta),
    decreased: comparisonRows.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta),
  };
}

export type TrendGranularity = "year" | "half" | "month";

// 日付を年度・半期・月単位の集計バケットに変換する。sortKeyは文字列比較でそのまま
// 時系列順になる形式にしている
export function bucketFor(dateStr: string, granularity: TrendGranularity): { sortKey: string; label: string } {
  const d = new Date(dateStr + "T12:00:00");
  const fy = currentFiscalYear(d);
  if (granularity === "year") {
    return { sortKey: String(fy), label: `${fy}年度` };
  }
  if (granularity === "half") {
    const month = d.getMonth() + 1;
    const half = month >= 4 && month <= 9 ? "h1" : "h2";
    return { sortKey: `${fy}-${half}`, label: `${fy}年度${half === "h1" ? "上期" : "下期"}` };
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { sortKey: `${y}-${String(m).padStart(2, "0")}`, label: `${y}/${m}` };
}

export interface TaskTrendPoint {
  label: string; // 表示用ラベル（例: "2026年度", "2026年度上期", "2026/8"）
  sortKey: string; // 時系列順に並べるためのキー
  totalSeconds: number;
  count: number;
}

// 特定の作業(aggregateRecordsが返すkeyと同じ単位)について、年度・半期・月単位での
// 作業時間・件数の推移を時系列順に返す。期間フィルタは適用せず全期間のデータが対象
export function computeTaskTrend(
  records: WorkRecord[],
  key: string,
  granularity: TrendGranularity,
  includeExcluded = false
): TaskTrendPoint[] {
  const matching = records.filter((r) => aggregateKey(r) === key && (includeExcluded || !r.excludedFromStats));
  const map = new Map<string, TaskTrendPoint>();
  for (const r of matching) {
    const { sortKey, label } = bucketFor(r.date, granularity);
    if (!map.has(sortKey)) map.set(sortKey, { label, sortKey, totalSeconds: 0, count: 0 });
    const point = map.get(sortKey)!;
    point.totalSeconds += r.seconds;
    point.count += 1;
  }
  return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export interface TotalTimeTrendPoint {
  label: string;
  sortKey: string;
  totalSeconds: number;
}

// 全作業を合わせた累計作業時間の推移を、年度・半期・月単位で時系列順に返す
export function computeTotalTimeTrend(
  records: WorkRecord[],
  granularity: TrendGranularity,
  includeExcluded = false
): TotalTimeTrendPoint[] {
  const target = records.filter((r) => includeExcluded || !r.excludedFromStats);
  const map = new Map<string, TotalTimeTrendPoint>();
  for (const r of target) {
    const { sortKey, label } = bucketFor(r.date, granularity);
    if (!map.has(sortKey)) map.set(sortKey, { label, sortKey, totalSeconds: 0 });
    map.get(sortKey)!.totalSeconds += r.seconds;
  }
  return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}
