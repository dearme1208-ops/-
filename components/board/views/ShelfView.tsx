import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hueForString, kindIcon } from "./shared";

// カテゴリごとに1段の棚。ToDo/案件を背表紙(本)に見立て、太さ=サブタスク/段階の件数、
// 色=対応状況タグ。統合ボードの「滞留(経過日数)」の考え方をそのまま埃(彩度低下)に流用し、
// 長く放置されているものほど古びて見えるようにしている
export default function ShelfView({ items, onOpen }: AltViewProps) {
  const shelves = useMemo(() => {
    const map = new Map<string, BoardViewItem[]>();
    for (const it of items) {
      const key = it.category || "未分類";
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">📚 書架</h3>
      <p className="mb-4 text-xs text-cream/50">
        太い本ほどサブタスク・段階が多い案件。色あせているものほど長く放置されています。
      </p>
      <div className="space-y-6">
        {shelves.map(([name, list]) => (
          <div key={name}>
            <div className="mb-1 text-xs font-bold text-cream/70">{name}</div>
            <div className="flex items-end gap-[3px] overflow-x-auto rounded-t-md border-b-4 border-[#6b4a2b] bg-[#2a1c10]/40 p-2 pb-0">
              {list.map((it) => {
                const hue = hueForString(it.tag || "未設定");
                const height = 60 + Math.min(80, (it.subtaskTotal || 1) * 8);
                const width = 14 + Math.min(14, it.subtaskTotal);
                const dust = Math.min(0.65, it.ageDays / 60);
                return (
                  <button
                    key={it.id}
                    onClick={() => onOpen(it)}
                    title={`${it.title}（${it.ageDays}日経過）`}
                    className="relative flex shrink-0 flex-col items-center justify-end pb-1"
                    style={{
                      width,
                      height,
                      background: `hsl(${hue} 55% ${it.overdue ? 30 : 42}% / ${1 - dust * 0.5})`,
                      filter: `grayscale(${dust})`,
                      borderTop: "3px solid rgba(255,255,255,0.25)",
                      borderRadius: "2px 2px 0 0",
                    }}
                  >
                    <span className="absolute -top-4 text-[10px]">{kindIcon(it.kind)}</span>
                    {it.important && <span className="absolute top-1 text-[9px]">★</span>}
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
