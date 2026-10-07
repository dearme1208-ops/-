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
