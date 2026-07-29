import { db, uid } from "./db";
import type { RecurrenceRule, TodoList, TodoTask } from "./types";
import type { ParsedTodoRow } from "./todoCsv";
import { todayStr } from "./time";

export const DEFAULT_TAG_PRESETS = ["社内確認中", "客先確認中", "打ち合わせ", "対応中", "保留"];

function toDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

function fromDate(d: Date): string {
  return todayStr(d);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

// 指定した年月における「第N ◯曜日」（ordinal=-1なら最終）の日付を返す
function nthWeekdayOfMonth(year: number, month0: number, weekday: number, ordinal: 1 | 2 | 3 | 4 | -1): Date {
  if (ordinal === -1) {
    const last = daysInMonth(year, month0);
    for (let d = last; d >= 1; d--) {
      const date = new Date(year, month0, d);
      if (date.getDay() === weekday) return date;
    }
    return new Date(year, month0, last);
  }
  let count = 0;
  const last = daysInMonth(year, month0);
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, month0, d);
    if (date.getDay() === weekday) {
      count++;
      if (count === ordinal) return date;
    }
  }
  // その月にN回目の曜日が存在しない場合は、最終出現日にフォールバック
  return nthWeekdayOfMonth(year, month0, weekday, -1);
}

// 現在の期日から、繰り返しルールに基づく次回の期日を計算する
export function computeNextDueDate(rule: RecurrenceRule, fromDateStr: string): string {
  const base = toDate(fromDateStr);
  const interval = Math.max(1, rule.interval || 1);

  switch (rule.type) {
    case "daily": {
      const next = new Date(base);
      next.setDate(next.getDate() + interval);
      return fromDate(next);
    }
    case "weekly": {
      const weekdays = rule.weekdays && rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => a - b) : [base.getDay()];
      // まず同じ週内で、指定曜日のうち直後に来るものを探す
      for (let i = 1; i <= 7; i++) {
        const cand = new Date(base);
        cand.setDate(cand.getDate() + i);
        if (weekdays.includes(cand.getDay())) {
          // interval > 1 の場合は週数もチェックする必要があるが、
          // シンプルに保つため直近の該当曜日を採用し、interval週分先に送る
          if (interval > 1) cand.setDate(cand.getDate() + (interval - 1) * 7);
          return fromDate(cand);
        }
      }
      const next = new Date(base);
      next.setDate(next.getDate() + 7 * interval);
      return fromDate(next);
    }
    case "monthlyDate": {
      const day = rule.day ?? base.getDate();
      let year = base.getFullYear();
      let month0 = base.getMonth() + interval;
      year += Math.floor(month0 / 12);
      month0 = ((month0 % 12) + 12) % 12;
      const clampedDay = day === -1 ? daysInMonth(year, month0) : Math.min(day, daysInMonth(year, month0));
      return fromDate(new Date(year, month0, clampedDay));
    }
    case "monthlyWeekday": {
      const weekday = rule.weekday ?? base.getDay();
      const ordinal = rule.ordinal ?? 1;
      let year = base.getFullYear();
      let month0 = base.getMonth() + interval;
      year += Math.floor(month0 / 12);
      month0 = ((month0 % 12) + 12) % 12;
      return fromDate(nthWeekdayOfMonth(year, month0, weekday, ordinal));
    }
    case "yearly": {
      const month0 = (rule.month ?? base.getMonth() + 1) - 1;
      const day = rule.day ?? base.getDate();
      const year = base.getFullYear() + interval;
      const clampedDay = Math.min(day, daysInMonth(year, month0));
      return fromDate(new Date(year, month0, clampedDay));
    }
  }
}

// CSVの行を、リスト名でリストを紐付けながらタスクとして取り込む。
// idが一致する既存タスクは上書き、なければ新規作成する
export async function upsertTodoFromCsv(
  rows: ParsedTodoRow[]
): Promise<{ created: number; updated: number; listsCreated: number }> {
  let created = 0;
  let updated = 0;
  let listsCreated = 0;

  const existingLists = await db.todoLists.toArray();
  const listIdByTitle = new Map(existingLists.map((l) => [l.title, l.id]));
  const orderCursor = new Map<string, number>();

  for (const row of rows) {
    if (!listIdByTitle.has(row.listTitle)) {
      const newList: TodoList = { id: uid(), title: row.listTitle, order: listIdByTitle.size, createdAt: Date.now() };
      await db.todoLists.add(newList);
      listIdByTitle.set(row.listTitle, newList.id);
      listsCreated++;
    }
  }

  for (const row of rows) {
    const listId = listIdByTitle.get(row.listTitle)!;
    const id = row.id || uid();
    const existing = await db.todoTasks.get(id);

    if (!orderCursor.has(listId)) {
      orderCursor.set(listId, await db.todoTasks.where("listId").equals(listId).count());
    }
    const order = existing?.order ?? orderCursor.get(listId)!;
    if (!existing) orderCursor.set(listId, order + 1);

    const task: TodoTask = {
      id,
      listId,
      parentTaskId: row.parentId || undefined,
      title: row.title,
      tag: row.tag,
      customer: row.customer,
      dueDate: row.dueDate,
      important: row.important,
      completed: row.completed,
      completedAt: row.completed ? (existing?.completedAt ?? Date.now()) : undefined,
      notes: row.notes,
      order,
      createdAt: existing?.createdAt ?? Date.now(),
      recurrence: row.recurrence,
      myDayDate: existing?.myDayDate,
      projectId: existing?.projectId,
    };
    await db.todoTasks.put(task);
    if (existing) updated++;
    else created++;
  }

  return { created, updated, listsCreated };
}
