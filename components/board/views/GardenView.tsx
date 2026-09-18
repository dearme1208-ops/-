import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, kindIcon } from "./shared";

// 進捗(0〜1)を4段階の生育ステージに割り当てる。期限切れは進捗に関わらず萎れた見た目にする
function growthEmoji(it: BoardViewItem): string {
  if (it.overdue) return "🥀";
  if (it.progress >= 0.75) return "🌻";
  if (it.progress >= 0.4) return "🌿";
  if (it.progress > 0) return "🌱";
  return "🫘";
}

export default function GardenView({ items, onOpen }: AltViewProps) {
  const beds = useMemo(() => {
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
      <h3 className="mb-3 font-display text-base font-bold">🌳 庭園栽培記録</h3>
      <p className="mb-4 text-xs text-cream/50">
        カテゴリごとに1つの花壇。進捗が進むほど育ち、期限切れは萎れて表示されます。
      </p>
      <div className="space-y-4">
        {beds.map(([name, list]) => (
          <div key={name} className="rounded-xl border border-cream/10 bg-[#1c2415]/60 p-3">
            <div className="mb-2 text-xs font-bold text-cream/70">🪴 {name}</div>
            <div className="flex flex-wrap gap-3 rounded-lg bg-[#2c3a1e]/70 p-3">
              {list.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onOpen(it)}
                  title={`${it.title}（進捗 ${Math.round(it.progress * 100)}%）`}
                  className="flex w-16 flex-col items-center gap-1 rounded-md p-1 hover:bg-white/5"
                >
                  <span className="text-2xl leading-none">{growthEmoji(it)}</span>
                  <span className="w-full truncate text-center text-[9px] text-cream/70">{it.title}</span>
                  <span className="text-[9px]">{kindIcon(it.kind)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-cream/50">
        <span>🫘 未着手</span>
        <span>🌱 着手</span>
        <span>🌿 進行中</span>
        <span>🌻 仕上げ</span>
        <span>🥀 期限切れ</span>
      </div>
    </div>
  );
}
