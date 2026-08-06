import type { WorkRecord } from "./types";
import { isDateStrInRange, type PeriodFilter, getPeriodRange } from "./period";

export interface AggregateRow {
  key: string;
  category: string;
  name: string;
  totalSeconds: number;
  avgSeconds: number;
  count: number;
}

export type SortMetric = "total" | "avg" | "count";

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
    // トラブル対応など「ポイント」が付いた実績は、実績ごとに詳細作業名が異なっていても
    // 大項目（category）でひとつにまとめて集計する
    const key = r.isTrouble ? `__trouble__::${r.category}` : (r.masterTaskId ?? `${r.category}::${r.name}`);
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
