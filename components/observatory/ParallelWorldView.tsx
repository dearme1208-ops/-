"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatDateJp, formatHms, parseHourStr, shiftDateStr, todayStr } from "@/lib/time";

// 「毎営業日きっちり定時分だけ働いた並行世界の自分」と、現実の自分の累積を並べる観測法。
// 責めるためではなく、差が開いた場所と縮まった場所を正確に見るためのもの。
// 理想線は設定の標準勤務時間(定時)からそのまま引くので、非現実的な目標にはならない
const RANGE_OPTIONS = [
  { key: "30", label: "30日", days: 30 },
  { key: "90", label: "90日", days: 90 },
  { key: "180", label: "半年", days: 180 },
];

export default function ParallelWorldView() {
  const today = todayStr();
  const [rangeKey, setRangeKey] = useState("30");
  const [includeWeekend, setIncludeWeekend] = useState(false);
  const [standardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [standardWorkEnd] = useSetting("today.standardWorkEnd", "17:00");
  const records = useLiveQuery(() => db.records.toArray(), []);

  const days = RANGE_OPTIONS.find((r) => r.key === rangeKey)?.days ?? 30;
  const standardSeconds = Math.max(
    3600,
    (parseHourStr(standardWorkEnd, 17) - parseHourStr(standardWorkStart, 8)) * 3600
  );

  const series = useMemo(() => {
    const start = shiftDateStr(today, -(days - 1));
    const byDate = new Map<string, number>();
    for (const r of records ?? []) {
      if (r.date < start || r.date > today) continue;
      byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
    }
    let actual = 0;
    let ideal = 0;
    const points: { date: string; actual: number; ideal: number; dayActual: number; isWorkday: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const date = shiftDateStr(start, i);
      const dow = new Date(date + "T00:00:00").getDay();
      const isWorkday = includeWeekend || (dow !== 0 && dow !== 6);
      const dayActual = byDate.get(date) ?? 0;
      actual += dayActual;
      if (isWorkday) ideal += standardSeconds;
      points.push({ date, actual, ideal, dayActual, isWorkday });
    }
    return points;
  }, [records, today, days, includeWeekend, standardSeconds]);

  const last = series[series.length - 1];
  const gap = last ? last.actual - last.ideal : 0;
  const maxValue = Math.max(1, ...series.map((p) => Math.max(p.actual, p.ideal)));

  // 差が最も開いた日 / 最も縮まった日を拾う(どこで離され、どこで追い上げたか)
  const widest = series.reduce((best, p) => (p.actual - p.ideal < best.actual - best.ideal ? p : best), series[0]);
  const bestDay = series.reduce((best, p) => (p.dayActual > best.dayActual ? p : best), series[0]);

  const W = 900;
  const H = 260;
  const PAD_L = 52;
  const PAD_B = 24;
  const x = (i: number) => PAD_L + (i / Math.max(1, series.length - 1)) * (W - PAD_L - 12);
  const y = (v: number) => H - PAD_B - (v / maxValue) * (H - PAD_B - 12);

  if (!records) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;

  const actualPath = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.actual)}`).join(" ");
  const idealPath = series.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.ideal)}`).join(" ");
  const areaPath = `${actualPath} L ${x(series.length - 1)} ${y(series[series.length - 1].ideal)} ${series
    .slice()
    .reverse()
    .map((p, ri) => `L ${x(series.length - 1 - ri)} ${y(p.ideal)}`)
    .join(" ")} Z`;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold">🌓 並行世界</h3>
        <div className="flex flex-wrap items-center gap-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              className={rangeKey === r.key ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={includeWeekend}
              onChange={(e) => setIncludeWeekend(e.target.checked)}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            土日も理想に含める
          </label>
        </div>
      </div>

      <div
        className={`mb-3 rounded-lg border p-3 ${
          gap >= 0 ? "border-cream/30 bg-cream/5" : "border-alert/40 bg-alert/5"
        }`}
      >
        <p className="text-sm">
          {gap >= 0 ? (
            <>
              現実のあなたは、並行世界の自分より{" "}
              <span className="font-display text-lg font-bold text-cream">{formatHms(gap)}</span> 先にいます。
            </>
          ) : (
            <>
              並行世界の自分は、今のあなたより{" "}
              <span className="font-display text-lg font-bold text-alert">{formatHms(-gap)}</span> 先にいます。
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-cream/50">
          この{days}日間の実績 {formatHms(last?.actual ?? 0)} ／ 定時どおりに働いた場合 {formatHms(last?.ideal ?? 0)}
          （1営業日 = {formatHms(standardSeconds)}）
        </p>
      </div>

      <div className="overflow-x-auto">
        <svg width={W} height={H} className="block min-w-[640px]" role="img" aria-label="理想と現実の累積作業時間">
          {/* 目盛り */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={PAD_L} y1={y(maxValue * f)} x2={W - 12} y2={y(maxValue * f)} stroke="rgb(var(--cream-rgb) / 0.1)" strokeWidth={1} />
              <text x={4} y={y(maxValue * f) + 3} fontSize={9} fill="rgb(var(--cream-rgb) / 0.4)">
                {Math.round((maxValue * f) / 3600)}h
              </text>
            </g>
          ))}
          {/* 差の面積 */}
          <path d={areaPath} fill={gap >= 0 ? "rgb(var(--cream-rgb) / 0.12)" : "rgb(var(--accent-rgb) / 0.14)"} />
          {/* 理想(並行世界) */}
          <path d={idealPath} fill="none" stroke="rgb(var(--cream-rgb) / 0.55)" strokeWidth={1.6} strokeDasharray="5 4" />
          {/* 現実 */}
          <path d={actualPath} fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth={2.4} />
          {/* 日付ラベル(両端と中央) */}
          {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="rgb(var(--cream-rgb) / 0.45)">
              {formatDateJp(series[i].date)}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-cream/55">
        <span>
          <span className="mr-1 inline-block h-[2px] w-4 align-middle" style={{ backgroundColor: "rgb(var(--accent-rgb))" }} />
          現実の累積
        </span>
        <span>
          <span className="mr-1 inline-block h-[2px] w-4 border-t border-dashed border-cream/60 align-middle" />
          並行世界（定時どおり）
        </span>
      </div>

      {widest && bestDay && (
        <p className="mt-2 text-[11px] leading-relaxed text-cream/45">
          最も引き離されたのは {formatDateJp(widest.date)}（差 {formatHms(Math.abs(widest.actual - widest.ideal))}）。
          最も追い上げたのは {formatDateJp(bestDay.date)} の {formatHms(bestDay.dayActual)}。
        </p>
      )}
    </div>
  );
}
