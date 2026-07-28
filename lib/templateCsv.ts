import type { TemplateItem, Weekday } from "./types";
import { WEEKDAY_LABELS } from "./types";
import { csvEscape, parseCsvLine } from "./csv";
import { formatHms, parseHmsToSeconds } from "./time";

const HEADERS = ["id", "weekday", "order", "category", "name", "estimatedSeconds"] as const;

const WEEKDAY_BY_LABEL: Record<string, Weekday> = { 月: 1, 火: 2, 水: 3, 木: 4, 金: 5 };

export function templateItemsToCsv(items: TemplateItem[]): string {
  const rows = [HEADERS.join(",")];
  const sorted = [...items].sort((a, b) => a.weekday - b.weekday || a.order - b.order);
  for (const t of sorted) {
    rows.push(
      [t.id, WEEKDAY_LABELS[t.weekday], String(t.order), csvEscape(t.category), csvEscape(t.name), formatHms(t.estimatedSeconds)].join(
        ","
      )
    );
  }
  return rows.join("\n");
}

export function templateCsvTemplate(): string {
  const rows = [
    HEADERS.join(","),
    ["", "月", "0", "組立", "部品A取付", "00:15:00"].join(","),
    ["", "月", "1", "検査", "外観チェック", "00:05:00"].join(","),
  ];
  return rows.join("\n");
}

export interface ParsedTemplateRow {
  id?: string;
  weekday: Weekday;
  order?: number;
  category: string;
  name: string;
  estimatedSeconds: number;
}

export interface ParsedTemplateCsvResult {
  rows: ParsedTemplateRow[];
  errors: string[];
}

function parseWeekday(raw: string): Weekday | null {
  const trimmed = raw.trim();
  if (trimmed in WEEKDAY_BY_LABEL) return WEEKDAY_BY_LABEL[trimmed];
  const n = Number(trimmed);
  if (n >= 1 && n <= 5) return n as Weekday;
  return null;
}

export function parseTemplateCsv(text: string): ParsedTemplateCsvResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["weekday", "category", "name", "estimatedSeconds"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const idCol = idx("id");
  const orderCol = idx("order");
  const rows: ParsedTemplateRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const weekday = parseWeekday(cols[idx("weekday")] ?? "");
    const category = cols[idx("category")]?.trim();
    const name = cols[idx("name")]?.trim();
    const estimatedRaw = cols[idx("estimatedSeconds")]?.trim();
    if (!weekday || !category || !name || !estimatedRaw) {
      errors.push(`${i + 1}行目: weekday・category・name・estimatedSecondsが不正なためスキップしました`);
      continue;
    }
    const estimatedSeconds = estimatedRaw.includes(":") ? parseHmsToSeconds(estimatedRaw) : Number(estimatedRaw);
    if (Number.isNaN(estimatedSeconds)) {
      errors.push(`${i + 1}行目: 想定時間の形式が不正です（hh:mm:ss または秒数）`);
      continue;
    }
    rows.push({
      id: idCol !== -1 && cols[idCol] ? cols[idCol].trim() : undefined,
      weekday,
      order: orderCol !== -1 && cols[orderCol]?.trim() ? Number(cols[orderCol]) : undefined,
      category,
      name,
      estimatedSeconds,
    });
  }
  return { rows, errors };
}
