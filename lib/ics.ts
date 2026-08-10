import type { WorkRecord } from "./types";

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// epoch msをICSのUTC形式(YYYYMMDDTHHMMSSZ)に変換する
function toIcsUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// 実績(WorkRecord)を、Googleカレンダー等にインポートできるiCalendar(.ics)形式のテキストに変換する。
// 「実績→カレンダーへの逆輸出」を、OAuth連携無しで実現するための手段。開始/終了時刻が
// 無い実績(手動で秒数のみ記録したもの等)は対象外とする
export function recordsToIcs(records: WorkRecord[]): string {
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//koutei-hyo//JA", "CALSCALE:GREGORIAN"];
  const now = toIcsUtc(Date.now());

  for (const r of records) {
    if (!r.startedAt || !r.endedAt || r.endedAt <= r.startedAt) continue;
    const summary = escapeIcsText(`${r.category} / ${r.name}`);
    const descriptionParts = [`実績時間: ${Math.round(r.seconds / 60)}分`];
    if (r.note) descriptionParts.push(`メモ: ${r.note}`);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@koutei-hyo`,
      `DTSTAMP:${now}`,
      `DTSTART:${toIcsUtc(r.startedAt)}`,
      `DTEND:${toIcsUtc(r.endedAt)}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join("\\n"))}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
