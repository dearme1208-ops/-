import type { ProjectItem, ProjectStage } from "./types";
import { csvEscape, parseCsvLine } from "./csv";
import { todayStr } from "./time";

const HEADERS = ["id", "title", "category", "workName", "dueDate", "createdDate", "completed", "stages"] as const;

// 段階(ProjectStage)は1セルに「タイトル:期日:目標件数」を;区切りで詰めて表現する
// (例: 初稿作成:2026-08-20:;検収立会:2026-08-25:5 )。期日・目標件数は空でもよい。
// タイトルに":"や";"を含めることはできない
function serializeStages(stages: ProjectStage[] | undefined): string {
  if (!stages || stages.length === 0) return "";
  return stages.map((s) => `${s.title}:${s.dueDate ?? ""}:${s.targetCount != null ? s.targetCount : ""}`).join(";");
}

export function projectsToCsv(projects: ProjectItem[]): string {
  const rows = [HEADERS.join(",")];
  for (const p of projects) {
    rows.push(
      [
        p.id,
        csvEscape(p.title),
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
    ["", "A社案件", "組立", "本体組立", today, today, "false", csvEscape("初稿作成:" + today + ":;先方送付::")].join(","),
    ["", "B社案件", "検査", "出荷前検査", today, today, "false", ""].join(","),
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
  category: string;
  workName: string;
  dueDate: string;
  createdDate?: string;
  completed: boolean;
  // 未定義=CSVにstages列自体が無い/空セル(既存の段階には触れない)。
  // 空配列以上の値があれば、その内容で段階を作成・更新する
  stages?: ParsedProjectStage[];
}

// 「タイトル:期日:目標件数」;区切りのセルをパースする
function parseStagesCell(cell: string): ParsedProjectStage[] {
  const trimmed = cell.trim();
  if (!trimmed) return [];
  return trimmed
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [titleRaw, dueDateRaw, targetCountRaw] = entry.split(":");
      const title = (titleRaw ?? "").trim();
      const dueDate = (dueDateRaw ?? "").trim() || undefined;
      const targetCountStr = (targetCountRaw ?? "").trim();
      const targetCountNum = targetCountStr ? Number(targetCountStr) : NaN;
      return { title, dueDate, targetCount: Number.isFinite(targetCountNum) ? targetCountNum : undefined };
    })
    .filter((s) => !!s.title);
}

export interface ParsedProjectsCsvResult {
  rows: ParsedProjectRow[];
  errors: string[];
}

export function parseProjectsCsv(text: string): ParsedProjectsCsvResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
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
  const createdCol = idx("createdDate");
  const completedCol = idx("completed");
  const stagesCol = idx("stages");
  const rows: ParsedProjectRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const title = cols[idx("title")]?.trim();
    const category = cols[idx("category")]?.trim();
    const workName = cols[idx("workName")]?.trim();
    const dueDate = cols[idx("dueDate")]?.trim();
    if (!title || !category || !workName || !dueDate) {
      errors.push(`${i + 1}行目: title・category・workName・dueDateが空のためスキップしました`);
      continue;
    }
    rows.push({
      id: idCol !== -1 && cols[idCol] ? cols[idCol].trim() : undefined,
      title,
      category,
      workName,
      dueDate,
      createdDate: createdCol !== -1 ? cols[createdCol]?.trim() || undefined : undefined,
      completed: completedCol !== -1 ? cols[completedCol]?.trim() === "true" : false,
      stages: stagesCol !== -1 && cols[stagesCol]?.trim() ? parseStagesCell(cols[stagesCol]) : undefined,
    });
  }
  return { rows, errors };
}
