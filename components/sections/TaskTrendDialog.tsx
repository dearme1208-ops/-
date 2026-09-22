"use client";

import { useMemo, useState } from "react";
import { computeTaskTrend, type TrendGranularity } from "@/lib/aggregate";
import { computeMethodBreakdown } from "@/lib/method";
import { formatHms } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import RankingBarChart from "@/components/charts/RankingBarChart";
import LineChart from "@/components/charts/LineChart";
import ComboChart from "@/components/charts/ComboChart";

const GRANULARITY_LABELS: Record<TrendGranularity, string> = {
  year: "年度ごと",
  half: "半期ごと",
  month: "1ヶ月ごと",
};

type ChartType = "bar" | "line" | "combo";
const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: "棒グラフ",
  line: "折れ線グラフ",
  combo: "合計(棒)+平均(線)",
};

// 直前の期間と比べた増減率。分母が0(直前期間にデータが無い)の場合は算出不能としてnullを返す
function periodDelta(curr: number, prev: number): { pct: number; up: boolean } | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return { pct: ((curr - prev) / prev) * 100, up: curr > prev };
}

// 業務改善の観点でまず見たいのは「合計時間・件数・平均時間(効率)が前期と比べてどう
// 動いたか」という一目でわかるサマリー。特に平均時間(1件あたりの所要時間)は、件数の
// 増減とは切り離した「効率が上がっているか下がっているか」を示す指標なので、
// 良化/悪化の色分けをして目立たせる。合計時間・件数は増減どちらが良いとも限らない
// (仕事が増えただけの場合もある)ため、方向だけを中立色で示す
function SummaryTile({
  label,
  currentLabel,
  currentValue,
  delta,
  sense,
}: {
  label: string;
  currentLabel: string;
  currentValue: string;
  delta: { pct: number; up: boolean } | null;
  sense: "neutral" | "lowerIsBetter";
}) {
  const deltaColor =
    delta === null
      ? "text-cream/40"
      : sense === "neutral"
        ? "text-cream/70"
        : delta.up
          ? "text-alert"
          : "text-emerald-400";
  return (
    <div className="panel min-w-0 flex-1 p-3">
      <p className="mb-1 text-[10px] text-cream/50">{label}</p>
      <p className="truncate text-sm font-bold text-cream">{currentValue}</p>
      <p className="text-[10px] text-cream/40">{currentLabel}</p>
      <p className={`mt-1 text-xs font-bold tabular-nums ${deltaColor}`}>
        {delta === null
          ? "前期データなし"
          : `${delta.up ? "▲" : "▼"} 前期比 ${delta.pct >= 0 ? "+" : ""}${delta.pct.toFixed(0)}%${
              sense === "lowerIsBetter" ? (delta.up ? "（悪化）" : "（改善）") : ""
            }`}
      </p>
    </div>
  );
}

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
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  const methodStats = useMemo(() => computeMethodBreakdown(records, rowKey), [records, rowKey]);
  // 手段が一度も入力されていない(全件が未設定1グループのみ)場合は比較にならないため出し分ける
  const showMethodBreakdown = methodStats.length > 1 || (methodStats.length === 1 && methodStats[0].method !== "（未設定）");
  const firstMethodStat = methodStats.find((m) => m.method !== "（未設定）");

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
        {(Object.keys(CHART_TYPE_LABELS) as ChartType[]).map((t) => (
          <button
            key={t}
            className={chartType === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setChartType(t)}
          >
            {CHART_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {latest && (
        <div className="mb-4 flex flex-wrap gap-2">
          <SummaryTile
            label="合計時間"
            currentLabel={latest.label}
            currentValue={formatHms(latest.totalSeconds)}
            delta={previous ? periodDelta(latest.totalSeconds, previous.totalSeconds) : null}
            sense="neutral"
          />
          <SummaryTile
            label="平均時間（効率）"
            currentLabel={latest.label}
            currentValue={formatHms(latest.totalSeconds / latest.count)}
            delta={previous && previous.count > 0 ? periodDelta(latest.totalSeconds / latest.count, previous.totalSeconds / previous.count) : null}
            sense="lowerIsBetter"
          />
          <SummaryTile
            label="件数"
            currentLabel={latest.label}
            currentValue={`${latest.count}件`}
            delta={previous ? periodDelta(latest.count, previous.count) : null}
            sense="neutral"
          />
        </div>
      )}

      {showMethodBreakdown && (
        <div className="mb-4">
          <h4 className="mb-2 text-xs font-bold text-cream/70">🛠 手段別の比較</h4>
          <p className="mb-2 text-[11px] text-cream/40">
            「作業内容を編集」の手段欄・実績編集タブで入力した内容をもとに、やり方を変えた前後の所要時間を比べます（初めて使った日の古い順）。
          </p>
          <div className="mb-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-xs">
              <thead>
                <tr className="text-cream/50">
                  <th className="pb-1 pr-3 font-normal">手段</th>
                  <th className="pb-1 pr-3 text-right font-normal">件数</th>
                  <th className="pb-1 pr-3 text-right font-normal">合計時間</th>
                  <th className="pb-1 pr-3 text-right font-normal">平均時間</th>
                  <th className="pb-1 text-right font-normal">対最初の手段</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {methodStats.map((m) => {
                  const delta =
                    firstMethodStat && firstMethodStat.method !== m.method
                      ? ((m.avgSeconds - firstMethodStat.avgSeconds) / firstMethodStat.avgSeconds) * 100
                      : null;
                  return (
                    <tr key={m.method} className="border-t border-cream/10">
                      <td className="py-1.5 pr-3 font-bold text-cream">
                        {m.method}
                        <div className="font-normal text-cream/40">
                          {m.firstDate === m.lastDate ? m.firstDate : `${m.firstDate}〜${m.lastDate}`}
                        </div>
                      </td>
                      <td className="py-1.5 pr-3 text-right text-cream/80">{m.count}件</td>
                      <td className="py-1.5 pr-3 text-right text-cream/80">{formatHms(m.totalSeconds)}</td>
                      <td className="py-1.5 pr-3 text-right text-cream/80">{formatHms(m.avgSeconds)}</td>
                      <td
                        className={`py-1.5 text-right font-bold ${
                          delta === null ? "text-cream/30" : delta < 0 ? "text-emerald-400" : delta > 0 ? "text-alert" : "text-cream/50"
                        }`}
                      >
                        {delta === null ? "―" : `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <RankingBarChart
            data={methodStats.map((m) => ({ key: m.method, label: m.method, value: m.avgSeconds }))}
            formatValue={formatHms}
          />
        </div>
      )}

      {points.length === 0 ? (
        <p className="text-sm text-cream/50">データがありません。</p>
      ) : chartType === "combo" ? (
        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">合計時間（棒）× 平均時間（線）</h4>
            <ComboChart
              points={points.map((p) => ({
                key: p.sortKey,
                label: p.label,
                barValue: p.totalSeconds,
                lineValue: p.totalSeconds / p.count,
              }))}
              barLabel="合計時間"
              lineLabel="平均時間"
              formatBar={formatHms}
              formatLine={formatHms}
            />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold text-cream/70">作業件数</h4>
            <RankingBarChart
              data={points.map((p) => ({ key: p.sortKey, label: p.label, value: p.count }))}
              formatValue={(v) => `${v}件`}
            />
          </div>
        </div>
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
