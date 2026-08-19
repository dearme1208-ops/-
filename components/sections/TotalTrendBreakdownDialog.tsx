"use client";

import { useMemo } from "react";
import { bucketFor, type TrendGranularity } from "@/lib/aggregate";
import { breakdownByCategory } from "@/lib/overtime";
import { formatHms } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import RankingBarChart from "@/components/charts/RankingBarChart";

export default function TotalTrendBreakdownDialog({
  granularity,
  sortKey,
  label,
  totalSeconds,
  records,
  onClose,
}: {
  granularity: TrendGranularity;
  sortKey: string;
  label: string;
  totalSeconds: number;
  records: WorkRecord[];
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    const matching = records.filter((r) => !r.excludedFromStats && bucketFor(r.date, granularity).sortKey === sortKey);
    return breakdownByCategory(matching);
  }, [records, granularity, sortKey]);

  return (
    <Modal title={`${label}の内訳`} onClose={onClose}>
      <div className="mb-3">
        <div className="text-xs text-cream/50">この期間の累計作業時間</div>
        <div className="font-display text-lg font-bold text-cream">{formatHms(totalSeconds)}</div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-cream/50">データがありません。</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <RankingBarChart data={rows.map((r) => ({ label: r.label, sublabel: r.sublabel, value: r.seconds }))} formatValue={formatHms} />
        </div>
      )}
    </Modal>
  );
}
