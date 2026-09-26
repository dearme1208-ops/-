import { bucketFor, type TaskTrendPoint, type TrendGranularity } from "./aggregate";
import { getPeriodRange, isDateStrInRange, type PeriodFilter } from "./period";
import type { ProjectItem, TodoTask, WorkRecord } from "./types";

// 案件・ToDoに紐づく実績だけに絞った時間集計。lib/aggregate.tsの作業別ランキングは
// 業務区分・詳細作業名(masterTaskId)単位でしか見られず、「この案件/このToDoにどれだけ
// 時間を使ったか」「その内訳(段階別・サブタスク別)」を横断的に見る手段が無かったため、
// ここで案件別・ToDo別の集計とその内訳(段階/サブタスク)・時系列推移を提供する

export type LinkedGroupKind = "project" | "todo";

export interface LinkedAggregateRow {
  key: string; // projectId または (トップレベル)todoTaskId
  kind: LinkedGroupKind;
  title: string;
  subtitle?: string;
  totalSeconds: number;
  avgSeconds: number;
  count: number;
}

export type LinkedSortMetric = "total" | "avg" | "count";

function sortLinkedRows<T extends { totalSeconds: number; avgSeconds: number; count: number }>(
  rows: T[],
  sortBy: LinkedSortMetric
): T[] {
  const metricKey: Record<LinkedSortMetric, keyof T> = {
    total: "totalSeconds" as keyof T,
    avg: "avgSeconds" as keyof T,
    count: "count" as keyof T,
  };
  return [...rows].sort((a, b) => (b[metricKey[sortBy]] as number) - (a[metricKey[sortBy]] as number));
}

// 案件別の集計。主案件(projectId)だけでなく、兼務向けの追加タグ(secondaryProjectIds)で
// この案件が挙がっている実績も合算する(ProjectsSectionの累計作業時間と同じ考え方)
export function aggregateByProject(
  records: WorkRecord[],
  projects: ProjectItem[],
  filter: PeriodFilter,
  sortBy: LinkedSortMetric,
  now: Date = new Date()
): LinkedAggregateRow[] {
  const range = getPeriodRange(filter, now);
  const inPeriod = records.filter((r) => isDateStrInRange(r.date, range) && !r.excludedFromStats);
  const map = new Map<string, { totalSeconds: number; count: number }>();
  for (const r of inPeriod) {
    const ids = new Set([r.projectId, ...(r.secondaryProjectIds ?? [])].filter((id): id is string => !!id));
    for (const id of ids) {
      const cur = map.get(id) ?? { totalSeconds: 0, count: 0 };
      cur.totalSeconds += r.seconds;
      cur.count += 1;
      map.set(id, cur);
    }
  }
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const rows: LinkedAggregateRow[] = [...map.entries()].map(([id, v]) => {
    const p = projectById.get(id);
    return {
      key: id,
      kind: "project" as const,
      title: p?.title ?? "（削除済みの案件）",
      subtitle: p ? [p.category, p.workName].filter(Boolean).join(" / ") || undefined : undefined,
      totalSeconds: v.totalSeconds,
      avgSeconds: v.totalSeconds / v.count,
      count: v.count,
    };
  });
  return sortLinkedRows(rows, sortBy);
}

// ToDo別の集計。サブタスク(parentTaskIdあり)は独立した行にはせず、親ToDoの行に
// 合算して見せる(内訳はcomputeTodoSubtaskBreakdownで別途ドリルダウンする)。
// 1段目の親子関係のみ考慮する(このアプリのサブタスクは1階層のみのため)
export function aggregateByTodo(
  records: WorkRecord[],
  todoTasks: TodoTask[],
  filter: PeriodFilter,
  sortBy: LinkedSortMetric,
  now: Date = new Date()
): LinkedAggregateRow[] {
  const range = getPeriodRange(filter, now);
  const inPeriod = records.filter((r) => r.todoTaskId && isDateStrInRange(r.date, range) && !r.excludedFromStats);
  const todoById = new Map(todoTasks.map((t) => [t.id, t]));
  // 実績が付いたToDoごとに、それが属する「トップレベルのToDo」(サブタスクなら親)を求める
  const topIdFor = (todoId: string): string | null => {
    const t = todoById.get(todoId);
    if (!t) return null;
    return t.parentTaskId ?? t.id;
  };
  const map = new Map<string, { totalSeconds: number; count: number }>();
  for (const r of inPeriod) {
    const topId = topIdFor(r.todoTaskId!);
    if (!topId) continue;
    const cur = map.get(topId) ?? { totalSeconds: 0, count: 0 };
    cur.totalSeconds += r.seconds;
    cur.count += 1;
    map.set(topId, cur);
  }
  const rows: LinkedAggregateRow[] = [...map.entries()].map(([id, v]) => {
    const t = todoById.get(id);
    return {
      key: id,
      kind: "todo" as const,
      title: t?.title ?? "（削除済みのToDo）",
      subtitle: t ? [t.category, t.customer].filter(Boolean).join(" / ") || undefined : undefined,
      totalSeconds: v.totalSeconds,
      avgSeconds: v.totalSeconds / v.count,
      count: v.count,
    };
  });
  return sortLinkedRows(rows, sortBy);
}

export interface LinkedBreakdownRow {
  key: string;
  title: string;
  totalSeconds: number;
  avgSeconds: number;
  count: number;
}

// 案件1件の内訳。段階(ProjectStage)ごとに実績を積み上げ、時間の大きい順に並べる。
// 段階に紐づいていない(案件タグだけ付いた)実績は「（段階未設定）」としてまとめる
export function computeProjectStageBreakdown(records: WorkRecord[], project: ProjectItem): LinkedBreakdownRow[] {
  const stageTitleById = new Map((project.stages ?? []).map((s) => [s.id, s.title]));
  const map = new Map<string, { totalSeconds: number; count: number }>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const ids = new Set([r.projectId, ...(r.secondaryProjectIds ?? [])].filter((id): id is string => !!id));
    if (!ids.has(project.id)) continue;
    const key = r.stageId && stageTitleById.has(r.stageId) ? r.stageId : "__none__";
    const cur = map.get(key) ?? { totalSeconds: 0, count: 0 };
    cur.totalSeconds += r.seconds;
    cur.count += 1;
    map.set(key, cur);
  }
  const rows: LinkedBreakdownRow[] = [...map.entries()].map(([key, v]) => ({
    key,
    title: key === "__none__" ? "（段階未設定）" : (stageTitleById.get(key) ?? key),
    totalSeconds: v.totalSeconds,
    avgSeconds: v.totalSeconds / v.count,
    count: v.count,
  }));
  return rows.sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// ToDo1件の内訳。サブタスクごとに実績を積み上げ、時間の大きい順に並べる。
// ToDo本体(サブタスクではなく親自身)に直接付いた実績は「（本体）」としてまとめる
export function computeTodoSubtaskBreakdown(
  records: WorkRecord[],
  parentTodo: TodoTask,
  allTodoTasks: TodoTask[]
): LinkedBreakdownRow[] {
  const children = allTodoTasks.filter((t) => t.parentTaskId === parentTodo.id);
  const titleById = new Map<string, string>([[parentTodo.id, "（本体）"], ...children.map((c) => [c.id, c.title] as const)]);
  const map = new Map<string, { totalSeconds: number; count: number }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.todoTaskId || !titleById.has(r.todoTaskId)) continue;
    const cur = map.get(r.todoTaskId) ?? { totalSeconds: 0, count: 0 };
    cur.totalSeconds += r.seconds;
    cur.count += 1;
    map.set(r.todoTaskId, cur);
  }
  const rows: LinkedBreakdownRow[] = [...map.entries()].map(([key, v]) => ({
    key,
    title: titleById.get(key) ?? key,
    totalSeconds: v.totalSeconds,
    avgSeconds: v.totalSeconds / v.count,
    count: v.count,
  }));
  return rows.sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// 案件1件(主+兼務タグ含む)の実績だけを対象にした、年度/半期/月単位の時系列推移
export function computeProjectTrend(records: WorkRecord[], projectId: string, granularity: TrendGranularity): TaskTrendPoint[] {
  const matching = records.filter((r) => {
    if (r.excludedFromStats) return false;
    const ids = new Set([r.projectId, ...(r.secondaryProjectIds ?? [])].filter((id): id is string => !!id));
    return ids.has(projectId);
  });
  return bucketTrend(matching, granularity);
}

// ToDo1件(配下のサブタスクを含む)の実績だけを対象にした、年度/半期/月単位の時系列推移
export function computeTodoTrend(records: WorkRecord[], todoIds: Set<string>, granularity: TrendGranularity): TaskTrendPoint[] {
  const matching = records.filter((r) => !r.excludedFromStats && r.todoTaskId && todoIds.has(r.todoTaskId));
  return bucketTrend(matching, granularity);
}

function bucketTrend(records: WorkRecord[], granularity: TrendGranularity): TaskTrendPoint[] {
  const map = new Map<string, TaskTrendPoint>();
  for (const r of records) {
    const { sortKey, label } = bucketFor(r.date, granularity);
    if (!map.has(sortKey)) map.set(sortKey, { label, sortKey, totalSeconds: 0, count: 0 });
    const point = map.get(sortKey)!;
    point.totalSeconds += r.seconds;
    point.count += 1;
  }
  return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}
