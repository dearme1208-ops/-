import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hueForString, kindIcon } from "./shared";

// 全アイテムをタイル状に敷き詰め、進捗(サブタスク/段階の完了率)に応じて発色させる。
// 進捗0のタイルは灰色のまま、進んでいるほど色付いていくので、盤面全体がじわじわ
// 絵になっていくようなゲーミフィケーション演出
export default function MosaicView({ items, onOpen }: AltViewProps) {
  const sorted = useMemo(() => [...items].sort((a, b) => hueForString(a.category ?? "") - hueForString(b.category ?? "")), [items]);
  const overallProgress = items.length > 0 ? items.reduce((s, it) => s + it.progress, 0) / items.length : 0;

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🧩 モザイク</h3>
      <p className="mb-3 text-xs text-cream/50">
        進捗が進むほど色付くタイル。全体の発色度合い = 平均進捗{" "}
        <span className="font-bold text-cream">{Math.round(overallProgress * 100)}%</span>
      </p>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 md:grid-cols-10">
        {sorted.map((it) => {
          const hue = hueForString(it.category || it.title);
          const sat = 15 + it.progress * 55;
          const light = 22 + it.progress * 28;
          return (
            <button
              key={it.id}
              onClick={() => onOpen(it)}
              title={`${it.title}（進捗 ${Math.round(it.progress * 100)}%）`}
              className="relative flex aspect-square items-center justify-center rounded-sm text-[9px] transition-transform hover:z-10 hover:scale-110"
              style={{
                background: it.overdue ? `hsl(0 70% ${28 + it.progress * 20}%)` : `hsl(${hue} ${sat}% ${light}%)`,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
              }}
            >
              <span style={{ opacity: 0.35 + it.progress * 0.65 }}>{kindIcon(it.kind)}</span>
              {it.important && <span className="absolute right-0.5 top-0.5 text-[7px]">★</span>}
            </button>
          );
        })}
      </div>
      {sorted.length === 0 && <p className="mt-2 text-sm text-cream/50">タイルにするアイテムがありません。</p>}
    </div>
  );
}
