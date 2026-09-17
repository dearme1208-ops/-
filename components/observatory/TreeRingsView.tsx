"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatHms, todayStr } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";

// 1か月 = 1本の年輪。中心が一番古い月で、外側へ行くほど新しい。
// 年輪の太さ=その月の作業時間、色の濃さ=1日あたりの密度、
// 幹の傷=極端に長く働いた日があった月。木は削れない(過去の記録は書き換わらない)ので、
// 使い続けるほどこの断面figureだけが育っていく
const MIN_RING = 2.5;
const MAX_RING = 16;
const CORE_RADIUS = 10;
const MAX_MONTHS = 180; // 15年分。これ以上は中心側(最古)から丸めて省く

interface MonthRing {
  key: string; // YYYY-MM
  year: number;
  month: number;
  totalSeconds: number;
  workedDays: number;
  maxDaySeconds: number;
  lateNightSeconds: number;
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function buildMonths(records: WorkRecord[], today: string): MonthRing[] {
  if (records.length === 0) return [];
  const byMonth = new Map<string, { total: number; days: Map<string, number>; late: number }>();
  for (const r of records) {
    const key = monthKey(r.date);
    if (!byMonth.has(key)) byMonth.set(key, { total: 0, days: new Map(), late: 0 });
    const entry = byMonth.get(key)!;
    entry.total += r.seconds;
    entry.days.set(r.date, (entry.days.get(r.date) ?? 0) + r.seconds);
    // 「定時の外側で働いた分」の目安。20時以降に終わった作業と、6時より前に始めた作業を数える
    const startHour = new Date(r.startedAt).getHours();
    const endHour = new Date(r.endedAt).getHours();
    if (endHour >= 20 || startHour < 6) entry.late += r.seconds;
  }

  // 記録が1件も無い月も、薄い年輪として残す(使っていなかった時期そのものが記録になる)
  const first = [...byMonth.keys()].sort()[0];
  const [fy, fm] = first.split("-").map(Number);
  const [ty, tm] = today.slice(0, 7).split("-").map(Number);
  const out: MonthRing[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const e = byMonth.get(key);
    out.push({
      key,
      year: y,
      month: m,
      totalSeconds: e?.total ?? 0,
      workedDays: e ? e.days.size : 0,
      maxDaySeconds: e ? Math.max(0, ...e.days.values()) : 0,
      lateNightSeconds: e?.late ?? 0,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out.slice(-MAX_MONTHS);
}

export default function TreeRingsView() {
  const records = useLiveQuery(() => db.records.toArray(), []);
  const today = todayStr();
  const [hovered, setHovered] = useState<MonthRing | null>(null);

  const months = useMemo(() => buildMonths(records ?? [], today), [records, today]);

  const rings = useMemo(() => {
    if (months.length === 0) return [];
    const maxSeconds = Math.max(...months.map((m) => m.totalSeconds), 1);
    let radius = CORE_RADIUS;
    return months.map((m) => {
      // 太さは平方根で効かせる。線形だと忙しい月だけが極端に太くなり、
      // 静かな月がほとんど見えなくなってしまう
      const ratio = Math.sqrt(m.totalSeconds / maxSeconds);
      const width = MIN_RING + ratio * (MAX_RING - MIN_RING);
      const inner = radius;
      radius += width;
      return { month: m, inner, width, outer: radius };
    });
  }, [months]);

  const size = rings.length > 0 ? rings[rings.length - 1].outer * 2 + 24 : 100;
  const center = size / 2;

  const totalSeconds = months.reduce((s, m) => s + m.totalSeconds, 0);
  const busiest = months.reduce<MonthRing | null>((best, m) => (!best || m.totalSeconds > best.totalSeconds ? m : best), null);
  const scarCount = months.filter((m) => m.maxDaySeconds >= 12 * 3600).length;

  if (!records) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;
  if (months.length === 0) {
    return (
      <div className="panel p-6 text-center text-sm text-cream/50">
        まだ実績がありません。作業を記録すると、ここに最初の年輪が刻まれます。
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold">🪵 年輪</h3>
        <p className="text-xs text-cream/50">
          {months.length}か月 ・ 通算 {formatHms(totalSeconds)}
          {busiest && busiest.totalSeconds > 0 && `　最も太い年輪: ${busiest.year}年${busiest.month}月`}
          {scarCount > 0 && `　幹の傷 ${scarCount}箇所`}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 lg:flex-row lg:items-start">
        <div className="w-full max-w-[520px] shrink-0">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label="作業時間の年輪">
            <defs>
              <radialGradient id="tree-core">
                <stop offset="0%" stopColor="rgb(var(--cream-rgb) / 0.55)" />
                <stop offset="100%" stopColor="rgb(var(--cream-rgb) / 0.2)" />
              </radialGradient>
            </defs>
            {/* 樹皮(一番外側) */}
            <circle cx={center} cy={center} r={size / 2 - 6} fill="none" stroke="rgb(var(--cream-rgb) / 0.18)" strokeWidth={8} />
            {rings.map(({ month: m, inner, width }) => {
              const density = m.workedDays > 0 ? m.totalSeconds / m.workedDays / 3600 : 0; // 1日あたり時間
              const opacity = m.totalSeconds === 0 ? 0.07 : Math.min(0.85, 0.2 + density / 12);
              const lateRatio = m.totalSeconds > 0 ? m.lateNightSeconds / m.totalSeconds : 0;
              // 定時外の比率が高い月ほど、木肌が赤黒く焼ける
              const stroke =
                lateRatio > 0.25
                  ? `rgb(var(--accent-rgb) / ${Math.min(0.7, 0.25 + lateRatio * 0.6).toFixed(2)})`
                  : `rgb(var(--cream-rgb) / ${opacity.toFixed(2)})`;
              const isJanuary = m.month === 1;
              const scar = m.maxDaySeconds >= 12 * 3600;
              const r = inner + width / 2;
              return (
                <g key={m.key}>
                  <circle
                    cx={center}
                    cy={center}
                    r={r}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={Math.max(1, width - 1)}
                    onMouseEnter={() => setHovered(m)}
                    onMouseLeave={() => setHovered((h) => (h?.key === m.key ? null : h))}
                    style={{ cursor: "crosshair" }}
                  >
                    <title>{`${m.year}年${m.month}月 ・ ${formatHms(m.totalSeconds)} ・ ${m.workedDays}日稼働`}</title>
                  </circle>
                  {/* 年の変わり目に細い区切り線を入れて、何周目かを数えられるようにする */}
                  {isJanuary && (
                    <circle cx={center} cy={center} r={inner} fill="none" stroke="rgb(var(--cream-rgb) / 0.35)" strokeWidth={0.6} />
                  )}
                  {/* 12時間以上働いた日があった月は、幹に残る傷として上向きの切れ込みを描く */}
                  {scar && (
                    <line
                      x1={center}
                      y1={center - inner}
                      x2={center}
                      y2={center - inner - width}
                      stroke="rgb(var(--accent-rgb))"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}
            <circle cx={center} cy={center} r={CORE_RADIUS} fill="url(#tree-core)" />
          </svg>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="rounded-lg border border-cream/15 bg-ink/40 p-3">
            {hovered ? (
              <>
                <p className="font-display text-sm font-bold text-cream">
                  {hovered.year}年{hovered.month}月
                </p>
                <p className="mt-1 text-xs text-cream/70">
                  作業時間 {formatHms(hovered.totalSeconds)} ・ 稼働 {hovered.workedDays}日
                </p>
                <p className="text-xs text-cream/50">
                  最長の1日 {formatHms(hovered.maxDaySeconds)}
                  {hovered.maxDaySeconds >= 12 * 3600 && "（この月は幹に傷が残っています）"}
                </p>
                {hovered.lateNightSeconds > 0 && (
                  <p className="text-xs text-cream/50">定時外 {formatHms(hovered.lateNightSeconds)}</p>
                )}
              </>
            ) : (
              <p className="text-xs text-cream/40">年輪にカーソルを合わせると、その月の内訳が出ます。</p>
            )}
          </div>
          <ul className="space-y-1 text-[11px] leading-relaxed text-cream/40">
            <li>・中心が一番古い月。外側へ1周ずつ新しくなります</li>
            <li>・年輪の太さ = その月の作業時間</li>
            <li>・色の濃さ = 1日あたりの密度。薄い層は記録の無かった月</li>
            <li>・赤く焼けた層 = 定時外の作業が多かった月</li>
            <li>・上向きの切れ込み = 12時間以上働いた日があった月の傷</li>
            <li>・細い区切り線 = 1月(年の変わり目)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
