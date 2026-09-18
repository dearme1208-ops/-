import { effectiveTag } from "./todo";
import { computeProjectProgress, effectiveProjectTag, isStageDone } from "./projectStage";
import type { DailyTask, ProjectItem, TodoTask } from "./types";

// 統合ボードの「ボード以外の見え方」ビュー群(諸島マップ・書架・氷山...)が共通して使う、
// ToDo/案件/本日の作業を1種類のフラットな見た目データへ正規化したもの。各ビューは
// これだけを見れば良く、対応状況の自動算出やサブタスク集計などをそれぞれで再実装しなくて済む
export type BoardViewKind = "todo" | "project" | "task";

export interface BoardViewItem {
  id: string;
  kind: BoardViewKind;
  title: string;
  category?: string;
  tag?: string;
  dueDate?: string;
  overdue: boolean;
  dueToday: boolean;
  important: boolean;
  createdAt: number;
  ageDays: number;
  progress: number; // 0..1。ToDoはサブタスク完了率、案件は段階完了率、本日の作業は経過/見積
  subtaskDone: number;
  subtaskTotal: number;
  imageDataUrl?: string;
  url?: string;
  todo?: TodoTask;
  project?: ProjectItem;
  task?: DailyTask;
}

export function buildBoardViewItems({
  todos,
  projects,
  boardTasks,
  subtaskStats,
  subtasksByParent,
  tagOptions,
  today,
}: {
  todos: TodoTask[];
  projects: ProjectItem[];
  boardTasks: DailyTask[];
  subtaskStats: Map<string, { done: number; total: number }>;
  subtasksByParent: Map<string, TodoTask[]>;
  tagOptions: string[];
  today: string;
}): BoardViewItem[] {
  const now = Date.now();
  const items: BoardViewItem[] = [];

  for (const t of todos) {
    const stat = subtaskStats.get(t.id) ?? { done: 0, total: 0 };
    const tag = effectiveTag(t, subtasksByParent.get(t.id) ?? [], tagOptions);
    items.push({
      id: `todo:${t.id}`,
      kind: "todo",
      title: t.title,
      category: t.category,
      tag,
      dueDate: t.dueDate,
      overdue: !!t.dueDate && t.dueDate < today,
      dueToday: t.dueDate === today,
      important: t.important,
      createdAt: t.createdAt,
      ageDays: Math.max(0, Math.floor((now - t.createdAt) / 86400000)),
      progress: stat.total > 0 ? stat.done / stat.total : 0,
      subtaskDone: stat.done,
      subtaskTotal: stat.total,
      imageDataUrl: t.imageDataUrl,
      url: t.url,
      todo: t,
    });
  }

  for (const p of projects) {
    const stages = p.stages ?? [];
    const doneStages = stages.filter((s) => isStageDone(s)).length;
    const progress = computeProjectProgress(stages) ?? 0;
    items.push({
      id: `project:${p.id}`,
      kind: "project",
      title: p.title,
      category: p.category,
      tag: effectiveProjectTag(p, tagOptions),
      dueDate: p.dueDate,
      overdue: !!p.dueDate && p.dueDate < today,
      dueToday: p.dueDate === today,
      important: false,
      createdAt: p.createdAt,
      ageDays: Math.max(0, Math.floor((now - p.createdAt) / 86400000)),
      progress,
      subtaskDone: doneStages,
      subtaskTotal: stages.length,
      url: p.url,
      project: p,
    });
  }

  for (const t of boardTasks) {
    const estimatedMs = t.estimatedSeconds * 1000;
    items.push({
      id: `task:${t.id}`,
      kind: "task",
      title: t.name,
      category: t.category,
      dueDate: today,
      overdue: false,
      dueToday: true,
      important: false,
      createdAt: t.startedAt ?? now,
      ageDays: 0,
      progress: estimatedMs > 0 ? Math.min(1, t.accumulatedMs / estimatedMs) : 0,
      subtaskDone: 0,
      subtaskTotal: 0,
      task: t,
    });
  }

  return items;
}
