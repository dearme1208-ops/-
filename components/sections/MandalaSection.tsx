"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { buildMandalaGrid, emptyMandalaChart, mandalaChartFromSample, MANDALA_SAMPLES, type MandalaCell } from "@/lib/mandala";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";
import type { MandalaChart, TodoTask } from "@/lib/types";

const GRID = buildMandalaGrid();

function cellValue(chart: MandalaChart, cell: MandalaCell): string {
  if (cell.kind === "goal") return chart.goal;
  if (cell.kind === "theme") return chart.themes[cell.themeIndex] ?? "";
  return chart.actions[cell.themeIndex][cell.actionIndex] ?? "";
}

function cellClass(cell: MandalaCell): string {
  if (cell.kind === "goal") {
    return "border-2 border-alert bg-alert/15 text-sm font-bold text-cream";
  }
  if (cell.kind === "theme") {
    return "border border-alert/40 bg-ink/40 text-xs font-bold text-cream/90";
  }
  return "border border-cream/10 bg-ink/20 text-[11px] text-cream/70";
}

async function ensureListId(): Promise<string> {
  const lists = await db.todoLists.orderBy("order").toArray();
  if (lists.length > 0) return lists[0].id;
  const id = uid();
  await db.todoLists.add({ id, title: "ToDo", order: 0, createdAt: Date.now() });
  return id;
}

export default function MandalaSection({
  onOpenTodoDetail,
}: {
  onOpenTodoDetail?: (taskId: string) => void;
}) {
  const charts = useLiveQuery(() => db.mandalaCharts.orderBy("createdAt").toArray(), []);
  const allTodoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const [activeChartId, setActiveChartId] = useState<string | null>(null);
  const [showNewChart, setShowNewChart] = useState(false);
  const [newChartTitle, setNewChartTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [editingCell, setEditingCell] = useState<MandalaCell | null>(null);
  const [showSamples, setShowSamples] = useState(false);

  // 未選択、または選択中のチャートが削除された場合は先頭のチャートへフォールバックする
  useEffect(() => {
    if (!charts || charts.length === 0) return;
    if (!activeChartId || !charts.some((c) => c.id === activeChartId)) {
      setActiveChartId(charts[0].id);
    }
  }, [charts, activeChartId]);

  const chart = charts?.find((c) => c.id === activeChartId) ?? null;

  const todoById = useMemo(() => new Map((allTodoTasks ?? []).map((t) => [t.id, t])), [allTodoTasks]);

  async function createChart() {
    const title = newChartTitle.trim();
    if (!title) return;
    const now = Date.now();
    const id = uid();
    await db.mandalaCharts.add({ id, createdAt: now, updatedAt: now, ...emptyMandalaChart(title) });
    setNewChartTitle("");
    setShowNewChart(false);
    setActiveChartId(id);
  }

  async function createChartFromSample(sample: (typeof MANDALA_SAMPLES)[number]) {
    const now = Date.now();
    const id = uid();
    await db.mandalaCharts.add({ id, createdAt: now, updatedAt: now, ...mandalaChartFromSample(sample) });
    setShowSamples(false);
    setActiveChartId(id);
  }

  async function deleteChart(target: MandalaChart) {
    await db.mandalaCharts.delete(target.id);
    if (activeChartId === target.id) setActiveChartId(null);
    showUndoToast(`「${target.title}」を削除しました`, async () => {
      await db.mandalaCharts.add(target);
    });
  }

  async function saveRename() {
    if (!chart) return;
    const title = renameValue.trim();
    if (!title) return;
    await db.mandalaCharts.update(chart.id, { title, updatedAt: Date.now() });
    setRenaming(false);
  }

  async function saveCellText(cell: MandalaCell, text: string) {
    if (!chart) return;
    const trimmed = text.trim();
    if (cell.kind === "goal") {
      await db.mandalaCharts.update(chart.id, { goal: trimmed, updatedAt: Date.now() });
    } else if (cell.kind === "theme") {
      const themes = [...chart.themes];
      themes[cell.themeIndex] = trimmed;
      await db.mandalaCharts.update(chart.id, { themes, updatedAt: Date.now() });
    } else {
      const actions = chart.actions.map((row) => [...row]);
      actions[cell.themeIndex][cell.actionIndex] = trimmed;
      await db.mandalaCharts.update(chart.id, { actions, updatedAt: Date.now() });
    }
  }

  async function linkTodo(cell: MandalaCell, todoTaskId: string | undefined) {
    if (!chart || cell.kind !== "action") return;
    const actionTodoIds = chart.actionTodoIds.map((row) => [...row]);
    actionTodoIds[cell.themeIndex][cell.actionIndex] = todoTaskId;
    await db.mandalaCharts.update(chart.id, { actionTodoIds, updatedAt: Date.now() });
  }

  // titleは呼び出し元(ダイアログ)がまさに入力中のテキストをそのまま渡す。
  // chart.actionsから読み直すと、保存(onSave)がまだDBに反映されておらず
  // 空文字のままの実績が読めてしまう(useLiveQueryの再取得が間に合わない)ため、
  // 必ず引数で受け取った値を使う
  async function createAndLinkTodo(cell: MandalaCell, title: string) {
    if (!chart || cell.kind !== "action") return;
    const trimmed = title.trim();
    if (!trimmed) return;
    const listId = await ensureListId();
    const task: TodoTask = {
      id: uid(),
      listId,
      title: trimmed,
      important: false,
      completed: false,
      order: (allTodoTasks ?? []).filter((t) => t.listId === listId && !t.parentTaskId).length,
      createdAt: Date.now(),
    };
    await db.todoTasks.add(task);
    await linkTodo(cell, task.id);
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(charts ?? []).map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveChartId(c.id)}
              className={c.id === activeChartId ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            >
              {c.title}
            </button>
          ))}
          {showNewChart ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newChartTitle}
                onChange={(e) => setNewChartTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createChart()}
                placeholder="チャート名"
                className="w-40 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-sm text-cream"
              />
              <button className="btn-pill text-xs" onClick={createChart}>
                作成
              </button>
              <button className="btn-pill-outline text-xs" onClick={() => setShowNewChart(false)}>
                ×
              </button>
            </div>
          ) : (
            <button className="btn-pill-outline text-sm" onClick={() => setShowNewChart(true)}>
              + 新規作成
            </button>
          )}
          <div className="relative">
            <button className="btn-pill-outline text-sm" onClick={() => setShowSamples((v) => !v)}>
              サンプルから作成
            </button>
            {showSamples && (
              <div className="absolute left-0 top-full z-10 mt-1 w-64 space-y-1 rounded-lg border border-cream/20 bg-ink p-2 shadow-lg">
                {MANDALA_SAMPLES.map((sample) => (
                  <button
                    key={sample.key}
                    className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-cream/80 hover:bg-cream/10"
                    onClick={() => createChartFromSample(sample)}
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-cream/50">
          中心に最終目標、その周り8マスにテーマ、各テーマの周り8マスに具体策を書き込みます。マスをタップすると編集できます。具体策のマスだけ、ToDoタスクの新規作成/紐付けができます。「サンプルから作成」で下書き入りのチャートをすぐに用意できます。
        </p>
      </div>

      {!chart && (
        <div className="panel p-6 text-center text-sm text-cream/50">
          まだマンダラチャートがありません。「+ 新規作成」から始めましょう。
        </div>
      )}

      {chart && (
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {renaming ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveRename()}
                  className="w-40 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-sm text-cream"
                />
                <button className="btn-pill text-xs" onClick={saveRename}>
                  保存
                </button>
                <button className="btn-pill-outline text-xs" onClick={() => setRenaming(false)}>
                  ×
                </button>
              </div>
            ) : (
              <button
                className="font-display text-lg font-bold text-cream hover:underline"
                onClick={() => {
                  setRenameValue(chart.title);
                  setRenaming(true);
                }}
              >
                {chart.title} ✎
              </button>
            )}
            <button className="text-xs text-alert hover:underline" onClick={() => deleteChart(chart)}>
              このチャートを削除
            </button>
          </div>

          <div className="overflow-x-auto">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: "repeat(9, minmax(64px, 1fr))", width: "max-content", minWidth: "100%" }}
            >
              {GRID.flatMap((row, r) =>
                row.map((cell, c) => {
                  const value = cellValue(chart, cell);
                  const linkedId = cell.kind === "action" ? chart.actionTodoIds[cell.themeIndex][cell.actionIndex] : undefined;
                  const linkedTask = linkedId ? todoById.get(linkedId) : undefined;
                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      onClick={() => setEditingCell(cell)}
                      className={`relative flex aspect-square items-center justify-center rounded-md p-1 text-center leading-tight ${cellClass(cell)} hover:brightness-125`}
                    >
                      <span className="line-clamp-3 break-words">{value || (cell.kind === "goal" ? "目標を入力" : cell.kind === "theme" ? "テーマ" : "")}</span>
                      {cell.kind === "action" && linkedId && (
                        <span
                          className={`absolute right-0.5 top-0.5 text-[10px] ${linkedTask?.completed ? "text-cream/30" : "text-alert"}`}
                          title={linkedTask ? `ToDo紐付け済み: ${linkedTask.title}` : "ToDo紐付け済み"}
                        >
                          {linkedTask?.completed ? "✓" : "🔗"}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {chart && editingCell && (
        <MandalaCellDialog
          cell={editingCell}
          value={cellValue(chart, editingCell)}
          linkedTask={
            editingCell.kind === "action"
              ? todoById.get(chart.actionTodoIds[editingCell.themeIndex][editingCell.actionIndex] ?? "")
              : undefined
          }
          allTodoTasks={allTodoTasks ?? []}
          onSave={(text) => saveCellText(editingCell, text)}
          onLinkExisting={(todoTaskId) => linkTodo(editingCell, todoTaskId)}
          onCreateAndLink={(title) => createAndLinkTodo(editingCell, title)}
          onUnlink={() => linkTodo(editingCell, undefined)}
          onOpenTodoDetail={onOpenTodoDetail}
          onClose={() => setEditingCell(null)}
        />
      )}
    </div>
  );
}

function MandalaCellDialog({
  cell,
  value,
  linkedTask,
  allTodoTasks,
  onSave,
  onLinkExisting,
  onCreateAndLink,
  onUnlink,
  onOpenTodoDetail,
  onClose,
}: {
  cell: MandalaCell;
  value: string;
  linkedTask?: TodoTask;
  allTodoTasks: TodoTask[];
  onSave: (text: string) => void;
  onLinkExisting: (todoTaskId: string) => void;
  onCreateAndLink: (title: string) => void;
  onUnlink: () => void;
  onOpenTodoDetail?: (taskId: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  const title = cell.kind === "goal" ? "最終目標" : cell.kind === "theme" ? "テーマ" : "具体策";

  function save() {
    onSave(text);
    onClose();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          placeholder={cell.kind === "goal" ? "例: 今年中に◯◯を達成する" : cell.kind === "theme" ? "例: 体づくり" : "例: 毎朝ストレッチをする"}
        />
        <div className="flex justify-end">
          <button className="btn-pill text-sm" onClick={save}>
            保存
          </button>
        </div>

        {cell.kind === "action" && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <h4 className="text-xs font-bold text-cream/60">ToDo連携</h4>
            {linkedTask ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/40 px-3 py-2">
                <span className={`text-sm ${linkedTask.completed ? "text-cream/40 line-through" : "text-cream"}`}>
                  {linkedTask.title}
                </span>
                <div className="flex gap-2">
                  {onOpenTodoDetail && (
                    <button
                      className="text-xs text-cream/60 hover:text-cream"
                      onClick={() => {
                        onOpenTodoDetail(linkedTask.id);
                        onClose();
                      }}
                    >
                      開く
                    </button>
                  )}
                  <button className="text-xs text-alert hover:underline" onClick={onUnlink}>
                    紐付け解除
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-pill-outline text-xs disabled:opacity-40"
                    disabled={!text.trim()}
                    onClick={() => {
                      onSave(text);
                      onCreateAndLink(text);
                    }}
                  >
                    + ToDoとして追加
                  </button>
                  <button className="btn-pill-outline text-xs" onClick={() => setShowLinkPicker((v) => !v)}>
                    既存のToDoを紐付け
                  </button>
                </div>
                {showLinkPicker && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onLinkExisting(e.target.value);
                        setShowLinkPicker(false);
                      }
                    }}
                    className="w-full rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
                  >
                    <option value="" disabled>
                      タスクを選択...
                    </option>
                    {allTodoTasks
                      .filter((t) => !t.completed)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
