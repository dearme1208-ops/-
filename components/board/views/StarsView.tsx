import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hashString, hueForString, kindIcon } from "./shared";

const W = 900;
const H = 560;

// 同じ分類(カテゴリ)を1つの星座として線で結ぶ。位置はID由来の疑似乱数で固定するため、
// 再描画のたびに星が飛び回ったりはしない。重要・期限切れは明るく大きな星になる
export default function StarsView({ items, onOpen }: AltViewProps) {
  const stars = useMemo(() => {
    return items.map((it) => {
      const h1 = hashString(it.id);
      const h2 = hashString(it.id + ":y");
      const x = 40 + (h1 % 1000) / 1000 * (W - 80);
      const y = 40 + (h2 % 1000) / 1000 * (H - 80);
      const brightness = it.overdue ? 1 : it.important ? 0.85 : 0.55;
      const r = it.kind === "project" ? 6 : 3.5 + brightness * 2;
      return { item: it, x, y, r, brightness };
    });
  }, [items]);

  const constellations = useMemo(() => {
    const map = new Map<string, typeof stars>();
    for (const s of stars) {
      const key = s.item.category || "未分類";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [stars]);

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🌌 星図</h3>
      <p className="mb-3 text-xs text-cream/50">
        明るい星ほど重要・期限切れ。同じ分類の星は線で結んで1つの星座にしています。
      </p>
      <div className="overflow-x-auto rounded-2xl" style={{ background: "radial-gradient(circle at 30% 20%, rgb(24 24 40), rgb(6 6 14))" }}>
        <svg width={W} height={H} className="block min-w-[640px]">
          {constellations.map(([name, list]) => {
            const hue = hueForString(name);
            if (list.length < 2) return null;
            const sorted = [...list].sort((a, b) => a.x - b.x);
            const path = sorted.map((s, i) => `${i === 0 ? "M" : "L"} ${s.x} ${s.y}`).join(" ");
            return <path key={name} d={path} fill="none" stroke={`hsl(${hue} 60% 60% / 0.35)`} strokeWidth={1} />;
          })}
          {stars.map(({ item, x, y, r, brightness }) => (
            <g key={item.id} className="cursor-pointer" onClick={() => onOpen(item)}>
              <circle cx={x} cy={y} r={r + 6} fill={`rgba(255,255,255,${brightness * 0.08})`} />
              <circle cx={x} cy={y} r={r} fill={item.overdue ? "rgb(var(--accent-rgb))" : `rgba(255,255,255,${0.5 + brightness * 0.5})`}>
                <title>
                  {kindIcon(item.kind)} {item.title}
                  {item.dueDate ? ` (期日: ${item.dueDate})` : ""}
                </title>
              </circle>
              <text x={x + r + 6} y={y + 3} fontSize={9} fill="rgba(255,255,255,0.55)">
                {item.title.length > 12 ? item.title.slice(0, 12) + "…" : item.title}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-cream/50">
        {constellations.map(([name]) => (
          <span key={name} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: `hsl(${hueForString(name)} 60% 60%)` }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
