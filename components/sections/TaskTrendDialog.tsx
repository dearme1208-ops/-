"use client";

import { useMemo, useState } from "react";
import { computeTaskTrend, type TrendGranularity } from "@/lib/aggregate";
import { formatHms } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import RankingBarChart from "@/components/charts/RankingBarChart";
import LineChart from "@/components/charts/LineChart";

const GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  year: "年度ごと",
  half: "半期ごと",
  month: "1ヶ月ごと",
};

type ChartType = "bar" | "line";

export default function TaskTrendDialog({
  rowKey,
  category,
  name,
  records,
  onClose,
}: {
  rowKey: string;
  category: string;
  name: string;
  records: WorkRecord[];
  onClose: () => void;
}) {
  const [granularity, setGranularity] = useState<TrendGranularity>("half");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const points = useMemo(
    () => computeTaskTrend(records, rowKey, granularity),
    [records, rowKey, granularity]
  );

  function renderChart(data: { key: string; label: string; value: number }[], formatValue: (v: number) => string) {
    return chartType === "bar" ? (
      <RankingBarChart data={data} formatValue={formatValue} />
    ) : (
      <LineChart points={data} formatValue={formatValue} />
    );
  }

  return (
    <Modal title="作業時間・平均・件数の推移" onClose={onClose}>
      <div className="mb-3">
        <div className="text-xs text-cream/50">{category}</div>
        <div className="text-sm font-bold text-cream">{name}</div>
      </div>

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
        {([
          ["bar", "棒グラフ"],
          ["line", "折れ線グラフ"],
        ] as [ChartType, string][]).map(([t, label]) => (
          <button
            key={t}
            className={chartType === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setChartType(t)}
          >
            {label}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <p className="text-sm text-cream/50">データがありません。</p>
      ) : (
        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">合計時間</h4>
            {renderChart(
              points.map((p) => ({ key: p.sortKey, label: p.label, value: p.totalSeconds })),
              formatHms
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">平均時間（1件あたり）</h4>
            {renderChart(
              points.map((p) => ({ key: p.sortKey, label: p.label, value: p.totalSeconds / p.count })),
              formatHms
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">作業件数</h4>
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
