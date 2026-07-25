"use client";

export interface RankingBarDatum {
  label: string;
  sublabel?: string;
  value: number;
}

export default function RankingBarChart({
  data,
  formatValue,
}: {
  data: RankingBarDatum[];
  formatValue: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0);
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="w-28 shrink-0 truncate text-xs text-cream/70 sm:w-40" title={d.sublabel ? `${d.sublabel} / ${d.label}` : d.label}>
              {d.label}
            </div>
            <div className="h-5 min-w-0 flex-1 rounded bg-cream/5">
              <div
                className="h-5 rounded-r bg-cream transition-[width]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="w-16 shrink-0 text-right text-xs tabular-nums text-cream/70 sm:w-20">
              {formatValue(d.value)}
            </div>
          </div>
        );
      })}
      {data.length === 0 && <p className="text-sm text-cream/50">データがありません。</p>}
    </div>
  );
}
