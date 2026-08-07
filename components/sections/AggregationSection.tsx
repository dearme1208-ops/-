"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subMonths, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import {
  aggregateRecords,
  computeHalfYearComparison,
  defaultComparePeriod,
  type HalfYearPeriod,
  type SortMetric,
} from "@/lib/aggregate";
import { currentFiscalYear, PERIOD_LABELS, type PeriodType } from "@/lib/period";
import { formatHms } from "@/lib/time";
import { computeWeekdayAverages } from "@/lib/weekday";
import { computeSwitchCostAnalysis } from "@/lib/switchcost";
import { computeTimeByTag } from "@/lib/tags";
import RankingBarChart from "@/components/charts/RankingBarChart";
import CollapsiblePanel from "@/components/ui/CollapsiblePanel";

const MEDALS = ["🥇", "🥈", "🥉"];
const HALF_LABELS: Record<"h1" | "h2", string> = { h1: "上期", h2: "下期" };

export default function AggregationSection() {
  const [period, setPeriod] = useState<PeriodType>("all");
  const [fiscalYear, setFiscalYear] = useState(() => currentFiscalYear());
  const [sortBy, setSortBy] = useState<SortMetric>("total");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [compareTarget, setCompareTarget] = useState<HalfYearPeriod>(() =>
    defaultComparePeriod({ type: "h1", fiscalYear: currentFiscalYear() })
  );

  // 表示期間（上期/下期）を切り替えたら、比較先も自然な「前期」に追従させる
  useEffect(() => {
    if (period === "h1" || period === "h2") {
      setCompareTarget(defaultComparePeriod({ type: period, fiscalYear }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, fiscalYear]);

  function toggleSection(key: string) {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }

  const records = useLiveQuery(() => db.records.toArray(), []);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const rows = records ? aggregateRecords(records, { type: period, fiscalYear }, sortBy) : [];
  const weekdayAverages = useMemo(() => computeWeekdayAverages(records ?? []), [records]);
  const switchCost = useMemo(() => computeSwitchCostAnalysis(records ?? []), [records]);
  const tagRows = useMemo(() => computeTimeByTag(records ?? [], masterTasks ?? []), [records, masterTasks]);
  const halfYearComparison = useMemo(() => {
    if (!records || (period !== "h1" && period !== "h2")) return null;
    return computeHalfYearComparison(records, { type: period, fiscalYear }, compareTarget);
  }, [records, period, fiscalYear, compareTarget]);

  // 今週・今月・半期表示の場合、前週・前月・比較対象の期との比較を出す
  const comparisonLabel =
    period === "week" ? "前週比" : period === "month" ? "前月比" : period === "h1" || period === "h2" ? "比較先比" : null;
  const previousTotalsByKey = useMemo(() => {
    if (!records || !comparisonLabel) return null;
    if (period === "h1" || period === "h2") {
      const prevRows = aggregateRecords(records, { type: compareTarget.type, fiscalYear: compareTarget.fiscalYear }, sortBy);
      return new Map(prevRows.map((r) => [r.key, r.totalSeconds]));
    }
    const prevNow = period === "week" ? subWeeks(new Date(), 1) : subMonths(new Date(), 1);
    const prevRows = aggregateRecords(records, { type: period, fiscalYear }, sortBy, false, prevNow);
    return new Map(prevRows.map((r) => [r.key, r.totalSeconds]));
  }, [records, period, fiscalYear, sortBy, comparisonLabel, compareTarget]);

  const fiscalYearOptions = Array.from({ length: 8 }, (_, i) => currentFiscalYear() - 5 + i);

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
            {fiscalYearOptions.map((y) => (
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

      {(period === "h1" || period === "h2") && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">比較対象の期</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <select
              value={compareTarget.type}
              onChange={(e) => setCompareTarget((c) => ({ ...c, type: e.target.value as "h1" | "h2" }))}
              className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
            >
              <option value="h1">上期</option>
              <option value="h2">下期</option>
            </select>
            <select
              value={compareTarget.fiscalYear}
              onChange={(e) => setCompareTarget((c) => ({ ...c, fiscalYear: Number(e.target.value) }))}
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
              {fiscalYear}年度 {HALF_LABELS[period]}
            </span>
            と
            <span className="font-bold text-cream">
              {" "}
              {compareTarget.fiscalYear}年度 {HALF_LABELS[compareTarget.type]}
            </span>
            を比較しています。
          </p>
        </div>
      )}

      {halfYearComparison && (
        <>
          <CollapsiblePanel
            title="⚠️ 増加ランキング（比較先より実績が増えた・ボトルネック候補）"
            collapsed={!!collapsed.increase}
            onToggle={() => toggleSection("increase")}
          >
            <p className="mb-3 text-xs text-cream/40">比較先の期にも実績があった業務のみが対象です（母数1件未満は対象外）。</p>
            {halfYearComparison.increased.length === 0 ? (
              <p className="text-sm text-cream/50">該当する業務はありません。</p>
            ) : (
              <div className="space-y-2">
                {halfYearComparison.increased.map((row, idx) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg bg-ink/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-xs text-cream/40">{idx + 1}</span>
                      <div>
                        <div className="text-xs text-cream/50">{row.category}</div>
                        <div className="text-sm text-cream">{row.name}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <div className="font-display text-base font-bold text-alert">+{formatHms(row.delta)}</div>
                      <div className="text-cream/40">
                        {formatHms(row.prevTotalSeconds)} → {formatHms(row.totalSeconds)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsiblePanel>

          <CollapsiblePanel
            title="✅ 改善ランキング（比較先より実績が減った）"
            collapsed={!!collapsed.improve}
            onToggle={() => toggleSection("improve")}
          >
            <p className="mb-3 text-xs text-cream/40">比較先の期にも実績があった業務のみが対象です（母数1件未満は対象外）。</p>
            {halfYearComparison.decreased.length === 0 ? (
              <p className="text-sm text-cream/50">該当する業務はありません。</p>
            ) : (
              <div className="space-y-2">
                {halfYearComparison.decreased.map((row, idx) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg bg-ink/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-xs text-cream/40">{idx + 1}</span>
                      <div>
                        <div className="text-xs text-cream/50">{row.category}</div>
                        <div className="text-sm text-cream">{row.name}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <div className="font-display text-base font-bold text-cream">-{formatHms(-row.delta)}</div>
                      <div className="text-cream/40">
                        {formatHms(row.prevTotalSeconds)} → {formatHms(row.totalSeconds)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CollapsiblePanel>
        </>
      )}

      <CollapsiblePanel
        title="曜日別の平均稼働時間"
        collapsed={!!collapsed.weekday}
        onToggle={() => toggleSection("weekday")}
      >
        <RankingBarChart
          data={weekdayAverages
            .filter((w) => w.dayCount > 0)
            .map((w) => ({ label: w.label, sublabel: `${w.dayCount}日分の平均`, value: w.avgSeconds }))}
          formatValue={formatHms}
        />
        {weekdayAverages.every((w) => w.dayCount === 0) && (
          <p className="text-sm text-cream/50">データがありません。</p>
        )}
      </CollapsiblePanel>

      {(switchCost.low || switchCost.high) && (
        <CollapsiblePanel
          title="作業の切り替えコスト分析"
          collapsed={!!collapsed.switchCost}
          onToggle={() => toggleSection("switchCost")}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[switchCost.low, switchCost.high].map(
              (b) =>
                b && (
                  <div key={b.label} className="rounded-lg bg-ink/50 p-3">
                    <div className="text-xs text-cream/50">
                      {b.label}（{b.dayCount}日、平均{b.avgTaskCount.toFixed(1)}件/日）
                    </div>
                    <div className="mt-1 text-sm text-cream/70">
                      1件あたり平均{" "}
                      <span className="font-display text-base font-bold text-cream">
                        {formatHms(b.avgPerTaskSeconds)}
                      </span>
                    </div>
                    <div className="text-sm text-cream/70">
                      1日の合計{" "}
                      <span className="font-display text-base font-bold text-cream">
                        {formatHms(b.avgDailyTotalSeconds)}
                      </span>
                    </div>
                  </div>
                )
            )}
          </div>
          <p className="mt-3 text-xs text-cream/40">
            1日に取り組んだ作業の種類数を目安に、切り替えが少ない日と多い日を比較しています。1件あたりの平均時間が短いほど、細切れになっている可能性があります。
          </p>
        </CollapsiblePanel>
      )}

      {tagRows.length > 0 && (
        <CollapsiblePanel
          title="タグ別の作業時間"
          collapsed={!!collapsed.tags}
          onToggle={() => toggleSection("tags")}
        >
          <RankingBarChart
            data={tagRows.map((r) => ({ label: r.tag, value: r.totalSeconds }))}
            formatValue={formatHms}
          />
          <p className="mt-3 text-xs text-cream/40">
            作業マスタタブでタグを設定した作業に紐づく実績を、タグごとに合計しています。
          </p>
        </CollapsiblePanel>
      )}

      <CollapsiblePanel
        title="作業別ランキング（全件）"
        collapsed={!!collapsed.fullList}
        onToggle={() => toggleSection("fullList")}
      >
        <div className="-mx-4 -mb-3 divide-y divide-cream/10">
          {rows.map((row, idx) => {
            const prevSeconds = previousTotalsByKey?.get(row.key) ?? 0;
            const delta = row.totalSeconds - prevSeconds;
            return (
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
                  {comparisonLabel && (
                    <div>
                      <div className="text-cream/50 text-xs">{comparisonLabel}</div>
                      <span className={delta === 0 ? "text-cream/50" : delta > 0 ? "text-alert" : "text-cream"}>
                        {delta === 0 ? "±0" : delta > 0 ? `▲${formatHms(delta)}` : `▼${formatHms(-delta)}`}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <p className="px-4 py-6 text-sm text-cream/50">この期間のデータはありません。</p>}
        </div>
      </CollapsiblePanel>
      <p className="text-xs text-cream/40">
        ※ 実績は基本的にそのまま集計されます。特定の記録を除外したい場合は「実績編集」から手動で操作してください。
      </p>
    </div>
  );
}
