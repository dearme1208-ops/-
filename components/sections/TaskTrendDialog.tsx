"use client";

import { useMemo, useState } from "react";
import { computeTaskTrend, type TrendGranularity } from "@/lib/aggregate";
import { formatHms } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import RankingBarChart from "@/components/charts/RankingBarChart";

const GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  year: "年度ごと",
  half: "半期ごと",
  month: "1ヶ月ごと",
};

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
  const points = useMemo(
    () => computeTaskTrend(records, rowKey, granularity),
    [records, rowKey, granularity]
  );

  return (
    <Modal title="作業時間・件数の推移" onClose={onClose}>
      <div className="mb-3">
        <div className="text-xs text-cream/50">{category}</div>
        <div className="text-sm font-bold text-cream">{name}</div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
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

      {points.length === 0 ? (
        <p className="text-sm text-cream/50">データがありません。</p>
      ) : (
        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">作業時間</h4>
            <RankingBarChart data={points.map((p) => ({ label: p.label, value: p.totalSeconds }))} formatValue={formatHms} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">作業件数</h4>
            <RankingBarChart
              data={points.map((p) => ({ label: p.label, value: p.count }))}
              formatValue={(v) => `${v}件`}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
