"use client";

import { useMemo, useState } from "react";
import type { ChainEdge, ChainNode } from "@/lib/categoryChain";

const SIZE = 320;
const CENTER = SIZE / 2;
const LAYOUT_RADIUS = 118;
const MAX_NODES = 10;

// DonutChartと同じく単一色相(accent)の濃淡だけで塗り分ける
function nodeColor(index: number, count: number): string {
  const t = count > 1 ? index / (count - 1) : 0;
  const opacity = 0.9 - t * 0.55;
  return `rgb(var(--accent-rgb) / ${opacity.toFixed(2)})`;
}

export default function CategoryChainGraph({
  nodes,
  edges,
  formatValue,
}: {
  nodes: ChainNode[];
  edges: ChainEdge[];
  formatValue: (seconds: number) => string;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const shownNodes = useMemo(() => nodes.slice(0, MAX_NODES), [nodes]);
  const shownCategories = useMemo(() => new Set(shownNodes.map((n) => n.category)), [shownNodes]);
  const shownEdges = useMemo(
    () => edges.filter((e) => shownCategories.has(e.from) && shownCategories.has(e.to)),
    [edges, shownCategories]
  );

  if (shownNodes.length === 0) {
    return <p className="text-sm text-cream/50">データがありません。</p>;
  }

  const maxSeconds = Math.max(...shownNodes.map((n) => n.totalSeconds));
  const maxEdgeCount = Math.max(1, ...shownEdges.map((e) => e.count));

  const positions = new Map<string, { x: number; y: number }>();
  shownNodes.forEach((n, i) => {
    const angle = (i / shownNodes.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(n.category, {
      x: CENTER + LAYOUT_RADIUS * Math.cos(angle),
      y: CENTER + LAYOUT_RADIUS * Math.sin(angle),
    });
  });

  function nodeRadius(seconds: number): number {
    if (maxSeconds <= 0) return 8;
    return 8 + (seconds / maxSeconds) * 16;
  }

  const relatedEdges = selected
    ? shownEdges.filter((e) => e.from === selected || e.to === selected)
    : [];

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-sm">
        <defs>
          <marker id="chain-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="rgb(var(--accent-rgb) / 0.8)" />
          </marker>
        </defs>
        {shownEdges.map((e, i) => {
          const from = positions.get(e.from);
          const to = positions.get(e.to);
          if (!from || !to) return null;
          const isRelated = selected !== null && (e.from === selected || e.to === selected);
          const dim = selected !== null && !isRelated;
          // 中心から見て外側に少し膨らませ、逆方向の矢印と重ならないようにする
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          const dx = mx - CENTER;
          const dy = my - CENTER;
          const bow = 0.18;
          const cx = mx + dx * bow;
          const cy = my + dy * bow;
          const fromR = nodeRadius(nodes.find((n) => n.category === e.from)?.totalSeconds ?? 0);
          const toR = nodeRadius(nodes.find((n) => n.category === e.to)?.totalSeconds ?? 0);
          const dirX = to.x - cx;
          const dirY = to.y - cy;
          const dirLen = Math.hypot(dirX, dirY) || 1;
          const endX = to.x - (dirX / dirLen) * (toR + 6);
          const endY = to.y - (dirY / dirLen) * (toR + 6);
          const startDirX = from.x - cx;
          const startDirY = from.y - cy;
          const startLen = Math.hypot(startDirX, startDirY) || 1;
          const startX = from.x - (startDirX / startLen) * fromR;
          const startY = from.y - (startDirY / startLen) * fromR;
          const width = 1 + (e.count / maxEdgeCount) * 4;
          return (
            <path
              key={`${e.from}-${e.to}-${i}`}
              d={`M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`}
              fill="none"
              stroke="rgb(var(--accent-rgb) / 0.8)"
              strokeWidth={width}
              strokeOpacity={dim ? 0.12 : isRelated ? 0.95 : 0.35}
              markerEnd="url(#chain-arrow)"
            />
          );
        })}
        {shownNodes.map((n, i) => {
          const pos = positions.get(n.category)!;
          const r = nodeRadius(n.totalSeconds);
          const dim = selected !== null && selected !== n.category && !relatedEdges.some((e) => e.from === n.category || e.to === n.category);
          return (
            <g
              key={n.category}
              transform={`translate(${pos.x}, ${pos.y})`}
              onClick={() => setSelected(selected === n.category ? null : n.category)}
              className="cursor-pointer"
            >
              <circle r={r} fill={nodeColor(i, shownNodes.length)} opacity={dim ? 0.25 : 1} />
              <text
                y={r + 13}
                textAnchor="middle"
                className="fill-cream text-[10px]"
                opacity={dim ? 0.35 : 0.85}
              >
                {n.category.length > 8 ? `${n.category.slice(0, 7)}…` : n.category}
              </text>
            </g>
          );
        })}
      </svg>
      {selected ? (
        <div className="space-y-1.5 text-xs">
          <p className="font-bold text-cream/80">
            {selected} ・ 合計 {formatValue(nodes.find((n) => n.category === selected)?.totalSeconds ?? 0)}
          </p>
          {relatedEdges.length === 0 && <p className="text-cream/40">他の大項目との連鎖はありません。</p>}
          {relatedEdges
            .slice()
            .sort((a, b) => b.count - a.count)
            .map((e) => (
              <p key={`${e.from}-${e.to}`} className="text-cream/60">
                {e.from === selected ? `→ ${e.to}` : `${e.from} →`} ・ {e.count}回
              </p>
            ))}
        </div>
      ) : (
        <p className="text-center text-[10px] text-cream/40">丸をタップすると、その大項目の前後の連鎖を確認できます。</p>
      )}
    </div>
  );
}
