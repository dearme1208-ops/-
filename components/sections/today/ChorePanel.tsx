"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { choreIntervals } from "@/lib/choreIntervals";
import { useHomeFilteredMasterTasks, useHomeFilteredRecords } from "@/lib/homeMode";
import { shiftDateStr } from "@/lib/time";

// 森モード(家庭)の「そろそろの家事」。繰り返している家事の、前にやってからの日数を
// いつもの間隔と並べ、空いてきたものから出す。押せばそのまま始められる(lib/choreIntervals.ts)
export default function ChorePanel({ today, onStart }: { today: string; onStart: (masterTaskId: string) => void }) {
  const records = useHomeFilteredRecords(
    useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -120)).toArray(), [today])
  );
  const masters = useHomeFilteredMasterTasks(useLiveQuery(() => db.masterTasks.toArray(), []));
  const recurringTodoIds = useLiveQuery(
    async () => new Set((await db.todoTasks.toArray()).filter((t) => !!t.recurrence).map((t) => t.id)),
    []
  );
  const items = useMemo(
    () => choreIntervals(records ?? [], masters ?? [], today, recurringTodoIds ?? new Set()).filter((c) => c.ratio >= 0.8).slice(0, 5),
    [records, masters, today, recurringTodoIds]
  );
  if (items.length === 0) return null;
  return (
    <section className="panel p-4" data-testid="chore-panel">
      <h3 className="font-display text-sm font-bold text-cream/85">🧺 そろそろの家事</h3>
      <p className="mt-0.5 text-[11px] text-cream/50">いつもの間隔より空いてきたものです。気が向いたらどうぞ。</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((c) => (
          <li key={c.master.id} className="flex items-center gap-2">
            <LeafPile ratio={c.ratio} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-cream">{c.master.name}</div>
              <div className="text-[11px] tabular-nums text-cream/55">
                前回から<b className={c.ratio >= 1.5 ? "text-alert" : "text-cream/80"}>{c.daysSince}日</b>
                （いつもは{Number.isInteger(c.usualDays) ? c.usualDays : c.usualDays.toFixed(1)}日おき）
              </div>
            </div>
            <button className="btn-pill-outline shrink-0 px-3 py-1 text-xs" onClick={() => onStart(c.master.id)}>
              ▶ 始める
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// 前にやってからの空き具合を、積もった落ち葉の量で見せる(いつもの間隔に近づくほど増え、
// 2倍を過ぎると枯れ色になる)。数字の日数より「そろそろ」が感覚で分かるように
function LeafPile({ ratio }: { ratio: number }) {
  const n = Math.max(1, Math.min(6, Math.round(ratio * 3)));
  const color = ratio >= 2 ? "rgb(var(--forest-rust-rgb, 168 88 56))" : ratio >= 1 ? "rgb(var(--forest-amber-rgb, 208 162 84))" : "rgb(var(--accent-rgb))";
  // 積み方(左右に少しずらしながら下から積む)
  const spots = [
    [10, 22, -20],
    [20, 23, 25],
    [15, 17, 70],
    [6, 14, -45],
    [23, 15, 10],
    [14, 9, 40],
  ];
  return (
    <svg viewBox="0 0 30 28" width={30} height={28} className="shrink-0" role="img" aria-label={`空き具合 ${Math.round(ratio * 100)}%`}>
      <line x1={2} y1={26} x2={28} y2={26} stroke="rgb(var(--cream-rgb) / 0.2)" strokeWidth={1} />
      {spots.slice(0, n).map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={5} ry={2.6} fill={color} opacity={0.9} transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </svg>
  );
}

