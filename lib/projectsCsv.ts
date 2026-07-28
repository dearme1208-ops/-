import type { ProjectItem } from "./types";
import { csvEscape, parseCsvLine } from "./csv";
import { todayStr } from "./time";

const HEADERS = ["id", "title", "category", "workName", "dueDate", "createdDate", "completed"] as const;

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
      ].join(",")
    );
  }
  return rows.join("\n");
}

export function projectsCsvTemplate(): string {
  const today = todayStr();
  const rows = [
    HEADERS.join(","),
    ["", "A社案件", "組立", "本体組立", today, today, "false"].join(","),
    ["", "B社案件", "検査", "出荷前検査", today, today, "false"].join(","),
  ];
  return rows.join("\n");
}

export interface ParsedProjectRow {
  id?: string;
  title: string;
  category: string;
  workName: string;
  dueDate: string;
  createdDate?: string;
  completed: boolean;
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
    });
  }
  return { rows, errors };
}
