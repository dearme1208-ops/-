"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { aggregateRecords, type SortMetric } from "@/lib/aggregate";
import { currentFiscalYear, PERIOD_LABELS, type PeriodType } from "@/lib/period";
import { buildTrend, TREND_GRANULARITY_LABELS, type TrendGranularity } from "@/lib/trend";
import { formatHms } from "@/lib/time";
import RankingBarChart from "@/components/charts/RankingBarChart";
import TrendBarChart from "@/components/charts/TrendBarChart";

const TOP_N = 10;

export default function ChartsSection() {
  const [period, setPeriod] = useState<PeriodType>("all");
  const [fiscalYear, setFiscalYear] = useState(() => currentFiscalYear());
  const [sortBy, setSortBy] = useState<SortMetric>("total");
  const [granularity, setGranularity] = useState<TrendGranularity>("day");

  const records = useLiveQuery(() => db.records.toArray(), []);

  const rankingRows = records ? aggregateRecords(records, { type: period, fiscalYear }, sortBy).slice(0, TOP_N) : [];
  const trendPoints = records ? buildTrend(records, granularity) : [];

  const metricFormat: Record<SortMetric, (v: number) => string> = {
    total: formatHms,
    avg: formatHms,
    count: (v) => `${v}件`,
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 font-display text-lg font-bold">作業別グラフ（上位{TOP_N}件）</h2>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {(Object.keys(PERIOD_LABELS) as PeriodType[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={period === p ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
          {(period === "h1" || period === "h2") && (
            <select
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
              className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            >
              {Array.from({ length: 6 }, (_, i) => currentFiscalYear() - 3 + i).map((y) => (
                <option key={y} value={y}>
                  {y}年度
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-cream/50">並び替え:</span>
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
        <div className="panel p-4">
          <RankingBarChart
            data={rankingRows.map((r) => ({
              label: r.name,
              sublabel: r.category,
              value: sortBy === "total" ? r.totalSeconds : sortBy === "avg" ? r.avgSeconds : r.count,
            }))}
            formatValue={metricFormat[sortBy]}
          />
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">期間別グラフ</h2>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(Object.keys(TREND_GRANULARITY_LABELS) as TrendGranularity[]).map((g) => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              className={granularity === g ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            >
              {TREND_GRANULARITY_LABELS[g]}
            </button>
          ))}
        </div>
        <div className="panel p-4">
          <TrendBarChart points={trendPoints} formatValue={formatHms} />
          <p className="mt-3 text-xs text-cream/40">棒をタップすると数値を表示します。</p>
        </div>
      </div>
    </div>
  );
}
