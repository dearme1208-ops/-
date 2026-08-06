"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatHms } from "@/lib/time";
import { computeHourDowMatrix } from "@/lib/heatmap";
import { computeCalendarHeatmap, heatLevel } from "@/lib/calendarHeatmap";

const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const CALENDAR_LEVEL_OPACITY = [0.04, 0.22, 0.42, 0.64, 0.9];

type SortKey = "name" | "total" | "count";
type ViewMode = "category" | "hour" | "calendar";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "名前順" },
  { key: "total", label: "合計時間順" },
  { key: "count", label: "実績件数順" },
];

export default function HeatmapSection() {
  const [viewMode, setViewMode] = useState<ViewMode>("category");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const records = useLiveQuery(() => db.records.toArray(), []);

  const hourMatrix = useMemo(
    () => computeHourDowMatrix((records ?? []).filter((r) => !r.excludedFromStats)),
    [records]
  );

  function hourCellColor(value: number): string {
    if (hourMatrix.max === 0 || value === 0) return "rgba(233,230,189,0.04)";
    const ratio = Math.min(1, value / hourMatrix.max);
    return `rgb(var(--accent-rgb) / ${0.08 + ratio * 0.72})`;
  }

  const calendarData = useMemo(
    () => computeCalendarHeatmap((records ?? []).filter((r) => !r.excludedFromStats)),
    [records]
  );
  const calendarByWeek = useMemo(() => {
    const weeks: (typeof calendarData.days)[number][][] = Array.from({ length: calendarData.weekCount }, () => []);
    for (const d of calendarData.days) weeks[d.weekIndex].push(d);
    return weeks;
  }, [calendarData]);

  const { categories, matrix, totals, counts, max } = useMemo(() => {
    const cats = new Set<string>();
    const m = new Map<string, number[]>(); // category -> [7 values]
    const totalMap = new Map<string, number>();
    const countMap = new Map<string, number>();
    let maxVal = 0;
    for (const r of records ?? []) {
      if (r.excludedFromStats) continue;
      cats.add(r.category);
      if (!m.has(r.category)) m.set(r.category, new Array(7).fill(0));
      const dow = new Date(r.date + "T12:00:00").getDay();
      const arr = m.get(r.category)!;
      arr[dow] += r.seconds;
      maxVal = Math.max(maxVal, arr[dow]);
      totalMap.set(r.category, (totalMap.get(r.category) ?? 0) + r.seconds);
      countMap.set(r.category, (countMap.get(r.category) ?? 0) + 1);
    }

    const sorted = [...cats].sort((a, b) => {
      if (sortKey === "total") return (totalMap.get(b) ?? 0) - (totalMap.get(a) ?? 0);
      if (sortKey === "count") return (countMap.get(b) ?? 0) - (countMap.get(a) ?? 0);
      return a.localeCompare(b, "ja");
    });

    return { categories: sorted, matrix: m, totals: totalMap, counts: countMap, max: maxVal };
  }, [records, sortKey]);

  function cellColor(value: number): string {
    if (max === 0 || value === 0) return "rgba(233,230,189,0.04)";
    const ratio = Math.min(1, value / max);
    return `rgb(var(--accent-rgb) / ${0.08 + ratio * 0.72})`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={viewMode === "category" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setViewMode("category")}
        >
          区分×曜日
        </button>
        <button
          className={viewMode === "hour" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setViewMode("hour")}
        >
          時間帯×曜日
        </button>
        <button
          className={viewMode === "calendar" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setViewMode("calendar")}
        >
          年間カレンダー
        </button>
      </div>

      {viewMode === "category" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-cream/50">並び替え:</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={sortKey === opt.key ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {viewMode === "hour" && (
        <div className="panel overflow-x-auto p-4">
          <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="text-left text-xs text-cream/50">時間帯 ＼ 曜日</th>
                {DOW_LABELS.map((d) => (
                  <th key={d} className="w-14 text-center text-xs text-cream/50">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => (
                <tr key={hour}>
                  <td className="whitespace-nowrap pr-2 text-xs text-cream/70">
                    {String(hour).padStart(2, "0")}:00
                  </td>
                  {DOW_LABELS.map((_, dow) => {
                    const v = hourMatrix.matrix[dow][hour];
                    return (
                      <td
                        key={dow}
                        className="rounded-md text-center text-[10px] tabular-nums text-cream/90"
                        style={{ backgroundColor: hourCellColor(v), height: 26 }}
                        title={formatHms(v)}
                      >
                        {v > 0 ? formatHms(v) : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {hourMatrix.max === 0 && <p className="py-6 text-sm text-cream/50">データがありません。</p>}
        </div>
      )}

      {viewMode === "calendar" && (
        <div className="panel overflow-x-auto p-4">
          <div className="inline-flex gap-[3px]">
            {calendarByWeek.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((d) => (
                  <div
                    key={d.date}
                    className="h-[11px] w-[11px] rounded-sm"
                    style={{
                      backgroundColor:
                        d.seconds > 0
                          ? `rgb(var(--accent-rgb) / ${CALENDAR_LEVEL_OPACITY[heatLevel(d.seconds, calendarData.maxSeconds)]})`
                          : "rgba(233,230,189,0.06)",
                    }}
                    title={`${d.date}: ${formatHms(d.seconds)}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-cream/40">
            少ない
            {CALENDAR_LEVEL_OPACITY.map((op, i) => (
              <div
                key={i}
                className="h-[11px] w-[11px] rounded-sm"
                style={{ backgroundColor: i === 0 ? "rgba(233,230,189,0.06)" : `rgb(var(--accent-rgb) / ${op})` }}
              />
            ))}
            多い
          </div>
        </div>
      )}

      {viewMode === "category" && (
      <div className="panel overflow-x-auto p-4">
        <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="text-left text-xs text-cream/50">区分 ＼ 曜日</th>
              {DOW_LABELS.map((d) => (
                <th key={d} className="w-16 text-center text-xs text-cream/50">
                  {d}
                </th>
              ))}
              <th className="w-20 text-center text-xs text-cream/50">合計</th>
              <th className="w-12 text-center text-xs text-cream/50">件数</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat}>
                <td className="whitespace-nowrap pr-2 text-cream">{cat}</td>
                {matrix.get(cat)!.map((v, dow) => (
                  <td
                    key={dow}
                    className="rounded-md text-center text-[11px] tabular-nums text-cream/90"
                    style={{ backgroundColor: cellColor(v), height: 40 }}
                    title={formatHms(v)}
                  >
                    {v > 0 ? formatHms(v) : ""}
                  </td>
                ))}
                <td className="text-center text-xs tabular-nums text-cream/70">{formatHms(totals.get(cat) ?? 0)}</td>
                <td className="text-center text-xs tabular-nums text-cream/70">{counts.get(cat) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {categories.length === 0 && <p className="py-6 text-sm text-cream/50">データがありません。</p>}
      </div>
      )}
    </div>
  );
}
