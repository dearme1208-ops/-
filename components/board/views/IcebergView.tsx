import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, kindIcon } from "./shared";

const CARD_W = 160;
const CARD_H = 220;
const WATERLINE = 90;

// アイテム1件につき氷山を1つ。水面上=まだ残っている分(1-progress)、水面下=すでに
// やってきた分(progress)。「実は水面下にこれだけ積み上げてきた」を面積で見せる
export default function IcebergView({ items, onOpen }: AltViewProps) {
  const sorted = useMemo(() => [...items].sort((a, b) => b.progress - a.progress), [items]);

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🧊 氷山</h3>
      <p className="mb-4 text-xs text-cream/50">
        水面より上=残りの作業、水面より下=すでに終えた作業。進捗が高いほど水面下が大きくなります。
      </p>
      <div className="flex flex-wrap gap-5">
        {sorted.map((it) => {
          const belowRatio = Math.max(0.04, it.progress);
          const belowHeight = (CARD_H - WATERLINE) * belowRatio;
          const aboveHeight = WATERLINE * Math.max(0.15, 1 - it.progress * 0.7);
          const topWidth = 30 + aboveHeight * 0.55;
          const bottomWidth = CARD_W - 20;
          return (
            <button
              key={it.id}
              onClick={() => onOpen(it)}
              className="flex flex-col items-center text-left"
              style={{ width: CARD_W }}
              title={it.title}
            >
              <div className="mb-1 flex w-full items-center justify-between text-[10px] text-cream/60">
                <span className="truncate">
                  {kindIcon(it.kind)} {it.title}
                </span>
                <span className="tabular-nums">{Math.round(it.progress * 100)}%</span>
              </div>
              <svg width={CARD_W} height={CARD_H} className="rounded-lg" style={{ background: "linear-gradient(180deg, #8fd0e8 0%, #8fd0e8 44%, #0c3a52 45%, #082a3d 100%)" }}>
                {/* 水面上の氷 */}
                <polygon
                  points={`${CARD_W / 2 - topWidth / 2},${WATERLINE - aboveHeight} ${CARD_W / 2 + topWidth / 2},${WATERLINE - aboveHeight} ${CARD_W / 2 + bottomWidth / 2},${WATERLINE} ${CARD_W / 2 - bottomWidth / 2},${WATERLINE}`}
                  fill={it.overdue ? "rgb(var(--accent-rgb) / 0.6)" : "#eaf7fb"}
                  stroke="#ffffff"
                  strokeWidth={1}
                />
                {/* 水面下の氷 */}
                <polygon
                  points={`${CARD_W / 2 - bottomWidth / 2},${WATERLINE} ${CARD_W / 2 + bottomWidth / 2},${WATERLINE} ${CARD_W / 2 + bottomWidth / 2 - 12},${WATERLINE + belowHeight} ${CARD_W / 2 - bottomWidth / 2 + 12},${WATERLINE + belowHeight}`}
                  fill="rgba(210, 240, 250, 0.35)"
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                />
                <line x1={0} y1={WATERLINE} x2={CARD_W} y2={WATERLINE} stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} />
              </svg>
            </button>
          );
        })}
      </div>
    </div>
  );
}
