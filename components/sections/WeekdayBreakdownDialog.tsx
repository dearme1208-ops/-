"use client";

import { useMemo } from "react";
import { computeWeekdayBreakdown } from "@/lib/weekday";
import { formatHms } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import RankingBarChart from "@/components/charts/RankingBarChart";

export default function WeekdayBreakdownDialog({
  dow,
  label,
  dayCount,
  avgSeconds,
  records,
  onClose,
}: {
  dow: number;
  label: string;
  dayCount: number;
  avgSeconds: number;
  records: WorkRecord[];
  onClose: () => void;
}) {
  const rows = useMemo(() => computeWeekdayBreakdown(records, dow, dayCount), [records, dow, dayCount]);

  return (
    <Modal title={`${label}曜日の内訳`} onClose={onClose}>
      <div className="mb-3">
        <div className="text-xs text-cream/50">{dayCount}日分の平均</div>
        <div className="font-display text-lg font-bold text-cream">{formatHms(avgSeconds)}</div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-cream/50">データがありません。</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <RankingBarChart
            data={rows.map((r) => ({ label: r.name, sublabel: r.category, value: r.avgSeconds }))}
            formatValue={formatHms}
          />
        </div>
      )}
      <p className="mt-3 text-[10px] text-cream/40">
        1日あたりの平均は、この曜日が実績のある{dayCount}日を分母にしています(作業ごとの内訳の合計は、上の平均とほぼ一致します)。
      </p>
    </Modal>
  );
}
