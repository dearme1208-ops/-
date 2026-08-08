"use client";

export interface ComboChartPoint {
  key: string;
  label: string;
  barValue: number;
  lineValue: number;
}

const PLOT_H = 160;

// 棒グラフ(合計時間など)と折れ線グラフ(平均時間など)を1つの図に重ねて表示する。
// 2つの系列は値の大きさが大きく異なることが多いため、それぞれ自分自身の最大値を
// 基準に0〜PLOT_Hへ独立してスケーリングする（軸は左右で別スケール）
export default function ComboChart({
  points,
  barLabel,
  lineLabel,
  formatBar,
  formatLine,
}: {
  points: ComboChartPoint[];
  barLabel: string;
  lineLabel: string;
  formatBar: (v: number) => string;
  formatLine: (v: number) => string;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-cream/50">データがありません。</p>;
  }

  const maxBar = Math.max(1, ...points.map((p) => p.barValue));
  const maxLine = Math.max(1, ...points.map((p) => p.lineValue));
  const n = points.length;
  const slotWidth = 100 / n;
  const barWidth = slotWidth * 0.5;

  function xCenterPct(i: number): number {
    return (i + 0.5) * slotWidth;
  }
  function barTopPx(v: number): number {
    return PLOT_H - (v / maxBar) * PLOT_H;
  }
  function lineYPx(v: number): number {
    return PLOT_H - (v / maxLine) * PLOT_H;
  }

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xCenterPct(i)} ${lineYPx(p.lineValue)}`).join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-[10px] text-cream/50">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-cream/30" />
          {barLabel}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-alert" />
          {lineLabel}
        </span>
      </div>
      <div className="relative" style={{ height: PLOT_H }}>
        <svg
          viewBox={`0 0 100 ${PLOT_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          {points.map((p, i) => {
            const x = xCenterPct(i) - barWidth / 2;
            const h = (p.barValue / maxBar) * PLOT_H;
            return <rect key={p.key} x={x} y={barTopPx(p.barValue)} width={barWidth} height={h} className="fill-cream/25" />;
          })}
          <path d={pathD} fill="none" className="stroke-alert" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <div
            key={p.key}
            className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-alert"
            style={{ left: `${xCenterPct(i)}%`, top: lineYPx(p.lineValue) }}
            title={`${p.label}\n${barLabel}: ${formatBar(p.barValue)}\n${lineLabel}: ${formatLine(p.lineValue)}`}
          />
        ))}
        <div className="absolute -top-4 left-0 text-[10px] text-cream/40">{formatBar(maxBar)}</div>
        <div className="absolute -top-4 right-0 text-[10px] text-alert/70">{formatLine(maxLine)}</div>
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
