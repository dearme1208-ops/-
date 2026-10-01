import { aggregateKey } from "./aggregate";
import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// 案件の段階・案件・ToDoのサブタスクから「本日の作業」に追加した作業は、作業名が
// 既定で段階名・詳細作業名・サブタスク名のまま(「設計」「実装」「確認」など)になる。
// 作業名そのものは作業マスタ(見積りの元になる平均時間)と結びついているので変えず、
// 画面や報告に出すときに「どの案件の/どのToDoの」作業かを添える。
// 表記はToDoのサブタスク(lib/todoLabel.ts)と揃えて「案件名 › 作業名」「親タスク名 › 作業名」

export interface WorkContextSources {
  projectById: Map<string, Pick<ProjectItem, "title">>;
  todoById: Map<string, Pick<TodoTask, "title" | "parentTaskId">>;
}

export interface WorkLinks {
  name: string;
  projectId?: string;
  todoTaskId?: string;
}

/** 作業を「もう一度開始」するときに引き継ぐ、案件・段階・ToDoとの紐付けなど */
export type DailyTaskLinks = Pick<DailyTask, "projectId" | "stageId" | "todoTaskId" | "method" | "secondaryProjectIds">;

export function dailyTaskLinksOf(t: DailyTaskLinks): DailyTaskLinks {
  const links: DailyTaskLinks = {};
  if (t.projectId) links.projectId = t.projectId;
  if (t.stageId) links.stageId = t.stageId;
  if (t.todoTaskId) links.todoTaskId = t.todoTaskId;
  if (t.method) links.method = t.method;
  if (t.secondaryProjectIds?.length) links.secondaryProjectIds = [...t.secondaryProjectIds];
  return links;
}

export function buildWorkContextSources(
  projects: Pick<ProjectItem, "id" | "title">[] | undefined,
  todoTasks: Pick<TodoTask, "id" | "title" | "parentTaskId">[] | undefined
): WorkContextSources {
  return {
    projectById: new Map((projects ?? []).map((p) => [p.id, p])),
    todoById: new Map((todoTasks ?? []).map((t) => [t.id, t])),
  };
}

/**
 * 作業名に添える「どの案件の/どのToDoの」の部分。添える必要がなければundefined。
 * ・案件(段階を含む)から追加した作業 → 案件名
 * ・ToDoのサブタスクから追加した作業 → 親タスク名
 * 作業名に既にその名前が入っている場合は重ねない
 */
export function workContextOf(item: WorkLinks, src: WorkContextSources): string | undefined {
  let ctx: string | undefined;
  if (item.projectId) ctx = src.projectById.get(item.projectId)?.title;
  if (!ctx && item.todoTaskId) {
    const todo = src.todoById.get(item.todoTaskId);
    if (todo?.parentTaskId) ctx = src.todoById.get(todo.parentTaskId)?.title;
  }
  if (!ctx || ctx === item.name || item.name.includes(ctx)) return undefined;
  return ctx;
}

/** 「案件名 › 作業名」の1行表記。添えるものが無ければ作業名だけ */
export function workNameWithContext(item: WorkLinks, src: WorkContextSources): string {
  const ctx = workContextOf(item, src);
  return ctx ? `${ctx} › ${item.name}` : item.name;
}

// 1つの集計行にまとめる案件・親タスクの数の上限。超えた分は「ほかN件」にする
const MAX_CONTEXTS_PER_ROW = 2;

/**
 * 実績を何らかのキーでまとめた集計行ごとに、添える「案件名・親タスク名」を求める。
 * 同じ作業が複数の案件にまたがる場合は「A案件・B案件」(3件以上は「ほかN件」)。キー→添える文字列
 */
export function workContextsByKey<R extends WorkLinks>(
  records: R[],
  src: WorkContextSources,
  keyOf: (r: R) => string
): Map<string, string[]> {
  const byKey = new Map<string, Set<string>>();
  for (const r of records) {
    const ctx = workContextOf(r, src);
    if (!ctx) continue;
    const key = keyOf(r);
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)!.add(ctx);
  }
  return new Map([...byKey].map(([k, v]) => [k, [...v]]));
}

/** 集計行の作業名に添える部分を1つの文字列にする(添えるものが無ければundefined) */
export function formatContexts(contexts: string[] | undefined, name: string): string | undefined {
  const ctxs = (contexts ?? []).filter((c) => !name.includes(c));
  if (ctxs.length === 0) return undefined;
  const shown = ctxs.slice(0, MAX_CONTEXTS_PER_ROW).join("・");
  const more = ctxs.length > MAX_CONTEXTS_PER_ROW ? ` ほか${ctxs.length - MAX_CONTEXTS_PER_ROW}件` : "";
  return `${shown}${more}`;
}

/**
 * 作業時間ランキングなど、実績を作業(作業マスタ)ごとにまとめた集計行向け。
 * 行に含まれる実績の案件・親タスクを集め、作業名を「案件名 › 作業名」にする
 */
export function withWorkContextNames<T extends { key: string; name: string }>(
  rows: T[],
  records: Pick<WorkRecord, "todoTaskId" | "projectId" | "isTrouble" | "masterTaskId" | "category" | "name">[],
  src: WorkContextSources
): T[] {
  const byKey = workContextsByKey(records, src, (r) => aggregateKey(r as WorkRecord));
  return rows.map((row) => {
    const ctx = formatContexts(byKey.get(row.key), row.name);
    return ctx ? { ...row, name: `${ctx} › ${row.name}` } : row;
  });
}

/**
 * 集計行の作業名(label)は元の実績を探し直すのにも使われている(残業分析の内訳など)ため、
 * 書き換えずに、添える部分を context として足す。表示側で「context › label」にする
 */
export function withWorkContextField<T extends { key: string; label: string }>(
  rows: T[],
  records: (WorkLinks & { category: string })[],
  src: WorkContextSources,
  keyOf: (r: WorkLinks & { category: string }) => string = (r) => `${r.category}::${r.name}`
): (T & { context?: string })[] {
  const byKey = workContextsByKey(records, src, keyOf);
  return rows.map((row) => {
    const ctx = formatContexts(byKey.get(row.key), row.label);
    return ctx ? { ...row, context: ctx } : row;
  });
}

/** context付きの集計行の表示名 */
export function rowLabelWithContext(row: { label: string; context?: string }): string {
  return row.context ? `${row.context} › ${row.label}` : row.label;
}
