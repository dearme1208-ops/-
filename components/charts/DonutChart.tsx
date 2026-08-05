"use client";

export interface DonutDatum {
  label: string;
  value: number;
}

// 単一色相（alert）の濃淡だけでセグメントを塗り分ける、パレット拡張なしの円グラフ
function segmentColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  const opacity = 0.9 - t * 0.6;
  return `rgba(194,59,59,${opacity.toFixed(2)})`;
}

export default function DonutChart({
  data,
  formatValue,
  maxSlices = 6,
}: {
  data: DonutDatum[];
  formatValue: (v: number) => string;
  maxSlices?: number;
}) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, maxSlices);
  const restTotal = sorted.slice(maxSlices).reduce((s, d) => s + d.value, 0);
  const slices = restTotal > 0 ? [...top, { label: "その他", value: restTotal }] : top;
  const total = slices.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return <p className="text-sm text-cream/50">データがありません。</p>;
  }

  let acc = 0;
  const stops: string[] = [];
  slices.forEach((d, i) => {
    const start = (acc / total) * 360;
    acc += d.value;
    const end = (acc / total) * 360;
    stops.push(`${segmentColor(i, slices.length)} ${start}deg ${end}deg`);
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div
        className="h-40 w-40 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${stops.join(", ")})`,
          boxShadow: "inset 0 0 0 28px #151517",
        }}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        {slices.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: segmentColor(i, slices.length) }}
            />
            <span className="min-w-0 flex-1 truncate text-cream/80">{d.label}</span>
            <span className="shrink-0 tabular-nums text-cream/50">
              {formatValue(d.value)} ({Math.round((d.value / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
