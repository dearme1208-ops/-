"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { subDays, subMonths, subWeeks } from "date-fns";
import { db } from "@/lib/db";
import { aggregateRecords } from "@/lib/aggregate";
import { computeAttentionList, type AttentionRow } from "@/lib/attention";
import { computeAfterHoursBreakdown } from "@/lib/overtime";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "@/lib/period";
import { baseAccumulatedMs } from "@/lib/tasks";
import { generateReportText, downloadTextFile, computeDailyOverlayComparison } from "@/lib/report";
import { computeTodoPeriodSummary } from "@/lib/todoTrend";
import { exportElementToPdf } from "@/lib/pdfExport";
import { recordsToIcs } from "@/lib/ics";
import { dailyAvgPrecipProbability } from "@/lib/weather";
import { fireConfetti } from "@/lib/confetti";
import { computeCost, formatYen, parseCategoryRates, resolveCategoryRate } from "@/lib/cost";
import { useDraftSetting, useSetting } from "@/lib/settings";
import { effectiveDueDate } from "@/lib/todo";
import { daysBetweenDateStrs, formatHms, todayStr } from "@/lib/time";
import type { TodoTask } from "@/lib/types";
import RankingBarChart from "@/components/charts/RankingBarChart";
import OverlayLineChart from "@/components/charts/OverlayLineChart";

const TOP_N = 10;
const MEDALS = ["🥇", "🥈", "🥉"];

export default function ReportSection() {
  const [kind, setKind] = useState<"day" | "week" | "month">("week");
  const [afterHoursCutoff] = useSetting("report.afterHoursCutoff", "18:00");
  const [standardHoursStr] = useSetting("overtime.standardDailyHours", "8");
  const standardDailySeconds = Math.max(0, Number(standardHoursStr) || 0) * 3600;
  const [dailyGoalHoursStr] = useSetting("report.dailyGoalHours", "");
  const [weeklyGoalHoursStr] = useSetting("report.weeklyGoalHours", "");
  const [monthlyGoalHoursStr] = useSetting("report.monthlyGoalHours", "");
  const goalHoursStr = kind === "day" ? dailyGoalHoursStr : kind === "week" ? weeklyGoalHoursStr : monthlyGoalHoursStr;
  const goalSeconds = Number(goalHoursStr) > 0 ? Number(goalHoursStr) * 3600 : null;
  const [defaultHourlyRateStr] = useSetting("cost.defaultHourlyRate", "");
  const defaultHourlyRate = Number(defaultHourlyRateStr) > 0 ? Number(defaultHourlyRateStr) : null;
  const [categoryRatesJson] = useSetting("cost.categoryRates", "{}");
  const categoryRates = useMemo(() => parseCategoryRates(categoryRatesJson), [categoryRatesJson]);
  const costEnabled = defaultHourlyRate !== null || Object.keys(categoryRates).length > 0;

  const records = useLiveQuery(() => db.records.toArray(), []);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const dailyTasks = useLiveQuery(() => db.dailyTasks.toArray(), []);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const weatherForecasts = useLiveQuery(() => db.weatherForecasts.toArray(), []);

  const title = kind === "week" ? "週報" : kind === "month" ? "月報" : "日報";
  const periodLabel = kind === "week" ? "週" : kind === "month" ? "月" : "日";
  const filter: PeriodFilter = { type: kind };
  const today = todayStr();

  // 今日/今週/今月の一言メモ。期間の開始日をキーにして保存する
  const periodKey = useMemo(() => {
    const range = getPeriodRange(filter);
    if (!range) return "all";
    return kind === "month" ? range.start.toISOString().slice(0, 7) : range.start.toISOString().slice(0, 10);
  }, [kind]);
  const [note, setNote] = useDraftSetting(`report.note.${kind}.${periodKey}`, "");
  const [goalCelebratedKey, setGoalCelebratedKey] = useSetting(`report.goalCelebrated.${kind}.${periodKey}`, "");
  // 負担にならない「1問だけ」の振り返り。自由記述の一言メモとは別に、
  // 期間ごとに固定の1問だけ答える軽い振り返りの儀式として設ける
  const reflectionQuestion =
    kind === "week" ? "今週、一番良かった判断は?" : kind === "month" ? "今月、一番の成長は?" : "今日、一番手応えがあった作業は?";
  const [reflectionAnswer, setReflectionAnswer] = useDraftSetting(`report.reflection.${kind}.${periodKey}`, "");

  const data = useMemo(() => {
    if (!records || !masterTasks) return null;
    const range = getPeriodRange(filter);
    const rangeLabel = range
      ? `${range.start.toISOString().slice(0, 10)} 〜 ${range.end.toISOString().slice(0, 10)}`
      : "累計";
    const ranking = aggregateRecords(records, filter, "total");
    const periodRecords = records.filter((r) => isDateStrInRange(r.date, range));
    const attention = computeAttentionList(masterTasks, periodRecords);
    const afterHours = computeAfterHoursBreakdown(periodRecords, afterHoursCutoff);
    const totalSeconds = ranking.reduce((s, r) => s + r.totalSeconds, 0);
    const totalCount = ranking.reduce((s, r) => s + r.count, 0);

    // 前日/前週/前月との比較（自動サマリー文章用）
    const prevNow = kind === "week" ? subWeeks(new Date(), 1) : kind === "month" ? subMonths(new Date(), 1) : subDays(new Date(), 1);
    const prevRanking = aggregateRecords(records, filter, "total", false, prevNow);
    const prevTotalSeconds = prevRanking.reduce((s, r) => s + r.totalSeconds, 0);
    const prevByKey = new Map(prevRanking.map((r) => [r.key, r.totalSeconds]));
    let topGainer: { category: string; name: string; deltaSeconds: number } | null = null;
    for (const r of ranking) {
      const delta = r.totalSeconds - (prevByKey.get(r.key) ?? 0);
      if (!topGainer || delta > topGainer.deltaSeconds) {
        topGainer = { category: r.category, name: r.name, deltaSeconds: delta };
      }
    }

    // トラブル対応（今期間中に発生した件数・時間）
    const troubleTasks = (dailyTasks ?? []).filter((t) => t.isTrouble && isDateStrInRange(t.date, range));
    const troubleTotalSeconds = troubleTasks.reduce((s, t) => s + baseAccumulatedMs(t) / 1000, 0);

    // ToDoの期限超過タスク（現時点で超過しているもの。サブタスクの期日も考慮）
    const subtasksByParent = new Map<string, TodoTask[]>();
    for (const t of todoTasks ?? []) {
      if (!t.parentTaskId) continue;
      if (!subtasksByParent.has(t.parentTaskId)) subtasksByParent.set(t.parentTaskId, []);
      subtasksByParent.get(t.parentTaskId)!.push(t);
    }
    const overdueTodos = (todoTasks ?? [])
      .filter((t) => !t.parentTaskId && !t.completed)
      .map((t) => ({ task: t, due: effectiveDueDate(t, subtasksByParent.get(t.id) ?? []) }))
      .filter((x): x is { task: TodoTask; due: string } => !!x.due && x.due < today)
      .sort((a, b) => a.due.localeCompare(b.due));

    // 週報かつ週後半（木・金）の場合、これまでの経過営業日数から見て進捗が遅れていないか警告する
    let paceWarning: { expectedSeconds: number; actualSeconds: number } | null = null;
    if (kind === "week" && standardDailySeconds > 0) {
      const dow = new Date().getDay(); // 0=日 ... 6=土
      if (dow === 4 || dow === 5) {
        const elapsedWeekdays = Math.min(dow, 5);
        const expectedSeconds = standardDailySeconds * elapsedWeekdays * 0.7;
        if (totalSeconds < expectedSeconds) {
          paceWarning = { expectedSeconds: standardDailySeconds * elapsedWeekdays, actualSeconds: totalSeconds };
        }
      }
    }

    // この期間、最も作業時間を投じた案件(案件MVP)。主案件(projectId)だけでなく
    // 兼務向けの追加の案件タグ(secondaryProjectIds)がこの案件を含む実績も合算する
    let projectMvp: { title: string; totalSeconds: number } | null = null;
    if (projects && projects.length > 0) {
      const byProject = new Map<string, number>();
      for (const r of periodRecords) {
        const ids = new Set([r.projectId, ...(r.secondaryProjectIds ?? [])].filter((id): id is string => !!id));
        for (const id of ids) byProject.set(id, (byProject.get(id) ?? 0) + r.seconds);
      }
      let topId: string | null = null;
      let topSeconds = 0;
      for (const [id, seconds] of byProject) {
        if (seconds > topSeconds) {
          topId = id;
          topSeconds = seconds;
        }
      }
      const topProject = topId ? projects.find((p) => p.id === topId) : undefined;
      if (topProject) projectMvp = { title: topProject.title, totalSeconds: topSeconds };
    }

    // この期間中、天気変化の通知機能でキャッシュが残っている日ごとの平均降水確率
    const dailyWeather: { date: string; avgPrecipProbability: number }[] = [];
    if (range && weatherForecasts) {
      // "day"は開始・終了が同日(23:59:59.999差)のため、ms差分の四捨五入では2日分と誤判定されてしまう
      const dayCount = kind === "day" ? 1 : Math.round((range.end.getTime() - range.start.getTime()) / 86400000) + 1;
      if (dayCount > 0 && dayCount <= 31) {
        for (let i = 0; i < dayCount; i++) {
          const d = new Date(range.start.getTime() + i * 86400000);
          const dateStr = todayStr(d);
          const avg = dailyAvgPrecipProbability(weatherForecasts, dateStr);
          if (avg !== null) dailyWeather.push({ date: dateStr, avgPrecipProbability: Math.round(avg) });
        }
      }
    }

    // ToDoの推移（この期間の期首→期末の未完了件数、新規作成・完了件数）
    const todoSummary = range
      ? computeTodoPeriodSummary(todoTasks ?? [], range.start.getTime(), range.end.getTime())
      : null;

    return {
      rangeLabel,
      ranking,
      attention,
      afterHours,
      totalSeconds,
      totalCount,
      prevTotalSeconds,
      topGainer,
      troubleCount: troubleTasks.length,
      troubleTotalSeconds,
      overdueTodos,
      paceWarning,
      periodRecords,
      projectMvp,
      dailyWeather,
      todoSummary,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, masterTasks, dailyTasks, todoTasks, projects, weatherForecasts, kind, afterHoursCutoff, standardDailySeconds, today]);

  const overlayPoints = useMemo(() => {
    if (!records) return [];
    return computeDailyOverlayComparison(records, kind);
  }, [records, kind]);

  // 今期の目標を達成したら、この期間で最初の1回だけ紙吹雪で祝う。設定書き込みの非同期反映による
  // 二重発火を防ぐため同期的なrefで先にラッチする(月次ダイジェスト通知と同じパターン)
  const goalCelebratedFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !goalSeconds || data.totalSeconds < goalSeconds) return;
    if (goalCelebratedKey === periodKey) return;
    if (goalCelebratedFiredRef.current === periodKey) return;
    goalCelebratedFiredRef.current = periodKey;
    fireConfetti();
    setGoalCelebratedKey(periodKey);
  }, [data, goalSeconds, goalCelebratedKey, periodKey, setGoalCelebratedKey]);

  function download() {
    if (!records || !masterTasks) return;
    const text = generateReportText(title, filter, records, masterTasks, afterHoursCutoff, note, todoTasks ?? []);
    const label = kind === "week" ? "weekly" : kind === "month" ? "monthly" : "daily";
    downloadTextFile(`report_${label}_${todayStr()}.txt`, text);
  }

  // 完了した実績を、カレンダーアプリにインポートできる.ics形式でエクスポートする。
  // Googleカレンダーへの自動書き戻し(OAuth連携)は行わず、あえて「エクスポート→手動インポート」
  // という形にしている。このアプリは認証・バックエンドを持たない100%クライアントサイド構成の
  // ままにしたいため
  function downloadIcs() {
    if (!data) return;
    const label = kind === "week" ? "weekly" : kind === "month" ? "monthly" : "daily";
    downloadTextFile(`records_${label}_${todayStr()}.ics`, recordsToIcs(data.periodRecords));
  }

  const totalCost = useMemo(() => {
    if (!data || !costEnabled) return null;
    let sum = 0;
    for (const r of data.ranking) {
      const rate = resolveCategoryRate(r.category, categoryRates, defaultHourlyRate);
      if (rate !== null) sum += computeCost(r.totalSeconds, rate);
    }
    return sum;
  }, [data, costEnabled, categoryRates, defaultHourlyRate]);

  const reportRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  async function downloadPdf() {
    if (!reportRef.current) return;
    setPdfExporting(true);
    try {
      const label = kind === "week" ? "weekly" : kind === "month" ? "monthly" : "daily";
      await exportElementToPdf(reportRef.current, `report_${label}_${todayStr()}.pdf`);
    } finally {
      setPdfExporting(false);
    }
  }

  // バックエンドを介さず、演出テーマや当アプリ自体に依存しない単一の静的HTMLファイルとして
  // 書き出す。ダウンロードしたファイルをそのまま他者にメール添付/共有すれば、
  // ブラウザさえあればオフラインでも開いて見せられる
  function downloadStaticHtml() {
    if (!data) return;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rankingRows = data.ranking
      .slice(0, TOP_N)
      .map(
        (r) =>
          `<tr><td>${esc(r.category)}</td><td>${esc(r.name)}</td><td style="text-align:right">${formatHms(r.totalSeconds)}</td><td style="text-align:right">${r.count}件</td></tr>`
      )
      .join("");
    const attentionRows = data.attention
      .map(
        (a) =>
          `<li>${esc(a.category)} / ${esc(a.name)}: 想定${formatHms(a.estimatedSeconds)} → 平均${formatHms(a.avgSeconds)}（+${Math.round(a.overRatio * 100)}%）</li>`
      )
      .join("");
    const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>${esc(title)} ${esc(data.rangeLabel)}</title>
<style>
body{font-family:-apple-system,"Hiragino Kaku Gothic ProN",sans-serif;max-width:720px;margin:32px auto;padding:0 16px;color:#222;background:#fff;line-height:1.6}
h1{font-size:22px;margin-bottom:4px}
h2{font-size:15px;margin:28px 0 8px;border-bottom:2px solid #333;padding-bottom:4px}
.meta{color:#666;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{border-bottom:1px solid #ddd;padding:6px 8px}
.stat{display:inline-block;margin:4px 16px 4px 0}
.stat b{font-size:18px;display:block}
ul{padding-left:20px;font-size:13px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">${esc(data.rangeLabel)}　生成日時: ${esc(new Date().toLocaleString("ja-JP"))}</p>
<h2>サマリー</h2>
<div class="stat">合計作業時間<b>${formatHms(data.totalSeconds)}</b></div>
<div class="stat">記録件数<b>${data.totalCount}件</b></div>
<div class="stat">要注意項目<b>${data.attention.length}件</b></div>
<h2>作業時間ランキング（上位${Math.min(TOP_N, data.ranking.length)}件）</h2>
<table><tr><th>区分</th><th>作業名</th><th>合計時間</th><th>件数</th></tr>${rankingRows}</table>
${data.attention.length > 0 ? `<h2>要注意項目</h2><ul>${attentionRows}</ul>` : ""}
${
  data.todoSummary
    ? `<h2>ToDoの推移</h2><p>未完了 ${data.todoSummary.openAtStart}件 → ${data.todoSummary.openAtEnd}件（${
        data.todoSummary.openAtEnd - data.todoSummary.openAtStart >= 0 ? "+" : ""
      }${data.todoSummary.openAtEnd - data.todoSummary.openAtStart}）　新規${data.todoSummary.createdInPeriod}件・完了${data.todoSummary.completedInPeriod}件</p>`
    : ""
}
${note ? `<h2>今${periodLabel}の一言</h2><p>${esc(note)}</p>` : ""}
</body></html>`;
    const label = kind === "week" ? "weekly" : kind === "month" ? "monthly" : "daily";
    downloadTextFile(`report_${label}_${todayStr()}.html`, html);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={kind === "day" ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          onClick={() => setKind("day")}
        >
          日報
        </button>
        <button
          className={kind === "week" ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          onClick={() => setKind("week")}
        >
          週報
        </button>
        <button
          className={kind === "month" ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          onClick={() => setKind("month")}
        >
          月報
        </button>
        <button className="btn-pill-outline text-sm" onClick={download} disabled={!data}>
          ダウンロード (.txt)
        </button>
        <button className="btn-pill-outline text-sm" onClick={downloadPdf} disabled={!data || pdfExporting}>
          {pdfExporting ? "PDF作成中..." : "ダウンロード (.pdf)"}
        </button>
        <button className="btn-pill-outline text-sm" onClick={downloadStaticHtml} disabled={!data}>
          静的HTMLで書き出す
        </button>
        <button
          className="btn-pill-outline text-sm print:hidden"
          onClick={() => window.print()}
          disabled={!data}
          title="演出テーマを外したシンプルな見た目で印刷します"
        >
          🖨 印刷用に表示
        </button>
        <button
          className="btn-pill-outline text-sm"
          onClick={downloadIcs}
          disabled={!data}
          title="完了した実績を、カレンダーアプリにインポートできる形式で書き出します"
        >
          実績をカレンダーへ (.ics)
        </button>
      </div>

      {!data ? (
        <p className="text-sm text-cream/50">読み込み中...</p>
      ) : data.ranking.length === 0 ? (
        <div className="panel p-6 text-center text-sm text-cream/50">この期間の実績データはまだありません。</div>
      ) : (
        <div ref={reportRef} id="report-print-area" className="space-y-4">
          <div className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-2xl font-bold text-cream">{title}</h2>
                <p className="text-sm text-cream/60">{data.rangeLabel}</p>
              </div>
              <p className="text-right text-[10px] leading-tight text-cream/40">
                生成日時
                <br />
                {new Date().toLocaleString("ja-JP")}
              </p>
            </div>
            {(data.prevTotalSeconds > 0 || data.totalSeconds > 0) && (
              <p className="mt-3 border-t border-cream/10 pt-3 text-sm text-cream/80">
                前{periodLabel}比{" "}
                <span className={data.totalSeconds - data.prevTotalSeconds >= 0 ? "font-bold text-alert" : "font-bold text-cream"}>
                  {data.totalSeconds - data.prevTotalSeconds >= 0 ? "+" : "-"}
                  {formatHms(Math.abs(data.totalSeconds - data.prevTotalSeconds))}
                </span>
                {data.topGainer && data.topGainer.deltaSeconds > 0 && (
                  <>
                    。特に「{data.topGainer.category} / {data.topGainer.name}」が前{periodLabel}より
                    <span className="font-bold text-cream">{formatHms(data.topGainer.deltaSeconds)}</span>増えました。
                  </>
                )}
              </p>
            )}
          </div>

          {goalSeconds && (
            <div className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-cream/80">🎯 今{periodLabel}の目標達成率</h3>
                <span className="text-sm tabular-nums text-cream/70">
                  {formatHms(data.totalSeconds)} / {formatHms(goalSeconds)}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-cream/5">
                <div
                  className={data.totalSeconds >= goalSeconds ? "h-3 rounded-full bg-cream" : "h-3 rounded-full bg-alert"}
                  style={{ width: `${Math.min(100, (data.totalSeconds / goalSeconds) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-cream/50">
                {data.totalSeconds >= goalSeconds
                  ? "目標を達成しています。"
                  : `達成率 ${Math.round((data.totalSeconds / goalSeconds) * 100)}%（残り ${formatHms(
                      goalSeconds - data.totalSeconds
                    )}）`}
              </p>
            </div>
          )}

          {data.paceWarning && (
            <div className="panel border border-alert/40 p-4">
              <h3 className="mb-1 font-display text-sm font-bold text-alert">⏰ 週後半の進捗遅れ警告</h3>
              <p className="text-sm text-cream/80">
                週の残りが少なくなってきましたが、ここまでの実績は
                <span className="mx-1 font-bold tabular-nums text-alert">{formatHms(data.paceWarning.actualSeconds)}</span>
                です（目安 {formatHms(data.paceWarning.expectedSeconds)}）。ペースに遅れがないか確認しましょう。
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="合計作業時間" value={formatHms(data.totalSeconds)} />
            <StatTile label="記録件数" value={`${data.totalCount}件`} />
            <StatTile label="対象タスク数" value={`${data.ranking.length}種類`} />
            <StatTile
              label={`${afterHoursCutoff}以降`}
              value={formatHms(data.afterHours.totalSeconds)}
              accent={data.afterHours.totalSeconds > 0}
            />
            <StatTile
              label="要注意項目"
              value={`${data.attention.length}件`}
              accent={data.attention.length > 0}
            />
            {totalCost !== null && <StatTile label="💰 概算コスト" value={formatYen(totalCost)} />}
          </div>

          {data.ranking.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {data.ranking.slice(0, 3).map((r, i) => (
                <div key={r.key} className="panel flex items-center gap-3 p-4">
                  <span className="text-3xl">{MEDALS[i]}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs text-cream/50">{r.category}</div>
                    <div className="truncate text-sm font-bold text-cream">{r.name}</div>
                    <div className="font-display text-lg font-bold tabular-nums text-cream">
                      {formatHms(r.totalSeconds)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.projectMvp && (
            <div className="panel flex items-center gap-3 p-4">
              <span className="text-3xl">🏆</span>
              <div className="min-w-0">
                <div className="text-xs text-cream/50">今{periodLabel}の案件MVP（最も時間を投じた案件）</div>
                <div className="truncate text-sm font-bold text-cream">{data.projectMvp.title}</div>
                <div className="font-display text-lg font-bold tabular-nums text-cream">
                  {formatHms(data.projectMvp.totalSeconds)}
                </div>
              </div>
            </div>
          )}

          {overlayPoints.length > 1 && (
            <div className="panel p-4">
              <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
                📈 前{periodLabel}との重ね合わせ比較（日別）
              </h3>
              <OverlayLineChart
                points={overlayPoints.map((p) => ({
                  key: p.key,
                  label: p.label,
                  currentSeconds: p.currentSeconds,
                  previousSeconds: p.previousSeconds,
                }))}
                formatValue={formatHms}
                currentLabel={`今${periodLabel}`}
                previousLabel={`前${periodLabel}`}
              />
            </div>
          )}

          {data.dailyWeather.length > 0 && (
            <div className="panel p-4 print:hidden">
              <h3 className="mb-3 font-display text-sm font-bold text-cream/80">🌤 期間中の天気（降水確率）</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {data.dailyWeather.map((w) => (
                  <span
                    key={w.date}
                    className={`rounded-full border px-2.5 py-1 ${
                      w.avgPrecipProbability >= 50 ? "border-alert/40 text-alert" : "border-cream/15 text-cream/70"
                    }`}
                  >
                    {w.date.slice(5)}: {w.avgPrecipProbability >= 50 ? "☔" : "☀️"} {w.avgPrecipProbability}%
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-cream/40">
                天気変化の通知機能でキャッシュされた予報データが残っている日のみ表示します。
              </p>
            </div>
          )}

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
              📊 作業時間ランキング（上位{Math.min(TOP_N, data.ranking.length)}件）
            </h3>
            <RankingBarChart
              data={data.ranking.slice(0, TOP_N).map((r) => ({
                label: r.name,
                sublabel: r.category,
                value: r.totalSeconds,
              }))}
              formatValue={formatHms}
            />
            {data.ranking.length > TOP_N && (
              <p className="mt-3 text-[10px] text-cream/40">他{data.ranking.length - TOP_N}件（.txtダウンロードで全件確認できます）</p>
            )}
          </div>

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
              🌙 定時（{afterHoursCutoff}）以降の業務
            </h3>
            {data.afterHours.totalSeconds === 0 ? (
              <p className="text-sm text-cream/50">定時以降の実績はありません。</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-cream/70">
                  合計 <span className="font-display text-lg font-bold text-alert">{formatHms(data.afterHours.totalSeconds)}</span>
                  {data.totalSeconds > 0 && (
                    <span className="ml-2 text-xs text-cream/50">
                      （全体の{Math.round((data.afterHours.totalSeconds / data.totalSeconds) * 100)}%）
                    </span>
                  )}
                </p>
                <RankingBarChart
                  data={data.afterHours.byTask.slice(0, TOP_N).map((r) => ({
                    label: r.label,
                    sublabel: r.sublabel,
                    value: r.seconds,
                  }))}
                  formatValue={formatHms}
                />
                {data.afterHours.byTask.length > TOP_N && (
                  <p className="mt-3 text-[10px] text-cream/40">他{data.afterHours.byTask.length - TOP_N}件</p>
                )}
              </>
            )}
          </div>

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
              ⚠️ 要注意項目（想定比+30%以上の超過）
            </h3>
            {data.attention.length === 0 ? (
              <p className="text-sm text-cream/50">該当なし。想定比+30%以上の超過はありません。</p>
            ) : (
              <div className="space-y-2">
                {data.attention.map((a) => (
                  <AttentionRowCard key={a.masterTaskId} row={a} />
                ))}
              </div>
            )}
          </div>

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">⚡ トラブル対応</h3>
            {data.troubleCount === 0 ? (
              <p className="text-sm text-cream/50">この期間、トラブル対応の発生はありませんでした。</p>
            ) : (
              <p className="text-sm text-cream/70">
                発生 <span className="font-display text-lg font-bold text-alert">{data.troubleCount}件</span>
                　合計対応時間 <span className="font-bold text-cream">{formatHms(data.troubleTotalSeconds)}</span>
                　平均 <span className="font-bold text-cream">{formatHms(data.troubleTotalSeconds / data.troubleCount)}</span>
                /件
              </p>
            )}
          </div>

          <div className="panel p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-cream/80">
              📅 ToDoの期限超過タスク（{data.overdueTodos.length}件）
            </h3>
            {data.overdueTodos.length === 0 ? (
              <p className="text-sm text-cream/50">期限超過のタスクはありません。</p>
            ) : (
              <div className="space-y-1.5">
                {data.overdueTodos.map(({ task, due }) => (
                  <div key={task.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                    <span className="truncate text-sm text-cream">{task.title}</span>
                    <span className="shrink-0 text-xs font-bold text-alert">
                      {due} （{daysBetweenDateStrs(due, today)}日超過）
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.todoSummary && (
            <div className="panel p-4">
              <h3 className="mb-3 font-display text-sm font-bold text-cream/80">📋 ToDoの推移</h3>
              <p className="text-sm text-cream/70">
                未完了{" "}
                <span className="font-display text-lg font-bold text-cream">{data.todoSummary.openAtStart}件</span>
                {" → "}
                <span className="font-display text-lg font-bold text-cream">{data.todoSummary.openAtEnd}件</span>
                {(() => {
                  const delta = data.todoSummary.openAtEnd - data.todoSummary.openAtStart;
                  return (
                    <span className={delta > 0 ? "ml-1 font-bold text-alert" : "ml-1 font-bold text-cream/60"}>
                      （{delta >= 0 ? "+" : ""}
                      {delta}）
                    </span>
                  );
                })()}
              </p>
              <p className="mt-1 text-xs text-cream/50">
                この期間の新規作成 {data.todoSummary.createdInPeriod}件・完了 {data.todoSummary.completedInPeriod}件
              </p>
            </div>
          )}

          <div className="panel space-y-2 p-4">
            <h3 className="font-display text-sm font-bold text-cream/80">🪞 {reflectionQuestion}</h3>
            <input
              type="text"
              value={reflectionAnswer}
              onChange={(e) => setReflectionAnswer(e.target.value)}
              placeholder="一言で構いません"
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <p className="text-[10px] text-cream/40">
              負担にならないよう、この1問だけです。答えなくても構いません。
            </p>
          </div>

          <div className="panel space-y-2 p-4">
            <h3 className="font-display text-sm font-bold text-cream/80">📝 今{periodLabel}の一言</h3>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`今${periodLabel}の振り返りを自由に書けます（この期間ごとに保存されます）`}
              rows={3}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`panel p-4 ${accent ? "border border-alert/40" : ""}`}>
      <div className="text-xs text-cream/50">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${accent ? "text-alert" : "text-cream"}`}>
        {value}
      </div>
    </div>
  );
}

function AttentionRowCard({ row }: { row: AttentionRow }) {
  const estPct = Math.min(100, (row.estimatedSeconds / row.avgSeconds) * 100);
  return (
    <div className="rounded-lg border border-alert/30 bg-alert/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-cream/50">{row.category}</div>
          <div className="text-sm font-bold text-cream">{row.name}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-cream/50">
            想定 {formatHms(row.estimatedSeconds)} → 平均 {formatHms(row.avgSeconds)}（{row.sampleCount}件）
          </div>
          <div className="font-display text-lg font-bold text-alert">+{Math.round(row.overRatio * 100)}%</div>
        </div>
      </div>
      <div className="relative mt-2 h-2.5 w-full overflow-hidden rounded bg-cream/5">
        <div className="absolute inset-y-0 left-0 bg-cream/40" style={{ width: `${estPct}%` }} />
        <div className="absolute inset-y-0 bg-alert" style={{ left: `${estPct}%`, right: 0 }} />
      </div>
    </div>
  );
}
