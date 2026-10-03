import { db, uid } from "./db";
import { isStageDone } from "./projectStage";
import { computeNextDueDate } from "./todo";
import { todayStr } from "./time";
import { hmToMin, minToHm } from "./timebox";
import type { BreakRange, DailyTask, ProjectItem, ProjectStage, TodoList, TodoTask } from "./types";

// 別のAI(Claudeなど)に案件・ToDoの進捗を登録してもらうための入出力。
// ・書き出し(スナップショット): 今の未完了の案件・ToDoを、IDつきのJSONで渡す
// ・取り込み(進捗の更新): 「この段階を完了」「このToDoの対応状況を変える」のような
//   部分的な操作の並びを受け取り、確認してから反映する
// CSV取り込み(全件の同期。載っていない案件を自動で完了にする等)とは違い、
// 書かれた操作以外には一切触れない。仕様は lib/progressSyncSpec.ts(ダウンロードできる.md)

export const SNAPSHOT_FORMAT = "koutei-progress-snapshot";
export const UPDATE_FORMAT = "koutei-progress-update";
export const SYNC_VERSION = 1;

// ---------------- 書き出し ----------------

export interface SnapshotStage {
  id: string;
  title: string;
  completed: boolean;
  completedDate?: string;
  dueDate?: string;
  tag?: string;
  targetCount?: number;
  completedCount?: number;
}

export interface SnapshotProject {
  id: string;
  title: string;
  groupName?: string;
  category: string;
  workName: string;
  dueDate: string;
  tag?: string;
  createdDate: string;
  completed: boolean;
  stages: SnapshotStage[];
}

export interface SnapshotSubtask {
  id: string;
  title: string;
  completed: boolean;
  completedDate?: string;
  dueDate?: string;
  tag?: string;
}

export interface SnapshotTodo {
  id: string;
  list: string;
  title: string;
  action?: string;
  notes?: string;
  tag?: string;
  dueDate?: string;
  startDate?: string;
  important: boolean;
  recurring: boolean;
  completed: boolean;
  projectId?: string;
  subtasks: SnapshotSubtask[];
}

export interface ProgressSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  exportedAt: string;
  today: string;
  tagOptions: string[];
  todoLists: string[];
  projects: SnapshotProject[];
  todos: SnapshotTodo[];
}

const dateOf = (ms: number | undefined) => (ms ? todayStr(new Date(ms)) : undefined);

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}

/** 未完了(アーカイブ済みを除く)の案件とToDoのスナップショット */
export function buildSnapshot({
  projects,
  todoTasks,
  todoLists,
  tagOptions,
  now = Date.now(),
}: {
  projects: ProjectItem[];
  todoTasks: TodoTask[];
  todoLists: TodoList[];
  tagOptions: string[];
  now?: number;
}): ProgressSnapshot {
  const listTitle = new Map(todoLists.map((l) => [l.id, l.title]));
  const subsByParent = new Map<string, TodoTask[]>();
  for (const t of todoTasks) {
    if (!t.parentTaskId) continue;
    subsByParent.set(t.parentTaskId, [...(subsByParent.get(t.parentTaskId) ?? []), t]);
  }
  return {
    format: SNAPSHOT_FORMAT,
    version: SYNC_VERSION,
    exportedAt: new Date(now).toISOString(),
    today: todayStr(new Date(now)),
    tagOptions,
    todoLists: [...todoLists].sort((a, b) => a.order - b.order).map((l) => l.title),
    projects: projects
      .filter((p) => !p.completedAt && !p.archived)
      .map((p) =>
        clean({
          id: p.id,
          title: p.title,
          groupName: p.groupName,
          category: p.category,
          workName: p.workName,
          dueDate: p.dueDate,
          tag: p.tag,
          createdDate: todayStr(new Date(p.createdAt)),
          completed: false,
          stages: (p.stages ?? []).map((s) =>
            clean({
              id: s.id,
              title: s.title,
              completed: isStageDone(s),
              completedDate: isStageDone(s) ? dateOf(s.completedAt) : undefined,
              dueDate: s.dueDate,
              tag: s.tag,
              targetCount: s.targetCount,
              completedCount: s.targetCount ? (s.completedCount ?? 0) : undefined,
            })
          ),
        })
      ),
    todos: todoTasks
      .filter((t) => !t.parentTaskId && !t.completed && !t.archived)
      .sort((a, b) => (listTitle.get(a.listId) ?? "").localeCompare(listTitle.get(b.listId) ?? "") || a.order - b.order)
      .map((t) =>
        clean({
          id: t.id,
          list: listTitle.get(t.listId) ?? "",
          title: t.title,
          action: t.action,
          notes: t.notes,
          tag: t.tag,
          dueDate: t.dueDate,
          startDate: t.startDate,
          important: t.important,
          recurring: !!t.recurrence,
          completed: false,
          projectId: t.projectId,
          subtasks: (subsByParent.get(t.id) ?? [])
            .sort((a, b) => a.order - b.order)
            .map((s) =>
              clean({
                id: s.id,
                title: s.title,
                completed: s.completed,
                completedDate: s.completed ? dateOf(s.completedAt) : undefined,
                dueDate: s.dueDate,
                tag: s.tag,
              })
            ),
        })
      ),
  };
}

// ---------------- 取り込み ----------------

type Json = Record<string, unknown>;

export interface PlannedOperation {
  index: number;
  op: string;
  ok: boolean;
  /** 何をするか(画面の確認用の一文) */
  summary: string;
  error?: string;
  warnings: string[];
  /** 確認画面に添える内訳(時間割の枠の一覧など) */
  details?: string[];
}

export interface UpdatePlan {
  operations: PlannedOperation[];
  /** ファイル全体の問題(形式が違う等)。これがあると何も反映しない */
  fatal?: string;
  /** 反映する変更(内部用) */
  writes: {
    projects: Map<string, { before?: ProjectItem; after: ProjectItem }>;
    todos: Map<string, { before?: TodoTask; after: TodoTask }>;
    lists: TodoList[];
    dailyTasks: Map<string, { before: DailyTask; after: DailyTask }>;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00");
  return !Number.isNaN(d.getTime()) && todayStr(d) === v;
}

/** 完了日(YYYY-MM-DD)を完了時刻にする。未来の日付や指定なしは今 */
function completedAtOf(date: unknown, now: number): number {
  if (!isDate(date)) return now;
  return Math.min(now, new Date(date + "T12:00:00").getTime());
}

class OpError extends Error {}

function str(o: Json, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new OpError(`"${key}" は文字列で指定してください`);
  return v.trim();
}

function optDate(o: Json, key: string): string | undefined | null {
  if (!(key in o)) return undefined;
  const v = o[key];
  if (v === null || v === "") return null; // 消す
  if (!isDate(v)) throw new OpError(`"${key}" はYYYY-MM-DD形式の日付で指定してください(値: ${JSON.stringify(v)})`);
  return v;
}

function optBool(o: Json, key: string): boolean | undefined {
  if (!(key in o)) return undefined;
  if (typeof o[key] !== "boolean") throw new OpError(`"${key}" は true / false で指定してください`);
  return o[key] as boolean;
}

/** 対応状況。null/""で消す。選択肢に無いものは警告して受け付ける */
function optTag(o: Json, key: string, tagOptions: string[], warnings: string[]): string | undefined | null {
  if (!(key in o)) return undefined;
  const v = o[key];
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new OpError(`"${key}" は文字列で指定してください`);
  if (!tagOptions.includes(v)) warnings.push(`対応状況「${v}」は選択肢にありません(そのまま登録します)`);
  return v;
}

export function planProgressUpdate(
  input: unknown,
  state: {
    projects: ProjectItem[];
    todoTasks: TodoTask[];
    todoLists: TodoList[];
    tagOptions: string[];
    /** 時間割(planTimebox)の対象になる本日以降の作業 */
    dailyTasks?: DailyTask[];
    /** 休憩帯(時間割が重なっていれば警告する) */
    breaks?: BreakRange[];
  },
  now = Date.now()
): UpdatePlan {
  const writes: UpdatePlan["writes"] = { projects: new Map(), todos: new Map(), lists: [], dailyTasks: new Map() };
  const plan: UpdatePlan = { operations: [], writes };
  if (!input || typeof input !== "object") return { ...plan, fatal: "JSONのオブジェクトではありません" };
  const root = input as Json;
  if (root.format !== UPDATE_FORMAT) return { ...plan, fatal: `"format" が "${UPDATE_FORMAT}" ではありません` };
  if (root.version !== SYNC_VERSION) return { ...plan, fatal: `"version" は ${SYNC_VERSION} にしてください` };
  if (!Array.isArray(root.operations)) return { ...plan, fatal: `"operations" が配列ではありません` };

  // 作業用のコピー。操作を順に当てていき、後の操作が前の操作の結果(追加したToDo等)を参照できるようにする
  let projects = new Map(state.projects.map((p) => [p.id, structuredClone(p)]));
  let todos = new Map(state.todoTasks.map((t) => [t.id, structuredClone(t)]));
  let lists = state.todoLists.map((l) => ({ ...l }));
  let daily = new Map((state.dailyTasks ?? []).map((t) => [t.id, structuredClone(t)]));
  const originalDaily = new Map((state.dailyTasks ?? []).map((t) => [t.id, t]));
  const touchDaily = (t: DailyTask) => writes.dailyTasks.set(t.id, { before: originalDaily.get(t.id)!, after: t });
  const originalProject = new Map(state.projects.map((p) => [p.id, p]));
  const originalTodo = new Map(state.todoTasks.map((t) => [t.id, t]));

  const touchProject = (p: ProjectItem) => writes.projects.set(p.id, { before: originalProject.get(p.id), after: p });
  const touchTodo = (t: TodoTask) => writes.todos.set(t.id, { before: originalTodo.get(t.id), after: t });

  function findProject(o: Json): ProjectItem {
    const id = str(o, "projectId");
    if (id) {
      const p = projects.get(id);
      if (!p) throw new OpError(`projectId "${id}" の案件がありません`);
      return p;
    }
    const title = str(o, "projectTitle");
    if (!title) throw new OpError(`"projectId" か "projectTitle" で案件を指定してください`);
    const hits = [...projects.values()].filter((p) => !p.completedAt && !p.archived && p.title === title);
    if (hits.length === 0) throw new OpError(`件名「${title}」の未完了の案件がありません`);
    if (hits.length > 1) throw new OpError(`件名「${title}」の案件が${hits.length}件あります。projectIdで指定してください`);
    return hits[0];
  }

  function findStage(p: ProjectItem, o: Json): ProjectStage {
    const id = str(o, "stageId");
    const title = str(o, "stageTitle");
    const stages = p.stages ?? [];
    const hits = id ? stages.filter((s) => s.id === id) : title ? stages.filter((s) => s.title === title) : null;
    if (!hits) throw new OpError(`"stageId" か "stageTitle" で段階を指定してください`);
    if (hits.length === 0) throw new OpError(`案件「${p.title}」に段階「${id ?? title}」がありません`);
    if (hits.length > 1) throw new OpError(`案件「${p.title}」に段階「${title}」が${hits.length}件あります。stageIdで指定してください`);
    return hits[0];
  }

  function findTodo(o: Json): TodoTask {
    const id = str(o, "todoId");
    if (id) {
      const t = todos.get(id);
      if (!t || t.parentTaskId) throw new OpError(`todoId "${id}" のToDoがありません`);
      return t;
    }
    const title = str(o, "todoTitle");
    if (!title) throw new OpError(`"todoId" か "todoTitle" でToDoを指定してください`);
    const list = str(o, "list");
    const listId = list ? lists.find((l) => l.title === list)?.id : undefined;
    if (list && !listId) throw new OpError(`リスト「${list}」がありません`);
    const hits = [...todos.values()].filter(
      (t) => !t.parentTaskId && !t.completed && !t.archived && t.title === title && (!listId || t.listId === listId)
    );
    if (hits.length === 0) throw new OpError(`件名「${title}」の未完了のToDoがありません`);
    if (hits.length > 1) throw new OpError(`件名「${title}」のToDoが${hits.length}件あります。todoIdかlistで指定してください`);
    return hits[0];
  }

  function findSubtask(parent: TodoTask, o: Json): TodoTask {
    const id = str(o, "subtaskId");
    const title = str(o, "subtaskTitle");
    const subs = [...todos.values()].filter((t) => t.parentTaskId === parent.id);
    const hits = id ? subs.filter((s) => s.id === id) : title ? subs.filter((s) => s.title === title) : null;
    if (!hits) throw new OpError(`"subtaskId" か "subtaskTitle" でサブタスクを指定してください`);
    if (hits.length === 0) throw new OpError(`ToDo「${parent.title}」にサブタスク「${id ?? title}」がありません`);
    if (hits.length > 1) throw new OpError(`ToDo「${parent.title}」にサブタスク「${title}」が${hits.length}件あります。subtaskIdで指定してください`);
    return hits[0];
  }

  function listIdFor(title: string, warnings: string[]): string {
    const found = lists.find((l) => l.title === title);
    if (found) return found.id;
    const created: TodoList = { id: uid(), title, order: lists.length, createdAt: now };
    lists.push(created);
    writes.lists.push(created);
    warnings.push(`リスト「${title}」が無いので新しく作ります`);
    return created.id;
  }

  /** ToDo・サブタスクの完了/未完了。繰り返しのToDoは完了にすると次回の期日へ進む */
  function setTodoCompleted(t: TodoTask, completed: boolean, date: unknown, parts: string[]) {
    if (completed === t.completed) return;
    if (completed && t.recurrence && !t.parentTaskId) {
      const next = computeNextDueDate(t.recurrence, t.dueDate ?? todayStr(new Date(now)));
      t.dueDate = next;
      t.lastRecurrenceAt = now;
      for (const s of todos.values()) {
        if (s.parentTaskId === t.id && s.completed) {
          s.completed = false;
          s.completedAt = undefined;
          touchTodo(s);
        }
      }
      parts.push(`繰り返しのため次回(${next})へ進める`);
      return;
    }
    t.completed = completed;
    t.completedAt = completed ? completedAtOf(date, now) : undefined;
    parts.push(completed ? `完了にする${isDate(date) ? `(${date})` : ""}` : "未完了に戻す");
  }

  function applyTodoFields(t: TodoTask, o: Json, warnings: string[], parts: string[]) {
    const due = optDate(o, "dueDate");
    if (due !== undefined && (due ?? undefined) !== t.dueDate) {
      parts.push(due ? `期日 ${t.dueDate ?? "なし"}→${due}` : "期日を消す");
      t.dueDate = due ?? undefined;
    }
    const tag = optTag(o, "tag", state.tagOptions, warnings);
    if (tag !== undefined && (tag ?? undefined) !== t.tag) {
      parts.push(tag ? `対応状況「${t.tag ?? "なし"}」→「${tag}」` : "対応状況を消す");
      t.tag = tag ?? undefined;
    }
  }

  root.operations.forEach((raw, index) => {
    const warnings: string[] = [];
    const opName = raw && typeof raw === "object" && typeof (raw as Json).op === "string" ? ((raw as Json).op as string) : "";
    const entry: PlannedOperation = { index, op: opName, ok: false, summary: "", warnings };
    // 失敗した操作が途中まで書き換えた分を戻せるよう、操作ごとに作業用コピーを控えておく
    const saved = {
      projects: structuredClone(projects),
      todos: structuredClone(todos),
      lists: structuredClone(lists),
      daily: structuredClone(daily),
      wd: structuredClone(writes.dailyTasks),
      wp: structuredClone(writes.projects),
      wt: structuredClone(writes.todos),
      wl: structuredClone(writes.lists),
    };
    try {
      if (!raw || typeof raw !== "object") throw new OpError("操作がオブジェクトではありません");
      const o = raw as Json;
      const parts: string[] = [];
      switch (opName) {
        case "updateProject": {
          const p = findProject(o);
          const due = optDate(o, "dueDate");
          if (due === null) throw new OpError("案件の期日は消せません");
          if (due !== undefined && due !== p.dueDate) {
            parts.push(`期日 ${p.dueDate}→${due}`);
            p.dueDate = due;
          }
          const tag = optTag(o, "tag", state.tagOptions, warnings);
          if (tag !== undefined && (tag ?? undefined) !== p.tag) {
            parts.push(tag ? `対応状況「${p.tag ?? "なし"}」→「${tag}」` : "対応状況を消す");
            p.tag = tag ?? undefined;
          }
          const completed = optBool(o, "completed");
          if (completed !== undefined && completed !== !!p.completedAt) {
            p.completedAt = completed ? completedAtOf(o.completedDate, now) : undefined;
            p.autoCompletedByImport = false;
            parts.push(completed ? "案件を完了にする" : "案件を未完了に戻す");
          }
          entry.summary = `案件「${p.title}」: ${parts.join("・") || "変更なし"}`;
          if (parts.length) touchProject(p);
          break;
        }
        case "addProject": {
          const title = str(o, "title");
          const category = str(o, "category");
          const workName = str(o, "workName") || title || "";
          const due = optDate(o, "dueDate");
          if (!title || !category || !due) throw new OpError(`"title"・"category"・"dueDate" は必須です`);
          if ([...projects.values()].some((p) => !p.completedAt && p.title === title && p.workName === workName)) {
            throw new OpError(`件名「${title}」の案件はもうあります(更新は updateProject / addStage を使ってください)`);
          }
          const stagesRaw = o.stages === undefined ? [] : o.stages;
          if (!Array.isArray(stagesRaw)) throw new OpError(`"stages" は配列で指定してください`);
          const stages: ProjectStage[] = stagesRaw.map((s, i) => {
            if (!s || typeof s !== "object") throw new OpError(`stages[${i}] がオブジェクトではありません`);
            const st = s as Json;
            const stTitle = str(st, "title");
            if (!stTitle) throw new OpError(`stages[${i}] の "title" がありません`);
            const stDue = optDate(st, "dueDate");
            const target = st.targetCount;
            if (target !== undefined && (typeof target !== "number" || target < 1)) throw new OpError(`stages[${i}] の "targetCount" は1以上の数で指定してください`);
            return { id: uid(), title: stTitle, completed: false, ...(stDue ? { dueDate: stDue } : {}), ...(target ? { targetCount: target as number } : {}) };
          });
          const tag = optTag(o, "tag", state.tagOptions, warnings);
          const p: ProjectItem = {
            id: uid(),
            title,
            category,
            workName,
            dueDate: due,
            createdAt: now,
            ...(str(o, "groupName") ? { groupName: str(o, "groupName") } : {}),
            ...(tag ? { tag } : {}),
            ...(stages.length ? { stages } : {}),
          };
          projects.set(p.id, p);
          touchProject(p);
          entry.summary = `案件「${title}」を追加(期日 ${due}${stages.length ? `・段階${stages.length}つ` : ""})`;
          break;
        }
        case "updateStage": {
          const p = findProject(o);
          const stage = findStage(p, o);
          const next: ProjectStage = { ...stage };
          const count = o.completedCount;
          if (count !== undefined) {
            if (!stage.targetCount) throw new OpError(`段階「${stage.title}」は件数で進める段階ではありません(completed を使ってください)`);
            if (typeof count !== "number" || count < 0) throw new OpError(`"completedCount" は0以上の数で指定してください`);
            parts.push(`件数 ${stage.completedCount ?? 0}→${count}/${stage.targetCount}`);
            next.completedCount = count;
          }
          const completed = optBool(o, "completed");
          if (completed !== undefined && completed !== isStageDone(next)) {
            if (next.targetCount) {
              next.completedCount = completed ? next.targetCount : Math.min(next.completedCount ?? 0, next.targetCount - 1);
            }
            parts.push(completed ? `完了にする${isDate(o.completedDate) ? `(${o.completedDate})` : ""}` : "未完了に戻す");
          }
          const doneNow = next.targetCount ? (next.completedCount ?? 0) >= next.targetCount : (completed ?? stage.completed);
          next.completed = doneNow;
          if (doneNow && !isStageDone(stage)) next.completedAt = completedAtOf(o.completedDate, now);
          if (!doneNow) next.completedAt = undefined;
          const due = optDate(o, "dueDate");
          if (due !== undefined && (due ?? undefined) !== stage.dueDate) {
            parts.push(due ? `期日 ${stage.dueDate ?? "なし"}→${due}` : "期日を消す");
            next.dueDate = due ?? undefined;
          }
          const tag = optTag(o, "tag", state.tagOptions, warnings);
          if (tag !== undefined && (tag ?? undefined) !== stage.tag) {
            parts.push(tag ? `対応状況「${stage.tag ?? "なし"}」→「${tag}」` : "対応状況を消す");
            next.tag = tag ?? undefined;
          }
          p.stages = (p.stages ?? []).map((s) => (s.id === stage.id ? next : s));
          entry.summary = `案件「${p.title}」の段階「${stage.title}」: ${parts.join("・") || "変更なし"}`;
          if (parts.length) touchProject(p);
          break;
        }
        case "addStage": {
          const p = findProject(o);
          const title = str(o, "title");
          if (!title) throw new OpError(`"title" がありません`);
          if ((p.stages ?? []).some((s) => s.title === title)) throw new OpError(`案件「${p.title}」に段階「${title}」はもうあります`);
          const due = optDate(o, "dueDate");
          const target = o.targetCount;
          if (target !== undefined && (typeof target !== "number" || target < 1)) throw new OpError(`"targetCount" は1以上の数で指定してください`);
          const stage: ProjectStage = { id: uid(), title, completed: false, ...(due ? { dueDate: due } : {}), ...(target ? { targetCount: target as number } : {}) };
          const stages = [...(p.stages ?? [])];
          const pos = o.position;
          if (pos !== undefined && (typeof pos !== "number" || pos < 0)) throw new OpError(`"position" は0以上の数で指定してください`);
          stages.splice(typeof pos === "number" ? Math.min(pos, stages.length) : stages.length, 0, stage);
          p.stages = stages;
          touchProject(p);
          entry.summary = `案件「${p.title}」に段階「${title}」を追加${due ? `(期日 ${due})` : ""}`;
          break;
        }
        case "updateTodo": {
          const t = findTodo(o);
          applyTodoFields(t, o, warnings, parts);
          const important = optBool(o, "important");
          if (important !== undefined && important !== t.important) {
            t.important = important;
            parts.push(important ? "重要にする" : "重要を外す");
          }
          const action = str(o, "action");
          if (action !== undefined && action !== (t.action ?? "")) {
            t.action = action || undefined;
            parts.push("次の行動を更新");
          }
          const notes = str(o, "notes");
          if (notes !== undefined && notes !== (t.notes ?? "")) {
            t.notes = notes || undefined;
            parts.push("メモを置き換える");
          }
          const append = str(o, "appendNotes");
          if (append) {
            const line = `[${todayStr(new Date(now))}] ${append}`;
            t.notes = t.notes ? `${t.notes}\n${line}` : line;
            parts.push("メモに追記");
          }
          const completed = optBool(o, "completed");
          if (completed !== undefined) setTodoCompleted(t, completed, o.completedDate, parts);
          entry.summary = `ToDo「${t.title}」: ${parts.join("・") || "変更なし"}`;
          if (parts.length) touchTodo(t);
          break;
        }
        case "addTodo": {
          const list = str(o, "list");
          const title = str(o, "title");
          if (!list || !title) throw new OpError(`"list"・"title" は必須です`);
          const listId = listIdFor(list, warnings);
          if ([...todos.values()].some((t) => !t.parentTaskId && !t.completed && t.listId === listId && t.title === title)) {
            throw new OpError(`リスト「${list}」に「${title}」はもうあります(更新は updateTodo / addSubtask を使ってください)`);
          }
          const siblings = [...todos.values()].filter((t) => t.listId === listId && !t.parentTaskId).length;
          const t: TodoTask = { id: uid(), listId, title, important: false, completed: false, order: siblings, createdAt: now };
          applyTodoFields(t, o, warnings, []);
          const start = optDate(o, "startDate");
          if (start) t.startDate = start;
          t.important = optBool(o, "important") ?? false;
          const action = str(o, "action");
          if (action) t.action = action;
          const notes = str(o, "notes");
          if (notes) t.notes = notes;
          todos.set(t.id, t);
          touchTodo(t);
          const subsRaw = o.subtasks === undefined ? [] : o.subtasks;
          if (!Array.isArray(subsRaw)) throw new OpError(`"subtasks" は配列で指定してください`);
          subsRaw.forEach((s, i) => {
            if (!s || typeof s !== "object") throw new OpError(`subtasks[${i}] がオブジェクトではありません`);
            const sTitle = str(s as Json, "title");
            if (!sTitle) throw new OpError(`subtasks[${i}] の "title" がありません`);
            const sub: TodoTask = { id: uid(), listId, parentTaskId: t.id, title: sTitle, important: false, completed: false, order: i, createdAt: now };
            applyTodoFields(sub, s as Json, warnings, []);
            todos.set(sub.id, sub);
            touchTodo(sub);
          });
          entry.summary = `ToDo「${title}」をリスト「${list}」に追加${t.dueDate ? `(期日 ${t.dueDate})` : ""}${subsRaw.length ? `・サブタスク${subsRaw.length}件` : ""}`;
          break;
        }
        case "updateSubtask": {
          const parent = findTodo(o);
          const sub = findSubtask(parent, o);
          applyTodoFields(sub, o, warnings, parts);
          const completed = optBool(o, "completed");
          if (completed !== undefined) setTodoCompleted(sub, completed, o.completedDate, parts);
          entry.summary = `ToDo「${parent.title}」のサブタスク「${sub.title}」: ${parts.join("・") || "変更なし"}`;
          if (parts.length) touchTodo(sub);
          break;
        }
        case "addSubtask": {
          const parent = findTodo(o);
          const title = str(o, "title");
          if (!title) throw new OpError(`"title" がありません`);
          const siblings = [...todos.values()].filter((t) => t.parentTaskId === parent.id);
          if (siblings.some((s) => s.title === title && !s.completed)) throw new OpError(`ToDo「${parent.title}」にサブタスク「${title}」はもうあります`);
          const sub: TodoTask = { id: uid(), listId: parent.listId, parentTaskId: parent.id, title, important: false, completed: false, order: siblings.length, createdAt: now };
          applyTodoFields(sub, o, warnings, []);
          todos.set(sub.id, sub);
          touchTodo(sub);
          entry.summary = `ToDo「${parent.title}」にサブタスク「${title}」を追加${sub.dueDate ? `(期日 ${sub.dueDate})` : ""}`;
          break;
        }
        case "planTimebox": {
          const date = optDate(o, "date");
          if (!date) throw new OpError(`"date" (YYYY-MM-DD) は必須です`);
          const today = todayStr(new Date(now));
          if (date < today) throw new OpError(`過ぎた日(${date})の時間割は作れません`);
          if (!Array.isArray(o.slots) || o.slots.length === 0) throw new OpError(`"slots" に1つ以上の枠を入れてください`);
          const dayTasks = [...daily.values()].filter((t) => t.date === date);
          const byId = new Map(dayTasks.map((t) => [t.id, t]));
          const seen = new Set<string>();
          const slots = o.slots.map((raw, i) => {
            if (!raw || typeof raw !== "object") throw new OpError(`slots[${i}] がオブジェクトではありません`);
            const sl = raw as Json;
            const taskId = str(sl, "taskId");
            const t = taskId ? byId.get(taskId) : undefined;
            if (!t) throw new OpError(`slots[${i}]: ${date}の作業に taskId "${taskId ?? ""}" がありません`);
            if (t.isProvisional || t.status === "done") throw new OpError(`slots[${i}]: 「${t.name}」は終わった作業なので枠を作れません`);
            if (seen.has(t.id)) throw new OpError(`slots[${i}]: 「${t.name}」が2回出てきます(1つの作業に枠は1つ)`);
            seen.add(t.id);
            const start = hmToMin(str(sl, "start") ?? "");
            const end = hmToMin(str(sl, "end") ?? "");
            if (start === null || end === null) throw new OpError(`slots[${i}]: "start"・"end" はHH:MM形式で指定してください`);
            if (end - start < 5) throw new OpError(`slots[${i}]: 枠は5分以上にしてください`);
            return { t, start, end };
          });
          slots.sort((a, b) => a.start - b.start);
          for (let i = 1; i < slots.length; i++) {
            if (slots[i].start < slots[i - 1].end) {
              throw new OpError(`「${slots[i - 1].t.name}」と「${slots[i].t.name}」の枠が重なっています`);
            }
          }
          const breaks = (state.breaks ?? [])
            .map((b) => ({ s: hmToMin(b.start), e: hmToMin(b.end), label: `${b.start}〜${b.end}` }))
            .filter((b): b is { s: number; e: number; label: string } => b.s !== null && b.e !== null);
          const nowMin = date === today ? new Date(now).getHours() * 60 + new Date(now).getMinutes() : -1;
          const details: string[] = [];
          for (const { t, start, end } of slots) {
            const overlap = breaks.find((b) => start < b.e && end > b.s);
            if (overlap) warnings.push(`「${t.name}」の枠が休憩帯(${overlap.label})に重なっています`);
            const past = end <= nowMin;
            if (past) warnings.push(`「${t.name}」の枠はもう過ぎています(自動では始まりません)`);
            t.scheduledTime = minToHm(start);
            t.timeboxEnd = minToHm(end);
            t.timeboxEndHandled = false;
            // 計測中・一時停止中の作業には、枠の始まりで改めて「開始」を出さない
            t.autoStartNotified = past || t.status !== "pending";
            t.autoStartDisabled = false;
            touchDaily(t);
            details.push(`${minToHm(start)}〜${minToHm(end)} ${t.category} / ${t.name}`);
          }
          // 時間割に入れなかった作業から、前の時間割の枠を外す(カレンダー予定の時刻だけのものは残す)
          const keepOthers = optBool(o, "keepOthers") ?? false;
          const left = dayTasks.filter((t) => !seen.has(t.id) && t.timeboxEnd && t.status !== "done");
          if (!keepOthers) {
            for (const t of left) {
              t.scheduledTime = undefined;
              t.timeboxEnd = undefined;
              t.timeboxEndHandled = undefined;
              touchDaily(t);
            }
            if (left.length) details.push(`時間割から外す: ${left.map((t) => t.name).join("、")}`);
          }
          // 作業リストの並びも時間割の順にそろえる
          const rest = dayTasks.filter((t) => !seen.has(t.id)).sort((a, b) => a.order - b.order);
          [...slots.map((x) => x.t), ...rest].forEach((t, i) => {
            if (t.order !== i) {
              t.order = i;
              touchDaily(t);
            }
          });
          entry.details = details;
          entry.summary = `${date}の時間割: ${slots.length}枠（${minToHm(slots[0].start)}〜${minToHm(slots[slots.length - 1].end)}）`;
          break;
        }
        default:
          throw new OpError(opName ? `知らない操作 "${opName}" です` : `"op" がありません`);
      }
      entry.ok = true;
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      projects = saved.projects;
      todos = saved.todos;
      lists = saved.lists;
      daily = saved.daily;
      writes.dailyTasks = saved.wd;
      writes.projects = saved.wp;
      writes.todos = saved.wt;
      writes.lists = saved.wl;
      entry.error = e.message;
      entry.summary = entry.summary || `${opName || "(不明な操作)"}`;
    }
    plan.operations.push(entry);
  });
  return plan;
}

/**
 * 計画した変更を反映する。失敗した操作があっても、成功した操作だけを反映する
 * (失敗した操作は作業用コピーにも当たっていない)。取り消し用の関数を返す
 */
export async function applyProgressPlan(plan: UpdatePlan): Promise<() => Promise<void>> {
  const { projects, todos, lists, dailyTasks } = plan.writes;
  await db.transaction("rw", [db.projects, db.todoTasks, db.todoLists, db.dailyTasks], async () => {
    for (const { before, after } of dailyTasks.values()) await db.dailyTasks.update(after.id, diff(before, after));
    for (const l of lists) await db.todoLists.add(l);
    for (const { before, after } of projects.values()) {
      if (before) await db.projects.update(after.id, diff(before, after));
      else await db.projects.add(after);
    }
    for (const { before, after } of todos.values()) {
      if (before) await db.todoTasks.update(after.id, diff(before, after));
      else await db.todoTasks.add(after);
    }
  });
  return async () => {
    await db.transaction("rw", [db.projects, db.todoTasks, db.todoLists, db.dailyTasks], async () => {
      for (const { before } of dailyTasks.values()) await db.dailyTasks.put(before);
      for (const { before, after } of projects.values()) {
        if (before) await db.projects.put(before);
        else await db.projects.delete(after.id);
      }
      for (const { before, after } of todos.values()) {
        if (before) await db.todoTasks.put(before);
        else await db.todoTasks.delete(after.id);
      }
      for (const l of lists) await db.todoLists.delete(l.id);
    });
  };
}

/** 変わった項目だけ(消えた項目はundefinedで消す)。変更履歴の記録(lib/db.tsのフック)が正しく働くよう、全体を上書きしない */
function diff<T extends object>(before: T, after: T): Partial<T> {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
  }
  return out as Partial<T>;
}
