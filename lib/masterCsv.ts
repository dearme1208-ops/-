import type { MasterTask } from "./types";
import { csvEscape, parseCsvLine } from "./csv";
import { formatHms, parseHmsToSeconds } from "./time";

const HEADERS = ["id", "category", "name", "estimatedSeconds", "isFavorite"] as const;

export function masterTasksToCsv(tasks: MasterTask[]): string {
  const rows = [HEADERS.join(",")];
  for (const t of tasks) {
    rows.push(
      [
        t.id,
        csvEscape(t.category),
        csvEscape(t.name),
        formatHms(t.estimatedSeconds),
        String(t.isFavorite),
      ].join(",")
    );
  }
  return rows.join("\n");
}

export function masterCsvTemplate(): string {
  const rows = [
    HEADERS.join(","),
    ["", "組立", "部品A取付", "00:15:00", "false"].join(","),
    ["", "検査", "外観チェック", "00:05:00", "true"].join(","),
  ];
  return rows.join("\n");
}

export interface ParsedMasterRow {
  id?: string;
  category: string;
  name: string;
  estimatedSeconds: number;
  isFavorite: boolean;
}

export interface ParsedMasterCsvResult {
  rows: ParsedMasterRow[];
  errors: string[];
}

export function parseMasterCsv(text: string): ParsedMasterCsvResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["category", "name", "estimatedSeconds"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const idCol = idx("id");
  const favCol = idx("isFavorite");
  const rows: ParsedMasterRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const category = cols[idx("category")]?.trim();
    const name = cols[idx("name")]?.trim();
    const estimatedRaw = cols[idx("estimatedSeconds")]?.trim();
    if (!category || !name || !estimatedRaw) {
      errors.push(`${i + 1}行目: category・name・estimatedSecondsが空のためスキップしました`);
      continue;
    }
    const estimatedSeconds = estimatedRaw.includes(":")
      ? parseHmsToSeconds(estimatedRaw)
      : Number(estimatedRaw);
    if (Number.isNaN(estimatedSeconds)) {
      errors.push(`${i + 1}行目: 想定時間の形式が不正です（hh:mm:ss または秒数）`);
      continue;
    }
    rows.push({
      id: idCol !== -1 && cols[idCol] ? cols[idCol].trim() : undefined,
      category,
      name,
      estimatedSeconds,
      isFavorite: favCol !== -1 ? cols[favCol]?.trim() === "true" : false,
    });
  }
  return { rows, errors };
}
