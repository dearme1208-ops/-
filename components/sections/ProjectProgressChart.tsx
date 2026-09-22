"use client";

import { useMemo, useState } from "react";
import type { ProjectItem } from "@/lib/types";
import { computeProjectProgressTrend } from "@/lib/projectProgress";
import ComboChart from "@/components/charts/ComboChart";
import LineChart from "@/components/charts/LineChart";

const MONTH_OPTIONS = [6, 12, 24] as const;

// 案件の「新規追加」と「完了」を、月ごとに棒(追加)と線(完了)で重ねて見せる。
// どちらのペースが上回っているかが一目で分かり、さらに下に累積未完了件数の
// 推移(バーンアップ)も添えて「積み上がっているか」まで見られるようにしている
export default function ProjectProgressChart({ projects }: { projects: ProjectItem[] }) {
  const [months, setMonths] = useState<(typeof MONTH_OPTIONS)[number]>(12);

  const trend = useMemo(() => computeProjectProgressTrend(projects, months), [projects, months]);

  const totalAdded = trend.reduce((s, p) => s + p.added, 0);
  const totalCompleted = trend.reduce((s, p) => s + p.completed, 0);
  const first = trend[0];
  const last = trend[trend.length - 1];
  const delta = last && first ? last.openAtEnd - first.openAtEnd : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">進捗グラフ（新規追加 と 完了）</h3>
        <div className="flex items-center gap-1">
          {MONTH_OPTIONS.map((m) => (
            <button
              key={m}
              className={months === m ? "btn-pill px-2 py-1 text-xs" : "btn-pill-outline px-2 py-1 text-xs"}
              onClick={() => setMonths(m)}
            >
              直近{m}ヶ月
            </button>
          ))}
        </div>
      </div>

      {trend.length === 0 ? (
        <p className="text-sm text-cream/50">案件のデータがまだありません。</p>
      ) : (
        <>
          <p className="text-sm text-cream/80">
            直近{months}ヶ月で新規追加<span className="mx-1 font-bold">{totalAdded}件</span>・完了
            <span className="mx-1 font-bold">{totalCompleted}件</span>。
            未完了の残りは{first?.label}時点の<span className="mx-1 font-bold">{first?.openAtEnd ?? 0}件</span>
            から、直近{last?.label}時点で
            <span className={`mx-1 font-bold ${delta > 0 ? "text-alert" : "text-cream"}`}>{last?.openAtEnd ?? 0}件</span>
            {delta === 0 ? "（変わっていません）" : delta > 0 ? `（+${delta}件、積み上がっています）` : `（${delta}件、減っています）`}
            。
          </p>

          <div className="panel p-3">
            <p className="mb-2 text-xs font-bold text-cream/60">月別: 新規追加(棒) と 完了(線)</p>
            <ComboChart
              points={trend.map((p) => ({ key: p.key, label: p.label, barValue: p.added, lineValue: p.completed }))}
              barLabel="新規追加"
              lineLabel="完了"
              formatBar={(v) => `${Math.round(v)}件`}
              formatLine={(v) => `${Math.round(v)}件`}
            />
          </div>

          <div className="panel p-3">
            <p className="mb-2 text-xs font-bold text-cream/60">月末時点の未完了件数（バーンアップ）</p>
            <LineChart
              points={trend.map((p) => ({ key: p.key, label: p.label, value: p.openAtEnd }))}
              formatValue={(v) => `${Math.round(v)}件`}
            />
          </div>
        </>
      )}
    </div>
  );
}
