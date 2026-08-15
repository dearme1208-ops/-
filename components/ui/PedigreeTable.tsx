"use client";

import { useMemo, useState } from "react";
import type { TreeNode, TreeNodeBadge } from "@/components/ui/TreeView";

// 縦書きの列見出し用スタイル(グループ/タスクの各名称セルに適用)。
// text-orientation: mixed だと半角の数字・英字だけ90度横倒しになり読みにくいため、
// upright にして全ての文字を(数字・英字も含めて)正立させたまま縦に並べる
const VERTICAL_STYLE = { writingMode: "vertical-rl" as const, textOrientation: "upright" as const };
// グループ列(大項目〜対応状況)は深さに応じて濃淡だけ変える。新しい色相は増やさない
const GROUP_BG = ["bg-ink/40", "bg-ink/28", "bg-ink/16"];

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

interface GroupCell {
  key: string;
  label: string;
  rowSpan: number; // 0 = このセルは直前の行のrowSpanに結合されており描画しない
  badges?: TreeNodeBadge[];
}

interface FlatRow {
  key: string;
  groups: GroupCell[]; // groupLabelsと同じ長さ(例: リスト/分類/対応状況)
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

// タスク(中)→サブタスク(小)の行を組み立てる。グループ列は呼び出し元が埋める
function buildTaskRows(taskNodes: TreeNode[], expandedTasks: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const task of taskNodes) {
    const subtasks = task.children ?? [];
    const subtaskCount = subtasks.length;
    const expanded = expandedTasks.has(task.id);
    if (subtaskCount === 0) {
      rows.push({
        key: `${task.id}-empty`,
        groups: [],
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
        groups: [],
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
          groups: [],
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
  return rows;
}

// グループ階層(リスト→分類→対応状況など、任意の深さ)を再帰的にたどり、同じ親を持つ行の
// グループセルをrowSpanで縦結合する。最下層(depth === groupDepth)に達したらタスク行を組み立てる
function buildRows(groupNodes: TreeNode[], depth: number, groupDepth: number, expandedTasks: Set<string>): FlatRow[] {
  if (depth === groupDepth) {
    return buildTaskRows(groupNodes, expandedTasks);
  }
  const rows: FlatRow[] = [];
  for (const node of groupNodes) {
    const start = rows.length;
    const childRows = buildRows(node.children ?? [], depth + 1, groupDepth, expandedTasks);
    for (const r of childRows) {
      r.groups[depth] = { key: node.id, label: node.label, rowSpan: 0, badges: node.badges };
    }
    rows.push(...childRows);
    if (rows.length > start) {
      rows[start].groups[depth] = { ...rows[start].groups[depth], rowSpan: rows.length - start };
    }
  }
  return rows;
}

// 競走馬の血統表そのままの表組みを再現したツリー表示。同じ親を持つ行はセルをrowSpanで
// 縦に結合して1回だけ表示し、名前は縦書き、値(アクション/期日)は横書きで見せる。
// groupLabelsの数だけリスト→分類→対応状況…といった任意の深さのグループ階層を表現できる
export default function PedigreeTable({ nodes, groupLabels }: { nodes: TreeNode[]; groupLabels: string[] }) {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () => buildRows(nodes, 0, groupLabels.length, expandedTasks),
    [nodes, groupLabels.length, expandedTasks]
  );

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
            {groupLabels.map((label) => (
              <th key={label} className="border border-cream/10 px-2 py-1 font-normal">
                {label}
              </th>
            ))}
            <th className="border border-cream/10 px-2 py-1 font-normal">タスク</th>
            <th className="border border-cream/10 px-2 py-1 text-right font-normal">アクション</th>
            <th className="border border-cream/10 px-2 py-1 font-normal">サブタスク</th>
            <th className="border border-cream/10 px-2 py-1 text-right font-normal">期日</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {row.groups.map((cell, depth) =>
                cell.rowSpan > 0 ? (
                  <td
                    key={cell.key}
                    rowSpan={cell.rowSpan}
                    className={`border border-cream/10 px-2 py-2 align-top ${GROUP_BG[Math.min(depth, GROUP_BG.length - 1)]}`}
                  >
                    <span className={`inline-block text-cream ${depth === 0 ? "text-sm font-bold" : "text-xs"}`} style={VERTICAL_STYLE}>
                      {cell.label}
                    </span>
                    <Badges badges={cell.badges} />
                  </td>
                ) : null
              )}
              {row.taskRowSpan > 0 && (
                <>
                  <td
                    rowSpan={row.taskRowSpan}
                    className={`border border-cream/10 bg-ink/10 px-2 py-2 align-top ${
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
                      <span className="inline-block text-xs text-cream" style={VERTICAL_STYLE}>
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
                    className={`border border-cream/10 px-2 py-2 align-top ${
                      row.subtaskEmphasis ? "ring-1 ring-inset ring-alert/40" : ""
                    }`}
                  >
                    <span className="block max-w-[10rem] truncate text-xs text-cream" title={row.subtaskLabel}>
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
