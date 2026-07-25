import type { WorkRecord } from "./types";

const HEADERS = [
  "id",
  "date",
  "category",
  "name",
  "seconds",
  "startedAt",
  "endedAt",
  "excludedFromStats",
  "excludeReason",
] as const;

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function recordsToCsv(records: WorkRecord[]): string {
  const rows = [HEADERS.join(",")];
  for (const r of records) {
    rows.push(
      [
        r.id,
        r.date,
        csvEscape(r.category),
        csvEscape(r.name),
        String(r.seconds),
        String(r.startedAt),
        String(r.endedAt),
        String(r.excludedFromStats),
        r.excludeReason ?? "",
      ].join(",")
    );
  }
  return rows.join("\n");
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

export interface ParsedCsvResult {
  records: Omit<WorkRecord, "masterTaskId">[];
  errors: string[];
}

export function parseRecordsCsv(text: string): ParsedCsvResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { records: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["date", "category", "name", "seconds"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { records: [], errors };

  const records: Omit<WorkRecord, "masterTaskId">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const date = cols[idx("date")]?.trim();
    const category = cols[idx("category")]?.trim();
    const name = cols[idx("name")]?.trim();
    const seconds = Number(cols[idx("seconds")]);
    if (!date || !category || !name || Number.isNaN(seconds)) {
      errors.push(`${i + 1}行目: 不正な行をスキップしました`);
      continue;
    }
    const idCol = idx("id");
    const startedAtCol = idx("startedAt");
    const endedAtCol = idx("endedAt");
    const excludedCol = idx("excludedFromStats");
    const reasonCol = idx("excludeReason");
    const now = Date.now();
    records.push({
      id: idCol !== -1 && cols[idCol] ? cols[idCol] : crypto.randomUUID(),
      date,
      category,
      name,
      seconds,
      startedAt: startedAtCol !== -1 && cols[startedAtCol] ? Number(cols[startedAtCol]) : now,
      endedAt: endedAtCol !== -1 && cols[endedAtCol] ? Number(cols[endedAtCol]) : now,
      excludedFromStats: excludedCol !== -1 ? cols[excludedCol] === "true" : false,
      excludeReason:
        reasonCol !== -1 && (cols[reasonCol] === "auto-iqr" || cols[reasonCol] === "manual")
          ? (cols[reasonCol] as "auto-iqr" | "manual")
          : undefined,
    });
  }
  return { records, errors };
}
