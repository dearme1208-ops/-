import type { ProjectItem, ProjectStage } from "./types";
import { csvEscape, csvLines, normalizeCsvDate, parseCsvLine } from "./csv";
import { todayStr } from "./time";

const HEADERS = ["id", "title", "group", "category", "workName", "dueDate", "createdDate", "completed", "stages"] as const;

// 段階(ProjectStage)は1セルに「タイトル:期日:目標件数」を;区切りで詰めて表現する
// (例: 初稿作成:2026-08-20:;検収立会:2026-08-25:5 )。期日・目標件数は空でもよい。
// タイトルに含まれる区切り文字(":" ";")と"\"は、前に"\"を置いて書き出す。
// 以前はそのまま書き出していたため、「10:30 客先打合せ」のような段階名が取り込み直しで
// 「10」という別の段階になり、元の段階の完了状態や添付が引き継がれなくなっていた
function escapeStageTitle(title: string): string {
  return title.replace(/[\\:;]/g, (ch) => "\\" + ch);
}

function serializeStages(stages: ProjectStage[] | undefined): string {
  if (!stages || stages.length === 0) return "";
  return stages
    .map((s) => `${escapeStageTitle(s.title)}:${s.dueDate ?? ""}:${s.targetCount != null ? s.targetCount : ""}`)
    .join(";");
}

export function projectsToCsv(projects: ProjectItem[]): string {
  const rows = [HEADERS.join(",")];
  for (const p of projects) {
    rows.push(
      [
        p.id,
        csvEscape(p.title),
        csvEscape(p.groupName ?? ""),
        csvEscape(p.category),
        csvEscape(p.workName),
        p.dueDate,
        todayStr(new Date(p.createdAt)),
        String(!!p.completedAt),
        csvEscape(serializeStages(p.stages)),
      ].join(",")
    );
  }
  return rows.join("\n");
}

export function projectsCsvTemplate(): string {
  const today = todayStr();
  const rows = [
    HEADERS.join(","),
    ["", "A社案件(型番X)", "A社案件", "組立", "本体組立", today, today, "false", csvEscape("初稿作成:" + today + ":;先方送付::")].join(
      ","
    ),
    ["", "B社案件", "", "検査", "出荷前検査", today, today, "false", ""].join(","),
  ];
  return rows.join("\n");
}

export interface ParsedProjectStage {
  title: string;
  dueDate?: string;
  targetCount?: number;
}

export interface ParsedProjectRow {
  id?: string;
  title: string;
  // 未定義=CSVにgroup列自体が無い(既存のグループ名には触れない)。空文字はグループ解除。
  groupName?: string;
  category: string;
  workName: string;
  dueDate: string;
  createdDate?: string;
  completed: boolean;
  // 未定義=CSVにstages列自体が無い/空セル(既存の段階には触れない)。
  // 値があれば、その内容で段階を作成・更新する(ここに無い既存の段階は消さずに残す)
  stages?: ParsedProjectStage[];
}

// "\"でエスケープされていない区切り文字で分ける。分けた各片のエスケープはまだ解かない
// (":"で分ける前に解くと、タイトル中の"\:"が区切りと見分けられなくなる)
function splitUnescaped(text: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      cur += ch + text[i + 1];
      i++;
    } else if (ch === sep) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

// "\:" "\;" "\\" だけを元の文字に戻す。それ以外の"\"(エスケープを始める前に書き出した
// ファイルや手書きのファイルにある「C:\work」など)はそのまま残す
function unescapeStageText(text: string): string {
  return text.replace(/\\([\\:;])/g, "$1");
}

// 期日の欄として読める形か(空・YYYY-MM-DD・Excelが書き換えた 2026/8/20 など)
function looksLikeStageDate(raw: string): boolean {
  const v = raw.trim();
  return v === "" || /^\d{1,4}[-/.年]\d{1,2}([-/.月]\d{1,4})?日?$/.test(v);
}

// 目標件数の欄として読める形か(空・数値)
function looksLikeStageCount(raw: string): boolean {
  const v = raw.trim();
  return v === "" || /^\d+(\.\d+)?$/.test(v);
}

// 「タイトル:期日:目標件数」;区切りのセルをパースする。
// 期日・目標件数は末尾から読む。エスケープを始める前に書き出したファイルでは、タイトルの
// ":"がそのまま入っているため、先頭から3つに分けるとタイトルが途中で切れてしまう
// (「10:30 客先打合せ:2026-12-01:」→ タイトル「10」)。末尾の2欄が期日・件数として読める
// 限り、それより前は":"を含めてすべてタイトルとして扱う。
// なお、エスケープ前のファイルでタイトルに";"が入っていた場合は、段階の区切りと
// 見分けがつかないため救えない
function parseStagesCell(cell: string): ParsedProjectStage[] {
  const trimmed = cell.trim();
  if (!trimmed) return [];
  return splitUnescaped(trimmed, ";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const fields = splitUnescaped(entry, ":");
      const n = fields.length;
      let titleFields = fields;
      let dueDateRaw = "";
      let targetCountRaw = "";
      if (n >= 3 && looksLikeStageCount(fields[n - 1]) && looksLikeStageDate(fields[n - 2])) {
        titleFields = fields.slice(0, n - 2);
        dueDateRaw = fields[n - 2].trim();
        targetCountRaw = fields[n - 1].trim();
      } else if (n >= 2 && looksLikeStageDate(fields[n - 1])) {
        // 手書きの「タイトル:期日」(目標件数の欄ごと省略した形)
        titleFields = fields.slice(0, n - 1);
        dueDateRaw = fields[n - 1].trim();
      }
      // どちらにも当てはまらなければ、全体をタイトルとみなす(「10:30 客先打合せ」とだけ書いた場合など)
      const title = unescapeStageText(titleFields.join(":")).trim();
      const dueDate = dueDateRaw ? normalizeCsvDate(dueDateRaw) ?? dueDateRaw : undefined;
      const targetCountNum = targetCountRaw ? Number(targetCountRaw) : NaN;
      return { title, dueDate, targetCount: Number.isFinite(targetCountNum) ? targetCountNum : undefined };
    })
    .filter((s) => !!s.title);
}

export interface ParsedProjectsCsvResult {
  rows: ParsedProjectRow[];
  errors: string[];
}

export function parseProjectsCsv(text: string): ParsedProjectsCsvResult {
  const lines = csvLines(text);
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["title", "category", "workName", "dueDate"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const idCol = idx("id");
  const groupCol = idx("group");
  const createdCol = idx("createdDate");
  const completedCol = idx("completed");
  const stagesCol = idx("stages");
  const rows: ParsedProjectRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const title = cols[idx("title")]?.trim();
    const category = cols[idx("category")]?.trim();
    const workName = cols[idx("workName")]?.trim();
    const dueDateRaw = cols[idx("dueDate")]?.trim();
    const dueDate = dueDateRaw ? normalizeCsvDate(dueDateRaw) ?? dueDateRaw : dueDateRaw;
    if (!title || !category || !workName || !dueDate) {
      errors.push(`${i + 1}行目: title・category・workName・dueDateが空のためスキップしました`);
      continue;
    }
    rows.push({
      id: idCol !== -1 && cols[idCol] ? cols[idCol].trim() : undefined,
      title,
      groupName: groupCol !== -1 ? (cols[groupCol]?.trim() ?? "") : undefined,
      category,
      workName,
      dueDate,
      createdDate: createdCol !== -1 ? cols[createdCol]?.trim() || undefined : undefined,
      completed: completedCol !== -1 ? /^true$/i.test(cols[completedCol]?.trim() ?? "") : false,
      stages: stagesCol !== -1 && cols[stagesCol]?.trim() ? parseStagesCell(cols[stagesCol]) : undefined,
    });
  }
  return { rows, errors };
}
