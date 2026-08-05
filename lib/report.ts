import type { MasterTask, WorkRecord } from "./types";
import { aggregateRecords } from "./aggregate";
import { computeAttentionList } from "./attention";
import { computeAfterHoursBreakdown } from "./overtime";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "./period";
import { formatHms } from "./time";

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
    lines.push(`【今${title === "週報" ? "週" : "月"}の一言】`);
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
