"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { computeAttentionList, computeEstimationAccuracyTrend } from "@/lib/attention";
import { computeProductivityByCondition, CONDITION_LEVELS } from "@/lib/condition";
import { formatHms } from "@/lib/time";
import DiffLineChart from "@/components/charts/DiffLineChart";
import ConditionGlyph from "@/components/ui/ConditionGlyph";

export default function AttentionSection() {
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.toArray(), []);

  const rows = masterTasks && records ? computeAttentionList(masterTasks, records) : [];
  const accuracyTrend = masterTasks && records ? computeEstimationAccuracyTrend(masterTasks, records) : [];
  const productivityRows =
    masterTasks && records && conditionLogs
      ? computeProductivityByCondition(conditionLogs, records, masterTasks)
      : [];

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="mb-3 font-display text-sm font-bold text-cream/80">体調別の生産性（想定時間に対する達成度）</h3>
        {productivityRows.length === 0 ? (
          <p className="text-sm text-cream/50">
            体調を記録している間に行った作業に、想定時間と実績が両方揃っているデータがまだありません。
          </p>
        ) : (
          <div className="space-y-2">
            {productivityRows.map((row) => {
              const c = CONDITION_LEVELS.find((c) => c.level === row.level);
              const pct = Math.min(150, row.avgProductivityPct);
              return (
                <div key={row.level} className="flex items-center gap-2">
                  <div className="flex w-24 shrink-0 items-center gap-1.5 text-sm text-cream/80">
                    <ConditionGlyph level={row.level} size={18} />
                    {c?.label}
                  </div>
                  <div className="h-5 min-w-0 flex-1 rounded bg-cream/5">
                    <div
                      className={`h-5 rounded-r ${row.avgProductivityPct >= 100 ? "bg-cream" : "bg-alert"}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs tabular-nums text-cream/70">
                    {row.avgProductivityPct}%（{row.sampleCount}件）
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-3 text-xs text-cream/40">
          体調は「記録した時点から、次に体調を変更するまで」有効なものとして扱い、その間に開始した作業を対象に想定時間÷実績時間を算出し、体調レベルごとに平均したものです。100%が想定通り、100%を超えるほど想定より速く終えられている傾向を表します。
        </p>
      </div>

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
