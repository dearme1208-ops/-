"use client";

import { useMemo, useState } from "react";
import type { TreeNode, TreeNodeBadge } from "@/components/ui/TreeView";

// 縦書きの列見出し用スタイル(リスト/タスク/サブタスクの各名称セルに適用)
const VERTICAL_STYLE = { writingMode: "vertical-rl" as const, textOrientation: "mixed" as const };

function badgeClass(tone: TreeNodeBadge["tone"]): string {
  if (tone === "alert") return "bg-alert/20 text-alert font-bold";
  if (tone === "muted") return "text-cream/30";
  return "bg-cream/10 text-cream/70";
}

function Badges({ badges }: { badges?: TreeNodeBadge[] }) {
  if (!badges || badges.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      {badges.map((b, i) => (
        <span key={i} className={`rounded-full px-1.5 py-0.5 text-[10px] ${badgeClass(b.tone)}`}>
          {b.text}
        </span>
      ))}
    </div>
  );
}

interface FlatRow {
  key: string;
  listId: string;
  listLabel: string;
  listRowSpan: number;
  taskId: string;
  taskLabel: string;
  taskRowSpan: number;
  taskEmphasis: boolean;
  taskBadges?: TreeNodeBadge[];
  taskSubtaskCount: number;
  actionLabel: string;
  isCollapsedSummary: boolean;
  collapsedCount: number;
  hasSubtaskColumns: boolean;
  subtaskLabel?: string;
  subtaskEmphasis?: boolean;
  subtaskBadges?: TreeNodeBadge[];
  dateLabel?: string;
}

// リスト(大)→タスク(中)→サブタスク(小)の3階層を前提に、同じ親を持つ行を
// rowSpanで結合した「本家の血統表」に近い表組み用の行データへ変換する
function buildRows(lists: TreeNode[], expandedTasks: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const list of lists) {
    const listStart = rows.length;
    for (const task of list.children ?? []) {
      const subtasks = task.children ?? [];
      const subtaskCount = subtasks.length;
      const expanded = expandedTasks.has(task.id);
      if (subtaskCount === 0) {
        rows.push({
          key: `${task.id}-empty`,
          listId: list.id,
          listLabel: list.label,
          listRowSpan: 0,
          taskId: task.id,
          taskLabel: task.label,
          taskRowSpan: 1,
          taskEmphasis: !!task.emphasis,
          taskBadges: task.badges,
          taskSubtaskCount: 0,
          actionLabel: task.valueLabel ?? "",
          isCollapsedSummary: false,
          collapsedCount: 0,
          hasSubtaskColumns: false,
        });
      } else if (!expanded) {
        rows.push({
          key: `${task.id}-collapsed`,
          listId: list.id,
          listLabel: list.label,
          listRowSpan: 0,
          taskId: task.id,
          taskLabel: task.label,
          taskRowSpan: 1,
          taskEmphasis: !!task.emphasis,
          taskBadges: task.badges,
          taskSubtaskCount: subtaskCount,
          actionLabel: task.valueLabel ?? "",
          isCollapsedSummary: true,
          collapsedCount: subtaskCount,
          hasSubtaskColumns: false,
        });
      } else {
        subtasks.forEach((s, i) => {
          rows.push({
            key: s.id,
            listId: list.id,
            listLabel: list.label,
            listRowSpan: 0,
            taskId: task.id,
            taskLabel: task.label,
            taskRowSpan: i === 0 ? subtaskCount : 0,
            taskEmphasis: !!task.emphasis,
            taskBadges: i === 0 ? task.badges : undefined,
            taskSubtaskCount: subtaskCount,
            actionLabel: task.valueLabel ?? "",
            isCollapsedSummary: false,
            collapsedCount: 0,
            hasSubtaskColumns: true,
            subtaskLabel: s.label,
            subtaskEmphasis: !!s.emphasis,
            subtaskBadges: s.badges,
            dateLabel: s.valueLabel ?? "",
          });
        });
      }
    }
    if (rows.length > listStart) {
      rows[listStart].listRowSpan = rows.length - listStart;
    }
  }
  return rows;
}

// 競走馬の血統表そのままの表組みを再現したツリー表示。同じ親(大/中)を持つ行は
// セルをrowSpanで縦に結合して1回だけ表示し、名前は縦書き、値(アクション/期日)は横書きで見せる
export default function PedigreeTable({ nodes }: { nodes: TreeNode[] }) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const rows = useMemo(() => buildRows(nodes, expandedTasks), [nodes, expandedTasks]);

  if (rows.length === 0) {
    return <p className="px-1 py-4 text-sm text-cream/50">表示する項目がありません。</p>;
  }

  const toggleTask = (id: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-cream/15">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] text-cream/40">
            <th className="border border-cream/10 px-2 py-1 font-normal">リスト</th>
            <th className="border border-cream/10 px-2 py-1 font-normal">タスク</th>
            <th className="border border-cream/10 px-2 py-1 text-right font-normal">アクション</th>
            <th className="border border-cream/10 px-2 py-1 font-normal">サブタスク</th>
            <th className="border border-cream/10 px-2 py-1 text-right font-normal">期日</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.listRowSpan > 0 && (
                <td rowSpan={row.listRowSpan} className="border border-cream/10 bg-ink/40 px-2 py-2 align-top">
                  <span className="inline-block text-sm font-bold text-cream" style={VERTICAL_STYLE}>
                    {row.listLabel}
                  </span>
                </td>
              )}
              {row.taskRowSpan > 0 && (
                <>
                  <td
                    rowSpan={row.taskRowSpan}
                    className={`border border-cream/10 bg-ink/25 px-2 py-2 align-top ${
                      row.taskEmphasis ? "ring-1 ring-inset ring-alert/40" : ""
                    }`}
                  >
                    <div className="flex items-start gap-1">
                      {row.taskSubtaskCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => toggleTask(row.taskId)}
                          className="shrink-0 text-cream/50 hover:text-cream"
                          aria-label={expandedTasks.has(row.taskId) ? "折りたたむ" : "展開"}
                          aria-expanded={expandedTasks.has(row.taskId)}
                        >
                          <span
                            className={`inline-block transition-transform ${
                              expandedTasks.has(row.taskId) ? "" : "-rotate-90"
                            }`}
                          >
                            ▾
                          </span>
                        </button>
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="inline-block text-sm text-cream" style={VERTICAL_STYLE}>
                        {row.taskLabel}
                      </span>
                    </div>
                  </td>
                  <td rowSpan={row.taskRowSpan} className="border border-cream/10 px-2 py-2 align-top text-right">
                    <span className="text-xs text-cream/60">{row.actionLabel || "—"}</span>
                    <Badges badges={row.taskBadges} />
                  </td>
                </>
              )}
              {row.isCollapsedSummary ? (
                <td colSpan={2} className="border border-cream/10 px-2 py-2 align-top">
                  <button
                    type="button"
                    onClick={() => toggleTask(row.taskId)}
                    className="text-xs text-cream/40 hover:text-cream"
                  >
                    ▸ サブタスク{row.collapsedCount}件
                  </button>
                </td>
              ) : row.hasSubtaskColumns ? (
                <>
                  <td
                    className={`border border-cream/10 bg-ink/10 px-2 py-2 align-top ${
                      row.subtaskEmphasis ? "ring-1 ring-inset ring-alert/40" : ""
                    }`}
                  >
                    <span className="inline-block text-xs text-cream" style={VERTICAL_STYLE}>
                      {row.subtaskLabel}
                    </span>
                  </td>
                  <td className="border border-cream/10 px-2 py-2 align-top text-right">
                    <span className="text-xs text-cream/60">{row.dateLabel || "—"}</span>
                    <Badges badges={row.subtaskBadges} />
                  </td>
                </>
              ) : (
                <>
                  <td className="border border-cream/10 px-2 py-2" />
                  <td className="border border-cream/10 px-2 py-2" />
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
