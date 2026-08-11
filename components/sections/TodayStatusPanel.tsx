"use client";

import { useMemo, useState } from "react";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { computeTodayNarrative } from "@/lib/narrative";
import { formatHms, parseHourStr } from "@/lib/time";
import type { ConditionLog, DailyTask } from "@/lib/types";
import DonutChart from "@/components/charts/DonutChart";

// ガントチャート以外で「本日の作業状況」を一目で把握するための panel。
// 1) 進捗サマリーカード(完了件数・実績/予定の進捗バー・ペース判定)
// 2) カテゴリ別ドーナツグラフ(今の時点までの実績の内訳)
// 3) あらすじ(作業区間・体調変化を時系列テキストにしたもの)
export default function TodayStatusPanel({
  tasks,
  conditionLogs,
  now,
  standardWorkStart,
  standardWorkEnd,
}: {
  tasks: DailyTask[];
  conditionLogs: ConditionLog[];
  now: number;
  standardWorkStart: string;
  standardWorkEnd: string;
}) {
  const [showDonut, setShowDonut] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);

  const realTasks = useMemo(() => tasks.filter((t) => !t.isProvisional), [tasks]);

  const { totalCount, doneCount, totalEstimatedSeconds, totalActualSeconds } = useMemo(() => {
    let est = 0;
    let actual = 0;
    let done = 0;
    for (const t of realTasks) {
      est += t.estimatedSeconds;
      actual += segmentsAccumulatedMs(t, now) / 1000;
      if (t.status === "done") done++;
    }
    return { totalCount: realTasks.length, doneCount: done, totalEstimatedSeconds: est, totalActualSeconds: actual };
  }, [realTasks, now]);

  const progressPct = totalEstimatedSeconds > 0 ? Math.min(100, (totalActualSeconds / totalEstimatedSeconds) * 100) : null;

  // 所定労働時間帯のうち、現在までに経過した割合を「本来進んでいるはずのペース」の目安にする
  const pace = useMemo(() => {
    if (progressPct === null) return null;
    const nowDate = new Date(now);
    const nowHour = nowDate.getHours() + nowDate.getMinutes() / 60;
    const startHour = parseHourStr(standardWorkStart, 8);
    const endHour = parseHourStr(standardWorkEnd, 17);
    if (endHour <= startHour) return null;
    const expectedFrac = Math.min(1, Math.max(0, (nowHour - startHour) / (endHour - startHour)));
    const actualFrac = progressPct / 100;
    if (expectedFrac <= 0) return null;
    return actualFrac >= expectedFrac * 0.9 ? "順調" : "遅れ気味";
  }, [progressPct, now, standardWorkStart, standardWorkEnd]);

  const donutData = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of realTasks) {
      const sec = segmentsAccumulatedMs(t, now) / 1000;
      if (sec <= 0) continue;
      map.set(t.category, (map.get(t.category) ?? 0) + sec);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value }));
  }, [realTasks, now]);

  const narrativeLines = useMemo(() => computeTodayNarrative(realTasks, conditionLogs, now), [realTasks, conditionLogs, now]);

  if (totalCount === 0) return null;

  return (
    <div className="panel space-y-3 p-4">
      <h3 className="font-display text-sm font-bold text-cream/80">📊 本日の作業状況</h3>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-cream/70">
          完了 <span className="font-display text-lg font-bold text-cream">{doneCount}</span> / {totalCount}件
        </span>
        {pace && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${pace === "順調" ? "bg-cream/15 text-cream" : "bg-alert/20 text-alert"}`}>
            {pace === "順調" ? "🟢 順調" : "🟠 ペースやや遅れ気味"}
          </span>
        )}
      </div>

      {progressPct !== null && (
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-cream/50">
            <span>実績 / 予定</span>
            <span className="tabular-nums">
              {formatHms(totalActualSeconds)} / {formatHms(totalEstimatedSeconds)}（{Math.round(progressPct)}%）
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-cream/5">
            <div
              className={progressPct >= 100 ? "h-2.5 rounded-full bg-alert" : "h-2.5 rounded-full bg-cream"}
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn-pill-outline text-xs" onClick={() => setShowDonut((v) => !v)}>
          {showDonut ? "▼" : "▶"} カテゴリ別の内訳
        </button>
        <button className="btn-pill-outline text-xs" onClick={() => setShowNarrative((v) => !v)}>
          {showNarrative ? "▼" : "▶"} 本日のあらすじ
        </button>
      </div>

      {showDonut && (
        <div className="pt-1">
          <DonutChart data={donutData} formatValue={formatHms} />
        </div>
      )}

      {showNarrative && (
        <div className="space-y-1 border-t border-cream/10 pt-3 text-xs text-cream/70">
          {narrativeLines.length === 0 ? (
            <p className="text-cream/50">まだ今日の記録はありません。</p>
          ) : (
            narrativeLines.map((line, i) => <p key={i}>{line}</p>)
          )}
        </div>
      )}
    </div>
  );
}
