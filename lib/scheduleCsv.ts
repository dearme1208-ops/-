import { csvEscape, parseCsvLine } from "./csv";

const HEADERS = ["date", "category", "name", "startTime", "endTime", "notes"] as const;

export interface ScheduleRow {
  date: string; // YYYY-MM-DD
  category: string;
  name: string;
  startTime: string; // HH:MM。この時刻になったら自動的に差し込み開始する
  endTime?: string; // HH:MM。想定時間の算出に使う（省略可）
  notes?: string;
}

export function scheduleCsvTemplate(): string {
  const rows = [
    HEADERS.join(","),
    ["2026-08-10", "予定", "散髪", "10:00", "13:30", ""].join(","),
    ["2026-08-10", "予定", "定例会議", "15:00", "16:00", "会議室A"].join(","),
  ];
  return rows.join("\n");
}

export interface ParsedScheduleCsvResult {
  rows: ScheduleRow[];
  errors: string[];
}

const TIME_RE = /^\d{1,2}:\d{2}$/;

export function parseScheduleCsv(text: string): ParsedScheduleCsvResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["date", "name", "startTime"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const col = (cols: string[], name: string) => {
    const i = idx(name);
    return i !== -1 ? cols[i]?.trim() : undefined;
  };

  const rows: ScheduleRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const date = col(cols, "date");
    const name = col(cols, "name");
    const startTime = col(cols, "startTime");
    if (!date || !name || !startTime || !TIME_RE.test(startTime)) {
      errors.push(`${i + 1}行目: date・name・startTime(HH:MM)が不正なためスキップしました`);
      continue;
    }
    const endTime = col(cols, "endTime");
    rows.push({
      date,
      category: col(cols, "category") || "予定",
      name,
      startTime,
      endTime: endTime && TIME_RE.test(endTime) ? endTime : undefined,
      notes: col(cols, "notes") || undefined,
    });
  }
  return { rows, errors };
}

export function scheduleRowsToCsv(rows: ScheduleRow[]): string {
  const lines = [HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.date, csvEscape(r.category), csvEscape(r.name), r.startTime, r.endTime ?? "", csvEscape(r.notes ?? "")].join(
        ","
      )
    );
  }
  return lines.join("\n");
}
