"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { currentFiscalYear } from "@/lib/period";
import {
  computeMonthlyLaborStats,
  computeMonthTaskDeviationRanking,
  pickVolatileMonths,
} from "@/lib/yearlyChart";
import { formatHms } from "@/lib/time";
import { computeBadgeProgress } from "@/lib/badges";
import StackedComboChart, { type StackedComboPoint } from "@/components/charts/StackedComboChart";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function YearlyChartSection() {
  const [fiscalYear, setFiscalYear] = useState(() => currentFiscalYear());
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [commentingMonth, setCommentingMonth] = useState<string | null>(null);
  const [standardHoursStr] = useSetting("overtime.standardDailyHours", "8");
  const standardDailyHours = Math.max(0, Number(standardHoursStr) || 0);

  const records = useLiveQuery(() => db.records.toArray(), []);
  const settings = useLiveQuery(() => db.settings.toArray(), []);

  const settingsMap = useMemo(() => new Map((settings ?? []).map((s) => [s.key, s.value])), [settings]);

  const workDaysByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, value] of settingsMap) {
      if (key.startsWith("overtime.workdays.")) {
        const v = Number(value);
        if (!Number.isNaN(v)) map.set(key.slice("overtime.workdays.".length), v);
      }
    }
    return map;
  }, [settingsMap]);

  const stats = useMemo(
    () => computeMonthlyLaborStats(records ?? [], fiscalYear, standardDailyHours, workDaysByMonth),
    [records, fiscalYear, standardDailyHours, workDaysByMonth]
  );
  const volatileMonths = useMemo(() => pickVolatileMonths(stats, 3), [stats]);

  const deviationRanking = useMemo(() => {
    if (!selectedMonth || !records) return null;
    return computeMonthTaskDeviationRanking(records, selectedMonth, fiscalYear);
  }, [records, selectedMonth, fiscalYear]);

  const fiscalYearOptions = Array.from({ length: 8 }, (_, i) => currentFiscalYear() - 5 + i);

  async function saveMonthComment(month: string, text: string) {
    const key = `yearlyChart.monthComment.${month}`;
    if (text.trim() === "") {
      await db.settings.delete(key);
      return;
    }
    await db.settings.put({ key, value: text });
  }

  async function saveTaskComment(month: string, taskKey: string, text: string) {
    const key = `yearlyChart.taskComment.${month}::${taskKey}`;
    if (text.trim() === "") {
      await db.settings.delete(key);
      return;
    }
    await db.settings.put({ key, value: text });
  }

  const points: StackedComboPoint[] = stats.map((s) => ({
    key: s.month,
    label: s.label,
    segments: [
      { value: s.normalSeconds, className: "fill-cream/30" },
      { value: s.overtimeSeconds, className: "fill-alert/70" },
    ],
    lineValue: s.avgTaskSeconds,
  }));

  const totalYearSeconds = stats.reduce((s, m) => s + m.totalSeconds, 0);
  const totalOvertimeSeconds = stats.reduce((s, m) => s + m.overtimeSeconds, 0);
  const bestMonth = useMemo(
    () => stats.reduce((best: (typeof stats)[number] | null, m) => (!best || m.totalSeconds > best.totalSeconds ? m : best), null),
    [stats]
  );
  const badgeProgress = useMemo(() => computeBadgeProgress(records ?? []), [records]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold">年表</h2>
        <select
          value={fiscalYear}
          onChange={(e) => {
            setFiscalYear(Number(e.target.value));
            setSelectedMonth(null);
          }}
          className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-sm text-cream"
        >
          {fiscalYearOptions.map((y) => (
            <option key={y} value={y}>
              {y}年度
            </option>
          ))}
        </select>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">📅 年間サマリー</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="panel bg-ink/40 p-3">
            <div className="text-xs text-cream/50">年度合計</div>
            <div className="font-display text-lg font-bold tabular-nums text-cream">{formatHms(totalYearSeconds)}</div>
          </div>
          {bestMonth && bestMonth.totalSeconds > 0 && (
            <div className="panel bg-ink/40 p-3">
              <div className="text-xs text-cream/50">ベスト月</div>
              <div className="font-display text-lg font-bold tabular-nums text-cream">{bestMonth.label}</div>
              <div className="text-[10px] text-cream/40">{formatHms(bestMonth.totalSeconds)}</div>
            </div>
          )}
          {badgeProgress.map((b) => (
            <div key={b.category} className="panel bg-ink/40 p-3">
              <div className="text-xs text-cream/50">
                {b.icon} {b.label}
              </div>
              <div className="font-display text-lg font-bold tabular-nums text-cream">
                {b.currentValue}
                {b.unit}
              </div>
              <div className="text-[10px] text-cream/40">
                {b.achievedThresholds.length > 0 && `達成: ${b.achievedThresholds.join("/")}${b.unit} `}
                {b.nextThreshold !== null ? `次の目標: ${b.nextThreshold}${b.unit}` : "全マイルストーン達成"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-sm font-bold text-cream/80">
            月別 総作業時間（所定内＋残業）× 平均作業時間
          </h3>
          <div className="text-right text-xs text-cream/60">
            <div>年度合計 {formatHms(totalYearSeconds)}</div>
            <div>うち残業 {formatHms(totalOvertimeSeconds)}</div>
          </div>
        </div>
        <StackedComboChart
          points={points}
          formatBar={formatHms}
          formatLine={formatHms}
          barLegendItems={[
            { label: "所定時間内", className: "fill-cream/30" },
            { label: "残業時間", className: "fill-alert/70" },
          ]}
          lineLabel="平均作業時間"
          onBarClick={(month) => setSelectedMonth(month === selectedMonth ? null : month)}
          selectedKey={selectedMonth}
          renderAboveBar={(p) => {
            const hasComment = !!settingsMap.get(`yearlyChart.monthComment.${p.key}`);
            const isVolatile = volatileMonths.has(p.key);
            if (!isVolatile) return null;
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCommentingMonth(p.key === commentingMonth ? null : p.key);
                }}
                title={isVolatile ? "変動の大きい月です。クリックしてコメントを書けます" : "クリックしてコメントを書けます"}
                className={`text-base leading-none ${hasComment ? "text-alert" : "text-cream/30"}`}
              >
                {hasComment ? "★" : "☆"}
              </button>
            );
          }}
        />
        <p className="mt-2 text-xs text-cream/40">
          棒グラフをクリックするとその月の作業別ランキングを、★（変動の大きい月）をクリックすると月次コメントを書けます。労働日数・所定労働時間は残業分析タブで設定します。
        </p>
      </div>

      {commentingMonth && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">
            {commentingMonth.slice(5)}月のコメント（変動の大きい月）
          </h3>
          <textarea
            defaultValue={settingsMap.get(`yearlyChart.monthComment.${commentingMonth}`) ?? ""}
            onBlur={(e) => saveMonthComment(commentingMonth, e.target.value)}
            placeholder="この月に何があったか、メモを残せます"
            rows={3}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
        </div>
      )}

      {selectedMonth && deviationRanking && (
        <div className="panel space-y-3 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">
            {selectedMonth.slice(5)}月: 他の月と比べた平均作業時間の変化
          </h3>
          <p className="text-xs text-cream/40">
            同年度内の他の月における平均時間と比べています（両方に2件以上の実績がある作業のみ対象）。
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-bold text-cream/70">⚠️ この月は長くなった作業</h4>
              {deviationRanking.increased.length === 0 ? (
                <p className="text-sm text-cream/50">該当する作業はありません。</p>
              ) : (
                <div className="space-y-2">
                  {deviationRanking.increased.slice(0, 10).map((row, idx) => (
                    <div key={row.key} className="rounded-lg bg-ink/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-center text-sm">{idx < 3 ? MEDALS[idx] : idx + 1}</span>
                          <div>
                            <div className="text-xs text-cream/50">{row.category}</div>
                            <div className="text-sm text-cream">{row.name}</div>
                          </div>
                        </div>
                        <div className="text-right text-xs tabular-nums">
                          <div className="font-display text-base font-bold text-alert">+{formatHms(row.deltaSeconds)}</div>
                          <div className="text-cream/40">
                            {formatHms(row.otherAvgSeconds)} → {formatHms(row.monthAvgSeconds)}
                          </div>
                        </div>
                      </div>
                      <textarea
                        defaultValue={settingsMap.get(`yearlyChart.taskComment.${selectedMonth}::${row.key}`) ?? ""}
                        onBlur={(e) => saveTaskComment(selectedMonth, row.key, e.target.value)}
                        placeholder="コメント（任意）"
                        rows={1}
                        className="mt-2 w-full rounded-md border border-cream/10 bg-transparent px-2 py-1 text-xs text-cream/80"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h4 className="mb-2 text-xs font-bold text-cream/70">✅ この月は短くなった作業</h4>
              {deviationRanking.decreased.length === 0 ? (
                <p className="text-sm text-cream/50">該当する作業はありません。</p>
              ) : (
                <div className="space-y-2">
                  {deviationRanking.decreased.slice(0, 10).map((row, idx) => (
                    <div key={row.key} className="rounded-lg bg-ink/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
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
                            {formatHms(row.otherAvgSeconds)} → {formatHms(row.monthAvgSeconds)}
                          </div>
                        </div>
                      </div>
                      <textarea
                        defaultValue={settingsMap.get(`yearlyChart.taskComment.${selectedMonth}::${row.key}`) ?? ""}
                        onBlur={(e) => saveTaskComment(selectedMonth, row.key, e.target.value)}
                        placeholder="コメント（任意）"
                        rows={1}
                        className="mt-2 w-full rounded-md border border-cream/10 bg-transparent px-2 py-1 text-xs text-cream/80"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {stats.every((s) => s.totalSeconds === 0) && (
        <p className="text-sm text-cream/50">{fiscalYear}年度の実績データがありません。</p>
      )}
    </div>
  );
}
