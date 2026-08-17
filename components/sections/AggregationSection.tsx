"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subMonths, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import {
  aggregateRecords,
  computeHalfYearComparison,
  computeTotalTimeTrend,
  defaultComparePeriod,
  type AggregateRow,
  type HalfYearPeriod,
  type SortMetric,
  type TrendGranularity,
} from "@/lib/aggregate";
import { currentFiscalYear, fiscalPeriodRange, isDateStrInRange, PERIOD_LABELS, type FiscalPeriodType, type PeriodType } from "@/lib/period";
import { formatHms } from "@/lib/time";
import { computeWeekdayAverages } from "@/lib/weekday";
import { computeSwitchCostAnalysis } from "@/lib/switchcost";
import { computeTimeByTag } from "@/lib/tags";
import { computeCost, formatYen, parseCategoryRates, resolveCategoryRate } from "@/lib/cost";
import { useSetting } from "@/lib/settings";
import RankingBarChart from "@/components/charts/RankingBarChart";
import DonutChart from "@/components/charts/DonutChart";
import LineChart from "@/components/charts/LineChart";
import CollapsiblePanel from "@/components/ui/CollapsiblePanel";
import TaskTrendDialog from "@/components/sections/TaskTrendDialog";
import WeekdayBreakdownDialog from "@/components/sections/WeekdayBreakdownDialog";

const MEDALS = ["🥇", "🥈", "🥉"];
const HALF_LABELS: Record<"h1" | "h2", string> = { h1: "上期", h2: "下期" };
const TREND_GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  year: "年度ごと",
  half: "半期ごと",
  month: "1ヶ月ごと",
};
const WEEKDAY_PERIOD_LABELS: Record<FiscalPeriodType, string> = {
  all: "累計",
  year: "年度",
  h1: "上期",
  h2: "下期",
};

export default function AggregationSection() {
  const [period, setPeriod] = useState<PeriodType>("all");
  const [fiscalYear, setFiscalYear] = useState(() => currentFiscalYear());
  const [sortBy, setSortBy] = useState<SortMetric>("total");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [trendRow, setTrendRow] = useState<AggregateRow | null>(null);
  const [totalTrendGranularity, setTotalTrendGranularity] = useState<TrendGranularity>("half");
  const [totalTrendChartType, setTotalTrendChartType] = useState<"bar" | "line">("bar");
  const [weekdayPeriodType, setWeekdayPeriodType] = useState<FiscalPeriodType>("all");
  const [weekdayFiscalYear, setWeekdayFiscalYear] = useState(() => currentFiscalYear());
  const [compareTarget, setCompareTarget] = useState<HalfYearPeriod>(() =>
    defaultComparePeriod({ type: "h1", fiscalYear: currentFiscalYear() })
  );
  const [defaultHourlyRateStr] = useSetting("cost.defaultHourlyRate", "");
  const defaultHourlyRate = Number(defaultHourlyRateStr) > 0 ? Number(defaultHourlyRateStr) : null;
  const [categoryRatesJson] = useSetting("cost.categoryRates", "{}");
  const categoryRates = useMemo(() => parseCategoryRates(categoryRatesJson), [categoryRatesJson]);
  const costEnabled = defaultHourlyRate !== null || Object.keys(categoryRates).length > 0;

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
  // 曜日別バーの内訳ダイアログでも同じ絞り込み後のレコードを使うため、平均の算出と分けて保持する
  const weekdayFilteredRecords = useMemo(() => {
    const range = fiscalPeriodRange(weekdayPeriodType, weekdayFiscalYear);
    return range ? (records ?? []).filter((r) => isDateStrInRange(r.date, range)) : records ?? [];
  }, [records, weekdayPeriodType, weekdayFiscalYear]);
  const weekdayAverages = useMemo(
    () => computeWeekdayAverages(weekdayFilteredRecords),
    [weekdayFilteredRecords]
  );
  const weekdayChartData = useMemo(() => weekdayAverages.filter((w) => w.dayCount > 0), [weekdayAverages]);
  const [weekdayDetailDow, setWeekdayDetailDow] = useState<number | null>(null);
  const weekdayDetail = weekdayChartData.find((w) => w.dow === weekdayDetailDow) ?? null;
  const switchCost = useMemo(() => computeSwitchCostAnalysis(records ?? []), [records]);
  const tagRows = useMemo(() => computeTimeByTag(records ?? [], masterTasks ?? []), [records, masterTasks]);
  const totalTrendPoints = useMemo(
    () => computeTotalTimeTrend(records ?? [], totalTrendGranularity),
    [records, totalTrendGranularity]
  );
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

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.category, (map.get(r.category) ?? 0) + r.totalSeconds);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

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

      <CollapsiblePanel
        title="業務区分別の内訳"
        collapsed={!!collapsed.categoryDonut}
        onToggle={() => toggleSection("categoryDonut")}
      >
        <DonutChart data={categoryTotals} formatValue={formatHms} />
      </CollapsiblePanel>

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
                      <span className="w-5 shrink-0 text-center text-sm">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
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
                      <span className="w-5 shrink-0 text-center text-sm">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
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
        title="累計作業時間の推移"
        collapsed={!!collapsed.totalTrend}
        onToggle={() => toggleSection("totalTrend")}
      >
        <div className="mb-2 flex flex-wrap gap-2">
          {(Object.keys(TREND_GRANULARITY_LABELS) as TrendGranularity[]).map((g) => (
            <button
              key={g}
              className={totalTrendGranularity === g ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setTotalTrendGranularity(g)}
            >
              {TREND_GRANULARITY_LABELS[g]}
            </button>
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {([
            ["bar", "棒グラフ"],
            ["line", "折れ線グラフ"],
          ] as ["bar" | "line", string][]).map(([t, label]) => (
            <button
              key={t}
              className={totalTrendChartType === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setTotalTrendChartType(t)}
            >
              {label}
            </button>
          ))}
        </div>
        {totalTrendChartType === "bar" ? (
          <RankingBarChart
            data={totalTrendPoints.map((p) => ({ label: p.label, value: p.totalSeconds }))}
            formatValue={formatHms}
          />
        ) : (
          <LineChart
            points={totalTrendPoints.map((p) => ({ key: p.sortKey, label: p.label, value: p.totalSeconds }))}
            formatValue={formatHms}
          />
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="曜日別の平均稼働時間"
        collapsed={!!collapsed.weekday}
        onToggle={() => toggleSection("weekday")}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(Object.keys(WEEKDAY_PERIOD_LABELS) as FiscalPeriodType[]).map((t) => (
            <button
              key={t}
              className={weekdayPeriodType === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setWeekdayPeriodType(t)}
            >
              {WEEKDAY_PERIOD_LABELS[t]}
            </button>
          ))}
          {weekdayPeriodType !== "all" && (
            <select
              value={weekdayFiscalYear}
              onChange={(e) => setWeekdayFiscalYear(Number(e.target.value))}
              className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
            >
              {fiscalYearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}年度
                </option>
              ))}
            </select>
          )}
        </div>
        <RankingBarChart
          data={weekdayChartData.map((w) => ({ label: w.label, sublabel: `${w.dayCount}日分の平均`, value: w.avgSeconds }))}
          formatValue={formatHms}
          onBarClick={(i) => setWeekdayDetailDow(weekdayChartData[i].dow)}
        />
        {weekdayChartData.length > 0 && (
          <p className="mt-2 text-[10px] text-cream/40">棒をタップ/クリックすると内訳を表示します。</p>
        )}
        {weekdayAverages.every((w) => w.dayCount === 0) && (
          <p className="text-sm text-cream/50">データがありません。</p>
        )}
      </CollapsiblePanel>

      {weekdayDetail && (
        <WeekdayBreakdownDialog
          dow={weekdayDetail.dow}
          label={weekdayDetail.label}
          dayCount={weekdayDetail.dayCount}
          avgSeconds={weekdayDetail.avgSeconds}
          records={weekdayFilteredRecords}
          onClose={() => setWeekdayDetailDow(null)}
        />
      )}

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
            const rate = resolveCategoryRate(row.category, categoryRates, defaultHourlyRate);
            return (
              <button
                key={row.key}
                onClick={() => setTrendRow(row)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-cream/5"
              >
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
                  {costEnabled && rate !== null && (
                    <div>
                      <div className="text-cream/50 text-xs">概算金額</div>
                      {formatYen(computeCost(row.totalSeconds, rate))}
                    </div>
                  )}
                  {comparisonLabel && (
                    <div>
                      <div className="text-cream/50 text-xs">{comparisonLabel}</div>
                      <span className={delta === 0 ? "text-cream/50" : delta > 0 ? "text-alert" : "text-cream"}>
                        {delta === 0 ? "±0" : delta > 0 ? `▲${formatHms(delta)}` : `▼${formatHms(-delta)}`}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {rows.length === 0 && <p className="px-4 py-6 text-sm text-cream/50">この期間のデータはありません。</p>}
        </div>
      </CollapsiblePanel>
      <p className="text-xs text-cream/40">
        ※ 実績は基本的にそのまま集計されます。特定の記録を除外したい場合は「実績編集」から手動で操作してください。
      </p>

      {trendRow && (
        <TaskTrendDialog
          rowKey={trendRow.key}
          category={trendRow.category}
          name={trendRow.name}
          records={records ?? []}
          onClose={() => setTrendRow(null)}
        />
      )}
    </div>
  );
}
