"use client";

import { useState } from "react";
import type { TrendPoint } from "@/lib/trend";

const CHART_H = 160;
const LABEL_H = 16;
const BAR_AREA_H = CHART_H - LABEL_H;
const BAR_MAX_W = 24;

export default function TrendBarChart({
  points,
  formatValue,
}: {
  points: TrendPoint[];
  formatValue: (v: number) => string;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.totalSeconds));
  const peakIdx = points.reduce((best, p, i) => (p.totalSeconds > points[best].totalSeconds ? i : best), 0);

  const gridSteps = [0, 0.5, 1];

  return (
    <div className="flex">
      {/* y軸の目盛り */}
      <div className="mr-2 flex w-12 shrink-0 flex-col justify-between text-right text-[10px] text-cream/40" style={{ height: BAR_AREA_H, marginTop: LABEL_H }}>
        {[...gridSteps].reverse().map((s) => (
          <span key={s}>{formatValue(max * s)}</span>
        ))}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="relative" style={{ height: CHART_H, minWidth: points.length * 32 }}>
          {gridSteps.map((s) => (
            <div
              key={s}
              className="absolute left-0 right-0 border-t border-cream/10"
              style={{ bottom: s * BAR_AREA_H }}
            />
          ))}
          <div className="flex h-full items-end justify-around gap-1 px-1">
            {points.map((p, i) => {
              const h = Math.max((p.totalSeconds / max) * BAR_AREA_H, p.totalSeconds > 0 ? 3 : 0);
              const isPeak = i === peakIdx && p.totalSeconds > 0;
              const showLabel = (activeIdx === i || isPeak) && p.totalSeconds > 0;
              return (
                <button
                  key={p.key}
                  onClick={() => setActiveIdx((cur) => (cur === i ? null : i))}
                  className="flex h-full flex-1 flex-col items-center justify-end"
                  style={{ maxWidth: BAR_MAX_W + 8 }}
                >
                  <div className="whitespace-nowrap text-[10px] font-bold text-cream" style={{ height: LABEL_H }}>
                    {showLabel ? formatValue(p.totalSeconds) : ""}
                  </div>
                  <div
                    className={`w-full rounded-t bg-cream ${activeIdx === i ? "opacity-100" : "opacity-80"}`}
                    style={{ height: h, maxWidth: BAR_MAX_W }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-1 flex justify-around gap-1 px-1 text-[10px] text-cream/50" style={{ minWidth: points.length * 32 }}>
          {points.map((p) => (
            <div key={p.key} className="flex-1 text-center" style={{ maxWidth: BAR_MAX_W + 8 }}>
              {p.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
