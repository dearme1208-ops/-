"use client";

import type { DurationRange } from "@/lib/visuals";

// 「いつもの所要時間の幅」。これまでに終えた回の、短い時〜長い時の幅を薄い帯で、真ん中を縦線で、
// 今の経過を点で描く。予測という1つの数字より、「今回はいつもより長いのか」が実感しやすい
const m = (ms: number) => Math.round(ms / 60_000);

export function RangeBand({ range, elapsedMs }: { range: DurationRange; elapsedMs: number }) {
  const max = Math.max(range.high, elapsedMs) * 1.12;
  const pct = (ms: number) => `${Math.min(100, (ms / max) * 100)}%`;
  const state = elapsedMs < range.low ? "いつもより短め" : elapsedMs <= range.high ? "いつもの範囲" : "いつもより長い";
  return (
    <div className="mt-2 space-y-0.5" data-testid="range-band">
      <div className="relative h-4" role="img" aria-label={`いつもは${m(range.low)}〜${m(range.high)}分。今は${m(elapsedMs)}分で${state}`}>
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-cream/15" />
        <div
          className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-cream/20"
          style={{ left: pct(range.low), width: `calc(${pct(range.high)} - ${pct(range.low)})` }}
        />
        <div className="absolute top-0 h-4 w-0.5 rounded bg-cream/55" style={{ left: pct(range.mid) }} />
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[rgb(var(--ink-rgb))] ${
            elapsedMs > range.high ? "bg-alert" : "bg-[rgb(var(--accent-rgb))]"
          }`}
          style={{ left: pct(elapsedMs) }}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-cream/50">
        <span>
          いつもは{m(range.low)}〜{m(range.high)}分（{range.count}回の記録）
        </span>
        <span className={elapsedMs > range.high ? "font-bold text-alert" : "text-cream/70"}>{state}</span>
      </div>
    </div>
  );
}
