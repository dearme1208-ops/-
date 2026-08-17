"use client";

export interface RankingBarDatum {
  label: string;
  sublabel?: string;
  value: number;
}

export default function RankingBarChart({
  data,
  formatValue,
  onBarClick,
}: {
  data: RankingBarDatum[];
  formatValue: (v: number) => string;
  // 指定すると各バーがクリック/タップ可能になり、押した棒のインデックスを受け取る
  // (例: 曜日別の平均稼働時間で、押した曜日の内訳を別途表示する用途)
  onBarClick?: (index: number) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const pct = Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0);
        return (
          <div
            key={i}
            className={`flex items-center gap-2 ${
              onBarClick ? "-mx-1 cursor-pointer rounded-lg px-1 py-0.5 active:bg-cream/10 hover:bg-cream/5" : ""
            }`}
            onClick={onBarClick ? () => onBarClick(i) : undefined}
            role={onBarClick ? "button" : undefined}
            tabIndex={onBarClick ? 0 : undefined}
            onKeyDown={
              onBarClick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onBarClick(i);
                    }
                  }
                : undefined
            }
          >
            <div className="w-24 shrink-0 overflow-hidden sm:w-36" title={d.sublabel ? `${d.sublabel} / ${d.label}` : d.label}>
              {d.sublabel && <div className="truncate text-[10px] text-cream/50">{d.sublabel}</div>}
              <div className="truncate text-xs text-cream/80">{d.label}</div>
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
