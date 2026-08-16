"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { DOW_LABELS, buildWeekGrid, type WeekViewMode } from "@/lib/calendarGrid";
import { formatClock, formatHms, todayStr } from "@/lib/time";
import type { DailyTask } from "@/lib/types";
import { ganttOverrunClass, useVisualMode } from "@/lib/theme";
import { usePinchZoom, useSwipeNavigate } from "@/lib/gestures";

const DEFAULT_HOUR_PX = 44;
const MIN_HOUR_PX = 18;
const MAX_HOUR_PX = 140;
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;
const MIN_BLOCK_PX = 13;

interface WeekBlock {
  key: string;
  taskName: string;
  category: string;
  startHour: number;
  endHour: number;
  ongoing: boolean;
  overPlan: boolean;
  kind: "actual" | "scheduled";
}

// 縦の時間軸上に置くブロック。左右いっぱいに広がる(横幅は列=曜日の幅に合わせる)ため、
// GanttSection.tsxのHoverBar(左右とも数値pxで指定する横長バー向け)とは別に用意する
function WeekBlockBar({
  top,
  height,
  className,
  textClassName,
  tooltip,
  label,
}: {
  top: number;
  height: number;
  className: string;
  textClassName: string;
  tooltip: string;
  label: string;
}) {
  return (
    <div className="group absolute inset-x-0.5" style={{ top, height }}>
      <div className={`h-full w-full overflow-hidden ${className}`}>
        <span className={`block truncate px-1 pt-0.5 text-[9px] leading-tight ${textClassName}`}>{label}</span>
      </div>
      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-pre rounded border border-cream/30 bg-ink px-2 py-1 text-[10px] leading-tight text-cream shadow-lg group-hover:block">
        {tooltip}
      </div>
    </div>
  );
}

// 同じ大項目・作業名の実績区間が間を空けず連続する場合のみ1つのブロックにまとめる
// (GanttSectionの1日表示と同じ考え方。日をまたぐ心配が無いので日付ごとに独立して処理する)
function mergeAdjacentSegments(
  flat: { start: number; end: number; category: string; name: string; ongoing: boolean }[]
): { start: number; end: number; category: string; name: string; ongoing: boolean }[] {
  const sorted = [...flat].sort((a, b) => a.start - b.start);
  const merged: typeof sorted = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.category === iv.category && last.name === iv.name) {
      last.end = Math.max(last.end, iv.end);
      last.ongoing = iv.ongoing;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

// ガントチャートを、Googleカレンダーの週表示のように「曜日を列・時刻を縦軸」にして見せる
// 代替ビュー。1日表示(GanttSection本体)の詳細な予定/予測バーとは違い、実績とカレンダー予定
// インポート分だけを、実際の時刻に沿って一目で見渡せることを目的にした簡易な表示にする
export default function GanttWeekView({
  anchorDate,
  onSelectDate,
  onShiftWeek,
}: {
  anchorDate: string;
  onSelectDate: (date: string) => void;
  onShiftWeek: (deltaDays: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const [weekViewMode] = useSetting("calendar.weekViewMode", "fixedStart");
  const [weekStartDayStr] = useSetting("calendar.weekStartDay", "0");
  const weekStartDay = Number(weekStartDayStr);
  const { themedMode } = useVisualMode();
  const gridRef = useRef<HTMLDivElement>(null);

  // タッチパネルの2本指ピンチで時間軸の縦の詰まり具合(hourPx)を拡大縮小する
  usePinchZoom(gridRef, (factor) => {
    setHourPx((v) => Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, Math.round(v * factor))));
  });
  // 1本指の横スワイプで前の週・次の週へ移動する(このグリッドは横スクロールしないため常に発火する)
  useSwipeNavigate(gridRef, {
    onSwipeLeft: () => onShiftWeek(7),
    onSwipeRight: () => onShiftWeek(-7),
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const weekDays = useMemo(() => {
    const anchor = new Date(anchorDate + "T00:00:00");
    return buildWeekGrid(anchor, weekViewMode as WeekViewMode, weekStartDay);
  }, [anchorDate, weekViewMode, weekStartDay]);
  const weekDateStrs = useMemo(() => weekDays.map((d) => todayStr(d)), [weekDays]);
  const weekDateStrsKey = weekDateStrs.join(",");
  const todayDateStr = todayStr(new Date(now));

  const weekTasks = useLiveQuery(() => db.dailyTasks.where("date").anyOf(weekDateStrs).toArray(), [weekDateStrsKey]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, DailyTask[]>();
    for (const t of weekTasks ?? []) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date)!.push(t);
    }
    return map;
  }, [weekTasks]);

  // 各日の実績区間・カレンダー予定を、その日の0時からの経過時間(小数の時)に変換してブロック化する
  const blocksByDate = useMemo(() => {
    const map = new Map<string, WeekBlock[]>();
    for (const ds of weekDateStrs) {
      const dayBase = new Date(ds + "T00:00:00").getTime();
      const tasks = tasksByDate.get(ds) ?? [];
      const flatSegments: { start: number; end: number; category: string; name: string; ongoing: boolean }[] = [];
      for (const t of tasks) {
        for (const seg of t.segments) {
          const end = seg.end ?? now;
          if (end <= seg.start) continue;
          flatSegments.push({ start: seg.start, end, category: t.category, name: t.name, ongoing: seg.end === undefined });
        }
      }
      const merged = mergeAdjacentSegments(flatSegments);
      const blocks: WeekBlock[] = merged.map((seg, i) => {
        const task = tasks.find((t) => t.category === seg.category && t.name === seg.name);
        const overPlan =
          !!task &&
          task.estimatedSeconds > 0 &&
          (task.status === "done" || task.status === "paused") &&
          (seg.end - seg.start) / 1000 > task.estimatedSeconds;
        return {
          key: `actual-${ds}-${i}`,
          taskName: seg.name,
          category: seg.category,
          startHour: (seg.start - dayBase) / 3600000,
          endHour: (seg.end - dayBase) / 3600000,
          ongoing: seg.ongoing,
          overPlan,
          kind: "actual",
        };
      });
      for (const t of tasks) {
        if (!t.scheduledTime) continue;
        const [hh, mm] = t.scheduledTime.split(":").map(Number);
        const startHour = hh + mm / 60;
        const durHour = Math.max(t.estimatedSeconds / 3600, 1 / 60);
        blocks.push({
          key: `sched-${t.id}`,
          taskName: t.name,
          category: t.category,
          startHour,
          endHour: startHour + durHour,
          ongoing: false,
          overPlan: false,
          kind: "scheduled",
        });
      }
      map.set(ds, blocks);
    }
    return map;
  }, [weekDateStrs, tasksByDate, now]);

  // 表示する時間範囲: 週内の全ブロック(+今日なら現在時刻)を包む範囲に自動フィットする。
  // データが無ければ朝〜夜(6-22時)を既定にする
  const { startHour, endHour } = useMemo(() => {
    let min = DEFAULT_START_HOUR;
    let max = DEFAULT_END_HOUR;
    let hasData = false;
    for (const blocks of blocksByDate.values()) {
      for (const b of blocks) {
        if (!hasData) {
          min = b.startHour;
          max = b.endHour;
          hasData = true;
        } else {
          min = Math.min(min, b.startHour);
          max = Math.max(max, b.endHour);
        }
      }
    }
    if (weekDateStrs.includes(todayDateStr)) {
      const nowHour = (now - new Date(todayDateStr + "T00:00:00").getTime()) / 3600000;
      min = Math.min(min, nowHour);
      max = Math.max(max, nowHour);
    }
    min = Math.max(0, Math.floor(Math.min(min, DEFAULT_START_HOUR)));
    max = Math.min(24, Math.ceil(Math.max(max, DEFAULT_END_HOUR)));
    if (max - min < 8) max = Math.min(24, min + 8);
    return { startHour: min, endHour: max };
  }, [blocksByDate, weekDateStrs, todayDateStr, now]);

  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const totalHeight = (endHour - startHour) * hourPx;
  const nowHourToday = (now - new Date(todayDateStr + "T00:00:00").getTime()) / 3600000;
  const showNowLine = weekDateStrs.includes(todayDateStr) && nowHourToday >= startHour && nowHourToday <= endHour;

  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-end gap-1">
        <button
          className="btn-pill-outline px-3 py-1 text-sm"
          onClick={() => setHourPx((v) => Math.max(MIN_HOUR_PX, Math.round(v / 1.3)))}
          aria-label="縮小"
        >
          －
        </button>
        <button
          className="btn-pill-outline px-3 py-1 text-sm"
          onClick={() => setHourPx((v) => Math.min(MAX_HOUR_PX, Math.round(v * 1.3)))}
          aria-label="拡大"
        >
          ＋
        </button>
      </div>
      <div className="flex">
        <div className="w-12 shrink-0 sm:w-14" />
        <div className="flex flex-1">
          {weekDays.map((d, i) => {
            const ds = weekDateStrs[i];
            const isToday = ds === todayDateStr;
            return (
              <button
                key={ds}
                onClick={() => onSelectDate(ds)}
                className={`flex-1 rounded-lg px-1 py-1.5 text-center text-xs transition-colors hover:bg-cream/10 ${
                  isToday ? "bg-cream/15 font-bold text-cream" : "text-cream/70"
                }`}
              >
                <div className="text-[10px] text-cream/50">{DOW_LABELS[d.getDay()]}</div>
                <div className="tabular-nums">{d.getDate()}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={gridRef} className="mt-2 flex max-h-[560px] overflow-y-auto border-t border-cream/10 pt-2">
        <div className="w-12 shrink-0 sm:w-14">
          {hours.map((h) => (
            <div key={h} className="relative text-right text-[10px] text-cream/40" style={{ height: hourPx }}>
              <span className="absolute -top-2 right-1">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
        <div className="relative flex flex-1" style={{ height: totalHeight }}>
          <div className="pointer-events-none absolute inset-0">
            {hours.map((h, i) => (
              <div key={h} className="absolute left-0 right-0 border-t border-cream/[0.06]" style={{ top: i * hourPx }} />
            ))}
            {showNowLine && (
              <div className="absolute left-0 right-0 z-10 flex items-center" style={{ top: (nowHourToday - startHour) * hourPx }}>
                <div className="h-2 w-2 shrink-0 rounded-full bg-alert" />
                <div className="h-px flex-1 bg-alert/70" />
              </div>
            )}
          </div>
          {weekDateStrs.map((ds, i) => (
            <div key={ds} className={`relative flex-1 ${i > 0 ? "border-l border-cream/[0.06]" : ""}`}>
              {(blocksByDate.get(ds) ?? []).map((b) => {
                const top = Math.max(0, (b.startHour - startHour) * hourPx);
                const height = Math.max((b.endHour - b.startHour) * hourPx, MIN_BLOCK_PX);
                const dayBase = new Date(ds + "T00:00:00").getTime();
                const tooltip =
                  b.kind === "scheduled"
                    ? `${b.taskName}（カレンダー予定）\n${b.category}\n${formatClock(
                        dayBase + b.startHour * 3600000
                      )} 〜 見込み ${formatHms(Math.max((b.endHour - b.startHour) * 3600, 0))}`
                    : `${b.taskName}（実績）\n${b.category}\n${formatClock(dayBase + b.startHour * 3600000)} 〜 ${
                        b.ongoing ? "計測中" : formatClock(dayBase + b.endHour * 3600000)
                      }`;
                // bg-creamは明るい背景色のため、通常の実績ブロックだけラベルを暗い文字色にする
                // (超過=bg-alert・カレンダー予定=bg-ink/60はどちらも暗い背景なのでcreamの明るい文字のまま)
                const isLightBackground = b.kind === "actual" && !b.overPlan;
                return (
                  <WeekBlockBar
                    key={b.key}
                    top={top}
                    height={height}
                    label={b.taskName}
                    tooltip={tooltip}
                    textClassName={isLightBackground ? "text-ink/90" : "text-cream/90"}
                    className={
                      b.kind === "scheduled"
                        ? "rounded border-2 border-cream/70 bg-ink/60"
                        : `rounded ${b.overPlan ? `bg-alert ${themedMode ? ganttOverrunClass(themedMode) : ""}` : "bg-cream"} opacity-90`
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-cream/60">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-cream" /> 実績
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-alert" /> 実績（超過）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border-2 border-cream/70 bg-ink/60" /> カレンダー予定（実時刻）
        </span>
        <span className="text-cream/40">
          日付・ブロックをタップすると1日表示に切り替わります／2本指ピンチで拡大縮小、左右スワイプで前後の週へ移動できます
        </span>
      </div>
    </div>
  );
}
