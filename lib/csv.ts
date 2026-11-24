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
  // 開始・終了を人が読める形でも書き出す(下の formatCsvDateTime のコメント参照)。
  // 以前のファイルや他の道具との互換のため、startedAt/endedAtの列もそのまま残す
  "開始時刻",
  "終了時刻",
] as const;

// startedAt/endedAtは13桁の数値(ミリ秒)なので、Excelで開いて保存し直すと「1.7636E+12」に
// 丸められて元の時刻が分からなくなる。Excelが日時として扱える形(端末の現地時刻)でも
// 書き出しておき、取り込みではこちらを手掛かりに復元できるようにする
function formatCsvDateTime(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 「2026-11-20 09:53:20」や、Excelが書き換えた「2026/11/20 9:53」を現地時刻のミリ秒にする。
// 読めなければundefined
function parseCsvDateTime(raw: string | undefined): number | undefined {
  const m = raw?.trim().match(/^(\S+?)[ T\u3000]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (!m) return undefined;
  const date = normalizeCsvDate(m[1]);
  if (!date) return undefined;
  const [h, min, sec] = [Number(m[2]), Number(m[3]), Number(m[4] ?? 0)];
  if (h > 23 || min > 59 || sec > 59) return undefined;
  const [y, mo, d] = date.split("-").map(Number);
  const ms = new Date(y, mo - 1, d, h, min, sec).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

// startedAt/endedAtの列(ミリ秒の数値)を読む。空・数値でない値に加えて、Excelが丸めた
// 指数表記(1.7636E+12)も「読めない」として扱う。指数表記はNumber()では数値として通って
// しまうが、下の桁が失われていて元の時刻とは最大で1日以上ずれている
function parseCsvEpochMs(raw: string | undefined): number | undefined {
  const v = raw?.trim();
  if (!v || /e/i.test(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

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
        formatCsvDateTime(r.startedAt),
        formatCsvDateTime(r.endedAt),
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
  /**
   * records と同じ並びで、その行のCSVに実際に値があった項目。既存の実績へ取り込み直す時は
   * これだけを上書きする(CSVに無い案件・段階・ToDo・メモ・区間などを消さないように)
   */
  provided: (keyof WorkRecord)[][];
}

/** 実績CSVの取り込み計画 */
export interface RecordsImportPlan {
  /** 新しいIDの行 */
  added: Omit<WorkRecord, "masterTaskId">[];
  /** 既にあるIDの行(before: 今の実績、after: CSVの列だけを重ねたもの) */
  updated: { before: WorkRecord; after: WorkRecord }[];
}

/**
 * 既にあるIDの実績へは、CSVにある列だけを重ねる。CSVに無い項目(案件・段階・ToDo・メモ・区間・
 * トラブル・兼務・手動の除外指定など)は今の実績のまま残す。
 * 区分・作業名が変わらなければ作業マスタの紐付けも今のまま。開始・終了を変えた行は区間を捨てる
 * (区間と開始〜終了が食い違うため)
 */
export function planRecordsImport(
  parsed: Pick<ParsedCsvResult, "records" | "provided">,
  existingById: Map<string, WorkRecord>
): RecordsImportPlan {
  const added: RecordsImportPlan["added"] = [];
  const updated: RecordsImportPlan["updated"] = [];
  parsed.records.forEach((row, i) => {
    const before = existingById.get(row.id);
    if (!before) {
      added.push(row);
      return;
    }
    const after: WorkRecord = { ...before };
    const target = after as unknown as Record<string, unknown>;
    for (const key of parsed.provided[i] ?? []) target[key] = (row as Record<string, unknown>)[key];
    if (after.startedAt !== before.startedAt || after.endedAt !== before.endedAt) after.segments = undefined;
    updated.push({ before, after });
  });
  return { added, updated };
}

export function parseRecordsCsv(text: string): ParsedCsvResult {
  const lines = csvLines(text);
  const errors: string[] = [];
  if (lines.length === 0) return { records: [], errors: ["空のファイルです"], provided: [] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["date", "category", "name", "seconds"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { records: [], errors, provided: [] };

  const records: Omit<WorkRecord, "masterTaskId">[] = [];
  const provided: (keyof WorkRecord)[][] = [];
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
    const startedTextCol = idx("開始時刻");
    const endedTextCol = idx("終了時刻");
    // 開始・終了は、数値(ミリ秒)の列と、人が読める日時の列の2通りで書き出している。
    // ・両方読めて1分以内の差なら、ミリ秒まで残っている数値の列を使う
    //   (Excelは日時の秒を落として保存することがあるため、差が小さい時は数値の方が正確)
    // ・食い違う時は日時の列を使う(Excelで時刻を手直しした、とみなす)
    // ・数値の列が空・指数表記に丸められた等で読めない時も日時の列を使う
    // ・どちらも読めなければ、従来どおり取り込んだ時刻にする
    // 読めた時刻の項目(取り込んだ時刻で埋めたものは「CSVに値があった」に含めない)
    const readTimes = new Set<"startedAt" | "endedAt">();
    const msCol = (col: number, textCol: number, key: "startedAt" | "endedAt") => {
      const epoch = col !== -1 ? parseCsvEpochMs(cols[col]) : undefined;
      const fromText = textCol !== -1 ? parseCsvDateTime(cols[textCol]) : undefined;
      if (epoch !== undefined || fromText !== undefined) readTimes.add(key);
      if (epoch !== undefined && fromText !== undefined) return Math.abs(epoch - fromText) < 60_000 ? epoch : fromText;
      if (epoch === undefined && fromText === undefined && col !== -1 && /\d\s*e\s*\+?\d/i.test(cols[col] ?? "")) rounded = true;
      return epoch ?? fromText ?? now;
    };
    let rounded = false;
    const startedAt = msCol(startedAtCol, startedTextCol, "startedAt");
    const endedAt = msCol(endedAtCol, endedTextCol, "endedAt");
    // 行は取り込むが、時刻が元どおりでないことは黙って通さずに知らせる
    if (rounded) {
      errors.push(`${i + 1}行目: 開始・終了の時刻がExcelで丸められていて(1.7E+12 のような形)読めないため、取り込んだ時刻にしました`);
    }
    records.push({
      id: idCol !== -1 && cols[idCol]?.trim() ? cols[idCol].trim() : crypto.randomUUID(),
      date,
      category,
      name,
      method: methodCol !== -1 && cols[methodCol] ? cols[methodCol] : undefined,
      seconds,
      startedAt,
      endedAt,
      excludedFromStats: excludedCol !== -1 ? /^true$/i.test(cols[excludedCol]?.trim() ?? "") : false,
      excludeReason:
        reasonCol !== -1 && (cols[reasonCol] === "auto-iqr" || cols[reasonCol] === "manual")
          ? (cols[reasonCol] as "auto-iqr" | "manual")
          : undefined,
    });
    const keys: (keyof WorkRecord)[] = ["date", "category", "name", "seconds", ...readTimes];
    if (methodCol !== -1) keys.push("method");
    if (excludedCol !== -1) keys.push("excludedFromStats");
    if (reasonCol !== -1) keys.push("excludeReason");
    provided.push(keys);
  }
  return { records, errors, provided };
}
