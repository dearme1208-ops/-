"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subMonths, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "@/lib/period";
import { formatHms, formatDateJp } from "@/lib/time";
import { useDraftSetting } from "@/lib/settings";

interface CompletionEntry {
  key: string;
  label: string;
  completedAt: number;
  kind: "project" | "stage";
  auto?: boolean; // インポート元で行が見当たらなくなったことによる自動完了(実際に終わったとは限らない)
}

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

    // プロジェクト全体の完了と、その中の個々の段階の完了は別の出来事として扱う。
    // 段階は完了しても案件全体はまだ、ということも多いため、両方を別集計にして
    // 詳細も一覧で見えるようにする(段階にはcompletedAtが無かったため以前は区別できなかった)
    const completions: CompletionEntry[] = [];
    for (const p of projects ?? []) {
      if (p.completedAt && isDateStrInRange(new Date(p.completedAt).toISOString().slice(0, 10), range)) {
        const label = p.workName && p.workName !== p.title ? `${p.title}（${p.workName}）` : p.title;
        completions.push({ key: `project-${p.id}`, label, completedAt: p.completedAt, kind: "project", auto: p.autoCompletedByImport });
      }
      for (const s of p.stages ?? []) {
        if (s.completedAt && isDateStrInRange(new Date(s.completedAt).toISOString().slice(0, 10), range)) {
          completions.push({ key: `stage-${s.id}`, label: `${p.title} - ${s.title}`, completedAt: s.completedAt, kind: "stage" });
        }
      }
    }
    completions.sort((a, b) => b.completedAt - a.completedAt);
    // インポート元で行が見当たらなくなったための自動完了は、実際に案件が終わったとは
    // 限らない(詳細作業名が変わって別行扱いになっただけのことが多い)ため、
    // 「完了しました」と讃える対象からは外し、件数だけ別枠で控えめに触れる
    const projectCompletions = completions.filter((c) => c.kind === "project" && !c.auto);
    const autoCompletions = completions.filter((c) => c.kind === "project" && c.auto);
    const stageCompletions = completions.filter((c) => c.kind === "stage");

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
      if (projectCompletions.length > 0) {
        // 同名プロジェクトが繰り返し完了している場合に文章が延々と続くのを防ぐため、
        // タイトルの重複を除いた上で先頭3件までに切り詰める
        const uniqueTitles = [...new Set(projectCompletions.map((c) => c.label))];
        const shown = uniqueTitles.slice(0, 3).join("」「");
        const suffix = uniqueTitles.length > 3 ? `など${projectCompletions.length}件` : "";
        sentences.push(`プロジェクト「${shown}」${suffix}が完了しました。`);
      }
      if (stageCompletions.length > 0) {
        sentences.push(`段階は${stageCompletions.length}件完了しました(詳細は下記)。`);
      }
      if (autoCompletions.length > 0) {
        sentences.push(
          `なお、インポート元で行が見当たらなくなったために自動的に完了扱いとなった案件が${autoCompletions.length}件あります。実際に作業が終わったとは限らないため、上記のカウントには含めていません。`
        );
      }
    }

    const displayCompletions = [...projectCompletions, ...stageCompletions].sort((a, b) => b.completedAt - a.completedAt);
    return { totalSeconds, categoryRanking, sentences, completions: displayCompletions, autoCompletions };
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

      {summary && (summary.completions.length > 0 || summary.autoCompletions.length > 0) && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/70">完了した内容</h3>
          {summary.completions.length > 0 ? (
            <div className="space-y-1">
              {summary.completions.slice(0, 8).map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-cream/80">
                    <span
                      className={`mr-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        c.kind === "project" ? "bg-alert/15 text-alert" : "bg-cream/10 text-cream/50"
                      }`}
                    >
                      {c.kind === "project" ? "プロジェクト" : "段階"}
                    </span>
                    {c.label}
                  </span>
                  <span className="shrink-0 text-cream/40">{formatDateJp(new Date(c.completedAt).toISOString().slice(0, 10))}</span>
                </div>
              ))}
              {summary.completions.length > 8 && (
                <p className="text-[11px] text-cream/40">ほか{summary.completions.length - 8}件</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-cream/40">自分で完了にした案件・段階はまだありません。</p>
          )}
          {summary.autoCompletions.length > 0 && (
            <p className="border-t border-cream/10 pt-2 text-[11px] leading-relaxed text-cream/35">
              ほか、インポート元で行が見当たらなくなったために自動的に完了扱いとなった案件が{summary.autoCompletions.length}
              件あります（詳細作業名が変わって別行扱いになっただけの可能性が高く、実際に終わったとは限らないためここには含めていません）。
            </p>
          )}
        </div>
      )}

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
