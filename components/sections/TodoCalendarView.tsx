"use client";

import { useMemo, useState } from "react";
import { todayStr } from "@/lib/time";
import type { TodoTask } from "@/lib/types";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export default function TodoCalendarView({ tasks, today }: { tasks: TodoTask[]; today: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  // 開始日(なければ期日)〜期日の各日に、その日がバーの先頭/末尾かどうかとともに登録する
  const byDate = useMemo(() => {
    const map = new Map<string, { task: TodoTask; isStart: boolean; isEnd: boolean }[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const startStr = t.startDate && t.startDate <= t.dueDate ? t.startDate : t.dueDate;
      let cursor = new Date(startStr + "T00:00:00");
      const endDate = new Date(t.dueDate + "T00:00:00");
      while (cursor.getTime() <= endDate.getTime()) {
        const key = todayStr(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ task: t, isStart: key === startStr, isEnd: key === t.dueDate });
        cursor = new Date(cursor.getTime() + 86400000);
      }
    }
    return map;
  }, [tasks]);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  function prevMonth() {
    const d = new Date(year, month - 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function nextMonth() {
    const d = new Date(year, month + 1, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function goToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-base font-bold">
          {year}年{month + 1}月
        </h3>
        <div className="flex items-center gap-1">
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={prevMonth} aria-label="前月">
            ‹
          </button>
          <button className="btn-pill-outline text-xs" onClick={goToday}>
            今月
          </button>
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={nextMonth} aria-label="翌月">
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
            const inMonth = date.getMonth() === month;
            const isToday = dateStr === today;
            const items = byDate.get(dateStr) ?? [];
            return (
              <div
                key={dateStr}
                className={`min-h-[76px] rounded-lg border p-1 ${
                  isToday ? "border-cream/60 bg-cream/5" : "border-cream/10"
                } ${inMonth ? "" : "opacity-30"}`}
              >
                <div className={`text-[11px] ${isToday ? "font-bold text-cream" : "text-cream/50"}`}>
                  {date.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {items.map(({ task: t, isStart, isEnd }) => {
                    const overdue = !t.completed && t.dueDate! < today;
                    const rangeLabel = t.startDate ? `${t.title}（${t.startDate} 〜 ${t.dueDate}）` : t.title;
                    return (
                      <div
                        key={t.id}
                        title={rangeLabel}
                        className={`truncate rounded px-1 py-0.5 text-[10px] ${
                          t.completed
                            ? "bg-cream/10 text-cream/40 line-through"
                            : overdue
                              ? "bg-alert/80 text-cream"
                              : "bg-cream/80 text-ink"
                        }`}
                      >
                        {!isStart && "…"}
                        {t.title}
                        {!isEnd && "…"}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
