"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import { formatClock, shiftDateStr } from "@/lib/time";
import type { DailyTask } from "@/lib/types";
import { gapKey } from "@/lib/dayGaps";
import { DayGapsList, useDayGaps } from "@/components/DayGaps";
import {
  categorySlots,
  conditionHeatmap,
  dayRingSegments,
  HEAT_BLOCKS,
  HEAT_DAYS,
  hourglass,
  nextScheduled,
  weekStacks,
} from "@/lib/visuals";

// 本日の作業に置く可視化(数字を読まなくても、見た瞬間に分かる形)。計算は lib/visuals.ts

export const slotColor = (slot: number | undefined) => (slot ? `var(--viz-${slot})` : "var(--viz-other)");
const hm = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`;
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}
function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const sweep = Math.max(0.01, Math.min(359.99, a2 - a1));
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, r, a1 + sweep);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** 凡例(2区分以上の時だけ。色だけに頼らず名前と時間を並べる) */
function Legend({ items }: { items: { label: string; slot: number; ms: number }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-cream/70">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: slotColor(i.slot) }} aria-hidden="true" />
          {i.label}
          <span className="tabular-nums text-cream/50">{hm(i.ms)}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- 1. 今日のリング(+ 今日の抜けを埋める) ----
// 記録のない時間はリングの上に点線で描き、押すと下の一覧でその時間に作業を当てはめられる
export function DayRing({
  tasks,
  date,
  now,
  onEditTask,
}: {
  tasks: DailyTask[];
  date: string;
  now: number;
  onEditTask: (task: DailyTask) => void;
}) {
  const segs = useMemo(() => dayRingSegments(tasks, now), [tasks, now]);
  const slots = useMemo(() => categorySlots(segs.map((s) => ({ category: s.category, ms: s.end - s.start }))), [segs]);
  const [hover, setHover] = useState<number | null>(null);
  const gapData = useDayGaps(date, now);
  const [openGap, setOpenGap] = useState<string | null>(null);
  const fillCount = gapData.gaps.length + gapData.longSpans.length + gapData.pendingStamps;
  if (segs.length === 0 && fillCount === 0) return null;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const deg = (ms: number) => ((ms - dayStart.getTime()) / 86_400_000) * 360;
  const total = segs.reduce((s, x) => s + (x.end - x.start), 0);
  const byCat = new Map<string, number>();
  for (const s of segs) byCat.set(s.category, (byCat.get(s.category) ?? 0) + (s.end - s.start));
  const legend = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([label, ms]) => ({ label, ms, slot: slots.get(label) ?? 0 }));
  const scheduled = tasks.filter((t) => t.status === "pending" && t.scheduledTime);
  const nowDeg = deg(now);
  const hovered = hover !== null ? segs[hover] : null;
  const pickedGap = gapData.gaps.find((g) => gapKey(g) === openGap) ?? null;
  return (
    <section className="panel p-4" data-testid="day-ring">
      <h3 className="font-display text-sm font-bold text-cream/85">🕰 今日のリング</h3>
      <p className="text-[11px] text-cream/50">
        24時間の輪に、今日計った時間を区分の色で並べています。
        {gapData.gaps.length > 0 && "点線は記録のない時間です。押すと、その時間にした作業を選べます。"}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
        <svg viewBox="0 0 200 200" width={200} height={200} role="img" aria-label={`今日の記録 合計${hm(total)}`}>
          <circle cx={100} cy={100} r={78} fill="none" stroke="rgb(var(--cream-rgb) / 0.08)" strokeWidth={18} />
          {[0, 6, 12, 18].map((h) => {
            const [x, y] = polar(100, 100, 97, h * 15);
            return (
              <text key={h} x={x} y={y + 3} textAnchor="middle" fontSize={9} fill="rgb(var(--cream-rgb) / 0.5)">
                {h}
              </text>
            );
          })}
          {Array.from({ length: 24 }, (_, h) => {
            const [x1, y1] = polar(100, 100, 88, h * 15);
            const [x2, y2] = polar(100, 100, h % 6 === 0 ? 92 : 90, h * 15);
            return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(var(--cream-rgb) / 0.3)" strokeWidth={1} />;
          })}
          {segs.map((s, i) => {
            // 隣の区間とのあいだに細いすき間を残す(色どうしが溶けないように)
            const a1 = deg(s.start) + 0.4;
            const a2 = Math.max(a1 + 0.3, deg(s.end) - 0.4);
            return (
              <path
                key={i}
                d={arcPath(100, 100, 78, a1, a2)}
                fill="none"
                stroke={slotColor(slots.get(s.category))}
                strokeWidth={hover === i ? 22 : 18}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(hover === i ? null : i)}
              >
                <title>{`${s.category} / ${s.name} ${formatClock(s.start)}〜${s.running ? "計測中" : formatClock(s.end)}（${hm(s.end - s.start)}）`}</title>
              </path>
            );
          })}
          {scheduled.map((t) => {
            const [h, m] = t.scheduledTime!.split(":").map(Number);
            const [x, y] = polar(100, 100, 64, (h * 60 + m) / 4);
            return (
              <circle key={t.id} cx={x} cy={y} r={3} fill="none" stroke="rgb(var(--cream-rgb) / 0.7)" strokeWidth={1.2}>
                <title>{`予定 ${t.scheduledTime} ${t.name}`}</title>
              </circle>
            );
          })}
          {gapData.gaps.map((g) => {
            const key = gapKey(g);
            const on = openGap === key;
            return (
              <g key={key} role="button" aria-label={`記録のない時間 ${formatClock(g.start)}〜${formatClock(g.end)}`} data-testid="ring-gap" className="cursor-pointer" onClick={() => setOpenGap(on ? null : key)}>
                {/* 押しやすいよう、見た目より太い透明の当たり判定を重ねる */}
                <path d={arcPath(100, 100, 78, deg(g.start), deg(g.end))} fill="none" stroke="transparent" strokeWidth={26} />
                <path
                  d={arcPath(100, 100, 78, deg(g.start) + 0.4, deg(g.end) - 0.4)}
                  fill="none"
                  // 区分の色(特に橙)と見分けられるよう、ふだんは淡い点線、押した所だけ赤くする
                  stroke={on ? "rgb(var(--alert-rgb))" : "rgb(var(--cream-rgb) / 0.55)"}
                  strokeWidth={on ? 14 : 10}
                  strokeDasharray="3 2.5"
                />
              </g>
            );
          })}
          {(() => {
            const [x1, y1] = polar(100, 100, 60, nowDeg);
            const [x2, y2] = polar(100, 100, 92, nowDeg);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(var(--alert-rgb))" strokeWidth={2} strokeLinecap="round" />;
          })()}
          <text x={100} y={95} textAnchor="middle" fontSize={11} fill="rgb(var(--cream-rgb) / 0.6)">
            {hovered ? hovered.name.slice(0, 8) : pickedGap ? "記録なし" : "今日の記録"}
          </text>
          <text x={100} y={114} textAnchor="middle" fontSize={17} fontWeight={700} fill="rgb(var(--cream-rgb))">
            {hovered ? hm(hovered.end - hovered.start) : pickedGap ? hm(pickedGap.end - pickedGap.start) : hm(total)}
          </text>
        </svg>
        <div className="min-w-[10rem] space-y-1.5">
          <Legend items={legend} />
          {scheduled.length > 0 && <p className="text-[11px] text-cream/50">○ は予定の時刻、赤い線は今です。</p>}
        </div>
      </div>
      <div className="mt-3 border-t border-cream/10 pt-3">
        <DayGapsList date={date} data={gapData} openGap={openGap} onOpenGap={setOpenGap} onEditTask={onEditTask} />
      </div>
    </section>
  );
}

// ---- 2. 終業までの砂時計 ----
export function HourglassPanel({
  tasks,
  predictedSecondsByTaskId,
  elapsedMsOf,
  now,
  workEnd,
}: {
  tasks: DailyTask[];
  predictedSecondsByTaskId: Map<string, number>;
  elapsedMsOf: (t: DailyTask) => number;
  now: number;
  workEnd: string;
}) {
  const date = new Date(now);
  const [eh, em] = workEnd.split(":").map(Number);
  const endMs = new Date(date.getFullYear(), date.getMonth(), date.getDate(), eh || 0, em || 0).getTime();
  const h = hourglass(tasks, predictedSecondsByTaskId, elapsedMsOf, now, endMs);
  if (h.needMs === 0 && h.unknownCount === 0) return null;
  const scale = Math.max(h.leftMs, h.needMs, 1);
  const overflow = h.needMs - h.leftMs;
  const fits = overflow <= 0;
  return (
    <section className="panel space-y-2 p-4" data-testid="hourglass">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-bold text-cream/85">⏳ {workEnd}までに収まる？</h3>
        <span className={`text-xs font-bold ${fits ? "text-cream/80" : "text-alert"}`}>
          {h.leftMs === 0 ? "終業の時刻を過ぎています" : fits ? `収まる（${hm(-overflow)}の余裕）` : `${hm(overflow)}あふれそう`}
        </span>
      </div>
      <div className="space-y-1.5 text-[11px] text-cream/60">
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0">終業まで</span>
          <div className="h-3 flex-1 rounded-full bg-cream/8">
            <div className="h-full rounded-full bg-cream/45" style={{ width: `${(h.leftMs / scale) * 100}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums text-cream/80">{hm(h.leftMs)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0">残りの作業</span>
          <div className="relative h-3 flex-1 rounded-full bg-cream/8">
            <div className="h-full rounded-full bg-[rgb(var(--accent-rgb))]" style={{ width: `${(Math.min(h.needMs, h.leftMs) / scale) * 100}%` }} />
            {!fits && (
              <div
                className="absolute inset-y-0 rounded-r-full bg-alert"
                style={{ left: `calc(${(h.leftMs / scale) * 100}% + 2px)`, width: `calc(${(overflow / scale) * 100}% - 2px)` }}
              />
            )}
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums text-cream/80">{hm(h.needMs)}</span>
        </div>
      </div>
      {h.unknownCount > 0 && <p className="text-[11px] text-cream/45">見込みの立たない作業が{h.unknownCount}件あり、ここには入っていません。</p>}
    </section>
  );
}

// ---- 3. 次の予定まで ----
export function NextScheduleBar({
  tasks,
  date,
  now,
  runningFinishMs,
}: {
  tasks: DailyTask[];
  date: string;
  now: number;
  /** 計測中の作業の終わる見込み */
  runningFinishMs?: number;
}) {
  const next = nextScheduled(tasks, date, now);
  if (!next || next.at - now > 3 * 3600_000) return null;
  const span = next.at - now;
  const overlap = runningFinishMs !== undefined ? runningFinishMs - next.at : undefined;
  const finishPct = runningFinishMs !== undefined ? Math.min(100, ((runningFinishMs - now) / span) * 100) : undefined;
  return (
    <div className={`panel space-y-1 px-3 py-2 ${overlap !== undefined && overlap > 0 ? "border border-alert/50" : ""}`} data-testid="next-schedule">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-cream/80">
          ⏰ 次の予定 <b className="text-cream">{next.task.scheduledTime} {next.task.name}</b> まで
        </span>
        <span className="shrink-0 font-bold tabular-nums text-cream">{hm(span)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-cream/10" aria-hidden="true">
        {finishPct !== undefined && (
          <div
            className={`h-full rounded-full ${overlap !== undefined && overlap > 0 ? "bg-alert" : "bg-[rgb(var(--accent-rgb))]"}`}
            style={{ width: `${Math.max(2, finishPct)}%` }}
          />
        )}
      </div>
      {overlap !== undefined && (
        <p className={`text-[11px] ${overlap > 0 ? "font-bold text-alert" : "text-cream/55"}`}>
          {overlap > 0 ? `今の作業は予定に${hm(overlap)}食い込みそうです` : `今の作業は予定の${hm(-overlap)}前に終わる見込みです`}
        </p>
      )}
    </div>
  );
}

// ---- 5. 予定と実績のずれ(今日終えた作業) ----
export function PlanActualPanel({ tasks }: { tasks: DailyTask[] }) {
  const rows = tasks.filter((t) => t.status === "done" && !t.isProvisional && t.estimatedSeconds > 0);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((t) => Math.max(t.estimatedSeconds * 1000, t.accumulatedMs)));
  return (
    <section className="panel space-y-2 p-4" data-testid="plan-actual">
      <h3 className="font-display text-sm font-bold text-cream/85">📏 予定と実績</h3>
      <p className="text-[11px] text-cream/50">細い線が予定、太い棒が実績です。予定をはみ出した分は赤で示します。</p>
      <ul className="space-y-2">
        {rows.map((t) => {
          const plan = t.estimatedSeconds * 1000;
          const over = t.accumulatedMs - plan;
          return (
            <li key={t.id} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-cream/85">{t.name}</span>
                <span className={`shrink-0 tabular-nums ${over > 0 ? "font-bold text-alert" : "text-cream/55"}`}>
                  {hm(t.accumulatedMs)} / 予定{hm(plan)}
                  {over > 0 ? `（+${hm(over)}）` : ""}
                </span>
              </div>
              <div className="relative h-3" aria-hidden="true">
                <div className="absolute top-1 h-1 rounded-full bg-cream/30" style={{ width: `${(plan / max) * 100}%` }} />
                <div
                  className="absolute inset-y-0 rounded-full bg-[rgb(var(--accent-rgb))]"
                  style={{ width: `${(Math.min(t.accumulatedMs, plan) / max) * 100}%`, opacity: 0.85 }}
                />
                {over > 0 && (
                  <div
                    className="absolute inset-y-0 rounded-r-full bg-alert"
                    style={{ left: `calc(${(plan / max) * 100}% + 2px)`, width: `calc(${(over / max) * 100}% - 2px)` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- 6. 1週間の積み木 ----
export function WeekBlocks({ today }: { today: string }) {
  const records = useHomeFilteredRecords(useLiveQuery(() => db.records.where("date").aboveOrEqual(shiftDateStr(today, -6)).toArray(), [today]));
  const days = useMemo(() => weekStacks(records ?? [], today), [records, today]);
  const slots = useMemo(() => categorySlots(days.flatMap((d) => d.parts)), [days]);
  const max = Math.max(...days.map((d) => d.totalMs), 1);
  if (days.every((d) => d.totalMs === 0)) return null;
  const byCat = new Map<string, number>();
  for (const d of days) for (const p of d.parts) byCat.set(p.category, (byCat.get(p.category) ?? 0) + p.ms);
  const legend = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([label, ms]) => ({ label, ms, slot: slots.get(label) ?? 0 }));
  const wd = ["日", "月", "火", "水", "木", "金", "土"];
  return (
    <section className="panel space-y-2 p-4" data-testid="week-blocks">
      <h3 className="font-display text-sm font-bold text-cream/85">🧱 この1週間</h3>
      <div className="flex h-36 items-end gap-2">
        {days.map((d) => (
          <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] tabular-nums text-cream/55">{d.totalMs ? hm(d.totalMs).replace("時間", "h").replace("分", "m") : ""}</span>
            <div className="flex w-full max-w-[2.25rem] flex-col-reverse gap-[2px]" style={{ height: `${(d.totalMs / max) * 100}%` }}>
              {d.parts.map((p) => (
                <div
                  key={p.category}
                  className="w-full first:rounded-b-[4px] last:rounded-t-[4px]"
                  style={{ flexGrow: p.ms, background: slotColor(slots.get(p.category)) }}
                  title={`${d.date} ${p.category} ${hm(p.ms)}`}
                />
              ))}
            </div>
            <span className={`text-[10px] ${d.date === today ? "font-bold text-cream" : "text-cream/50"}`}>
              {wd[new Date(`${d.date}T00:00:00`).getDay()]}
            </span>
          </div>
        ))}
      </div>
      <Legend items={legend} />
    </section>
  );
}

// ---- 9. 時間帯ごとの調子 ----
export function ConditionHeatmapPanel({ today }: { today: string }) {
  const done = useLiveQuery(
    () => db.dailyTasks.where("date").aboveOrEqual(shiftDateStr(today, -60)).filter((t) => t.status === "done").toArray(),
    [today]
  );
  const grid = useMemo(() => conditionHeatmap(done ?? []), [done]);
  const filled = grid.flat().filter(Boolean).length;
  if (filled < 3) return null;
  return (
    <section className="panel space-y-2 p-4" data-testid="condition-heatmap">
      <h3 className="font-display text-sm font-bold text-cream/85">🌡 時間帯ごとの調子</h3>
      <p className="text-[11px] text-cream/50">この2か月、予定どおりに終えた割合です。濃いほど予定どおり、空白は記録なし。</p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-[10px]">
          <thead>
            <tr>
              <th />
              {HEAT_BLOCKS.map((b) => (
                <th key={b.label} className="font-normal text-cream/50">
                  {b.label}〜
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, di) => (
              <tr key={HEAT_DAYS[di]}>
                <th className="pr-1 font-normal text-cream/55">{HEAT_DAYS[di]}</th>
                {row.map((c, bi) => (
                  <td
                    key={bi}
                    className="h-7 min-w-[2.25rem] rounded-[4px] text-center tabular-nums"
                    style={{
                      background: c ? `color-mix(in srgb, var(--viz-good) ${Math.round(15 + c.onTime * 75)}%, transparent)` : "rgb(var(--cream-rgb) / 0.05)",
                      color: c ? "rgb(var(--cream-rgb))" : "transparent",
                    }}
                    title={c ? `${HEAT_DAYS[di]}曜 ${HEAT_BLOCKS[bi].label}台: ${c.count}件中${Math.round(c.onTime * c.count)}件が予定どおり` : "記録なし"}
                  >
                    {c ? `${Math.round(c.onTime * 100)}` : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-cream/40">数字は%。押す(重ねる)と件数が出ます。</p>
    </section>
  );
}

