"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatHms, todayStr } from "@/lib/time";

const DEFAULT_PX_PER_MIN = 6;
const MIN_PX_PER_MIN = 1;
const MAX_PX_PER_MIN = 24;
const ROW_H = 46;
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
  const scrollRef = useRef<HTMLDivElement>(null);

  const startHour = Math.min(23, Math.max(0, Number(startHourStr) || 0));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).sortBy("order"), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const masterMap = useMemo(() => new Map((masterTasks ?? []).map((m) => [m.id, m])), [masterTasks]);

  const rows = useMemo(() => {
    if (!tasks) return [];
    const base = baseAtHour(date, startHour);
    let cursor = 0; // minutes from startHour
    return tasks.map((task) => {
      const predictedSeconds = task.masterTaskId ? masterMap.get(task.masterTaskId)?.estimatedSeconds ?? task.estimatedSeconds : task.estimatedSeconds;
      const layoutDurationMin = Math.max(task.estimatedSeconds, predictedSeconds) / 60;
      const scheduledStartMin = cursor;
      cursor += Math.max(layoutDurationMin, 1);

      let actualStartMin: number | null = null;
      let actualSeconds = 0;
      if (task.startedAt) {
        actualStartMin = (task.startedAt - base) / 60000;
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
  }, [tasks, masterMap, date, now, startHour]);

  const autoMinutes = Math.max(
    ...rows.map((r) => r.scheduledStartMin + Math.max(r.task.estimatedSeconds, r.predictedSeconds) / 60),
    (rows.at(-1)?.actualStartMin ?? 0) + (rows.at(-1)?.actualSeconds ?? 0) / 60,
    480
  );
  const totalMinutes = rangeMode === "24h" ? Math.max(DAY_MINUTES, autoMinutes) : autoMinutes;
  const hourMarks = Array.from({ length: Math.ceil(totalMinutes / 60) + 1 }, (_, i) => i);

  function zoomIn() {
    setPxPerMin((v) => Math.min(MAX_PX_PER_MIN, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerMin((v) => Math.max(MIN_PX_PER_MIN, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const containerWidth = scrollRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0 || totalMinutes <= 0) return;
    const fit = containerWidth / totalMinutes;
    setPxPerMin(Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, +fit.toFixed(2))));
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
          <label className="text-xs text-cream/60">表示開始時刻</label>
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
      </div>

      <div className="panel flex p-4">
        {/* 固定ラベル列: 横スクロールしても常に見える */}
        <div className="w-32 shrink-0 pr-2 sm:w-44">
          <div className="mb-2 h-6 border-b border-cream/20" />
          {rows.map((r) => (
            <div
              key={r.task.id}
              className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70"
              style={{ height: ROW_H }}
              title={`${r.task.category} / ${r.task.name}`}
            >
              <span className="truncate text-cream/50">{r.task.category}</span>
              <span className="truncate">{r.task.name}</span>
            </div>
          ))}
        </div>

        {/* スクロール可能なタイムライン */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: Math.max(totalMinutes * pxPerMin + 40, 320) }}>
            {/* axis */}
            <div className="relative mb-2 h-6 border-b border-cream/20 text-xs text-cream/50">
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className="absolute top-0 border-l border-cream/10 pl-1"
                  style={{ left: h * 60 * pxPerMin }}
                >
                  {String((startHour + h) % 24).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: rows.length * ROW_H }}>
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-cream/5"
                  style={{ left: h * 60 * pxPerMin }}
                />
              ))}
              {rows.map((r, idx) => {
                const top = idx * ROW_H;
                const planLeft = r.scheduledStartMin * pxPerMin;
                const planWidth = Math.max((r.task.estimatedSeconds / 60) * pxPerMin, 3);
                const predWidth = Math.max((r.predictedSeconds / 60) * pxPerMin, 3);
                const overPlan = r.task.estimatedSeconds > 0 && r.actualSeconds > r.task.estimatedSeconds;
                return (
                  <div key={r.task.id} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                    {/* 予測枠（点線） */}
                    <div
                      className="absolute rounded border border-dashed border-cream/50"
                      style={{ left: planLeft, width: predWidth, top: 14, height: 20 }}
                    />
                    {/* 予定バー */}
                    <div
                      className="absolute rounded bg-cream/70"
                      style={{ left: planLeft, width: planWidth, top: 14, height: 20 }}
                    />
                    {/* 実績バー */}
                    {r.actualStartMin !== null && r.actualSeconds > 0 && (
                      <div
                        className={`absolute rounded ${overPlan ? "bg-alert" : "bg-cream"} opacity-90`}
                        style={{
                          left: r.actualStartMin * pxPerMin,
                          width: Math.max((r.actualSeconds / 60) * pxPerMin, 3),
                          top: 14,
                          height: 20,
                          boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
                        }}
                        title={`実績 ${formatHms(r.actualSeconds)}`}
                      />
                    )}
                  </div>
                );
              })}
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
