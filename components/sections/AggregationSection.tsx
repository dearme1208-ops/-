"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { recomputeOutliersForAll } from "@/lib/outliers";
import { aggregateRecords, type SortMetric } from "@/lib/aggregate";
import { currentFiscalYear, PERIOD_LABELS, type PeriodType } from "@/lib/period";
import { formatHms } from "@/lib/time";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function AggregationSection() {
  const [period, setPeriod] = useState<PeriodType>("all");
  const [fiscalYear, setFiscalYear] = useState(() => currentFiscalYear());
  const [sortBy, setSortBy] = useState<SortMetric>("total");

  useEffect(() => {
    recomputeOutliersForAll();
  }, []);

  const records = useLiveQuery(() => db.records.toArray(), []);
  const rows = records ? aggregateRecords(records, { type: period, fiscalYear }, sortBy) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PERIOD_LABELS) as PeriodType[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={period === p ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {(period === "h1" || period === "h2") && (
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-sm text-cream"
          >
            {Array.from({ length: 6 }, (_, i) => currentFiscalYear() - 3 + i).map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-cream/60">並び替え:</span>
        {([
          ["total", "合計時間"],
          ["avg", "平均時間"],
          ["count", "件数"],
        ] as [SortMetric, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            className={sortBy === key ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="panel divide-y divide-cream/10">
        {rows.map((row, idx) => (
          <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="w-8 text-center text-lg">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
              <div>
                <div className="text-xs text-cream/50">{row.category}</div>
                <div className="text-sm text-cream">{row.name}</div>
              </div>
            </div>
            <div className="flex gap-4 text-right text-sm tabular-nums">
              <div>
                <div className="text-cream/50 text-xs">合計</div>
                {formatHms(row.totalSeconds)}
              </div>
              <div>
                <div className="text-cream/50 text-xs">平均</div>
                {formatHms(row.avgSeconds)}
              </div>
              <div>
                <div className="text-cream/50 text-xs">件数</div>
                {row.count}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-cream/50">この期間のデータはありません。</p>}
      </div>
      <p className="text-xs text-cream/40">
        ※ 統計的な外れ値（IQR範囲外）は自動的に集計から除外されています。復活させる場合は「実績編集」から操作してください。
      </p>
    </div>
  );
}
