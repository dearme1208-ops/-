"use client";

import type { AutoAllocationResult } from "@/lib/allocate";
import { useSetting } from "@/lib/settings";
import { formatClock, formatMsClock } from "@/lib/time";

export type AutoAllocateMode = "off" | "live" | "manual";

// 終業までの残り時間に、未完了作業の予測が収まるかを示す「自動配分」パネル。
// 配分の計算自体は作業カードでも使うため呼び出し側で行い、ここは表示と切り替えだけを持つ
export default function AutoAllocatePanel({
  mode,
  onModeChange,
  standardWorkEnd,
  allocation,
  manualComputed,
  manualComputedAt,
  onRunManual,
}: {
  mode: AutoAllocateMode;
  onModeChange: (mode: AutoAllocateMode) => void;
  standardWorkEnd: string;
  /** 今表示している配分(ライブ/手動のどちらか。オフならnull) */
  allocation: AutoAllocationResult | null;
  /** 手動モードで一度でも計算したか */
  manualComputed: boolean;
  manualComputedAt: number | null;
  onRunManual: () => void;
}) {
  const [collapsedStr, setCollapsedStr] = useSetting("today.collapseAutoAllocate", "false");
  const collapsed = collapsedStr === "true";
  return (
    <div className="panel p-4">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setCollapsedStr(collapsed ? "false" : "true")}
      >
        <h3 className="font-display text-sm font-bold text-cream/80">
          自動配分
          {collapsed && mode !== "off" && (
            <span className="ml-1 font-normal text-cream/40">（{mode === "live" ? "ライブ" : "手動"}）</span>
          )}
        </h3>
        <span className="text-xs text-cream/40">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && (
        <>
          <div className="mb-2 mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-normal text-cream/40">
              {standardWorkEnd}までの残り時間に、未完了作業の予測を収めるための目標ペース
            </span>
            <div className="flex items-center gap-1">
              {(["off", "live", "manual"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className={mode === m ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                >
                  {m === "off" ? "オフ" : m === "live" ? "ライブ" : "手動"}
                </button>
              ))}
              {mode === "manual" && (
                <button className="btn-pill-outline text-xs" onClick={onRunManual}>
                  配分を計算
                </button>
              )}
            </div>
          </div>
          {mode === "manual" && !manualComputed && (
            <p className="text-xs text-cream/50">「配分を計算」を押すと、その時点の残業務時間から配分を計算します。</p>
          )}
          {allocation && (
            <div className="text-xs text-cream/60">
              {mode === "manual" && manualComputedAt && (
                <div className="mb-1 text-cream/40">{formatClock(manualComputedAt)} 時点で計算</div>
              )}
              <div>
                {standardWorkEnd}までの残り {formatMsClock(allocation.remainingWorkMs)} / 未完了作業の予測合計{" "}
                {formatMsClock(allocation.totalRemainingPredictedMs)}
              </div>
              <div className={allocation.scale < 1 ? "text-alert" : "text-cream/60"}>
                {allocation.scale < 1
                  ? `ペース ${Math.round(allocation.scale * 100)}%（業務時間に収めるには、この比率まで各作業を圧縮する必要があります）`
                  : "業務時間内に収まる見込みです（圧縮なし）"}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
