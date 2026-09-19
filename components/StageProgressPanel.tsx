"use client";

import { useMemo } from "react";
import CollapsiblePanel from "@/components/ui/CollapsiblePanel";
import {
  buildStageProgressRows,
  computeStageConversion,
  computeStageLeadTime,
  computeStalledStages,
  FALLBACK_STALLED_THRESHOLD_DAYS,
} from "@/lib/stageProgress";
import { formatDateJp } from "@/lib/time";
import type { ProjectItem, WorkRecord } from "@/lib/types";

// 「案件の段階を本日の作業に反映して、実際にどれだけ完了しているか」を見るパネル。
// 反映(=実績が付いた)段階のうち何割が完了しているか、完了までに実際何日かかって
// いるか(P50/P80)、着手したまま止まっている段階、の3つをまとめて見せる。
// どれも既にある実績(WorkRecord.stageId)と段階の完了時刻(completedAt)だけから
// 出せるので、新しく入力してもらうものは無い
export default function StageProgressPanel({
  records,
  projects,
  collapsed,
  onToggle,
}: {
  records: WorkRecord[] | undefined;
  projects: ProjectItem[] | undefined;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const rows = useMemo(() => buildStageProgressRows(projects ?? [], records ?? []), [projects, records]);
  const conversion = useMemo(() => computeStageConversion(rows), [rows]);
  const leadTime = useMemo(() => computeStageLeadTime(rows), [rows]);
  const stalled = useMemo(() => computeStalledStages(rows, leadTime), [rows, leadTime]);

  if (conversion.touchedCount === 0) return null;

  return (
    <CollapsiblePanel title="🧩 段階の反映と完了" collapsed={collapsed} onToggle={onToggle}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">反映して着手した段階</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">{conversion.touchedCount}件</div>
        </div>
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">うち完了した段階</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {conversion.completedCount}件
            {conversion.rate !== null && (
              <span className="ml-1 text-sm font-normal text-cream/50">({Math.round(conversion.rate * 100)}%)</span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">完了までの日数(中央値)</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {leadTime.p50Days !== null ? `${leadTime.p50Days}日` : "—"}
          </div>
          {leadTime.p50Days === null && <div className="text-[10px] text-cream/40">サンプルが集まり次第表示</div>}
        </div>
        <div className="rounded-lg bg-ink/50 p-3">
          <div className="text-[11px] text-cream/50">完了までの日数(P80)</div>
          <div className="font-display text-lg font-bold tabular-nums text-cream">
            {leadTime.p80Days !== null ? `${leadTime.p80Days}日` : "—"}
          </div>
          <div className="text-[10px] text-cream/40">8割はこの日数以内に完了</div>
        </div>
      </div>

      {conversion.byProject.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-cream/60">着手したまま残っている段階が多い案件</div>
          <div className="space-y-1">
            {conversion.byProject.slice(0, 5).map((row) => (
              <div key={row.projectId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-cream/80">{row.projectTitle}</span>
                <span className="shrink-0 tabular-nums text-cream/50">
                  {row.completedCount}/{row.touchedCount}件完了
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stalled.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs text-cream/60">
            放置されている段階(最後に手を付けてから
            {leadTime.p50Days !== null ? `中央値の${leadTime.p50Days}日` : `${FALLBACK_STALLED_THRESHOLD_DAYS}日`}
            以上経過)
          </div>
          <div className="space-y-1">
            {stalled.slice(0, 8).map((row) => (
              <div key={row.stageId} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-cream/80">
                  {row.projectTitle} / {row.stageTitle}
                </span>
                <span className="shrink-0 tabular-nums text-alert/80">
                  最終着手 {formatDateJp(row.lastTouchDate)}・{row.daysSinceLastActivity}日経過
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-cream/40">
        「反映」は、その段階に紐づく実績(本日の作業から段階を完了させた記録)が1件以上あることを指します。見積もりだけ立てて未着手の段階は対象に含みません。
      </p>
    </CollapsiblePanel>
  );
}
