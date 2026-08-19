"use client";

export interface DonutDatum {
  label: string;
  value: number;
}

// 単一色相（alert）の濃淡だけでセグメントを塗り分ける、パレット拡張なしの円グラフ
function segmentColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  const opacity = 0.9 - t * 0.6;
  return `rgb(var(--accent-rgb) / ${opacity.toFixed(2)})`;
}

export default function DonutChart({
  data,
  formatValue,
  maxSlices = 6,
  onSliceClick,
}: {
  data: DonutDatum[];
  formatValue: (v: number) => string;
  maxSlices?: number;
  // 区分をタップした際に呼ばれる。「その他」行がタップされた場合は、上位maxSlices件に
  // 入りきらず折り畳まれた元データをotherItemsで渡すので、呼び出し側でその内訳も見せられる
  onSliceClick?: (d: DonutDatum, meta: { isOther: boolean; otherItems: DonutDatum[] }) => void;
}) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, maxSlices);
  const restItems = sorted.slice(maxSlices);
  const restTotal = restItems.reduce((s, d) => s + d.value, 0);
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
      <div className="min-w-0 flex-1 space-y-2">
        {slices.map((d, i) => {
          const isOther = restTotal > 0 && i === slices.length - 1;
          const handleClick = () => onSliceClick?.(d, { isOther, otherItems: isOther ? restItems : [] });
          return (
            <div
              key={d.label}
              role={onSliceClick ? "button" : undefined}
              tabIndex={onSliceClick ? 0 : undefined}
              onClick={onSliceClick ? handleClick : undefined}
              onKeyDown={
                onSliceClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleClick();
                      }
                    }
                  : undefined
              }
              className={`-m-1 rounded-md p-1 text-xs ${
                onSliceClick ? "cursor-pointer transition hover:bg-cream/5 focus:outline-none focus:ring-1 focus:ring-cream/50" : ""
              }`}
            >
              {/* 区分名と値を同じ行に並べて幅を取り合わせると、狭い画面では区分名側が
                  1文字分の幅まで押しつぶされ、truncateだとほぼ消え、折り返しだと
                  縦に1文字ずつ並ぶ縦書きのようになってしまう。区分名を単独の行いっぱいに
                  使わせ、値はその下に置くことで、区分名の幅を値の長さに左右されないようにする */}
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: segmentColor(i, slices.length) }}
                />
                <span className="min-w-0 break-words text-cream/80">{d.label}</span>
              </div>
              <div className="pl-[18px] tabular-nums text-cream/50">
                {formatValue(d.value)} ({Math.round((d.value / total) * 100)}%)
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
