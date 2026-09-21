"use client";

import { useMemo } from "react";
import CollapsiblePanel from "@/components/ui/CollapsiblePanel";
import {
  DEEP_BLOCK_MS,
  REFERENCE_RETURN_GAP_MS,
  computeFocusSummary,
  type DayFocus,
} from "@/lib/focus";
import type { WorkRecord } from "@/lib/types";

const LOOKBACK_DAYS = 30;

function formatMinutes(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, "0")}分`;
}

/** 直近LOOKBACK_DAYS日分の日付文字列(新しい順) */
function recentDates(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/** 1日を1本の帯にして、まとまった時間がどれだけあったかを並べる */
function DayBar({ day, maxMs }: { day: DayFocus; maxMs: number }) {
  const width = maxMs > 0 ? (day.totalMs / maxMs) * 100 : 0;
  const deepShare = day.totalMs > 0 ? (day.deepMs / day.totalMs) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] tabular-nums text-cream/40">{day.date.slice(5)}</span>
      <div className="progress-track h-2.5 grow overflow-hidden rounded-full bg-cream/10">
        <div className="h-full rounded-full bg-cream/25" style={{ width: `${width}%` }}>
          {/* 濃い部分が「25分以上続いた区間」。細切れの日は色が乗らない */}
          <div className="h-full rounded-full bg-alert/80" style={{ width: `${deepShare}%` }} />
        </div>
      </div>
      <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-cream/50">
        最長 {formatMinutes(day.longestMs)}
      </span>
    </div>
  );
}

// 実績の「合計時間」では見えない、集中がどれだけ途切れずに続いたかを見るパネル。
// 一時停止のたびに刻まれている区間(TimeSegment)だけを材料にしているので、
// 新しく入力してもらうものは何もない
export default function FocusContinuityPanel({
  records,
  collapsed,
  onToggle,
}: {
  records: WorkRecord[] | undefined;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const dates = useMemo(() => recentDates(), []);
  const summary = useMemo(() => computeFocusSummary(records ?? [], dates), [records, dates]);

  if (summary.days.length === 0) return null;

  const maxMs = Math.max(...summary.days.map((d) => d.totalMs));
  const gapVsReference =
    summary.medianReturnGapMs === null ? null : summary.medianReturnGapMs - REFERENCE_RETURN_GAP_MS;

  return (
    <CollapsiblePanel title="集中の連続性" collapsed={collapsed} onToggle={onToggle}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">1日の最長無中断</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {formatMinutes(summary.avgLongestMs)}
          </div>
          <div className="text-[10px] text-cream/40">{summary.days.length}日の平均</div>
        </div>
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">まとまった時間の割合</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {Math.round(summary.deepRatio * 100)}%
          </div>
          <div className="text-[10px] text-cream/40">{Math.round(DEEP_BLOCK_MS / 60000)}分以上続いた分</div>
        </div>
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">作業を切り替えた回数</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {summary.avgSwitchesPerDay}
          </div>
          <div className="text-[10px] text-cream/40">1日あたり</div>
        </div>
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">中断から戻るまで</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {summary.medianReturnGapMs === null ? "—" : formatMinutes(summary.medianReturnGapMs)}
          </div>
          <div className="text-[10px] text-cream/40">
            {gapVsReference === null
              ? "中断の記録なし"
              : gapVsReference <= 0
                ? `調査平均より${formatMinutes(-gapVsReference)}早い`
                : `調査平均より${formatMinutes(gapVsReference)}遅い`}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {summary.days.map((d) => (
          <DayBar key={d.date} day={d} maxMs={maxMs} />
        ))}
      </div>

      {summary.topInterrupters.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-cream/60">他の作業を止めていた時間が長い順</div>
          <div className="space-y-1">
            {summary.topInterrupters.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-cream/80">{row.label}</span>
                <span className="shrink-0 tabular-nums text-cream/50">
                  {row.count}回 / 計{formatMinutes(row.blockedMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-cream/40">
        一時停止で刻まれた区間から、どれだけ途切れずに続けられたかを見ています。濃い部分が
        {Math.round(DEEP_BLOCK_MS / 60000)}分以上続いた「まとまった時間」です。合計時間が同じでも、細切れの日は濃い部分が出ません。
        {summary.skippedDayCount > 0 &&
          `（区間の記録がない${summary.skippedDayCount}日分は対象外です）`}
      </p>
    </CollapsiblePanel>
  );
}
