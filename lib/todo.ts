import { db, uid } from "./db";
import type { RecurrenceOrdinal, RecurrenceRule, TodoList, TodoTask } from "./types";
import type { ParsedTodoRow } from "./todoCsv";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";
import { highestPriorityTag } from "./tagPriority";
import { putInTrash } from "./trash";

// 対応状況の初期値（設定タブ「todo.tagPresets」の初期シード値。以後は設定タブで自由に増減できる）
export const DEFAULT_TAG_PRESETS = ["社内確認中", "客先確認中", "打ち合わせ", "対応中", "保留"];

// スキームなしで貼られたURL（例: example.com）もリンクボタンから開けるよう補う
export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// 選択肢リスト（対応状況・分類）は設定タブでJSON配列の文字列として保持する。
// 分類は既定値を持たず、設定タブで登録したものだけが選択肢・かんばんの列になる
export function parsePresetList(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function serializePresetList(list: string[]): string {
  return JSON.stringify(list);
}

// タスク全体の期日を、自分自身の期日と未完了サブタスクの期日の中で最も早いものとして算出する。
// 完了済みサブタスクの期日はもう対応が必要ないため、期限切れ・期日が近い等の判定から除外する
export function effectiveDueDate(task: TodoTask, subtasks: TodoTask[]): string | undefined {
  const dates = [task.dueDate, ...subtasks.filter((s) => !s.completed).map((s) => s.dueDate)].filter(
    (d): d is string => !!d
  );
  if (dates.length === 0) return undefined;
  return dates.reduce((min, d) => (d < min ? d : min));
}

// タスク全体の対応状況。サブタスクを持たない場合は自分の対応状況をそのまま使う(=手動設定)。
// サブタスクを持つ場合は、対応状況は完全にサブタスク側から自動算出され、自分自身に設定した
// 対応状況は使われない(未完了サブタスクの中で最も優先度の高いものを採用し、未完了サブタスクに
// 対応状況が1つも見当たらなければ完了済みも含めて探す)。effectiveDueDateと同じ考え方
export function effectiveTag(task: TodoTask, subtasks: TodoTask[], priorityOrder: string[]): string | undefined {
  if (subtasks.length === 0) return task.tag;
  const fromOpen = highestPriorityTag(
    subtasks.filter((s) => !s.completed).map((s) => s.tag),
    priorityOrder
  );
  if (fromOpen) return fromOpen;
  return highestPriorityTag(
    subtasks.map((s) => s.tag),
    priorityOrder
  );
}

// タスクを完了にする(未完了 -> 完了の一方向)。繰り返しタスクは完了扱いにはならず、
// 次回の期日に進むだけ。一覧のチェックボックスと期日リマインダーの両方から呼べるよう共通化する
export async function completeTodoTask(task: TodoTask, today: string): Promise<void> {
  if (task.recurrence) {
    // 期日を何日も過ぎてから完了した場合、1回分進めただけでは次回も「期限切れ」のままになり、
    // 追いつくまで何度も完了を押すことになる。今日より後の回になるまでまとめて進める。
    // (期日より前に早めに完了した場合は、最初の1回で今日より後になるので1回分だけ進む)
    // 省略された項目(毎月の日付など)は元の期日から一度だけ補い、途中の月末丸めで日付がずれないようにする
    const base = task.dueDate ?? today;
    const rule = fillRecurrenceDefaults(task.recurrence, base);
    let nextDue = computeNextDueDate(rule, base);
    for (let i = 0; i < 1000 && nextDue <= today; i++) {
      nextDue = computeNextDueDate(rule, nextDue);
    }
    // lastRecurrenceAtは、この期日の変更が「延期」ではなく次の回へ進んだものだと記録側に伝える印
    const now = Date.now();
    const updates: Partial<TodoTask> = { dueDate: nextDue, lastRecurrenceAt: now };
    if (task.myDayDate === today) updates.myDayDate = undefined;
    // 期日が進んだ日数。サブタスクの期日・通知も同じだけ進め、前回の日付のまま残らないようにする
    // (親に期日が無かった場合はずらす基準が無いので動かさない)
    const deltaDays = task.dueDate ? daysBetweenDateStrs(task.dueDate, nextDue) : 0;
    const deltaMs = deltaDays * 86_400_000;
    if (task.reminderAt && deltaMs) {
      updates.reminderAt = task.reminderAt + deltaMs;
      updates.reminderFiredAt = undefined;
    }
    await db.transaction("rw", db.todoTasks, async () => {
      await db.todoTasks.update(task.id, updates);
      // 次回に進む際、前回分のサブタスクの完了状態を持ち越さないよう未完了に戻す
      const subtasks = await db.todoTasks.where("parentTaskId").equals(task.id).toArray();
      for (const s of subtasks) {
        const subUpdates: Partial<TodoTask> = {};
        if (s.completed) Object.assign(subUpdates, { completed: false, completedAt: undefined });
        if (deltaDays && !s.archived) {
          if (s.dueDate) Object.assign(subUpdates, { dueDate: shiftDateStr(s.dueDate, deltaDays), lastRecurrenceAt: now });
          if (s.reminderAt) Object.assign(subUpdates, { reminderAt: s.reminderAt + deltaMs, reminderFiredAt: undefined });
        }
        if (Object.keys(subUpdates).length > 0) await db.todoTasks.update(s.id, subUpdates);
      }
    });
    return;
  }
  await db.todoTasks.update(task.id, { completed: true, completedAt: Date.now() });
}

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

// 繰り返しルールのうち、その種類に必要な項目をすべて明示した形にして返す。
// 編集画面は「毎月1日」「第1金曜」のような値を表示していても、利用者が触るまで保存しておらず、
// 計算側は別の既定(今の期日の日付・曜日)で補っていたため、表示と実際の次回期日が食い違っていた。
// 表示・保存・計算の3つが同じ値を使うよう、補い方をここ1か所にまとめる。
// 既定値は基準日(タスクの期日。無ければ今日)から取る。種類に関係ない項目(毎月→毎年に切り替えた時に
// 残った day:-1 など)は計算を狂わせるので落とす
export function fillRecurrenceDefaults(rule: RecurrenceRule, baseDateStr: string): RecurrenceRule {
  const base = toDate(baseDateStr);
  const interval = Math.max(1, Math.floor(Number(rule.interval)) || 1);
  const validWeekday = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;
  const validDay = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 31;

  switch (rule.type) {
    case "daily":
      return { type: "daily", interval };
    case "weekly": {
      const weekdays = [...new Set((rule.weekdays ?? []).filter(validWeekday))].sort((a, b) => a - b);
      return { type: "weekly", interval, weekdays: weekdays.length > 0 ? weekdays : [base.getDay()] };
    }
    case "monthlyDate":
      return { type: "monthlyDate", interval, day: rule.day === -1 || validDay(rule.day) ? rule.day : base.getDate() };
    case "monthlyWeekday": {
      // 基準日がその月の何回目の曜日かを既定にする(5回目は毎月あるとは限らないので「最終」扱い)
      const nth = Math.ceil(base.getDate() / 7);
      const baseOrdinal: RecurrenceOrdinal = nth >= 5 ? -1 : (nth as RecurrenceOrdinal);
      const ordinal =
        rule.ordinal !== undefined && ([1, 2, 3, 4, -1] as number[]).includes(rule.ordinal) ? rule.ordinal : baseOrdinal;
      return { type: "monthlyWeekday", interval, weekday: validWeekday(rule.weekday) ? rule.weekday : base.getDay(), ordinal };
    }
    case "yearly": {
      const month =
        typeof rule.month === "number" && Number.isInteger(rule.month) && rule.month >= 1 && rule.month <= 12
          ? rule.month
          : base.getMonth() + 1;
      return { type: "yearly", interval, month, day: validDay(rule.day) ? rule.day : base.getDate() };
    }
  }
}

// 現在の期日から、繰り返しルールに基づく次回の期日を計算する
export function computeNextDueDate(rawRule: RecurrenceRule, fromDateStr: string): string {
  const base = toDate(fromDateStr);
  // 省略された項目は編集画面と同じ既定(fillRecurrenceDefaults)で補う
  const rule = fillRecurrenceDefaults(rawRule, fromDateStr);
  const interval = rule.interval;

  switch (rule.type) {
    case "daily": {
      const next = new Date(base);
      next.setDate(next.getDate() + interval);
      return fromDate(next);
    }
    case "weekly": {
      const weekdays = rule.weekdays!;
      // 指定曜日のうち直後に来るものを探す
      for (let i = 1; i <= 7; i++) {
        const cand = new Date(base);
        cand.setDate(cand.getDate() + i);
        if (weekdays.includes(cand.getDay())) {
          // 「2週ごとの月・水」のように複数曜日を選んでいる場合、同じ週の中の次の曜日(月→水)は
          // そのまま採用し、週をまたぐ時(水→翌々週の月)だけ間の週を飛ばす。週は日曜始まりで数える
          const wrapped = cand.getDay() <= base.getDay();
          if (interval > 1 && wrapped) cand.setDate(cand.getDate() + (interval - 1) * 7);
          return fromDate(cand);
        }
      }
      const next = new Date(base);
      next.setDate(next.getDate() + 7 * interval);
      return fromDate(next);
    }
    case "monthlyDate": {
      const day = rule.day!;
      let year = base.getFullYear();
      let month0 = base.getMonth() + interval;
      year += Math.floor(month0 / 12);
      month0 = ((month0 % 12) + 12) % 12;
      const clampedDay = day === -1 ? daysInMonth(year, month0) : Math.min(day, daysInMonth(year, month0));
      return fromDate(new Date(year, month0, clampedDay));
    }
    case "monthlyWeekday": {
      let year = base.getFullYear();
      let month0 = base.getMonth() + interval;
      year += Math.floor(month0 / 12);
      month0 = ((month0 % 12) + 12) % 12;
      return fromDate(nthWeekdayOfMonth(year, month0, rule.weekday!, rule.ordinal!));
    }
    case "yearly": {
      const month0 = rule.month! - 1;
      const year = base.getFullYear() + interval;
      const clampedDay = Math.min(rule.day!, daysInMonth(year, month0));
      return fromDate(new Date(year, month0, clampedDay));
    }
  }
}

// CSVの行を、リスト名でリストを紐付けながらタスクとして取り込む。
// idが一致する既存タスクは上書き、なければ新規作成する。
// 親(parentId)は、CSVにその列がある時だけ書き換える(列の無いCSVで既存のサブタスクが親から外れないように)。
// 親は「存在する・サブタスクではない・自分ではない」ものに限り、リストは親のリストに合わせる。
// 条件に合わない行は取り込まずにerrorsへ理由を返す
export async function upsertTodoFromCsv(
  rows: ParsedTodoRow[],
  options: { hasParentColumn?: boolean } = {}
): Promise<{ created: number; updated: number; listsCreated: number; errors: string[] }> {
  let created = 0;
  let updated = 0;
  let listsCreated = 0;
  const errors: string[] = [];
  // 列の有無を渡されなかった時は、どこかの行に親が書かれていれば列あり扱い
  const hasParentColumn = options.hasParentColumn ?? rows.some((r) => r.parentId !== undefined);

  const existingLists = await db.todoLists.toArray();
  const listIdByTitle = new Map(existingLists.map((l) => [l.title, l.id]));
  const orderCursor = new Map<string, number>();
  const subOrderCursor = new Map<string, number>();

  for (const row of rows) {
    if (!listIdByTitle.has(row.listTitle)) {
      const newList: TodoList = { id: uid(), title: row.listTitle, order: listIdByTitle.size, createdAt: Date.now() };
      await db.todoLists.add(newList);
      listIdByTitle.set(row.listTitle, newList.id);
      listsCreated++;
    }
  }

  // 取り込み後の親子関係を、既存のタスクとCSVの行を合わせて判定する
  const allExisting = await db.todoTasks.toArray();
  const existingById = new Map(allExisting.map((t) => [t.id, t]));
  const rowById = new Map(rows.filter((r) => r.id).map((r) => [r.id!, r]));
  const finalParentOf = (id: string): string | undefined => {
    const r = rowById.get(id);
    if (r && hasParentColumn) return r.parentId || undefined;
    return existingById.get(id)?.parentTaskId;
  };
  const finalListOf = (id: string): string | undefined => {
    const r = rowById.get(id);
    return r ? listIdByTitle.get(r.listTitle) : existingById.get(id)?.listId;
  };
  const hasChildren = (id: string): boolean => {
    for (const r of rows) if (r.id !== id && hasParentColumn && r.parentId === id) return true;
    for (const t of allExisting) {
      if (t.parentTaskId === id && !(hasParentColumn && rowById.has(t.id))) return true;
    }
    return false;
  };

  for (const row of rows) {
    const id = row.id || uid();
    const existing = existingById.get(id);
    const parentId = hasParentColumn ? row.parentId || undefined : existing?.parentTaskId;

    let listId = listIdByTitle.get(row.listTitle)!;
    if (parentId) {
      const label = `「${row.title}」`;
      if (parentId === id) {
        errors.push(`${label}: 自分自身を親にはできないため取り込みませんでした`);
        continue;
      }
      if (!rowById.has(parentId) && !existingById.has(parentId)) {
        errors.push(`${label}: 親タスク(id=${parentId})が見つからないため取り込みませんでした`);
        continue;
      }
      if (finalParentOf(parentId)) {
        errors.push(`${label}: 親タスク(id=${parentId})がサブタスクのため取り込みませんでした（サブタスクは1段まで）`);
        continue;
      }
      if (hasChildren(id)) {
        errors.push(`${label}: サブタスクを持つタスクはサブタスクにできないため取り込みませんでした`);
        continue;
      }
      listId = finalListOf(parentId) ?? listId;
    }

    let order: number;
    if (existing && existing.parentTaskId === parentId) {
      order = existing.order;
    } else if (parentId) {
      if (!subOrderCursor.has(parentId)) {
        const subs = allExisting.filter((t) => t.parentTaskId === parentId && t.id !== id);
        subOrderCursor.set(parentId, subs.reduce((m, t) => Math.max(m, t.order + 1), 0));
      }
      order = subOrderCursor.get(parentId)!;
      subOrderCursor.set(parentId, order + 1);
    } else if (existing) {
      order = existing.order;
    } else {
      if (!orderCursor.has(listId)) {
        orderCursor.set(listId, await db.todoTasks.where("listId").equals(listId).count());
      }
      order = orderCursor.get(listId)!;
      orderCursor.set(listId, order + 1);
    }

    // 既に完了済みのタスクはCSV側がfalseでも復活させない（完了はCSV再取込で覆されない一方向の状態）
    const completed = existing?.completed || row.completed;
    // CSVに列がある項目だけ。既存タスクではこの項目だけを書き換える
    const fromCsv: Partial<TodoTask> = {
      listId,
      title: row.title,
      action: row.action,
      url: row.url,
      tag: row.tag,
      category: row.category,
      customer: row.customer,
      startDate: row.startDate,
      dueDate: row.dueDate,
      important: row.important,
      completed,
      completedAt: completed ? (existing?.completedAt ?? Date.now()) : undefined,
      notes: row.notes,
    };
    if (hasParentColumn || !existing) fromCsv.parentTaskId = parentId;
    if (existing && order !== existing.order) fromCsv.order = order;
    if (existing) {
      // 丸ごと置き換えると、CSVに列の無い項目(添付画像・メール・リマインダー・見込み時間・取引先・
      // アーカイブ・ボード上の位置・変更履歴など)が再取込のたびに消えてしまうため、差分だけを書く。
      // 繰り返しは、CSVに繰り返しの指定が無い行では既存の設定を残す
      await db.todoTasks.update(id, row.recurrence && !parentId ? { ...fromCsv, recurrence: row.recurrence } : fromCsv);
      updated++;
    } else {
      const task = {
        ...fromCsv,
        id,
        order,
        createdAt: Date.now(),
        recurrence: parentId ? undefined : row.recurrence,
      } as TodoTask;
      await db.todoTasks.add(task);
      created++;
    }
  }

  return { created, updated, listsCreated, errors };
}

// 開始日(優先)または期日が設定されたタスクを、同じリスト内で日付順になる位置に挿入する。
// 日付未設定の既存タスクは常に日付ありのタスクより後ろとして扱う。
// 既存タスクのorderは、挿入位置を1つ空けた 0..n の連番に振り直す。後ろだけを1つずつずらす方式だと、
// 既存のorderが連番でない(削除で抜けた・重複している)場合に、返した位置が既存と重複したり
// 意図と違う場所に入ったりするため、毎回全体を振り直して一意にする(以後は手動並び替え可能)
export async function computeDateOrderedPosition(
  listId: string,
  taskId: string,
  sortDate: string
): Promise<number> {
  const siblings = (await db.todoTasks.where("listId").equals(listId).sortBy("order")).filter(
    (t) => !t.parentTaskId && t.id !== taskId
  );

  let insertIndex = siblings.length;
  for (let i = 0; i < siblings.length; i++) {
    const s = siblings[i];
    const sDate = s.startDate || s.dueDate;
    if (!sDate || sDate > sortDate) {
      insertIndex = i;
      break;
    }
  }

  await db.transaction("rw", db.todoTasks, async () => {
    for (let i = 0; i < siblings.length; i++) {
      const order = i < insertIndex ? i : i + 1;
      if (siblings[i].order !== order) await db.todoTasks.update(siblings[i].id, { order });
    }
  });

  return insertIndex;
}

// ---- 親子の付け替え(サブタスクは1段まで) ----

/** 書き換えた1件分の前後の値。元に戻す時は「今の値がafterのまま」の時だけbeforeへ戻す */
export interface TodoChange {
  id: string;
  before: Partial<TodoTask>;
  after: Partial<TodoTask>;
}

export type SetParentRefusal =
  | "not-found"
  | "self"
  | "parent-not-found"
  | "parent-is-subtask"
  | "parent-archived"
  | "parent-completed"
  | "has-subtasks"
  | "noop";

export const SET_PARENT_REFUSAL_MESSAGES: Record<SetParentRefusal, string> = {
  "not-found": "タスクが見つかりません",
  self: "自分自身を親にはできません",
  "parent-not-found": "親タスクが見つかりません",
  "parent-is-subtask": "サブタスクの下にはサブタスクを作れません（1段まで）",
  "parent-archived": "アーカイブ済みのタスクは親にできません",
  "parent-completed": "完了済みのタスクは親にできません",
  "has-subtasks": "サブタスクを持つタスクは、ほかのタスクのサブタスクにできません（1段まで）",
  noop: "すでにその状態です",
};

export type SetParentResult =
  | { ok: true; changes: TodoChange[]; fromListId: string; toListId: string; parentTitle?: string }
  | { ok: false; reason: SetParentRefusal; message: string };

// 親として選べるか(サブタスクでない・未完了・アーカイブしていない)
export function canBeParent(t: TodoTask): boolean {
  return !t.parentTaskId && !t.completed && !t.archived;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// patchのうち実際に値が変わる項目だけを、前後の値として控える
function diffChange(cur: TodoTask, patch: Partial<TodoTask>): TodoChange | null {
  const before: Partial<TodoTask> = {};
  const after: Partial<TodoTask> = {};
  for (const key of Object.keys(patch) as (keyof TodoTask)[]) {
    if (sameValue(cur[key], patch[key])) continue;
    (before as Record<string, unknown>)[key] = cur[key];
    (after as Record<string, unknown>)[key] = patch[key];
  }
  return Object.keys(after).length > 0 ? { id: cur.id, before, after } : null;
}

/**
 * タスクの親を付け替える。parentIdにnullを渡すと通常のタスクに戻す。
 * 子になる側は親のリストへ移り、親のサブタスクの末尾に入る。繰り返し・マイデイ・
 * 統合ボード上の位置・アーカイブはサブタスクでは使わないので外す(元に戻すで戻る)。
 * 通常のタスクに戻す時は、日付があれば日付順の位置、無ければリストの先頭に入れる
 */
export async function setTodoParent(taskId: string, parentId: string | null): Promise<SetParentResult> {
  const refuse = (reason: SetParentRefusal): SetParentResult => ({ ok: false, reason, message: SET_PARENT_REFUSAL_MESSAGES[reason] });
  return db.transaction("rw", db.todoTasks, async (): Promise<SetParentResult> => {
    const task = await db.todoTasks.get(taskId);
    if (!task) return refuse("not-found");
    const changes: TodoChange[] = [];
    const apply = async (cur: TodoTask, patch: Partial<TodoTask>) => {
      const c = diffChange(cur, patch);
      if (!c) return;
      changes.push(c);
      await db.todoTasks.update(cur.id, c.after);
    };

    if (parentId === null) {
      if (!task.parentTaskId) return refuse("noop");
      const siblings = (await db.todoTasks.where("listId").equals(task.listId).sortBy("order")).filter(
        (t) => !t.parentTaskId && t.id !== task.id
      );
      const sortDate = task.startDate || task.dueDate;
      let insertIndex = 0;
      if (sortDate) {
        insertIndex = siblings.length;
        for (let i = 0; i < siblings.length; i++) {
          const sDate = siblings[i].startDate || siblings[i].dueDate;
          if (!sDate || sDate > sortDate) {
            insertIndex = i;
            break;
          }
        }
      }
      // 既存のorderが連番でなくても重複しないよう、挿入位置を空けて0..nに振り直す
      for (let i = 0; i < siblings.length; i++) {
        await apply(siblings[i], { order: i < insertIndex ? i : i + 1 });
      }
      await apply(task, { parentTaskId: undefined, order: insertIndex });
      return { ok: true, changes, fromListId: task.listId, toListId: task.listId };
    }

    if (parentId === taskId) return refuse("self");
    const parent = await db.todoTasks.get(parentId);
    if (!parent) return refuse("parent-not-found");
    if (parent.parentTaskId) return refuse("parent-is-subtask");
    if (parent.archived) return refuse("parent-archived");
    if (parent.completed) return refuse("parent-completed");
    if (task.parentTaskId === parentId) return refuse("noop");
    const ownSubs = await db.todoTasks.where("parentTaskId").equals(taskId).count();
    if (ownSubs > 0) return refuse("has-subtasks");

    const parentSubs = (await db.todoTasks.where("parentTaskId").equals(parentId).toArray()).filter((t) => t.id !== taskId);
    const order = parentSubs.reduce((m, t) => Math.max(m, t.order + 1), 0);
    await apply(task, {
      parentTaskId: parentId,
      listId: parent.listId,
      order,
      recurrence: undefined,
      myDayDate: undefined,
      myDayDismissedDate: undefined,
      boardX: undefined,
      boardY: undefined,
      boardLocked: undefined,
      boardPinned: undefined,
      boardHidden: undefined,
      archived: undefined,
    });
    return { ok: true, changes, fromListId: task.listId, toListId: parent.listId, parentTitle: parent.title };
  });
}

/**
 * 控えた変更を元に戻す。戻すまでの間にほかで書き換えられたタスクは上書きしない
 * (今の値がafterのままのタスクだけをbeforeへ戻す)。戻せなかった件数をskippedで返す
 */
export async function undoTodoChanges(changes: TodoChange[]): Promise<{ restored: number; skipped: number }> {
  let restored = 0;
  let skipped = 0;
  await db.transaction("rw", db.todoTasks, async () => {
    for (const c of changes) {
      const cur = await db.todoTasks.get(c.id);
      if (!cur) {
        skipped++;
        continue;
      }
      // 1件の中で一部だけ戻すと親とリストが食い違うことがあるので、1件ごとに全部戻すか戻さないか
      const untouched = (Object.keys(c.after) as (keyof TodoTask)[]).every((key) => sameValue(cur[key], c.after[key]));
      if (!untouched) {
        skipped++;
        continue;
      }
      // サブタスクへ戻す時は、戻すまでの間に親が消された・サブタスクになった、または自分が
      // サブタスクを持った場合に戻さない(サブタスクは1段まで・親のいないサブタスクを作らない)
      const restoreParent = c.before.parentTaskId;
      if (restoreParent) {
        const parent = await db.todoTasks.get(restoreParent);
        const ownSubs = await db.todoTasks.where("parentTaskId").equals(c.id).count();
        const restoredListId = "listId" in c.before ? c.before.listId : cur.listId;
        if (!parent || parent.parentTaskId || ownSubs > 0 || parent.listId !== restoredListId) {
          skipped++;
          continue;
        }
      }
      await db.todoTasks.update(c.id, c.before);
      restored++;
    }
  });
  return { restored, skipped };
}

/**
 * アーカイブする/解除する。親をアーカイブするとサブタスクも一緒にアーカイブし、
 * 解除するとサブタスクも一緒に戻す(サブタスクだけが一覧・計画に残らないように)
 */
export async function setTodoArchived(taskId: string, archived: boolean): Promise<TodoChange[]> {
  return db.transaction("rw", db.todoTasks, async () => {
    const task = await db.todoTasks.get(taskId);
    if (!task) return [];
    const subs = task.parentTaskId ? [] : await db.todoTasks.where("parentTaskId").equals(taskId).toArray();
    const changes: TodoChange[] = [];
    for (const t of [task, ...subs]) {
      const c = diffChange(t, { archived: archived ? true : undefined });
      if (!c) continue;
      changes.push(c);
      await db.todoTasks.update(t.id, c.after);
    }
    return changes;
  });
}

// すぐ追加の「＞親の名前の一部 件名」。＞(全角)か>で始まり、空白の後ろに件名がある時だけ親の指定とみなす
export function parseParentPrefix(raw: string): { parentQuery: string; rest: string } | null {
  const m = raw.trim().match(/^[>＞]\s*(\S+)\s+(.+)$/);
  if (!m) return null;
  const rest = m[2].trim();
  if (!rest) return null;
  return { parentQuery: m[1], rest };
}

// 名前の一部で親を探す。同じリストの、親として選べるタスクの中から(大文字小文字は区別しない)
export function findParentCandidates(tasks: TodoTask[], listId: string, query: string): TodoTask[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tasks.filter((t) => t.listId === listId && canBeParent(t) && t.title.toLowerCase().includes(q));
}

/** ゴミ箱に出す名前。tasks は消した親(またはサブタスク単体)、subCount はその下で一緒に消えたサブタスク数 */
export function todoTrashLabel(tasks: Pick<TodoTask, "title" | "parentTaskId">[], subCount = 0): string {
  const first = tasks[0];
  if (!first) return "ToDo";
  const head =
    tasks.length === 1 && first.parentTaskId ? `サブタスク「${first.title}」` : `ToDo「${first.title}」${tasks.length > 1 ? `ほか${tasks.length - 1}件` : ""}`;
  return subCount > 0 ? `${head}とサブタスク${subCount}件` : head;
}

/** 消したToDo(とサブタスク・リスト)をゴミ箱に入れる。ゴミ箱の項目idを返す(取り消し時に消すため) */
export async function trashTodos(label: string, tasks: TodoTask[], lists: TodoList[] = []): Promise<string | null> {
  return putInTrash("todo", label, { todoLists: lists, todoTasks: tasks });
}
