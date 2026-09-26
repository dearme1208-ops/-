"use client";

import { useMemo, useState } from "react";
import type { TrendGranularity, TaskTrendPoint } from "@/lib/aggregate";
import type { LinkedBreakdownRow } from "@/lib/linkedAggregate";
import { formatHms } from "@/lib/time";
import Modal from "@/components/ui/Modal";
import RankingBarChart from "@/components/charts/RankingBarChart";
import LineChart from "@/components/charts/LineChart";

const GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  year: "年度ごと",
  half: "半期ごと",
  month: "1ヶ月ごと",
};

type ChartType = "bar" | "line";
const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: "棒グラフ",
  line: "折れ線グラフ",
};

// 案件・ToDo1件に絞った時間の内訳(段階別/サブタスク別)と時系列推移をまとめて見せる汎用ダイアログ。
// AggregationSectionの「案件別」「ToDo別」集計から、行をタップして開く
export default function LinkedTimeBreakdownDialog({
  title,
  subtitle,
  breakdownLabel,
  breakdownRows,
  trendFn,
  onClose,
}: {
  title: string;
  subtitle?: string;
  breakdownLabel: string;
  breakdownRows: LinkedBreakdownRow[];
  trendFn: (granularity: TrendGranularity) => TaskTrendPoint[];
  onClose: () => void;
}) {
  const [granularity, setGranularity] = useState<TrendGranularity>("half");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const points = useMemo(() => trendFn(granularity), [trendFn, granularity]);
  const totalSeconds = breakdownRows.reduce((s, r) => s + r.totalSeconds, 0);
  const totalCount = breakdownRows.reduce((s, r) => s + r.count, 0);

  function renderChart(data: { key: string; label: string; value: number }[], formatValue: (v: number) => string) {
    return chartType === "bar" ? (
      <RankingBarChart data={data} formatValue={formatValue} />
    ) : (
      <LineChart points={data} formatValue={formatValue} />
    );
  }

  return (
    <Modal title="作業時間の内訳・推移" onClose={onClose}>
      <div className="mb-3">
        {subtitle && <div className="text-xs text-cream/50">{subtitle}</div>}
        <div className="text-sm font-bold text-cream">{title}</div>
        <div className="mt-1 text-xs tabular-nums text-cream/60">
          合計 {formatHms(totalSeconds)}（{totalCount}件）
        </div>
      </div>

      {breakdownRows.length === 0 ? (
        <p className="mb-4 text-sm text-cream/50">紐づく実績がまだありません。</p>
      ) : (
        <div className="mb-5">
          <h4 className="mb-2 text-xs font-bold text-cream/70">{breakdownLabel}</h4>
          <div className="mb-3 overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-xs">
              <thead>
                <tr className="text-cream/50">
                  <th className="pb-1 pr-3 font-normal"></th>
                  <th className="pb-1 pr-3 text-right font-normal">件数</th>
                  <th className="pb-1 pr-3 text-right font-normal">合計時間</th>
                  <th className="pb-1 text-right font-normal">平均時間</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {breakdownRows.map((r) => (
                  <tr key={r.key} className="border-t border-cream/10">
                    <td className="py-1.5 pr-3 font-bold text-cream">{r.title}</td>
                    <td className="py-1.5 pr-3 text-right text-cream/80">{r.count}件</td>
                    <td className="py-1.5 pr-3 text-right text-cream/80">{formatHms(r.totalSeconds)}</td>
                    <td className="py-1.5 text-right text-cream/80">{formatHms(r.avgSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RankingBarChart
            data={breakdownRows.map((r) => ({ key: r.key, label: r.title, value: r.totalSeconds }))}
            formatValue={formatHms}
          />
        </div>
      )}

      <h4 className="mb-2 text-xs font-bold text-cream/70">時系列推移</h4>
      <div className="mb-2 flex flex-wrap gap-2">
        {(Object.keys(GRANULARITY_LABELS) as TrendGranularity[]).map((g) => (
          <button
            key={g}
            className={granularity === g ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setGranularity(g)}
          >
            {GRANULARITY_LABELS[g]}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((t) => (
          <button
            key={t}
            className={chartType === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setChartType(t)}
          >
            {CHART_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="text-sm text-cream/50">この期間のデータはありません。</p>
      ) : (
        <div className="max-h-[45vh] space-y-5 overflow-y-auto pr-1">
          <div>
            <h5 className="mb-2 text-xs font-bold text-cream/70">合計時間</h5>
            {renderChart(
              points.map((p) => ({ key: p.sortKey, label: p.label, value: p.totalSeconds })),
              formatHms
            )}
          </div>
          <div>
            <h5 className="mb-2 text-xs font-bold text-cream/70">件数</h5>
            {renderChart(
              points.map((p) => ({ key: p.sortKey, label: p.label, value: p.count })),
              (v) => `${v}件`
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
