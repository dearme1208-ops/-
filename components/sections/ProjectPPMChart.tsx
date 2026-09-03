"use client";

import { useMemo, useState } from "react";
import type { ProjectItem } from "@/lib/types";
import { computeProjectProgress } from "@/lib/projectStage";
import { formatHms } from "@/lib/time";
import { computeCost } from "@/lib/cost";
import { daysBetweenDateStrs } from "@/lib/time";

// PPM(プロダクトポートフォリオマネジメント)の考え方を、案件の実績データで再現した
// 散布図。本家は「市場成長率×市場シェア」の2軸だが、このアプリには市場データが
// ないため、代わりに実績として持っている指標(投下時間・進捗率・残り日数・概算コスト・
// 段階数)から軸を選べるようにしている。花形/金のなる木/問題児/負け犬という
// 4象限の呼び名はあくまで比喩として添えているだけで、厳密な市場分析ではない
export type PPMMetricKey = "hours" | "progress" | "daysLeft" | "cost" | "stageCount";

export const PPM_METRIC_LABELS: Record<PPMMetricKey, string> = {
  hours: "投下時間(工数)",
  progress: "進捗率",
  daysLeft: "納期までの残り日数",
  cost: "概算コスト",
  stageCount: "段階数",
};

export interface PPMProjectInput {
  project: ProjectItem;
  totalSeconds: number;
  hourlyRate: number | null;
  today: string;
}

interface PPMPoint {
  project: ProjectItem;
  hours: number;
  progress: number;
  daysLeft: number;
  cost: number;
  stageCount: number;
}

function metricValue(p: PPMPoint, key: PPMMetricKey): number {
  if (key === "hours") return p.hours;
  if (key === "progress") return p.progress;
  if (key === "daysLeft") return p.daysLeft;
  if (key === "cost") return p.cost;
  return p.stageCount;
}

const W = 640;
const H = 440;
const PAD_L = 56;
const PAD_R = 20;
const PAD_T = 20;
const PAD_B = 44;

export default function ProjectPPMChart({ items }: { items: PPMProjectInput[] }) {
  const [xKey, setXKey] = useState<PPMMetricKey>("progress");
  const [yKey, setYKey] = useState<PPMMetricKey>("hours");

  const points: PPMPoint[] = useMemo(
    () =>
      items.map(({ project, totalSeconds, hourlyRate, today }) => ({
        project,
        hours: totalSeconds / 3600,
        progress: (computeProjectProgress(project.stages) ?? 0) * 100,
        daysLeft: daysBetweenDateStrs(today, project.dueDate),
        cost: hourlyRate !== null ? computeCost(totalSeconds, hourlyRate) : 0,
        stageCount: project.stages?.length ?? 0,
      })),
    [items]
  );

  if (points.length === 0) {
    return <p className="panel p-4 text-center text-sm text-cream/50">PPM分析を表示できる案件がありません。</p>;
  }

  const xValues = points.map((p) => metricValue(p, xKey));
  const yValues = points.map((p) => metricValue(p, yKey));
  const xMin = Math.min(0, ...xValues);
  const xMax = Math.max(xMin + 1, ...xValues);
  const yMin = Math.min(0, ...yValues);
  const yMax = Math.max(yMin + 1, ...yValues);
  const xMid = (xMin + xMax) / 2;
  const yMid = (yMin + yMax) / 2;

  function toSvgX(v: number) {
    return PAD_L + ((v - xMin) / (xMax - xMin)) * (W - PAD_L - PAD_R);
  }
  function toSvgY(v: number) {
    return H - PAD_B - ((v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);
  }

  const midX = toSvgX(xMid);
  const midY = toSvgY(yMid);

  return (
    <div className="panel space-y-3 p-4">
      <p className="text-xs text-cream/50">
        本来のPPMは「市場成長率×市場シェア」の2軸ですが、市場データを持たないこのアプリでは、案件の実績データから選べる軸に置き換えています。4象限の名前はあくまで比喩です。
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          横軸
          <select
            value={xKey}
            onChange={(e) => setXKey(e.target.value as PPMMetricKey)}
            className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-cream"
          >
            {(Object.keys(PPM_METRIC_LABELS) as PPMMetricKey[]).map((k) => (
              <option key={k} value={k}>
                {PPM_METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          縦軸
          <select
            value={yKey}
            onChange={(e) => setYKey(e.target.value as PPMMetricKey)}
            className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-cream"
          >
            {(Object.keys(PPM_METRIC_LABELS) as PPMMetricKey[]).map((k) => (
              <option key={k} value={k}>
                {PPM_METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
          <rect x={PAD_L} y={PAD_T} width={midX - PAD_L} height={midY - PAD_T} fill="rgb(var(--accent-rgb) / 0.05)" />
          <rect x={midX} y={PAD_T} width={W - PAD_R - midX} height={midY - PAD_T} fill="rgb(var(--accent-rgb) / 0.1)" />
          <rect x={PAD_L} y={midY} width={midX - PAD_L} height={H - PAD_B - midY} fill="rgb(var(--cream-rgb) / 0.02)" />
          <rect x={midX} y={midY} width={W - PAD_R - midX} height={H - PAD_B - midY} fill="rgb(var(--accent-rgb) / 0.03)" />

          <text x={midX + (W - PAD_R - midX) / 2} y={PAD_T + 16} textAnchor="middle" className="fill-cream/40 text-[10px]">
            花形
          </text>
          <text x={PAD_L + (midX - PAD_L) / 2} y={PAD_T + 16} textAnchor="middle" className="fill-cream/40 text-[10px]">
            問題児
          </text>
          <text x={midX + (W - PAD_R - midX) / 2} y={H - PAD_B - 6} textAnchor="middle" className="fill-cream/40 text-[10px]">
            金のなる木
          </text>
          <text x={PAD_L + (midX - PAD_L) / 2} y={H - PAD_B - 6} textAnchor="middle" className="fill-cream/40 text-[10px]">
            負け犬
          </text>

          <line x1={midX} y1={PAD_T} x2={midX} y2={H - PAD_B} stroke="rgb(var(--cream-rgb) / 0.15)" strokeDasharray="4 4" />
          <line x1={PAD_L} y1={midY} x2={W - PAD_R} y2={midY} stroke="rgb(var(--cream-rgb) / 0.15)" strokeDasharray="4 4" />
          <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="rgb(var(--cream-rgb) / 0.3)" />
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="rgb(var(--cream-rgb) / 0.3)" />

          <text x={W - PAD_R} y={H - PAD_B + 20} textAnchor="end" className="fill-cream/60 text-[11px]">
            {PPM_METRIC_LABELS[xKey]} →
          </text>
          <text x={PAD_L} y={PAD_T - 6} textAnchor="start" className="fill-cream/60 text-[11px]">
            ↑ {PPM_METRIC_LABELS[yKey]}
          </text>

          {points.map((p) => {
            const cx = toSvgX(metricValue(p, xKey));
            const cy = toSvgY(metricValue(p, yKey));
            return (
              <g key={p.project.id}>
                <circle cx={cx} cy={cy} r={7} className="fill-alert" opacity={0.85} />
                <text x={cx + 10} y={cy + 4} className="fill-cream text-[10px]">
                  {p.project.title}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-cream/50 sm:grid-cols-4">
        {points.map((p) => (
          <div key={p.project.id}>
            <span className="text-cream/80">{p.project.title}</span>: {PPM_METRIC_LABELS[xKey]}{" "}
            {xKey === "progress" ? `${metricValue(p, xKey).toFixed(0)}%` : xKey === "hours" ? formatHms(metricValue(p, xKey) * 3600) : metricValue(p, xKey).toFixed(0)}
            {" / "}
            {PPM_METRIC_LABELS[yKey]}{" "}
            {yKey === "progress" ? `${metricValue(p, yKey).toFixed(0)}%` : yKey === "hours" ? formatHms(metricValue(p, yKey) * 3600) : metricValue(p, yKey).toFixed(0)}
          </div>
        ))}
      </div>
    </div>
  );
}
