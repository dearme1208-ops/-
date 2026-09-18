import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hueForString } from "./shared";

const H = 260;

// カテゴリごとに1つの地区を作り、アイテムをビルとして並べる。高さ=サブタスク/段階の件数、
// 本日期日・重要は窓明かり(黄色)を強めにして目立たせる
export default function CityView({ items, onOpen }: AltViewProps) {
  const districts = useMemo(() => {
    const map = new Map<string, BoardViewItem[]>();
    for (const it of items) {
      const key = it.category || "未分類";
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  const maxWeight = Math.max(1, ...items.map((it) => it.subtaskTotal + 1));

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🏙 都市計画図</h3>
      <p className="mb-4 text-xs text-cream/50">
        カテゴリ=地区、ビルの高さ=サブタスク・段階の件数。窓の色は今日が期日・重要のものほど明るくなります。
      </p>
      <div className="space-y-6">
        {districts.map(([name, list]) => (
          <div key={name}>
            <div className="mb-1 text-xs font-bold text-cream/70">{name}地区</div>
            <div
              className="flex items-end gap-2 overflow-x-auto rounded-b-lg border-b-4 border-cream/20 p-3 pb-0"
              style={{ height: H, background: "linear-gradient(180deg, rgb(20 22 34), rgb(10 11 18))" }}
            >
              {list.map((it) => {
                const hue = hueForString(it.title);
                const height = 40 + ((it.subtaskTotal + 1) / maxWeight) * (H - 70);
                const width = 46;
                const floors = Math.max(2, Math.round(height / 18));
                const litFloors = it.dueToday || it.important || it.overdue ? floors : Math.round(floors * 0.35);
                return (
                  <button
                    key={it.id}
                    onClick={() => onOpen(it)}
                    title={it.title}
                    className="relative flex shrink-0 flex-col-reverse gap-[3px] rounded-t-sm p-1"
                    style={{ width, height, background: `hsl(${hue} 20% 20%)`, border: "1px solid rgba(255,255,255,0.12)" }}
                  >
                    {Array.from({ length: floors }).map((_, fi) => (
                      <div
                        key={fi}
                        className="flex justify-center gap-[2px]"
                        style={{ height: (height - 8) / floors }}
                      >
                        {[0, 1].map((wi) => (
                          <span
                            key={wi}
                            className="flex-1 rounded-[1px]"
                            style={{
                              background:
                                fi < litFloors
                                  ? it.overdue
                                    ? "rgb(var(--accent-rgb) / 0.85)"
                                    : "rgba(255,230,150,0.85)"
                                  : "rgba(255,255,255,0.05)",
                            }}
                          />
                        ))}
                      </div>
                    ))}
                    <span className="absolute -top-4 left-0 w-full truncate text-center text-[8px] text-cream/60">
                      {it.title.length > 8 ? it.title.slice(0, 8) + "…" : it.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
