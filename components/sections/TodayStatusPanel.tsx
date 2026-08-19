"use client";

import { useMemo, useState } from "react";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { computeTodayNarrative, computeTodaySummarySentence } from "@/lib/narrative";
import { useSetting } from "@/lib/settings";
import { formatHms, parseHourStr } from "@/lib/time";
import type { ConditionLog, DailyTask } from "@/lib/types";
import DonutChart, { type DonutDatum } from "@/components/charts/DonutChart";

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
  // パネル全体の開閉。ホーム画面を簡潔にしたい場合に畳めるよう、次回以降も畳んだままにする
  const [collapsedStr, setCollapsedStr] = useSetting("today.collapseStatusPanel", "false");
  const collapsed = collapsedStr === "true";

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

  // ドーナツグラフの区分をタップした際、その区分内の本日の作業内訳を見せる詳細パネル
  const [categoryDetail, setCategoryDetail] = useState<string | null>(null);
  function categoryDetailText(d: DonutDatum, meta: { isOther: boolean; otherItems: DonutDatum[] }): string {
    if (meta.isOther) {
      const items = [...meta.otherItems].sort((a, b) => b.value - a.value);
      const lines = ["その他（上位に入らなかった区分）", `合計 ${formatHms(d.value)}`, ""];
      for (const item of items.slice(0, 15)) lines.push(`・${item.label}: ${formatHms(item.value)}`);
      if (items.length > 15) lines.push(`ほか${items.length - 15}件`);
      return lines.join("\n");
    }
    const matching = realTasks
      .map((t) => ({ task: t, seconds: segmentsAccumulatedMs(t, now) / 1000 }))
      .filter((x) => x.task.category === d.label && x.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);
    const lines = [d.label, `合計 ${formatHms(d.value)}`, ""];
    for (const x of matching.slice(0, 15)) {
      lines.push(`・${x.task.name}: ${formatHms(x.seconds)}${x.task.status === "done" ? "（完了）" : ""}`);
    }
    if (matching.length > 15) lines.push(`ほか${matching.length - 15}件`);
    return lines.join("\n");
  }

  const narrativeItems = useMemo(() => computeTodayNarrative(realTasks, conditionLogs, now), [realTasks, conditionLogs, now]);
  const summarySentence = useMemo(
    () => computeTodaySummarySentence(realTasks, conditionLogs, now),
    [realTasks, conditionLogs, now]
  );

  if (totalCount === 0) return null;

  return (
    <div className="panel space-y-3 p-4">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setCollapsedStr(collapsed ? "false" : "true")}
      >
        <h3 className="font-display text-sm font-bold text-cream/80">📊 本日の作業状況</h3>
        <span className="text-xs text-cream/40">{collapsed ? "▶" : "▼"}</span>
      </button>

      {!collapsed && (
        <>
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
          <DonutChart
            data={donutData}
            formatValue={formatHms}
            onSliceClick={(d, meta) => setCategoryDetail(categoryDetailText(d, meta))}
          />
          {categoryDetail && (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-cream/20 bg-ink p-3">
              <p className="min-w-0 whitespace-pre-line break-words text-sm text-cream">{categoryDetail}</p>
              <button
                className="shrink-0 text-lg leading-none text-cream/50 hover:text-cream"
                onClick={() => setCategoryDetail(null)}
                aria-label="詳細を閉じる"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}

      {showNarrative && (
        <div className="space-y-3 border-t border-cream/10 pt-3">
          <p className="text-sm font-bold text-cream">{summarySentence}</p>
          {narrativeItems.length > 0 && (
            <div className="ml-2 space-y-3 border-l border-cream/15 pl-5">
              {narrativeItems.map((item, i) => (
                <div key={i} className="relative">
                  <span
                    className={`absolute -left-[27px] top-0 flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      item.type === "gap"
                        ? "border border-dashed border-cream/25 bg-ink text-cream/40"
                        : "border border-cream/30 bg-ink"
                    }`}
                  >
                    {item.icon}
                  </span>
                  <div
                    className={
                      item.type === "gap"
                        ? "text-xs italic text-cream/40"
                        : item.type === "condition"
                          ? "text-xs text-cream/60"
                          : "text-xs text-cream"
                    }
                  >
                    <div className={item.type === "task" ? "font-bold" : ""}>{item.title}</div>
                    {item.subtitle && <div className="text-[10px] tabular-nums text-cream/40">{item.subtitle}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}
