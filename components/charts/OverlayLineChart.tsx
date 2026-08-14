"use client";

export interface OverlayLineChartPoint {
  key: string;
  label: string;
  currentSeconds: number;
  previousSeconds: number;
}

const PLOT_H = 140;

// 今期(実線)と前期(破線)を同じ軸に重ねて表示する折れ線グラフ。週報・月報の
// 「先週/先月との重ね合わせ比較」用。色相は増やさず、線種(実線/破線)で区別する
export default function OverlayLineChart({
  points,
  formatValue,
  currentLabel,
  previousLabel,
}: {
  points: OverlayLineChartPoint[];
  formatValue: (v: number) => string;
  currentLabel: string;
  previousLabel: string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-cream/50">データがありません。</p>;
  }

  const max = Math.max(1, ...points.map((p) => Math.max(p.currentSeconds, p.previousSeconds)));

  function xPct(i: number): number {
    return points.length > 1 ? (i / (points.length - 1)) * 100 : 50;
  }
  function yPx(v: number): number {
    return PLOT_H - (v / max) * PLOT_H;
  }

  const currentPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xPct(i)} ${yPx(p.currentSeconds)}`).join(" ");
  const previousPath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xPct(i)} ${yPx(p.previousSeconds)}`).join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px] text-cream/60">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-cream" />
          {currentLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t border-dashed border-cream/50" />
          {previousLabel}
        </span>
      </div>
      <div className="relative" style={{ height: PLOT_H }}>
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <path d={previousPath} fill="none" className="stroke-cream/40" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          <path d={currentPath} fill="none" className="stroke-cream" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <div
            key={p.key}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream"
            style={{ left: `${xPct(i)}%`, top: yPx(p.currentSeconds) }}
            title={`${p.label}: ${formatValue(p.currentSeconds)}（前期 ${formatValue(p.previousSeconds)}）`}
          />
        ))}
        <div className="absolute -top-4 left-0 text-[10px] text-cream/40">{formatValue(max)}</div>
        <div className="absolute -bottom-1 left-0 text-[10px] text-cream/40">0</div>
      </div>
      <div className="mt-5 flex justify-between text-[10px] text-cream/50">
        {points.map((p) => (
          <div key={p.key} className="text-center">
            {p.label}
          </div>
        ))}
      </div>
    </div>
  );
}
