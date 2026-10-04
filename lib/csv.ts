import type { WorkRecord } from "./types";

const HEADERS = [
  "id",
  "date",
  "category",
  "name",
  "method",
  "seconds",
  "startedAt",
  "endedAt",
  "excludedFromStats",
  "excludeReason",
] as const;

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
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
        csvEscape(r.method ?? ""),
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

// CSVの本文を1件ずつの行に分ける。単純に改行で分けると、作業名やメモに改行が入っていて
// 「"…"」で囲まれた値が途中で切れ、以降の列がずれていた(書き出したCSVをそのまま
// 取り込み直すだけで起きる)。囲みの中の改行は値の一部として残す。
// あわせて、Excelの「CSV UTF-8」で保存したファイルの先頭に付く印(BOM)を取り除く。
// これが残ると先頭の列名が一致せず「必須列がありません」になっていた。空行は捨てる
export function csvLines(text: string): string[] {
  const body = text.replace(/^\uFEFF/, "");
  const lines: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      lines.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  lines.push(cur);
  return lines.filter((l) => l.trim() !== "");
}

// 取り込むファイルを文字列として読む。Excelで「CSV」(UTF-8でない方)として保存すると
// Shift_JISになり、そのまま読むと日本語がすべて文字化けして取り込まれていた。
// UTF-8として読めない文字が出たときだけShift_JISとして読み直す
export async function readTextFile(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    const sjis = new TextDecoder("shift_jis", { fatal: true }).decode(buf);
    return sjis;
  } catch {
    return utf8;
  }
}

// 日付の列を YYYY-MM-DD にそろえる。Excelで開いて保存し直すと「2026/9/29」の形に
// 変わるため、そのまま取り込むと日付で絞り込む集計・日報から漏れていた。読めない値はundefined
export function normalizeCsvDate(raw: string): string | undefined {
  const m = raw.trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return undefined;
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 任意の日付の列: 空ならundefined、読める形はYYYY-MM-DDにそろえ、読めない値はそのまま返す
export function csvDate(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  return normalizeCsvDate(v) ?? v;
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
  const lines = csvLines(text);
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
    const dateRaw = cols[idx("date")]?.trim() ?? "";
    const date = normalizeCsvDate(dateRaw);
    const category = cols[idx("category")]?.trim();
    const name = cols[idx("name")]?.trim();
    const secondsRaw = cols[idx("seconds")]?.trim() ?? "";
    const seconds = Number(secondsRaw);
    if (dateRaw && !date) {
      errors.push(`${i + 1}行目: 日付「${dateRaw}」を読めないためスキップしました(2026-09-29 の形で入れてください)`);
      continue;
    }
    if (!date || !category || !name || secondsRaw === "" || !Number.isFinite(seconds) || seconds < 0) {
      errors.push(`${i + 1}行目: 不正な行をスキップしました`);
      continue;
    }
    const idCol = idx("id");
    const methodCol = idx("method");
    const startedAtCol = idx("startedAt");
    const endedAtCol = idx("endedAt");
    const excludedCol = idx("excludedFromStats");
    const reasonCol = idx("excludeReason");
    const now = Date.now();
    // 開始・終了は書き出した時の数値(ミリ秒)。空や読めない値なら取り込んだ時刻にする
    const msCol = (col: number) => {
      const v = col !== -1 ? Number(cols[col]?.trim() || NaN) : NaN;
      return Number.isFinite(v) ? v : now;
    };
    records.push({
      id: idCol !== -1 && cols[idCol]?.trim() ? cols[idCol].trim() : crypto.randomUUID(),
      date,
      category,
      name,
      method: methodCol !== -1 && cols[methodCol] ? cols[methodCol] : undefined,
      seconds,
      startedAt: msCol(startedAtCol),
      endedAt: msCol(endedAtCol),
      excludedFromStats: excludedCol !== -1 ? /^true$/i.test(cols[excludedCol]?.trim() ?? "") : false,
      excludeReason:
        reasonCol !== -1 && (cols[reasonCol] === "auto-iqr" || cols[reasonCol] === "manual")
          ? (cols[reasonCol] as "auto-iqr" | "manual")
          : undefined,
    });
  }
  return { records, errors };
}
