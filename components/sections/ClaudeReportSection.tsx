"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subMonths, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "@/lib/period";
import { formatHms } from "@/lib/time";
import { useDraftSetting } from "@/lib/settings";

// Claudeモード専用の「レポート」体験。既存のReportSection(統計タイル・重ね合わせ
// グラフ・印刷レイアウト・PDF/HTML/ics書き出し等)は踏襲せず、Claudeが今週/今月を
// 振り返って語りかけるような、短い文章によるまとめに絞った。「1問だけの
// リフレクション」「今週/今月の一言」は通常のレポートタブと同じ保存先を使い、
// モードを切り替えても内容は共有される
export default function ClaudeReportSection() {
  const [kind, setKind] = useState<"week" | "month">("week");
  const records = useLiveQuery(() => db.records.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const filter: PeriodFilter = { type: kind };
  const periodLabel = kind === "week" ? "今週" : "今月";
  const prevLabel = kind === "week" ? "先週" : "先月";

  const periodKey = useMemo(() => {
    const range = getPeriodRange(filter);
    if (!range) return "all";
    return kind === "week" ? range.start.toISOString().slice(0, 10) : range.start.toISOString().slice(0, 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const [note, setNote] = useDraftSetting(`report.note.${kind}.${periodKey}`, "");
  const reflectionQuestion = kind === "week" ? "今週、一番良かった判断は?" : "今月、一番の成長は?";
  const [reflectionAnswer, setReflectionAnswer] = useDraftSetting(`report.reflection.${kind}.${periodKey}`, "");

  const summary = useMemo(() => {
    if (!records) return null;
    const range = getPeriodRange(filter);
    const periodRecords = records.filter((r) => isDateStrInRange(r.date, range) && !r.excludedFromStats);
    const totalSeconds = periodRecords.reduce((sum, r) => sum + r.seconds, 0);

    const byCategory = new Map<string, number>();
    for (const r of periodRecords) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.seconds);
    const categoryRanking = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const prevNow = kind === "week" ? subWeeks(new Date(), 1) : subMonths(new Date(), 1);
    const prevRange = getPeriodRange(filter, prevNow);
    const prevTotalSeconds = records
      .filter((r) => isDateStrInRange(r.date, prevRange) && !r.excludedFromStats)
      .reduce((sum, r) => sum + r.seconds, 0);
    const delta = totalSeconds - prevTotalSeconds;

    const troubleCount = periodRecords.filter((r) => r.isTrouble).length;
    const completedProjects = (projects ?? []).filter(
      (p) => p.completedAt && isDateStrInRange(new Date(p.completedAt).toISOString().slice(0, 10), range)
    );

    const sentences: string[] = [];
    if (periodRecords.length === 0) {
      sentences.push(`${periodLabel}はまだ記録がありません。`);
    } else {
      sentences.push(`${periodLabel}の合計作業時間は ${formatHms(totalSeconds)} でした。`);
      if (categoryRanking.length > 0) {
        sentences.push(`最も時間を使ったのは「${categoryRanking[0][0]}」で、${formatHms(categoryRanking[0][1])}です。`);
      }
      if (prevTotalSeconds > 0) {
        if (delta > 0) sentences.push(`${prevLabel}より約 ${formatHms(Math.abs(delta))} 多く作業しています。`);
        else if (delta < 0) sentences.push(`${prevLabel}より約 ${formatHms(Math.abs(delta))} 少なく作業しています。`);
        else sentences.push(`${prevLabel}とほぼ同じペースでした。`);
      }
      if (troubleCount > 0) sentences.push(`トラブル対応が ${troubleCount} 件ありました。`);
      if (completedProjects.length > 0) {
        sentences.push(`「${completedProjects.map((p) => p.title).join("」「")}」が完了しました。`);
      }
    }

    return { totalSeconds, categoryRanking, sentences };
  }, [records, projects, kind, filter, periodLabel, prevLabel]);

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-cream">レポート</h2>
          <div className="flex gap-2">
            <button className={kind === "week" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setKind("week")}>
              週
            </button>
            <button className={kind === "month" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setKind("month")}>
              月
            </button>
          </div>
        </div>
        {summary && (
          <div className="space-y-1.5 rounded-lg bg-ink/30 p-3 text-sm leading-relaxed text-cream/80">
            <p className="text-xs font-bold text-cream/40">Claudeより</p>
            {summary.sentences.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
        )}
      </div>

      {summary && summary.categoryRanking.length > 0 && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/70">分類別の内訳</h3>
          {summary.categoryRanking.map(([category, seconds]) => (
            <div key={category} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs text-cream/60">
                <span>{category}</span>
                <span className="tabular-nums">{formatHms(seconds)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/40">
                <div
                  className="h-full rounded-full bg-alert/70"
                  style={{ width: `${Math.round((seconds / summary.categoryRanking[0][1]) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel space-y-2 p-4">
        <h3 className="font-display text-sm font-bold text-cream/70">Claudeからの質問</h3>
        <p className="text-sm text-cream/60">{reflectionQuestion}</p>
        <input
          value={reflectionAnswer}
          onChange={(e) => setReflectionAnswer(e.target.value)}
          placeholder="ひとことで大丈夫です"
          className="w-full rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
        />
      </div>

      <div className="panel space-y-2 p-4">
        <h3 className="font-display text-sm font-bold text-cream/70">{periodLabel}の一言メモ</h3>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="自由に書いてください"
          className="w-full rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
        />
      </div>
    </div>
  );
}
