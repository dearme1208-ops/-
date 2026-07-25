"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatHms, todayStr } from "@/lib/time";

const PX_PER_MIN = 6;
const ROW_H = 46;

function baseEightAm(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 8, 0, 0).getTime();
}

export default function GanttSection() {
  const [date, setDate] = useState(todayStr());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).sortBy("order"), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const masterMap = useMemo(() => new Map((masterTasks ?? []).map((m) => [m.id, m])), [masterTasks]);

  const rows = useMemo(() => {
    if (!tasks) return [];
    const base = baseEightAm(date);
    let cursor = 0; // minutes from 8:00
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
  }, [tasks, masterMap, date, now]);

  const totalMinutes = Math.max(
    ...rows.map((r) => r.scheduledStartMin + Math.max(r.task.estimatedSeconds, r.predictedSeconds) / 60),
    (rows.at(-1)?.actualStartMin ?? 0) + (rows.at(-1)?.actualSeconds ?? 0) / 60,
    480
  );
  const hourMarks = Array.from({ length: Math.ceil(totalMinutes / 60) + 1 }, (_, i) => i);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-cream/70">日付</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
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
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: Math.max(totalMinutes * PX_PER_MIN + 40, 320) }}>
            {/* axis */}
            <div className="relative mb-2 h-6 border-b border-cream/20 text-xs text-cream/50">
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className="absolute top-0 border-l border-cream/10 pl-1"
                  style={{ left: h * 60 * PX_PER_MIN }}
                >
                  {String(8 + h).padStart(2, "0")}:00
                </div>
              ))}
            </div>

            <div className="relative" style={{ height: rows.length * ROW_H }}>
              {hourMarks.map((h) => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-l border-cream/5"
                  style={{ left: h * 60 * PX_PER_MIN }}
                />
              ))}
              {rows.map((r, idx) => {
                const top = idx * ROW_H;
                const planLeft = r.scheduledStartMin * PX_PER_MIN;
                const planWidth = Math.max((r.task.estimatedSeconds / 60) * PX_PER_MIN, 3);
                const predWidth = Math.max((r.predictedSeconds / 60) * PX_PER_MIN, 3);
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
                          left: r.actualStartMin * PX_PER_MIN,
                          width: Math.max((r.actualSeconds / 60) * PX_PER_MIN, 3),
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
