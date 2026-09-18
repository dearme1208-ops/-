import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hueForString, kindIcon } from "./shared";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 単純なスライス&ダイス方式のツリーマップ(正確な正方形分割ではないが、依存ライブラリ無しで
// カテゴリ>アイテムの入れ子構造を面積として直感的に見せるには十分)
function slice<T>(list: T[], weightOf: (t: T) => number, rect: Rect, horizontal: boolean): { item: T; rect: Rect }[] {
  const total = list.reduce((s, t) => s + weightOf(t), 0) || 1;
  let offset = 0;
  return list.map((item) => {
    const ratio = weightOf(item) / total;
    let r: Rect;
    if (horizontal) {
      const w = rect.w * ratio;
      r = { x: rect.x + offset, y: rect.y, w, h: rect.h };
      offset += w;
    } else {
      const h = rect.h * ratio;
      r = { x: rect.x, y: rect.y + offset, w: rect.w, h };
      offset += h;
    }
    return { item, rect: r };
  });
}

const W = 940;
const H = 560;

export default function TreemapView({ items, onOpen }: AltViewProps) {
  const groups = useMemo(() => {
    const map = new Map<string, BoardViewItem[]>();
    for (const it of items) {
      const key = it.category || "未分類";
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [items]);

  const groupWeight = (g: [string, BoardViewItem[]]) => g[1].reduce((s, it) => s + it.subtaskTotal + 1, 0);
  const groupRects = useMemo(() => slice(groups, groupWeight, { x: 0, y: 0, w: W, h: H }, true), [groups]);

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🪆 ツリーマップ</h3>
      <p className="mb-3 text-xs text-cream/50">
        面積はサブタスク・段階の件数に比例。カテゴリ内でアイテムごとに縦分割し、色は対応状況タグを表します。
      </p>
      <div className="overflow-x-auto">
        <svg width={W} height={H} className="block min-w-[640px] rounded-lg">
          {groupRects.map(({ item: [name, list], rect }) => {
            const itemRects = slice(list, (it) => it.subtaskTotal + 1, { x: rect.x + 2, y: rect.y + 22, w: rect.w - 4, h: rect.h - 26 }, false);
            return (
              <g key={name}>
                <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)" />
                <text x={rect.x + 6} y={rect.y + 15} fontSize={11} fontWeight="bold" fill="rgba(255,255,255,0.75)">
                  {name} ({list.length})
                </text>
                {itemRects.map(({ item: it, rect: r }) => {
                  const hue = hueForString(it.tag || "未設定");
                  if (r.h < 2) return null;
                  return (
                    <g key={it.id} className="cursor-pointer" onClick={() => onOpen(it)}>
                      <rect
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        fill={it.overdue ? "rgb(var(--accent-rgb) / 0.55)" : `hsl(${hue} 45% 38% / 0.85)`}
                        stroke="rgba(0,0,0,0.4)"
                      />
                      {r.h > 14 && (
                        <text x={r.x + 4} y={r.y + Math.min(r.h - 4, 14)} fontSize={9.5} fill="rgba(255,255,255,0.9)">
                          {kindIcon(it.kind)} {it.title.length > Math.floor(r.w / 6) ? it.title.slice(0, Math.floor(r.w / 6)) + "…" : it.title}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
