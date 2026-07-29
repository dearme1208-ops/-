"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatClock, formatHms, todayStr } from "@/lib/time";

const DEFAULT_PX_PER_MIN = 6;
const MIN_PX_PER_MIN = 0.05;
const MAX_PX_PER_MIN = 24;
const ROW_H_OVERLAP = 46;
const ROW_H_STACKED = 64;
const DAY_MINUTES = 24 * 60;

type RangeMode = "auto" | "24h";

function baseAtHour(dateStr: string, hour: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).getTime();
}

export default function GanttSection() {
  const [date, setDate] = useState(todayStr());
  const [now, setNow] = useState(() => Date.now());
  const [pxPerMin, setPxPerMin] = useState(DEFAULT_PX_PER_MIN);
  const [startHourStr, setStartHourStr] = useSetting("gantt.startHour", "8");
  const [rangeMode, setRangeMode] = useSetting("gantt.rangeMode", "auto");
  const [stackBarsStr, setStackBarsStr] = useSetting("gantt.stackBars", "false");
  const [compactViewStr, setCompactViewStr] = useSetting("gantt.compactView", "false");
  const scrollRef = useRef<HTMLDivElement>(null);

  const startHour = Math.min(23, Math.max(0, Number(startHourStr) || 0));
  const stackBars = stackBarsStr === "true";
  const compactView = compactViewStr === "true";
  const ROW_H = compactView ? ROW_H_OVERLAP : stackBars ? ROW_H_STACKED : ROW_H_OVERLAP;
  const planBarTop = stackBars ? 15 : 14;
  const planBarHeight = stackBars ? 14 : 20;
  const actualBarTop = stackBars ? 31 : 14;
  const actualBarHeight = stackBars ? 14 : 20;
  const endLabelTop = stackBars ? 47 : 34;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).sortBy("order"), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const masterMap = useMemo(() => new Map((masterTasks ?? []).map((m) => [m.id, m])), [masterTasks]);

  // 予定バーの起点: 実際に最初に計測を開始した作業の開始時刻を優先し、
  // まだ何も開始していない日は「表示開始時刻」の設定にフォールバックする
  const timelineBase = useMemo(() => {
    if (tasks) {
      const starts = tasks.filter((t) => t.startedAt).map((t) => t.startedAt!);
      if (starts.length > 0) return Math.min(...starts);
    }
    return baseAtHour(date, startHour);
  }, [tasks, date, startHour]);

  const rows = useMemo(() => {
    if (!tasks) return [];
    let cursor = 0; // minutes from timelineBase
    const base = tasks.map((task) => {
      const predictedSeconds = task.masterTaskId ? masterMap.get(task.masterTaskId)?.estimatedSeconds ?? task.estimatedSeconds : task.estimatedSeconds;
      const layoutDurationMin = Math.max(task.estimatedSeconds, predictedSeconds) / 60;
      const scheduledStartMin = cursor;
      cursor += Math.max(layoutDurationMin, 1);

      let actualStartMin: number | null = null;
      let actualSeconds = 0;
      if (task.startedAt) {
        actualStartMin = (task.startedAt - timelineBase) / 60000;
        actualSeconds =
          task.status === "running"
            ? task.accumulatedMs / 1000 + (task.segments.find((s) => s.end === undefined) ? (now - task.segments[task.segments.length - 1].start) / 1000 : 0)
            : task.accumulatedMs / 1000;
      }

      return {
        task,
        predictedSeconds,
        scheduledStartMin,
        actualStartMin,
        actualSeconds,
      };
    });

    // 同じ大項目・詳細作業名を同日中に複数回登録した場合、超過判定は個々のインスタンス
    // 単体ではなく累計で行う。当日最初に登録されたインスタンスの想定時間を基準の
    // 想定枠とし、登録順に実績を積み上げて、基準を超えた時点以降を超過扱いにする
    const overPlanByTaskId = new Map<string, boolean>();
    const groups = new Map<string, typeof base>();
    for (const r of base) {
      const key = `${r.task.category}::${r.task.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => a.task.order - b.task.order);
      const totalBudget = sorted[0]?.task.estimatedSeconds ?? 0;
      let cumulative = 0;
      for (const r of sorted) {
        cumulative += r.actualSeconds;
        overPlanByTaskId.set(r.task.id, totalBudget > 0 && cumulative > totalBudget);
      }
    }

    return base.map((r) => ({ ...r, overPlan: overPlanByTaskId.get(r.task.id) ?? false }));
  }, [tasks, masterMap, now, timelineBase]);

  // 「予定・実績を1本ずつの行で表示」時、違う作業まで1本にまとめてしまうと
  // どれをどこまで行ったか分からなくなるため、異なる作業のバーは分けたまま表示する。
  // ただし「作業A→作業A→作業B」のように同じ大項目・作業名が連続する場合のみ、
  // その連続区間はまとめて1本のバーにする（間に別の作業を挟む場合はまとめない）
  const mergedActualIntervals = useMemo(() => {
    const withActual = rows.filter((r) => r.actualStartMin !== null && r.actualSeconds > 0);
    const merged: { start: number; end: number; category: string; name: string; overPlan: boolean }[] = [];
    for (const r of withActual) {
      const start = r.actualStartMin!;
      const end = start + r.actualSeconds / 60;
      const last = merged[merged.length - 1];
      if (last && last.category === r.task.category && last.name === r.task.name) {
        last.end = Math.max(last.end, end);
        last.overPlan = last.overPlan || r.overPlan;
      } else {
        merged.push({ start, end, category: r.task.category, name: r.task.name, overPlan: r.overPlan });
      }
    }
    return merged;
  }, [rows]);

  // 1本化しない通常表示では、登録順ではなく実際に作業を開始した順（未着手なら予定順）に
  // 並べることで、上から下に見ていくだけで1日の流れが分かるようにする
  const displayRows = useMemo(() => {
    return [...rows].sort((a, b) => (a.actualStartMin ?? a.scheduledStartMin) - (b.actualStartMin ?? b.scheduledStartMin));
  }, [rows]);

  const autoMinutes = Math.max(
    ...rows.map((r) => r.scheduledStartMin + Math.max(r.task.estimatedSeconds, r.predictedSeconds) / 60),
    (rows.at(-1)?.actualStartMin ?? 0) + (rows.at(-1)?.actualSeconds ?? 0) / 60,
    480
  );
  const totalMinutes = rangeMode === "24h" ? Math.max(DAY_MINUTES, autoMinutes) : autoMinutes;
  const hourMarks = Array.from({ length: Math.ceil(totalMinutes / 60) + 1 }, (_, i) => i);
  // ズームアウト時にラベルが重なって読めなくなるのを防ぐため、間引いて表示する
  const MIN_LABEL_SPACING_PX = 34;
  const labelStepHours = Math.max(1, Math.ceil(MIN_LABEL_SPACING_PX / (60 * pxPerMin)));
  // 時間線が1時間刻みで表示できるくらいズームしている時だけ、10分刻みの補助線を表示する
  const MIN_GRIDLINE_SPACING_PX = 4;
  const minuteStep = labelStepHours > 1 ? 0 : pxPerMin * 10 >= MIN_GRIDLINE_SPACING_PX ? 10 : pxPerMin * 30 >= MIN_GRIDLINE_SPACING_PX ? 30 : 0;
  const minuteMarks: number[] = [];
  if (minuteStep > 0) {
    for (let m = 0; m <= totalMinutes; m += minuteStep) {
      if (m % 60 !== 0) minuteMarks.push(m);
    }
  }

  function zoomIn() {
    setPxPerMin((v) => Math.min(MAX_PX_PER_MIN, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerMin((v) => Math.max(MIN_PX_PER_MIN, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const containerWidth = scrollRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0 || totalMinutes <= 0) return;
    const fit = Math.max(0, containerWidth - 40) / totalMinutes;
    setPxPerMin(Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, +fit.toFixed(3))));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-cream/70">日付</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomOut} aria-label="縮小">
            －
          </button>
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomIn} aria-label="拡大">
            ＋
          </button>
          <button className="btn-pill-outline text-xs" onClick={fitToView}>
            全体表示
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-cream/60">表示開始時刻（未着手の日のみ）</label>
          <select
            value={startHour}
            onChange={(e) => setStartHourStr(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={rangeMode === "auto" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setRangeMode("auto" satisfies RangeMode)}
          >
            作業に合わせる
          </button>
          <button
            className={rangeMode === "24h" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setRangeMode("24h" satisfies RangeMode)}
          >
            24時間表示
          </button>
        </div>
        {!compactView && (
          <label className="flex items-center gap-2 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={stackBars}
              onChange={(e) => setStackBarsStr(e.target.checked ? "true" : "false")}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            予定と実績を重ねずに表示
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-cream/60">
          <input
            type="checkbox"
            checked={compactView}
            onChange={(e) => setCompactViewStr(e.target.checked ? "true" : "false")}
            className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
          />
          予定・実績を1本ずつの行で表示
        </label>
      </div>

      <div className="panel flex p-4">
        {/* 固定ラベル列: 横スクロールしても常に見える */}
        <div className="w-32 shrink-0 pr-2 sm:w-44">
          <div className="mb-2 h-6 border-b border-cream/20" />
          {compactView ? (
            <>
              <div className="flex items-center text-[11px] font-bold text-cream/70" style={{ height: ROW_H }}>
                予定
              </div>
              <div className="flex items-center text-[11px] font-bold text-cream/70" style={{ height: ROW_H }}>
                実績
              </div>
            </>
          ) : (
            displayRows.map((r) => (
              <div
                key={r.task.id}
                className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70"
                style={{ height: ROW_H }}
                title={`${r.task.category} / ${r.task.name}`}
              >
                <span className="truncate text-cream/50">{r.task.category}</span>
                <span className="truncate">{r.task.name}</span>
              </div>
            ))
          )}
        </div>

        {/* スクロール可能なタイムライン */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: totalMinutes * pxPerMin + 40 }}>
            {/* axis */}
            <div className="relative mb-2 h-6 border-b border-cream/20 text-xs text-cream/50">
              {hourMarks
                .filter((h) => h % labelStepHours === 0)
                .map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 border-l border-cream/10 pl-1"
                    style={{ left: h * 60 * pxPerMin }}
                  >
                    {formatClock(timelineBase + h * 60 * 60000)}
                  </div>
                ))}
            </div>

            <div className="relative" style={{ height: (compactView ? 2 : rows.length) * ROW_H }}>
              {minuteMarks.map((m) => (
                <div
                  key={`m${m}`}
                  className="absolute top-0 bottom-0 border-l border-cream/[0.04]"
                  style={{ left: m * pxPerMin }}
                />
              ))}
              {hourMarks
                .filter((h) => h % labelStepHours === 0)
                .map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 border-l border-cream/5"
                    style={{ left: h * 60 * pxPerMin }}
                  />
                ))}
              {compactView ? (
                <>
                  {/* 予定行: 全作業の予定バーを1本の行にまとめて表示 */}
                  {rows.map((r) => {
                    const planLeft = r.scheduledStartMin * pxPerMin;
                    const planWidth = Math.max((r.task.estimatedSeconds / 60) * pxPerMin, 3);
                    const predWidth = Math.max((r.predictedSeconds / 60) * pxPerMin, 3);
                    const planEndMin = r.scheduledStartMin + r.task.estimatedSeconds / 60;
                    const planEndLabel = formatClock(timelineBase + planEndMin * 60000);
                    return (
                      <div key={`plan-${r.task.id}`} className="absolute left-0 right-0" style={{ top: 0, height: ROW_H }}>
                        <div
                          className="absolute whitespace-nowrap text-[10px] font-medium leading-3 text-cream/90"
                          style={{ left: planLeft + 2, top: 1 }}
                        >
                          {r.task.name}
                        </div>
                        <div
                          className="absolute rounded border border-dashed border-cream/50"
                          style={{ left: planLeft, width: predWidth, top: 14, height: 20 }}
                        />
                        <div
                          className="absolute rounded bg-cream/70"
                          style={{ left: planLeft, width: planWidth, top: 14, height: 20 }}
                          title={`${r.task.name} 予定 ${formatHms(r.task.estimatedSeconds)}`}
                        />
                        <div
                          className="absolute whitespace-nowrap text-[10px] leading-3 text-cream/60"
                          style={{ left: planLeft + planWidth + 3, top: 34 }}
                        >
                          {planEndLabel}
                        </div>
                      </div>
                    );
                  })}
                  {/* 実績行: 全作業の実績バーを1本の行にまとめて表示。
                      異なる作業は分けたまま、同じ作業が連続する場合のみ1本のバーにまとめる */}
                  {mergedActualIntervals.map((iv, idx) => {
                    const actualLeft = iv.start * pxPerMin;
                    const actualWidth = Math.max((iv.end - iv.start) * pxPerMin, 3);
                    const actualEndLabel = formatClock(timelineBase + iv.end * 60000);
                    const label = iv.name;
                    return (
                      <div key={`actual-${idx}`} className="absolute left-0 right-0" style={{ top: ROW_H, height: ROW_H }}>
                        <div
                          className="absolute whitespace-nowrap text-[10px] font-medium leading-3 text-cream/90"
                          style={{ left: actualLeft + 2, top: 1 }}
                        >
                          {label}
                        </div>
                        <div
                          className={`absolute rounded ${iv.overPlan ? "bg-alert" : "bg-cream"} opacity-90`}
                          style={{
                            left: actualLeft,
                            width: actualWidth,
                            top: 14,
                            height: 20,
                            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                          }}
                          title={`${label} 実績 ${formatHms((iv.end - iv.start) * 60)}`}
                        />
                        <div
                          className="absolute whitespace-nowrap text-[10px] leading-3 text-cream/60"
                          style={{ left: actualLeft + actualWidth + 3, top: 34 }}
                        >
                          {actualEndLabel}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                displayRows.map((r, idx) => {
                  const top = idx * ROW_H;
                  const planLeft = r.scheduledStartMin * pxPerMin;
                  const planWidth = Math.max((r.task.estimatedSeconds / 60) * pxPerMin, 3);
                  const predWidth = Math.max((r.predictedSeconds / 60) * pxPerMin, 3);
                                    const hasActual = r.actualStartMin !== null && r.actualSeconds > 0;
                  const nameLeft = hasActual ? r.actualStartMin! * pxPerMin : planLeft;
                  const endMin = hasActual ? r.actualStartMin! + r.actualSeconds / 60 : r.scheduledStartMin + r.task.estimatedSeconds / 60;
                  const endLeft = endMin * pxPerMin;
                  const endLabel = formatClock(timelineBase + endMin * 60000);
                  return (
                    <div key={r.task.id} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                      {/* 作業名ラベル */}
                      <div
                        className="absolute whitespace-nowrap text-[10px] font-medium leading-3 text-cream/90"
                        style={{ left: nameLeft + 2, top: 1 }}
                      >
                        {r.task.name}
                      </div>
                      {/* 予測枠（点線） */}
                      <div
                        className="absolute rounded border border-dashed border-cream/50"
                        style={{ left: planLeft, width: predWidth, top: planBarTop, height: planBarHeight }}
                      />
                      {/* 予定バー */}
                      <div
                        className="absolute rounded bg-cream/70"
                        style={{ left: planLeft, width: planWidth, top: planBarTop, height: planBarHeight }}
                      />
                      {/* 実績バー */}
                      {hasActual && (
                        <div
                          className={`absolute rounded ${r.overPlan ? "bg-alert" : "bg-cream"} opacity-90`}
                          style={{
                            left: r.actualStartMin! * pxPerMin,
                            width: Math.max((r.actualSeconds / 60) * pxPerMin, 3),
                            top: actualBarTop,
                            height: actualBarHeight,
                            boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                          }}
                          title={`実績 ${formatHms(r.actualSeconds)}`}
                        />
                      )}
                      {/* 終了時刻ラベル */}
                      <div
                        className="absolute whitespace-nowrap text-[10px] leading-3 text-cream/60"
                        style={{ left: endLeft + 3, top: endLabelTop }}
                      >
                        {endLabel}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-cream/60">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-cream/70" /> 予定</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-dashed border-cream/50" /> 予測</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-cream" /> 実績</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-alert" /> 実績（超過）</span>
      </div>

      {(!tasks || tasks.length === 0) && (
        <p className="text-sm text-cream/50">この日の作業リストがありません。</p>
      )}
    </div>
  );
}
