"use client";

import { useMemo, useState } from "react";
import { todayStr } from "@/lib/time";
import { DOW_LABELS, buildMonthGrid, buildWeekGrid, type WeekViewMode } from "@/lib/calendarGrid";
import { useSetting } from "@/lib/settings";
import type { TodoTask } from "@/lib/types";

export interface SubtaskForCalendar {
  subtask: TodoTask;
  parentTitle: string;
}

type CalendarEntry =
  | { kind: "task"; task: TodoTask; isStart: boolean; isEnd: boolean }
  | { kind: "subtask"; subtask: TodoTask; parentTitle: string };

type Granularity = "month" | "week";

export default function TodoCalendarView({
  tasks,
  subtasks,
  today,
}: {
  tasks: TodoTask[];
  subtasks?: SubtaskForCalendar[];
  today: string;
}) {
  const now = new Date();
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [anchor, setAnchor] = useState(now);
  const [weekViewMode] = useSetting("calendar.weekViewMode", "fixedStart");
  const [weekStartDayStr] = useSetting("calendar.weekStartDay", "0");
  const weekStartDay = Number(weekStartDayStr);

  // 開始日(なければ期日)〜期日の各日に、その日がバーの先頭/末尾かどうかとともに登録する。
  // サブタスクは開始日の概念を持たないため、期日1日だけの単発エントリとして登録する
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const t of tasks) {
      if (!t.dueDate) continue;
      const startStr = t.startDate && t.startDate <= t.dueDate ? t.startDate : t.dueDate;
      let cursor = new Date(startStr + "T00:00:00");
      const endDate = new Date(t.dueDate + "T00:00:00");
      while (cursor.getTime() <= endDate.getTime()) {
        const key = todayStr(cursor);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ kind: "task", task: t, isStart: key === startStr, isEnd: key === t.dueDate });
        cursor = new Date(cursor.getTime() + 86400000);
      }
    }
    for (const { subtask, parentTitle } of subtasks ?? []) {
      if (!subtask.dueDate) continue;
      if (!map.has(subtask.dueDate)) map.set(subtask.dueDate, []);
      map.get(subtask.dueDate)!.push({ kind: "subtask", subtask, parentTitle });
    }
    return map;
  }, [tasks, subtasks]);

  const grid = useMemo(
    () =>
      granularity === "month"
        ? buildMonthGrid(anchor.getFullYear(), anchor.getMonth())
        : buildWeekGrid(anchor, weekViewMode as WeekViewMode, weekStartDay),
    [granularity, anchor, weekViewMode, weekStartDay]
  );

  function prev() {
    if (granularity === "month") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
    } else {
      setAnchor(new Date(anchor.getTime() - 7 * 86400000));
    }
  }
  function next() {
    if (granularity === "month") {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
    } else {
      setAnchor(new Date(anchor.getTime() + 7 * 86400000));
    }
  }
  function goToday() {
    setAnchor(now);
  }

  const weekGrid = granularity === "week" ? grid : null;
  const headerLabel =
    granularity === "month"
      ? `${anchor.getFullYear()}年${anchor.getMonth() + 1}月`
      : weekGrid
        ? weekGrid[0].getFullYear() === weekGrid[6].getFullYear() && weekGrid[0].getMonth() === weekGrid[6].getMonth()
          ? `${weekGrid[0].getFullYear()}年${weekGrid[0].getMonth() + 1}月${weekGrid[0].getDate()}日 〜 ${weekGrid[6].getDate()}日`
          : `${weekGrid[0].getMonth() + 1}月${weekGrid[0].getDate()}日 〜 ${weekGrid[6].getMonth() + 1}月${weekGrid[6].getDate()}日`
        : "";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">{headerLabel}</h3>
        <div className="flex items-center gap-1">
          <button
            className={granularity === "month" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setGranularity("month")}
          >
            月
          </button>
          <button
            className={granularity === "week" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setGranularity("week")}
          >
            週
          </button>
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={prev} aria-label={granularity === "month" ? "前月" : "前週"}>
            ‹
          </button>
          <button className="btn-pill-outline text-xs" onClick={goToday}>
            {granularity === "month" ? "今月" : "今週"}
          </button>
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={next} aria-label={granularity === "month" ? "翌月" : "翌週"}>
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
            const inMonth = granularity === "month" ? date.getMonth() === anchor.getMonth() : true;
            const isToday = dateStr === today;
            const items = byDate.get(dateStr) ?? [];
            return (
              <div
                key={dateStr}
                className={`${granularity === "month" ? "min-h-[76px]" : "min-h-[160px]"} rounded-lg border p-1 ${
                  isToday ? "border-cream/60 bg-cream/5" : "border-cream/10"
                } ${inMonth ? "" : "opacity-30"}`}
              >
                <div className={`text-[11px] ${isToday ? "font-bold text-cream" : "text-cream/50"}`}>
                  {date.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {items.map((entry) => {
                    if (entry.kind === "task") {
                      const { task: t, isStart, isEnd } = entry;
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
                    }
                    const { subtask: s, parentTitle } = entry;
                    const overdue = !s.completed && s.dueDate! < today;
                    return (
                      <div
                        key={s.id}
                        title={`${parentTitle} / ${s.title}`}
                        className={`truncate rounded border px-1 py-0.5 text-[10px] ${
                          s.completed
                            ? "border-cream/10 text-cream/40 line-through"
                            : overdue
                              ? "border-alert/60 text-alert"
                              : "border-cream/30 text-cream/70"
                        }`}
                      >
                        └ {s.title}
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
