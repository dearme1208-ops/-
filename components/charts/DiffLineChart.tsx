"use client";

export interface LineChartPoint {
  key: string;
  label: string;
  value: number;
}

const PLOT_H = 140;

export default function DiffLineChart({
  points,
  formatValue,
}: {
  points: LineChartPoint[];
  formatValue: (v: number) => string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-cream/50">手入力残業が登録されている月がありません。</p>;
  }

  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const min = -maxAbs;
  const max = maxAbs;
  const range = max - min;

  function xPct(i: number): number {
    return points.length > 1 ? (i / (points.length - 1)) * 100 : 50;
  }
  function yPx(v: number): number {
    return PLOT_H - ((v - min) / range) * PLOT_H;
  }

  const zeroY = yPx(0);
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xPct(i)} ${yPx(p.value)}`).join(" ");

  return (
    <div>
      <div className="relative" style={{ height: PLOT_H }}>
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <line x1="0" y1={zeroY} x2="100" y2={zeroY} className="stroke-cream/20" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path
            d={pathD}
            fill="none"
            className={maxAbs > 0 ? "stroke-alert" : "stroke-cream"}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {points.map((p, i) => (
          <div
            key={p.key}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream"
            style={{ left: `${xPct(i)}%`, top: yPx(p.value) }}
            title={`${p.label}: ${formatValue(p.value)}`}
          />
        ))}
        <div className="absolute -top-4 left-0 text-[10px] text-cream/40">{formatValue(max)}</div>
        <div className="absolute -bottom-4 left-0 text-[10px] text-cream/40">{formatValue(min)}</div>
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
