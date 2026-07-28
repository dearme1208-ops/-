import type { RecurrenceOrdinal, RecurrenceRule, RecurrenceType, TodoTask, TodoList } from "./types";
import { csvEscape, parseCsvLine } from "./csv";

const HEADERS = [
  "id",
  "listTitle",
  "parentId",
  "title",
  "tag",
  "customer",
  "dueDate",
  "important",
  "completed",
  "notes",
  "recurrenceType",
  "recurrenceInterval",
  "recurrenceWeekdays",
  "recurrenceDay",
  "recurrenceMonth",
  "recurrenceWeekday",
  "recurrenceOrdinal",
] as const;

const RECURRENCE_TYPES: RecurrenceType[] = ["daily", "weekly", "monthlyDate", "monthlyWeekday", "yearly"];

export function todoTasksToCsv(tasks: TodoTask[], lists: TodoList[]): string {
  const listTitleById = new Map(lists.map((l) => [l.id, l.title]));
  const rows = [HEADERS.join(",")];
  for (const t of tasks) {
    const r = t.recurrence;
    rows.push(
      [
        t.id,
        csvEscape(listTitleById.get(t.listId) ?? ""),
        t.parentTaskId ?? "",
        csvEscape(t.title),
        csvEscape(t.tag ?? ""),
        csvEscape(t.customer ?? ""),
        t.dueDate ?? "",
        String(t.important),
        String(t.completed),
        csvEscape(t.notes ?? ""),
        r?.type ?? "",
        r ? String(r.interval) : "",
        r?.weekdays ? r.weekdays.join("|") : "",
        r?.day !== undefined ? String(r.day) : "",
        r?.month !== undefined ? String(r.month) : "",
        r?.weekday !== undefined ? String(r.weekday) : "",
        r?.ordinal !== undefined ? String(r.ordinal) : "",
      ].join(",")
    );
  }
  return rows.join("\n");
}

export function todoCsvTemplate(): string {
  const rows = [
    HEADERS.join(","),
    // 親タスク(id=t1)と、そのサブタスク(parentId=t1)の例
    ["t1", "タスク", "", "見積書作成", "客先確認中", "〇〇工業", "2026-08-03", "true", "false", "先方に金額を確認してから提出", "", "", "", "", "", "", ""].join(","),
    ["t2", "タスク", "t1", "金額を確認する", "", "", "", "false", "false", "", "", "", "", "", "", "", ""].join(","),
    // 毎月第4金曜日に繰り返す例
    [
      "t3",
      "タスク",
      "",
      "月次報告",
      "打ち合わせ",
      "",
      "2026-07-24",
      "false",
      "false",
      "",
      "monthlyWeekday",
      "1",
      "",
      "",
      "",
      "5",
      "4",
    ].join(","),
  ];
  return rows.join("\n");
}

export interface ParsedTodoRow {
  id?: string;
  listTitle: string;
  parentId?: string;
  title: string;
  tag?: string;
  customer?: string;
  dueDate?: string;
  important: boolean;
  completed: boolean;
  notes?: string;
  recurrence?: RecurrenceRule;
}

export interface ParsedTodoCsvResult {
  rows: ParsedTodoRow[];
  errors: string[];
}

export function parseTodoCsv(text: string): ParsedTodoCsvResult {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (lines.length === 0) return { rows: [], errors: ["空のファイルです"] };

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const required = ["listTitle", "title"];
  for (const req of required) {
    if (idx(req) === -1) errors.push(`必須列 "${req}" がありません`);
  }
  if (errors.length > 0) return { rows: [], errors };

  const col = (cols: string[], name: string) => {
    const i = idx(name);
    return i !== -1 ? cols[i]?.trim() : undefined;
  };

  const rows: ParsedTodoRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const listTitle = col(cols, "listTitle");
    const title = col(cols, "title");
    if (!listTitle || !title) {
      errors.push(`${i + 1}行目: listTitle・titleが空のためスキップしました`);
      continue;
    }

    const recurrenceTypeRaw = col(cols, "recurrenceType");
    let recurrence: RecurrenceRule | undefined;
    if (recurrenceTypeRaw && (RECURRENCE_TYPES as string[]).includes(recurrenceTypeRaw)) {
      const weekdaysRaw = col(cols, "recurrenceWeekdays");
      recurrence = {
        type: recurrenceTypeRaw as RecurrenceType,
        interval: Math.max(1, Number(col(cols, "recurrenceInterval")) || 1),
        weekdays: weekdaysRaw ? weekdaysRaw.split("|").map(Number).filter((n) => !Number.isNaN(n)) : undefined,
        day: col(cols, "recurrenceDay") ? Number(col(cols, "recurrenceDay")) : undefined,
        month: col(cols, "recurrenceMonth") ? Number(col(cols, "recurrenceMonth")) : undefined,
        weekday: col(cols, "recurrenceWeekday") ? Number(col(cols, "recurrenceWeekday")) : undefined,
        ordinal: col(cols, "recurrenceOrdinal") ? (Number(col(cols, "recurrenceOrdinal")) as RecurrenceOrdinal) : undefined,
      };
    }

    rows.push({
      id: col(cols, "id") || undefined,
      listTitle,
      parentId: col(cols, "parentId") || undefined,
      title,
      tag: col(cols, "tag") || undefined,
      customer: col(cols, "customer") || undefined,
      dueDate: col(cols, "dueDate") || undefined,
      important: col(cols, "important") === "true",
      completed: col(cols, "completed") === "true",
      notes: col(cols, "notes") || undefined,
      recurrence,
    });
  }
  return { rows, errors };
}
