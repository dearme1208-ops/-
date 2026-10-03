"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { buildBonds, buildStats, pickCallingCard } from "@/lib/persona";
import { shiftDateStr } from "@/lib/time";

// ペルソナ風モードの画面部品(lib/persona.ts)。赤・黒・白と斜めの切り抜きで、
// 原作の予告状とカレンダーの日めくり、人間パラメータ、仲間との絆を見せる

const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function CallingCardPanel({ today }: { today: string }) {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const card = useMemo(() => pickCallingCard(projects ?? [], todos ?? [], today), [projects, todos, today]);
  const [y, m, d] = today.split("-").map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return (
    <section className="p5-calendar relative flex items-stretch gap-3 overflow-hidden" data-testid="persona-calling-card">
      {/* 日めくり */}
      <div className="p5-date flex w-20 shrink-0 flex-col items-center justify-center py-2">
        <span className="text-[11px] font-black tracking-widest">{wd}</span>
        <span className="text-3xl font-black leading-none">
          {m}/{d}
        </span>
      </div>
      {card ? (
        <div className="p5-card min-w-0 flex-1 px-3 py-2">
          <p className="text-[11px] font-black tracking-[0.25em]">予告状</p>
          <p className="truncate text-base font-black">{card.title}</p>
          <p className="mt-0.5 text-xs font-bold">
            {card.daysLeft < 0 ? (
              <>期日を<span className="p5-count">{-card.daysLeft}</span>日過ぎている</>
            ) : card.daysLeft === 0 ? (
              <span className="p5-count">今日が期日</span>
            ) : (
              <>
                期日まで あと<span className="p5-count">{card.daysLeft}</span>日
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="min-w-0 flex-1 self-center px-2 text-sm font-bold text-cream/80">7日以内に期日の迫る仕事はない。今のうちに力を蓄えよう</div>
      )}
    </section>
  );
}

export function PersonaStatsPanel({ today }: { today: string }) {
  const records = useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -90)).toArray(), [today]);
  const allRecords = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const clients = useLiveQuery(() => db.clients.toArray(), []);
  const stats = useMemo(() => buildStats(records ?? [], today), [records, today]);
  const bonds = useMemo(
    () => buildBonds(allRecords ?? [], masters ?? [], projects ?? [], clients ?? []).slice(0, 6),
    [allRecords, masters, projects, clients]
  );
  return (
    <section className="panel space-y-3 p-4" data-testid="persona-stats">
      <h3 className="font-display text-sm font-bold text-cream">人間パラメータ</h3>
      <ul className="space-y-1.5">
        {stats.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-sm">
            <span className="w-14 shrink-0 font-bold text-cream">{s.label}</span>
            <span className="flex gap-0.5" aria-label={`ランク${s.rank}`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={`h-3 w-4 -skew-x-12 ${i <= s.rank ? "bg-[rgb(var(--accent-rgb))]" : "bg-cream/15"}`} />
              ))}
            </span>
            <span className="ml-auto text-[11px] tabular-nums text-cream/60">{s.hours.toFixed(1)}h</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-cream/50">直近90日の作業時間から。作業の言葉(勉強・会議・制作・家事・運動など)でどれが伸びるかが決まります。</p>
      {bonds.length > 0 && (
        <div className="space-y-1.5 border-t border-cream/10 pt-3">
          <h4 className="text-xs font-bold text-cream/80">絆（取引先ごとのランク）</h4>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {bonds.map((b) => (
              <div key={b.clientId} className="flex items-center gap-2 rounded border border-cream/15 px-2 py-1.5">
                <span className="p5-rank flex h-7 w-7 shrink-0 items-center justify-center text-sm font-black">{b.rank}</span>
                <span className="min-w-0 truncate text-xs text-cream">{b.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
