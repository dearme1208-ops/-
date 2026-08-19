"use client";

import type { ReactNode } from "react";

export interface StackedComboSegment {
  value: number;
  className: string;
}

export interface StackedComboPoint {
  key: string;
  label: string;
  segments: StackedComboSegment[];
  lineValue: number;
}

const PLOT_H = 180;

// 積み上げ棒グラフ(例: 所定時間内+残業時間)と折れ線グラフ(例: 平均作業時間)を
// 1つの図に重ねて表示する。月ごとのクリックや、棒の上に任意のマーカー(星など)を
// 差し込めるようになっている
export default function StackedComboChart({
  points,
  formatBar,
  formatLine,
  barLegendItems,
  lineLabel,
  onBarClick,
  selectedKey,
  renderAboveBar,
}: {
  points: StackedComboPoint[];
  formatBar: (v: number) => string;
  formatLine: (v: number) => string;
  barLegendItems: { label: string; className: string }[];
  lineLabel: string;
  onBarClick?: (key: string) => void;
  selectedKey?: string | null;
  renderAboveBar?: (point: StackedComboPoint) => ReactNode;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-cream/50">データがありません。</p>;
  }

  const totalOf = (p: StackedComboPoint) => p.segments.reduce((s, seg) => s + seg.value, 0);
  const maxBar = Math.max(1, ...points.map(totalOf));
  const maxLine = Math.max(1, ...points.map((p) => p.lineValue));
  const n = points.length;
  const slotWidth = 100 / n;
  const barWidth = slotWidth * 0.6;

  function xCenterPct(i: number): number {
    return (i + 0.5) * slotWidth;
  }
  function lineYPx(v: number): number {
    return PLOT_H - (v / maxLine) * PLOT_H;
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xCenterPct(i)} ${lineYPx(p.lineValue)}`).join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[10px] text-cream/50">
        {barLegendItems.map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm ${item.className}`} />
            {item.label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-alert" />
          {lineLabel}
        </span>
      </div>
      <div className="relative" style={{ height: PLOT_H + 24, marginTop: renderAboveBar ? 20 : 0 }}>
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          style={{ height: PLOT_H }}
        >
          {points.map((p) => {
            const x = xCenterPct(points.indexOf(p)) - barWidth / 2;
            let cursorY = PLOT_H;
            return (
              <g key={p.key}>
                {p.segments.map((seg, si) => {
                  const h = (seg.value / maxBar) * PLOT_H;
                  cursorY -= h;
                  return (
                    <rect
                      key={si}
                      x={x}
                      y={cursorY}
                      width={barWidth}
                      height={h}
                      className={`${seg.className} stroke-ink`}
                      strokeWidth={0.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </g>
            );
          })}
          <path d={pathD} fill="none" className="stroke-alert" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <div
            key={`dot-${p.key}`}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-alert"
            style={{ left: `${xCenterPct(i)}%`, top: lineYPx(p.lineValue) }}
            title={`${p.label}\n${lineLabel}: ${formatLine(p.lineValue)}`}
          />
        ))}
        {onBarClick &&
          points.map((p, i) => (
            <button
              key={`click-${p.key}`}
              className={`absolute bottom-0 -translate-x-1/2 rounded-t transition-colors ${
                selectedKey === p.key ? "bg-cream/10 ring-1 ring-cream/60" : "hover:bg-cream/5"
              }`}
              style={{ left: `${xCenterPct(i)}%`, width: `${barWidth}%`, height: PLOT_H }}
              onClick={() => onBarClick(p.key)}
              aria-label={`${p.label}の詳細を見る`}
              title={`${p.label}\n合計: ${formatBar(totalOf(p))}\n${lineLabel}: ${formatLine(p.lineValue)}`}
            />
          ))}
        {renderAboveBar &&
          points.map((p, i) => (
            <div key={`marker-${p.key}`} className="absolute -translate-x-1/2" style={{ left: `${xCenterPct(i)}%`, top: -20 }}>
              {renderAboveBar(p)}
            </div>
          ))}
      </div>
      <div className="mt-2 flex text-[10px] text-cream/50">
        {points.map((p) => (
          <div key={p.key} className="text-center" style={{ width: `${slotWidth}%` }}>
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
