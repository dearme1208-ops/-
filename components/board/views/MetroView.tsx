import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, hueForString } from "./shared";

const W = 960;
const ROW_H = 130;
const PAD_L = 60;

// 案件(と、案件に属さないToDo用の「未分類」)を期日順の駅として1本の路線に並べる。
// 各駅の下にぶら下がるToDoは、その駅(案件)の「乗客」。今日の位置に電車を1本止めておく
export default function MetroView({ items, onOpen, today }: AltViewProps) {
  const stations = useMemo(() => {
    const map = new Map<string, { key: string; label: string; dueDate?: string; passengers: BoardViewItem[]; self?: BoardViewItem }>();
    for (const it of items) {
      if (it.kind === "project") {
        map.set(it.id, { key: it.id, label: it.title, dueDate: it.dueDate, passengers: [], self: it });
      }
    }
    const unassigned: BoardViewItem[] = [];
    for (const it of items) {
      if (it.kind === "project") continue;
      const projectId = it.todo?.projectId;
      const station = projectId ? map.get(`project:${projectId}`) : undefined;
      if (station) station.passengers.push(it);
      else unassigned.push(it);
    }
    if (unassigned.length > 0) {
      map.set("misc", { key: "misc", label: "未分類ToDo", passengers: unassigned });
    }
    return Array.from(map.values()).sort((a, b) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1);
  }, [items]);

  const n = Math.max(1, stations.length);
  const spacing = (W - PAD_L * 2) / Math.max(1, n - 1 || 1);
  const positions = stations.map((_, i) => PAD_L + (n === 1 ? 0 : i * spacing));
  const height = ROW_H + Math.max(0, ...stations.map((s) => s.passengers.length)) * 24 + 40;

  // 今日の電車の位置: 最初の「期日が今日以降」の駅の手前あたりに止める
  const trainIndex = stations.findIndex((s) => !s.dueDate || s.dueDate >= today);
  const trainX = trainIndex >= 0 ? positions[trainIndex] - spacing / 2 : positions[positions.length - 1] ?? PAD_L;

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">🚉 路線図</h3>
      <p className="mb-3 text-xs text-cream/50">案件を期日順の駅に見立てた1本の路線。駅の下にぶら下がるのはその案件のToDoです。</p>
      <div className="overflow-x-auto">
        <svg width={Math.max(W, PAD_L * 2 + 40)} height={height} className="block min-w-[640px]">
          <line x1={PAD_L} y1={40} x2={positions[positions.length - 1] ?? PAD_L} y2={40} stroke="rgba(255,255,255,0.35)" strokeWidth={4} />
          {trainIndex >= 0 && (
            <g>
              <rect x={Math.max(PAD_L - 14, trainX - 14)} y={28} width={28} height={24} rx={4} fill="rgb(var(--accent-rgb))" />
              <text x={Math.max(PAD_L - 14, trainX - 14) + 14} y={44} fontSize={13} textAnchor="middle">
                🚃
              </text>
            </g>
          )}
          {stations.map((s, i) => {
            const x = positions[i];
            const hue = hueForString(s.label);
            const overdue = s.self?.overdue;
            return (
              <g key={s.key}>
                <circle cx={x} cy={40} r={9} fill={overdue ? "rgb(var(--accent-rgb))" : `hsl(${hue} 55% 55%)`} stroke="#fff" strokeWidth={2} />
                <text
                  x={x}
                  y={64}
                  fontSize={10.5}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.85)"
                  className={s.self ? "cursor-pointer" : ""}
                  onClick={() => s.self && onOpen(s.self)}
                >
                  {s.label.length > 10 ? s.label.slice(0, 10) + "…" : s.label}
                </text>
                {s.dueDate && (
                  <text x={x} y={78} fontSize={9} textAnchor="middle" fill="rgba(255,255,255,0.4)">
                    {s.dueDate}
                  </text>
                )}
                {s.passengers.map((p, pi) => (
                  <g key={p.id} className="cursor-pointer" onClick={() => onOpen(p)}>
                    <circle cx={x} cy={100 + pi * 22} r={3.5} fill={p.overdue ? "rgb(var(--accent-rgb))" : "rgba(255,255,255,0.6)"} />
                    <text x={x + 8} y={104 + pi * 22} fontSize={9} fill="rgba(255,255,255,0.65)">
                      {p.title.length > 14 ? p.title.slice(0, 14) + "…" : p.title}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
