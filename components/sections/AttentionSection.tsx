"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { computeAttentionList, computeEstimationAccuracyTrend } from "@/lib/attention";
import { formatHms } from "@/lib/time";
import DiffLineChart from "@/components/charts/DiffLineChart";

export default function AttentionSection() {
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);

  const rows = masterTasks && records ? computeAttentionList(masterTasks, records) : [];
  const accuracyTrend = masterTasks && records ? computeEstimationAccuracyTrend(masterTasks, records) : [];

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="mb-3 font-display text-sm font-bold text-cream/80">見積り精度トレンド（想定比の月次推移）</h3>
        {accuracyTrend.length === 0 ? (
          <p className="text-sm text-cream/50">想定時間が設定された作業の実績がまだありません。</p>
        ) : (
          <DiffLineChart points={accuracyTrend} formatValue={(v) => `${v > 0 ? "+" : ""}${v}%`} />
        )}
        <p className="mt-3 text-xs text-cream/40">
          0%が想定通り。プラスは想定より時間がかかっている傾向、マイナスは想定より早く終わっている傾向を表します。
        </p>
      </div>

      <p className="text-sm text-cream/60">想定時間に対して実績平均が30%以上超過している作業です。</p>
      <div className="panel divide-y divide-cream/10">
        {rows.map((row) => (
          <div key={row.masterTaskId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <div className="text-xs text-cream/50">{row.category}</div>
              <div className="text-sm text-cream">{row.name}</div>
              <div className="text-xs text-cream/40">サンプル数 {row.sampleCount}</div>
            </div>
            <div className="text-right text-sm tabular-nums">
              <div className="text-alert font-display text-base font-bold">
                +{Math.round(row.overRatio * 100)}%
              </div>
              <div className="text-cream/50 text-xs">
                想定 {formatHms(row.estimatedSeconds)} → 平均 {formatHms(row.avgSeconds)}
              </div>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="px-4 py-6 text-sm text-cream/50">該当する作業はありません。</p>
        )}
      </div>
    </div>
  );
}
