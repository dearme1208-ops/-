"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subDays, subMonths, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "@/lib/period";
import { formatHms, formatDateJp } from "@/lib/time";
import { useDraftSetting } from "@/lib/settings";

interface CompletionEntry {
  key: string;
  label: string;
  completedAt: number;
  kind: "project" | "stage";
  suppressed?: boolean; // 「完了」として讃える対象から外すべき理由がある(自動完了 or 同一タイトル大量記録)
}

// 同じタイトルの案件がこの件数以上存在する場合、それは1つの案件ではなく詳細作業名(workName)
// 単位で日々の作業を記録しているだけの可能性が高いとみなし、完了を「讃える」対象から外す
const DUPLICATE_TITLE_THRESHOLD = 3;

// 文章のたびに違う言い回しを選ぶための簡易ハッシュ。同じseed(期間+文の種類)なら
// 再レンダーしても同じ選択になるので、数値だけ変わって言い回しはチラつかない。
// 期間や文の種類が変わればseedも変わるため、レポート全体が毎回同じ定型文には見えなくなる
function pickVariant<T>(options: readonly T[], seed: string): T {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return options[hash % options.length];
}

// Claudeモード専用の「レポート」体験。既存のReportSection(統計タイル・重ね合わせ
// グラフ・印刷レイアウト・PDF/HTML/ics書き出し等)は踏襲せず、Claudeが今週/今月を
// 振り返って語りかけるような、短い文章によるまとめに絞った。「1問だけの
// リフレクション」「今週/今月の一言」は通常のレポートタブと同じ保存先を使い、
// モードを切り替えても内容は共有される
export default function ClaudeReportSection() {
  const [kind, setKind] = useState<"day" | "week" | "month">("week");
  const records = useLiveQuery(() => db.records.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const filter: PeriodFilter = { type: kind };
  const periodLabel = kind === "week" ? "今週" : kind === "month" ? "今月" : "今日";
  const prevLabel = kind === "week" ? "先週" : kind === "month" ? "先月" : "昨日";

  const periodKey = useMemo(() => {
    const range = getPeriodRange(filter);
    if (!range) return "all";
    return kind === "month" ? range.start.toISOString().slice(0, 7) : range.start.toISOString().slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  const [note, setNote] = useDraftSetting(`report.note.${kind}.${periodKey}`, "");
  const reflectionQuestion =
    kind === "week" ? "今週、一番良かった判断は?" : kind === "month" ? "今月、一番の成長は?" : "今日、一番手応えがあった作業は?";
  const [reflectionAnswer, setReflectionAnswer] = useDraftSetting(`report.reflection.${kind}.${periodKey}`, "");

  const summary = useMemo(() => {
    if (!records) return null;
    const range = getPeriodRange(filter);
    const periodRecords = records.filter((r) => isDateStrInRange(r.date, range) && !r.excludedFromStats);
    const totalSeconds = periodRecords.reduce((sum, r) => sum + r.seconds, 0);

    const byCategory = new Map<string, number>();
    for (const r of periodRecords) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.seconds);
    const categoryRanking = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const prevNow = kind === "week" ? subWeeks(new Date(), 1) : kind === "month" ? subMonths(new Date(), 1) : subDays(new Date(), 1);
    const prevRange = getPeriodRange(filter, prevNow);
    const prevTotalSeconds = records
      .filter((r) => isDateStrInRange(r.date, prevRange) && !r.excludedFromStats)
      .reduce((sum, r) => sum + r.seconds, 0);
    const delta = totalSeconds - prevTotalSeconds;

    const troubleCount = periodRecords.filter((r) => r.isTrouble).length;

    // 同じタイトルの案件が大量に存在する場合、案件というより詳細作業名(workName)単位で
    // 日々の作業を記録しているだけの可能性が高い(CSVインポート元で「完了」列が立って
    // いても、それは「本日の作業に落とし込んだ分」が終わっただけで、案件そのものの
    // 完了ではないことが多い)。タイトルの出現回数を先に数えておき、閾値以上なら
    // その案件の完了は「讃える」対象から外す
    const titleCounts = new Map<string, number>();
    for (const p of projects ?? []) titleCounts.set(p.title, (titleCounts.get(p.title) ?? 0) + 1);

    // プロジェクト全体の完了と、その中の個々の段階の完了は別の出来事として扱う。
    // 段階は完了しても案件全体はまだ、ということも多いため、両方を別集計にして
    // 詳細も一覧で見えるようにする(段階にはcompletedAtが無かったため以前は区別できなかった)
    const completions: CompletionEntry[] = [];
    for (const p of projects ?? []) {
      if (p.completedAt && isDateStrInRange(new Date(p.completedAt).toISOString().slice(0, 10), range)) {
        const label = p.workName && p.workName !== p.title ? `${p.title}（${p.workName}）` : p.title;
        const suppressed = !!p.autoCompletedByImport || (titleCounts.get(p.title) ?? 0) >= DUPLICATE_TITLE_THRESHOLD;
        completions.push({ key: `project-${p.id}`, label, completedAt: p.completedAt, kind: "project", suppressed });
      }
      for (const s of p.stages ?? []) {
        if (s.completedAt && isDateStrInRange(new Date(s.completedAt).toISOString().slice(0, 10), range)) {
          completions.push({ key: `stage-${s.id}`, label: `${p.title} - ${s.title}`, completedAt: s.completedAt, kind: "stage" });
        }
      }
    }
    completions.sort((a, b) => b.completedAt - a.completedAt);
    // 讃える対象から外した完了は、件数だけ控えめに触れる(理由は自動完了・同名多発のいずれか)
    const projectCompletions = completions.filter((c) => c.kind === "project" && !c.suppressed);
    const autoCompletions = completions.filter((c) => c.kind === "project" && c.suppressed);
    const stageCompletions = completions.filter((c) => c.kind === "stage");

    const sentences: string[] = [];
    if (periodRecords.length === 0) {
      sentences.push(
        pickVariant(
          [`${periodLabel}はまだ記録がありません。`, `${periodLabel}はまだ記録がないようです。`, `${periodLabel}はここまで記録がありません。`],
          `${periodKey}-empty`
        )
      );
    } else {
      sentences.push(
        pickVariant(
          [
            `${periodLabel}の合計作業時間は ${formatHms(totalSeconds)} でした。`,
            `${periodLabel}は合計で ${formatHms(totalSeconds)} を記録しています。`,
            `記録を見ると、${periodLabel}は ${formatHms(totalSeconds)} 取り組んでいますね。`,
          ],
          `${periodKey}-total`
        )
      );
      if (categoryRanking.length > 0) {
        const [cat, sec] = categoryRanking[0];
        sentences.push(
          pickVariant(
            [
              `最も時間を使ったのは「${cat}」で、${formatHms(sec)}です。`,
              `いちばん多くの時間が「${cat}」に使われています(${formatHms(sec)})。`,
              `「${cat}」に最も比重が置かれた${periodLabel}でした(${formatHms(sec)})。`,
            ],
            `${periodKey}-top`
          )
        );
      }
      if (prevTotalSeconds > 0) {
        const diff = formatHms(Math.abs(delta));
        if (delta > 0) {
          sentences.push(
            pickVariant(
              [
                `${prevLabel}より約 ${diff} 多く作業しています。`,
                `${prevLabel}と比べて、約 ${diff} 増えました。`,
                `ペースが上がっていて、${prevLabel}より約 ${diff} 多いです。`,
              ],
              `${periodKey}-delta`
            )
          );
        } else if (delta < 0) {
          sentences.push(
            pickVariant(
              [
                `${prevLabel}より約 ${diff} 少なく作業しています。`,
                `${prevLabel}と比べると、約 ${diff} 減っています。`,
                `少しペースが落ち着いていて、${prevLabel}より約 ${diff} 少ないです。`,
              ],
              `${periodKey}-delta`
            )
          );
        } else {
          sentences.push(
            pickVariant([`${prevLabel}とほぼ同じペースでした。`, `${prevLabel}と変わらないペースを保っています。`], `${periodKey}-delta`)
          );
        }
      }
      if (troubleCount > 0) {
        sentences.push(
          pickVariant(
            [`トラブル対応が ${troubleCount} 件ありました。`, `トラブル対応も ${troubleCount} 件こなしています。`],
            `${periodKey}-trouble`
          )
        );
      }
      if (projectCompletions.length > 0) {
        // 同名プロジェクトが繰り返し完了している場合に文章が延々と続くのを防ぐため、
        // タイトルの重複を除いた上で先頭3件までに切り詰める
        const uniqueTitles = [...new Set(projectCompletions.map((c) => c.label))];
        const shown = uniqueTitles.slice(0, 3).join("」「");
        const suffix = uniqueTitles.length > 3 ? `など${projectCompletions.length}件` : "";
        sentences.push(
          pickVariant(
            [`プロジェクト「${shown}」${suffix}が完了しました。`, `「${shown}」${suffix}を完了させています。`],
            `${periodKey}-project`
          )
        );
      }
      if (stageCompletions.length > 0) {
        sentences.push(
          pickVariant(
            [`段階は${stageCompletions.length}件完了しました(詳細は下記)。`, `細かい段階も${stageCompletions.length}件進んでいます(詳細は下記)。`],
            `${periodKey}-stage`
          )
        );
      }
      if (autoCompletions.length > 0) {
        sentences.push(
          `なお、同じタイトルで詳細作業名(workName)違いの案件が多数記録されているものなど、実際に案件そのものが終わったとは断定できない完了が${autoCompletions.length}件あります。上記のカウントには含めていません。`
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
            <button className={kind === "day" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setKind("day")}>
              日
            </button>
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
              ほか、自動的に完了扱いとなったものや、同じタイトルの案件が詳細作業名(workName)違いで
              大量に記録されているものなど、実際に案件そのものが終わったとは断定できない完了が
              {summary.autoCompletions.length}件あります(詳細作業名ごとに日々の作業を記録しているだけの
              可能性が高く、ここには含めていません)。
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
