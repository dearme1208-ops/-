"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { DOW_LABELS, buildMonthGrid } from "@/lib/calendarGrid";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, todayStr } from "@/lib/time";
import { heatLevel } from "@/lib/calendarHeatmap";

// ヒートマップタブと同じ5段階の濃淡(lib/calendarHeatmap.tsのheatLevelと揃える)
const LEVEL_OPACITY = [0.04, 0.22, 0.42, 0.64, 0.9];

// ガントチャートの月表示。週表示だと1週間しか見えず、月単位でのペースの波や
// 抜けている日を把握しづらいため、日ごとの合計作業時間を一目で見渡せる
// カレンダー形式の代替ビューとして用意する。日付をタップすると1日表示に切り替わる
export default function GanttMonthView({
  anchorDate,
  onSelectDate,
  onShiftMonth,
}: {
  anchorDate: string;
  onSelectDate: (date: string) => void;
  onShiftMonth: (deltaMonths: number) => void;
}) {
  const anchor = useMemo(() => new Date(anchorDate + "T00:00:00"), [anchorDate]);
  const today = todayStr();
  const now = Date.now();

  const grid = useMemo(() => buildMonthGrid(anchor.getFullYear(), anchor.getMonth()), [anchor]);
  const gridDateStrs = useMemo(() => grid.map((d) => todayStr(d)), [grid]);
  const gridDateStrsKey = gridDateStrs.join(",");

  const monthTasks = useLiveQuery(() => db.dailyTasks.where("date").anyOf(gridDateStrs).toArray(), [gridDateStrsKey]);

  const secondsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of monthTasks ?? []) {
      if (t.isProvisional) continue;
      const ms = segmentsAccumulatedMs(t, now);
      map.set(t.date, (map.get(t.date) ?? 0) + ms / 1000);
    }
    return map;
  }, [monthTasks, now]);

  const maxSeconds = useMemo(() => Math.max(0, ...secondsByDate.values()), [secondsByDate]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">
          {anchor.getFullYear()}年{anchor.getMonth() + 1}月
        </h3>
        <div className="flex items-center gap-1">
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={() => onShiftMonth(-1)} aria-label="前月">
            ‹
          </button>
          <button className="btn-pill-outline text-xs" onClick={() => onShiftMonth(0)}>
            今月
          </button>
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={() => onShiftMonth(1)} aria-label="翌月">
            ›
          </button>
        </div>
      </div>

      <div className="panel overflow-x-auto p-3">
        <div className="grid min-w-[560px] grid-cols-7 gap-1">
          {DOW_LABELS.map((d, i) => (
            <div key={d} className={`px-1 pb-1 text-center text-xs ${i === 0 ? "text-alert/80" : "text-cream/50"}`}>
              {d}
            </div>
          ))}
          {grid.map((date) => {
            const dateStr = todayStr(date);
            const inMonth = date.getMonth() === anchor.getMonth();
            const isToday = dateStr === today;
            const seconds = secondsByDate.get(dateStr) ?? 0;
            const level = heatLevel(seconds, maxSeconds);
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => onSelectDate(dateStr)}
                className={`flex min-h-[76px] flex-col items-start rounded-lg border p-1 text-left transition-colors hover:border-cream/40 ${
                  isToday ? "border-cream/60" : "border-cream/10"
                } ${inMonth ? "" : "opacity-30"}`}
                style={level > 0 ? { backgroundColor: `rgb(var(--accent-rgb) / ${LEVEL_OPACITY[level]})` } : undefined}
              >
                <span className={`text-[11px] ${isToday ? "font-bold text-cream" : "text-cream/50"}`}>{date.getDate()}</span>
                {seconds > 0 && <span className="mt-1 text-[10px] tabular-nums text-cream/80">{formatHms(seconds)}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-cream/40">日付をタップすると1日表示に切り替わります。色の濃さはその月の中での作業時間の多さを表します。</p>
    </div>
  );
}
