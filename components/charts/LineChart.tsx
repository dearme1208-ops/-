"use client";

export interface LineChartPoint {
  key: string;
  label: string;
  value: number;
}

const PLOT_H = 140;

// 0を基準とした単純な折れ線グラフ（DiffLineChartは±0中心のdiff専用のため、
// 累計時間・件数など正の値の推移を見せる用にこちらを使う）
export default function LineChart({
  points,
  formatValue,
}: {
  points: LineChartPoint[];
  formatValue: (v: number) => string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-cream/50">データがありません。</p>;
  }

  const max = Math.max(1, ...points.map((p) => p.value));
  const min = 0;
  const range = max - min || 1;

  function xPct(i: number): number {
    return points.length > 1 ? (i / (points.length - 1)) * 100 : 50;
  }
  function yPx(v: number): number {
    return PLOT_H - ((v - min) / range) * PLOT_H;
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xPct(i)} ${yPx(p.value)}`).join(" ");
  const areaD = `${pathD} L 100 ${PLOT_H} L 0 ${PLOT_H} Z`;

  return (
    <div>
      <div className="relative" style={{ height: PLOT_H }}>
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <path d={areaD} className="fill-cream/5" />
          <path d={pathD} fill="none" className="stroke-cream" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
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
        <div className="absolute -bottom-1 left-0 text-[10px] text-cream/40">{formatValue(min)}</div>
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
