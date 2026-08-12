"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  computeAttentionList,
  computeAverageTimeComparison,
  computeEstimationAccuracyTrend,
  defaultAvgComparePeriod,
  type AvgComparePeriod,
  type AvgComparePeriodType,
} from "@/lib/attention";
import { computeConditionVarianceByTask, computeProductivityByCondition, CONDITION_LEVELS } from "@/lib/condition";
import { currentFiscalYear } from "@/lib/period";
import { formatHms } from "@/lib/time";
import { emphasisTextClass, getRiskTier, riskBadgeClasses, riskBadgeLabel, useVisualMode } from "@/lib/theme";
import DiffLineChart from "@/components/charts/DiffLineChart";
import ConditionGlyph from "@/components/ui/ConditionGlyph";

const MEDALS = ["🥇", "🥈", "🥉"];
const AVG_COMPARE_TYPE_LABELS: Record<AvgComparePeriodType, string> = { year: "年度", h1: "上期", h2: "下期" };

export default function AttentionSection() {
  const { themedMode } = useVisualMode();
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.toArray(), []);

  const [avgPeriodType, setAvgPeriodType] = useState<AvgComparePeriodType>("h1");
  const [avgFiscalYear, setAvgFiscalYear] = useState(() => currentFiscalYear());
  const [avgCompareTarget, setAvgCompareTarget] = useState<AvgComparePeriod>(() =>
    defaultAvgComparePeriod({ type: "h1", fiscalYear: currentFiscalYear() })
  );

  // 表示期間の種別/年度を変えたら、比較先も自然な「前期」に追従させる
  useEffect(() => {
    setAvgCompareTarget(defaultAvgComparePeriod({ type: avgPeriodType, fiscalYear: avgFiscalYear }));
  }, [avgPeriodType, avgFiscalYear]);

  const rows = masterTasks && records ? computeAttentionList(masterTasks, records) : [];
  const accuracyTrend = masterTasks && records ? computeEstimationAccuracyTrend(masterTasks, records) : [];
  const productivityRows =
    masterTasks && records && conditionLogs
      ? computeProductivityByCondition(conditionLogs, records, masterTasks)
      : [];
  const varianceRows = useMemo(
    () => (masterTasks && records && conditionLogs ? computeConditionVarianceByTask(conditionLogs, records, masterTasks) : []),
    [masterTasks, records, conditionLogs]
  );
  const avgComparison = useMemo(() => {
    if (!records) return null;
    return computeAverageTimeComparison(records, { type: avgPeriodType, fiscalYear: avgFiscalYear }, avgCompareTarget);
  }, [records, avgPeriodType, avgFiscalYear, avgCompareTarget]);

  const fiscalYearOptions = Array.from({ length: 8 }, (_, i) => currentFiscalYear() - 5 + i);

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
        <h3 className="mb-3 font-display text-sm font-bold text-cream/80">体調による所要時間のブレが大きい作業</h3>
        {varianceRows.length === 0 ? (
          <p className="text-sm text-cream/50">
            2つ以上の体調レベルでそれぞれ2件以上の実績がある作業がまだありません。
          </p>
        ) : (
          <div className="space-y-3">
            {varianceRows.slice(0, 10).map((row, idx) => (
              <div key={row.masterTaskId} className="rounded-lg bg-ink/50 px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-sm">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
                    <div>
                      <div className="text-xs text-cream/50">{row.category}</div>
                      <div className="text-sm text-cream">{row.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-base font-bold text-alert">±{row.rangePct}pt</div>
                    <div className="text-[10px] text-cream/40">達成度の最大差</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pl-7">
                  {row.levels.map((l) => {
                    const c = CONDITION_LEVELS.find((cl) => cl.level === l.level);
                    return (
                      <div
                        key={l.level}
                        className="flex items-center gap-1 rounded-full border border-cream/15 px-2 py-1 text-[11px] text-cream/70"
                      >
                        <ConditionGlyph level={l.level} size={14} />
                        <span>{c?.label}</span>
                        <span className="font-bold text-cream">{l.avgProductivityPct}%</span>
                        <span className="text-cream/40">({l.sampleCount}件)</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-cream/40">
          体調レベルごとの平均達成度（想定÷実績）の最大差が大きい作業ほど、体調によって所要時間が大きく変わりやすいことを表します。
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

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">平均時間の増減ランキング（改善成功／要改善）</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          {(Object.keys(AVG_COMPARE_TYPE_LABELS) as AvgComparePeriodType[]).map((t) => (
            <button
              key={t}
              className={avgPeriodType === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setAvgPeriodType(t)}
            >
              {AVG_COMPARE_TYPE_LABELS[t]}ごと
            </button>
          ))}
          <select
            value={avgFiscalYear}
            onChange={(e) => setAvgFiscalYear(Number(e.target.value))}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          >
            {fiscalYearOptions.map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <span>比較先:</span>
          <select
            value={avgCompareTarget.type}
            onChange={(e) => setAvgCompareTarget((c) => ({ ...c, type: e.target.value as AvgComparePeriodType }))}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          >
            {(Object.keys(AVG_COMPARE_TYPE_LABELS) as AvgComparePeriodType[]).map((t) => (
              <option key={t} value={t}>
                {AVG_COMPARE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            value={avgCompareTarget.fiscalYear}
            onChange={(e) => setAvgCompareTarget((c) => ({ ...c, fiscalYear: Number(e.target.value) }))}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          >
            {fiscalYearOptions.map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-cream/50">
          <span className="font-bold text-cream">
            {avgFiscalYear}年度{avgPeriodType !== "year" && AVG_COMPARE_TYPE_LABELS[avgPeriodType]}
          </span>
          と
          <span className="font-bold text-cream">
            {" "}
            {avgCompareTarget.fiscalYear}年度{avgCompareTarget.type !== "year" && AVG_COMPARE_TYPE_LABELS[avgCompareTarget.type]}
          </span>
          の、1件あたり平均時間を比較しています（両方の期に2件以上の実績がある作業のみ対象）。
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">✅ 改善成功（平均時間が短縮）</h4>
            {!avgComparison || avgComparison.improved.length === 0 ? (
              <p className="text-sm text-cream/50">該当する作業はありません。</p>
            ) : (
              <div className="space-y-2">
                {avgComparison.improved.slice(0, 10).map((row, idx) => (
                  <div key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-sm">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
                      <div>
                        <div className="text-xs text-cream/50">{row.category}</div>
                        <div className="text-sm text-cream">{row.name}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <div className="font-display text-base font-bold text-cream">-{formatHms(-row.deltaSeconds)}</div>
                      <div className="text-cream/40">
                        {formatHms(row.prevAvgSeconds)} → {formatHms(row.avgSeconds)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">⚠️ 要改善（平均時間が増加）</h4>
            {!avgComparison || avgComparison.regressed.length === 0 ? (
              <p className="text-sm text-cream/50">該当する作業はありません。</p>
            ) : (
              <div className="space-y-2">
                {avgComparison.regressed.slice(0, 10).map((row, idx) => {
                  const ratio = row.prevAvgSeconds > 0 ? row.avgSeconds / row.prevAvgSeconds : 1;
                  const tier = themedMode && ratio >= 1.3 ? getRiskTier(ratio, themedMode) : null;
                  return (
                    <div key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-center text-sm">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
                        <div>
                          <div className="text-xs text-cream/50">{row.category}</div>
                          <div className="flex items-center gap-1.5 text-sm text-cream">
                            {row.name}
                            {tier && themedMode && (
                              <span className={riskBadgeClasses(tier.level, themedMode)}>{riskBadgeLabel(tier, themedMode)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs tabular-nums">
                        <div className="font-display text-base font-bold text-alert">+{formatHms(row.deltaSeconds)}</div>
                        <div className="text-cream/40">
                          {formatHms(row.prevAvgSeconds)} → {formatHms(row.avgSeconds)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-sm text-cream/60">想定時間に対して実績平均が30%以上超過している作業です。</p>
      <div className="panel divide-y divide-cream/10">
        {rows.map((row) => {
          const ratio = 1 + row.overRatio;
          const tier = themedMode ? getRiskTier(ratio, themedMode) : null;
          return (
            <div key={row.masterTaskId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-xs text-cream/50">{row.category}</div>
                <div className="flex items-center gap-1.5 text-sm text-cream">
                  {row.name}
                  {tier && themedMode && (
                    <span className={riskBadgeClasses(tier.level, themedMode)}>{riskBadgeLabel(tier, themedMode)}</span>
                  )}
                </div>
                <div className="text-xs text-cream/40">サンプル数 {row.sampleCount}</div>
              </div>
              <div className="text-right text-sm tabular-nums">
                <div className={`font-display text-base font-bold ${themedMode ? emphasisTextClass(themedMode) : "text-alert"}`}>
                  +{Math.round(row.overRatio * 100)}%
                </div>
                <div className="text-cream/50 text-xs">
                  想定 {formatHms(row.estimatedSeconds)} → 平均 {formatHms(row.avgSeconds)}
                </div>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p className="px-4 py-6 text-sm text-cream/50">該当する作業はありません。</p>
        )}
      </div>
    </div>
  );
}
