import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hueForString, kindIcon } from "./shared";

// カテゴリ(なければ案件名、それも無ければ「未分類」)ごとに1つの島を作り、
// その上にToDo・案件・本日の作業を小屋(チップ)として置く。期限切れが1件でもある島には
// 嵐雲を出し、島の大きさは載っている件数に応じて変える
export default function IslandsView({ items, onOpen }: AltViewProps) {
  const islands = useMemo(() => {
    const map = new Map<string, BoardViewItem[]>();
    for (const it of items) {
      const key = it.category || "未分類";
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([name, list]) => ({
        name,
        list,
        overdueCount: list.filter((it) => it.overdue).length,
        hue: hueForString(name),
      }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [items]);

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🗺 諸島マップ</h3>
      <p className="mb-4 text-xs text-cream/50">
        分類(カテゴリ)ごとに島を1つ。嵐雲は期限切れを抱えている島の目印です。
      </p>
      <div
        className="flex flex-wrap items-start gap-6 rounded-2xl p-6"
        style={{ background: "linear-gradient(180deg, rgb(20 40 60), rgb(10 25 42))" }}
      >
        {islands.map((island) => {
          const size = Math.max(160, Math.min(320, 140 + island.list.length * 26));
          return (
            <div key={island.name} className="relative flex flex-col items-center" style={{ width: size }}>
              {island.overdueCount > 0 && (
                <div className="absolute -top-5 right-4 text-2xl" title={`期限切れ ${island.overdueCount}件`}>
                  ⛈️
                </div>
              )}
              <div
                className="flex w-full flex-col items-center gap-2 p-4 shadow-lg"
                style={{
                  minHeight: size * 0.75,
                  background: `hsl(${island.hue} 38% 32% / 0.9)`,
                  borderRadius: "62% 38% 41% 59% / 55% 42% 58% 45%",
                  border: `2px solid hsl(${island.hue} 45% 55% / 0.6)`,
                }}
              >
                <span className="mt-2 text-center text-xs font-bold text-cream/90">{island.name}</span>
                <span className="text-[10px] text-cream/50">{island.list.length}件</span>
                <div className="flex flex-wrap justify-center gap-1.5 px-2 pb-3">
                  {island.list.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => onOpen(it)}
                      title={it.title}
                      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${
                        it.overdue ? "bg-alert/70 text-cream" : "bg-ink/60 text-cream/85 hover:bg-ink/80"
                      }`}
                    >
                      <span>{kindIcon(it.kind)}</span>
                      <span className="max-w-[8rem] truncate">{it.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
