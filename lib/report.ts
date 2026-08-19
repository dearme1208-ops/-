import { subDays, subMonths, subWeeks } from "date-fns";
import type { MasterTask, WorkRecord } from "./types";
import { aggregateRecords } from "./aggregate";
import { computeAttentionList } from "./attention";
import { computeAfterHoursBreakdown } from "./overtime";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "./period";
import { formatHms, todayStr } from "./time";

const WEEKDAY_JP_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

export interface OverlayPoint {
  key: string;
  label: string;
  currentSeconds: number;
  previousSeconds: number;
}

// 今日/今週/今月と前日/前週/前月を、同じ日次インデックス(週なら曜日、月なら日付、
// 日なら1点のみ)で重ね合わせて比較するためのデータを作る。週報・月報の推移グラフで使う。
// 日報は期間が1日のみのため、呼び出し側では点が2点未満の場合はグラフを表示しない運用にしている
export function computeDailyOverlayComparison(
  records: WorkRecord[],
  kind: "day" | "week" | "month",
  now: Date = new Date()
): OverlayPoint[] {
  const currentRange = getPeriodRange({ type: kind }, now);
  const prevNow = kind === "week" ? subWeeks(now, 1) : kind === "month" ? subMonths(now, 1) : subDays(now, 1);
  const prevRange = getPeriodRange({ type: kind }, prevNow);
  if (!currentRange || !prevRange) return [];

  function dailyTotals(range: { start: Date; end: Date }): Map<string, number> {
    const map = new Map<string, number>();
    for (const r of records) {
      if (!isDateStrInRange(r.date, range)) continue;
      map.set(r.date, (map.get(r.date) ?? 0) + r.seconds);
    }
    return map;
  }

  const currentTotals = dailyTotals(currentRange);
  const prevTotals = dailyTotals(prevRange);
  // "day"は開始・終了が同日(23:59:59.999差)のため、ms差分の四捨五入では2日分と誤判定されてしまう。
  // 日報は元々1点しか意味を持たないため、ここで固定で1日分とする
  const dayCount = kind === "day" ? 1 : Math.round((currentRange.end.getTime() - currentRange.start.getTime()) / 86400000) + 1;

  const points: OverlayPoint[] = [];
  for (let i = 0; i < dayCount; i++) {
    const curDate = new Date(currentRange.start.getTime() + i * 86400000);
    const prevDate = new Date(prevRange.start.getTime() + i * 86400000);
    points.push({
      key: String(i),
      label: kind === "week" ? WEEKDAY_JP_SHORT[curDate.getDay()] : kind === "month" ? String(curDate.getDate()) : todayStr(curDate).slice(5),
      currentSeconds: currentTotals.get(todayStr(curDate)) ?? 0,
      previousSeconds: prevTotals.get(todayStr(prevDate)) ?? 0,
    });
  }
  return points;
}

export function generateReportText(
  title: string,
  filter: PeriodFilter,
  records: WorkRecord[],
  masterTasks: MasterTask[],
  afterHoursCutoff = "18:00",
  note = ""
): string {
  const range = getPeriodRange(filter);
  const rangeLabel = range
    ? `${range.start.toISOString().slice(0, 10)} 〜 ${range.end.toISOString().slice(0, 10)}`
    : "累計";

  const ranking = aggregateRecords(records, filter, "total");
  const periodRecords = records.filter((r) => isDateStrInRange(r.date, range));
  const attention = computeAttentionList(masterTasks, periodRecords);
  const afterHours = computeAfterHoursBreakdown(periodRecords, afterHoursCutoff);

  const lines: string[] = [];
  lines.push(`===== ${title} (${rangeLabel}) =====`);
  lines.push("");
  lines.push("【作業時間ランキング】");
  if (ranking.length === 0) {
    lines.push("（データなし）");
  } else {
    ranking.slice(0, 20).forEach((r, i) => {
      lines.push(
        `${i + 1}. ${r.category} / ${r.name} - 合計 ${formatHms(r.totalSeconds)} (平均 ${formatHms(
          r.avgSeconds
        )}, ${r.count}件)`
      );
    });
  }
  lines.push("");
  lines.push(`【定時（${afterHoursCutoff}）以降の業務】`);
  if (afterHours.totalSeconds === 0) {
    lines.push("（該当なし）");
  } else {
    lines.push(`合計 ${formatHms(afterHours.totalSeconds)}`);
    afterHours.byTask.slice(0, 20).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.sublabel} / ${r.label} - ${formatHms(r.seconds)}`);
    });
  }
  lines.push("");
  lines.push("【要注意項目】(想定比+30%以上の超過)");
  if (attention.length === 0) {
    lines.push("（該当なし）");
  } else {
    attention.forEach((a) => {
      lines.push(
        `- ${a.category} / ${a.name}: 想定 ${formatHms(a.estimatedSeconds)} → 平均 ${formatHms(
          a.avgSeconds
        )} (+${Math.round(a.overRatio * 100)}%)`
      );
    });
  }
  if (note.trim()) {
    lines.push("");
    lines.push(`【今${title === "週報" ? "週" : title === "月報" ? "月" : "日"}の一言】`);
    lines.push(note.trim());
  }
  lines.push("");
  lines.push(`生成日時: ${new Date().toLocaleString("ja-JP")}`);
  return lines.join("\n");
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
