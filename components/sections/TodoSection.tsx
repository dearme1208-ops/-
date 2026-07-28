"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeNextDueDate, DEFAULT_TAG_PRESETS } from "@/lib/todo";
import { todayStr, formatDateJp } from "@/lib/time";
import type { RecurrenceRule, RecurrenceType, TodoTask } from "@/lib/types";
import { RECURRENCE_TYPE_LABELS, WEEKDAY_JP, ORDINAL_LABELS } from "@/lib/types";
import Modal from "@/components/ui/Modal";

const DEFAULT_LIST_TITLE = "タスク";
const CUSTOM_TAG_VALUE = "__custom__";
const NO_TAG_VALUE = "";

type ViewKey = "myday" | "important" | "planned" | `list:${string}`;

export default function TodoSection() {
  const [view, setView] = useState<ViewKey>("myday");
  const [showNewList, setShowNewList] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskTagMode, setNewTaskTagMode] = useState<string>(NO_TAG_VALUE);
  const [newTaskCustomTag, setNewTaskCustomTag] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const today = todayStr();

  const lists = useLiveQuery(() => db.todoLists.orderBy("order").toArray(), []);
  const allTasks = useLiveQuery(() => db.todoTasks.toArray(), []);

  // 初回は既定のリストを1つ用意しておく
  useEffect(() => {
    if (lists && lists.length === 0) {
      db.todoLists.add({ id: uid(), title: DEFAULT_LIST_TITLE, order: 0, createdAt: Date.now() });
    }
  }, [lists]);

  useEffect(() => {
    if (view.startsWith("list:") && lists && lists.length > 0) {
      const listId = view.slice(5);
      if (!lists.some((l) => l.id === listId)) {
        setView("myday");
      }
    }
  }, [view, lists]);

  const tagOptions = useMemo(() => {
    const used = new Set<string>(DEFAULT_TAG_PRESETS);
    for (const t of allTasks ?? []) {
      if (t.tag) used.add(t.tag);
    }
    return [...used];
  }, [allTasks]);

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const t of allTasks ?? []) {
      if (!t.parentTaskId) continue;
      if (!map.has(t.parentTaskId)) map.set(t.parentTaskId, []);
      map.get(t.parentTaskId)!.push(t);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
    return map;
  }, [allTasks]);

  const topLevelTasks = useMemo(() => (allTasks ?? []).filter((t) => !t.parentTaskId), [allTasks]);

  const currentListId = view.startsWith("list:") ? view.slice(5) : null;

  const visibleTasks = useMemo(() => {
    let filtered: TodoTask[];
    if (view === "myday") {
      filtered = topLevelTasks.filter((t) => t.myDayDate === today);
    } else if (view === "important") {
      filtered = topLevelTasks.filter((t) => t.important);
    } else if (view === "planned") {
      filtered = topLevelTasks.filter((t) => !!t.dueDate);
    } else if (currentListId) {
      filtered = topLevelTasks.filter((t) => t.listId === currentListId);
    } else {
      filtered = [];
    }
    return [...filtered].sort((a, b) => {
      const doneDiff = Number(a.completed) - Number(b.completed);
      if (doneDiff !== 0) return doneDiff;
      if (view === "planned") {
        return (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99");
      }
      return a.order - b.order;
    });
  }, [view, currentListId, topLevelTasks, today]);

  const incompleteTasks = visibleTasks.filter((t) => !t.completed);
  const completedTasks = visibleTasks.filter((t) => t.completed);

  const detailTask = allTasks?.find((t) => t.id === detailTaskId) ?? null;

  async function addList() {
    if (!newListTitle.trim()) return;
    await db.todoLists.add({ id: uid(), title: newListTitle.trim(), order: (lists?.length ?? 0), createdAt: Date.now() });
    setNewListTitle("");
    setShowNewList(false);
  }

  async function deleteList(listId: string) {
    if (!confirm("このリストと、含まれる全てのタスクを削除しますか?")) return;
    const taskIds = (allTasks ?? []).filter((t) => t.listId === listId).map((t) => t.id);
    await db.transaction("rw", db.todoLists, db.todoTasks, async () => {
      await db.todoTasks.bulkDelete(taskIds);
      await db.todoLists.delete(listId);
    });
    if (view === `list:${listId}`) setView("myday");
  }

  function resolveTag(mode: string, custom: string): string | undefined {
    if (mode === CUSTOM_TAG_VALUE) return custom.trim() || undefined;
    return mode || undefined;
  }

  async function addTask() {
    if (!newTaskTitle.trim()) return;
    const targetListId = currentListId ?? lists?.[0]?.id;
    if (!targetListId) return;
    const count = (allTasks ?? []).filter((t) => t.listId === targetListId && !t.parentTaskId).length;
    const task: TodoTask = {
      id: uid(),
      listId: targetListId,
      title: newTaskTitle.trim(),
      tag: resolveTag(newTaskTagMode, newTaskCustomTag),
      important: view === "important",
      completed: false,
      order: count,
      createdAt: Date.now(),
      myDayDate: view === "myday" ? today : undefined,
    };
    await db.todoTasks.add(task);
    setNewTaskTitle("");
    setNewTaskTagMode(NO_TAG_VALUE);
    setNewTaskCustomTag("");
  }

  async function toggleComplete(task: TodoTask) {
    if (!task.completed && task.recurrence) {
      const nextDue = computeNextDueDate(task.recurrence, task.dueDate ?? today);
      await db.todoTasks.update(task.id, { dueDate: nextDue });
      return;
    }
    await db.todoTasks.update(task.id, {
      completed: !task.completed,
      completedAt: !task.completed ? Date.now() : undefined,
    });
  }

  async function toggleImportant(task: TodoTask) {
    await db.todoTasks.update(task.id, { important: !task.important });
  }

  async function toggleMyDay(task: TodoTask) {
    await db.todoTasks.update(task.id, { myDayDate: task.myDayDate === today ? undefined : today });
  }

  async function deleteTask(task: TodoTask) {
    if (!confirm(`「${task.title}」を削除しますか?`)) return;
    const subIds = (subtasksByParent.get(task.id) ?? []).map((s) => s.id);
    await db.todoTasks.bulkDelete([task.id, ...subIds]);
    if (detailTaskId === task.id) setDetailTaskId(null);
  }

  const listLabel = (key: ViewKey) => {
    if (key === "myday") return "マイデイ";
    if (key === "important") return "重要";
    if (key === "planned") return "期限日";
    return lists?.find((l) => l.id === key.slice(5))?.title ?? "";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["myday", "important", "planned"] as ViewKey[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={view === v ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          >
            {v === "myday" ? "☀ マイデイ" : v === "important" ? "★ 重要" : "📅 期限日"}
          </button>
        ))}
        {(lists ?? []).map((l) => (
          <div key={l.id} className="flex items-center">
            <button
              onClick={() => setView(`list:${l.id}`)}
              className={view === `list:${l.id}` ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            >
              {l.title}
            </button>
          </div>
        ))}
        {showNewList ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newListTitle}
              onChange={(e) => setNewListTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addList()}
              placeholder="リスト名"
              className="w-32 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-sm text-cream"
            />
            <button className="btn-pill text-xs" onClick={addList}>
              追加
            </button>
            <button className="btn-pill-outline text-xs" onClick={() => setShowNewList(false)}>
              ×
            </button>
          </div>
        ) : (
          <button className="btn-pill-outline text-sm" onClick={() => setShowNewList(true)}>
            + 新しいリスト
          </button>
        )}
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{listLabel(view)}</h2>
          {currentListId && (
            <button className="text-xs text-alert" onClick={() => deleteList(currentListId)}>
              このリストを削除
            </button>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="+ タスクを追加"
            className="min-w-[10rem] flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <select
            value={newTaskTagMode}
            onChange={(e) => setNewTaskTagMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
          >
            <option value={NO_TAG_VALUE}>タグなし</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={CUSTOM_TAG_VALUE}>＋ 新しいタグ...</option>
          </select>
          {newTaskTagMode === CUSTOM_TAG_VALUE && (
            <input
              value={newTaskCustomTag}
              onChange={(e) => setNewTaskCustomTag(e.target.value)}
              placeholder="タグ名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
            />
          )}
          <button className="btn-pill text-sm" onClick={addTask} disabled={!newTaskTitle.trim()}>
            追加
          </button>
        </div>

        <div className="space-y-1.5">
          {incompleteTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              subtasks={subtasksByParent.get(task.id) ?? []}
              onToggleComplete={() => toggleComplete(task)}
              onToggleImportant={() => toggleImportant(task)}
              onOpenDetail={() => setDetailTaskId(task.id)}
            />
          ))}
          {incompleteTasks.length === 0 && (
            <p className="px-1 py-4 text-sm text-cream/50">タスクはありません。</p>
          )}
        </div>

        {completedTasks.length > 0 && (
          <div className="mt-4 border-t border-cream/10 pt-3">
            <button
              className="mb-2 text-xs text-cream/50 hover:text-cream/80"
              onClick={() => setShowCompleted((v) => !v)}
            >
              {showCompleted ? "▼" : "▶"} 完了済み（{completedTasks.length}）
            </button>
            {showCompleted && (
              <div className="space-y-1.5">
                {completedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    subtasks={subtasksByParent.get(task.id) ?? []}
                    onToggleComplete={() => toggleComplete(task)}
                    onToggleImportant={() => toggleImportant(task)}
                    onOpenDetail={() => setDetailTaskId(task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          subtasks={subtasksByParent.get(detailTask.id) ?? []}
          tagOptions={tagOptions}
          today={today}
          onClose={() => setDetailTaskId(null)}
          onToggleMyDay={() => toggleMyDay(detailTask)}
          onDelete={() => deleteTask(detailTask)}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  subtasks,
  onToggleComplete,
  onToggleImportant,
  onOpenDetail,
}: {
  task: TodoTask;
  subtasks: TodoTask[];
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onOpenDetail: () => void;
}) {
  const today = todayStr();
  const overdue = !task.completed && !!task.dueDate && task.dueDate < today;
  const doneCount = subtasks.filter((s) => s.completed).length;
  return (
    <div className={`flex items-center gap-2 rounded-lg bg-ink/50 px-3 py-2 ${task.completed ? "opacity-50" : ""}`}>
      <button
        onClick={onToggleComplete}
        aria-label="完了"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          task.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
        }`}
      >
        {task.completed ? "✓" : task.recurrence ? "🔁" : ""}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onOpenDetail}>
        <div className="flex flex-wrap items-center gap-1.5">
          {task.tag && (
            <span className="rounded-full border border-cream/30 px-1.5 py-0.5 text-[10px] text-cream/70">
              {task.tag}
            </span>
          )}
          <span className={`text-sm text-cream ${task.completed ? "line-through" : ""}`}>{task.title}</span>
          {task.recurrence && !task.completed && <span className="text-xs text-cream/40">🔁</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {task.dueDate && (
            <span className={overdue ? "font-bold text-alert" : "text-cream/50"}>{formatDateJp(task.dueDate)}</span>
          )}
          {subtasks.length > 0 && (
            <span className="text-cream/40">
              {doneCount}/{subtasks.length}
            </span>
          )}
        </div>
      </button>
      <button onClick={onToggleImportant} aria-label="重要" className="shrink-0 text-lg">
        {task.important ? <span className="text-alert">★</span> : <span className="text-cream/30">☆</span>}
      </button>
    </div>
  );
}

function TaskDetailModal({
  task,
  subtasks,
  tagOptions,
  today,
  onClose,
  onToggleMyDay,
  onDelete,
}: {
  task: TodoTask;
  subtasks: TodoTask[];
  tagOptions: string[];
  today: string;
  onClose: () => void;
  onToggleMyDay: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [tagMode, setTagMode] = useState(task.tag && !tagOptions.includes(task.tag) ? CUSTOM_TAG_VALUE : (task.tag ?? NO_TAG_VALUE));
  const [customTag, setCustomTag] = useState(task.tag && !tagOptions.includes(task.tag) ? task.tag : "");
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(!!task.recurrence);
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(
    task.recurrence ?? { type: "weekly", interval: 1, weekdays: [new Date().getDay()] }
  );
  const [newSubtask, setNewSubtask] = useState("");

  function resolveTag(): string | undefined {
    if (tagMode === CUSTOM_TAG_VALUE) return customTag.trim() || undefined;
    return tagMode || undefined;
  }

  async function save() {
    if (!title.trim()) return;
    await db.todoTasks.update(task.id, {
      title: title.trim(),
      notes: notes.trim() || undefined,
      dueDate: dueDate || undefined,
      tag: resolveTag(),
      recurrence: recurrenceEnabled ? recurrence : undefined,
    });
    onClose();
  }

  async function addSubtask() {
    if (!newSubtask.trim()) return;
    await db.todoTasks.add({
      id: uid(),
      listId: task.listId,
      parentTaskId: task.id,
      title: newSubtask.trim(),
      important: false,
      completed: false,
      order: subtasks.length,
      createdAt: Date.now(),
    });
    setNewSubtask("");
  }

  async function toggleSubtask(sub: TodoTask) {
    await db.todoTasks.update(sub.id, { completed: !sub.completed, completedAt: !sub.completed ? Date.now() : undefined });
  }

  async function deleteSubtask(sub: TodoTask) {
    await db.todoTasks.delete(sub.id);
  }

  return (
    <Modal title="タスクの詳細" onClose={onClose}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          placeholder="タイトル"
        />

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">タグ</label>
          <select
            value={tagMode}
            onChange={(e) => setTagMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            <option value={NO_TAG_VALUE}>タグなし</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={CUSTOM_TAG_VALUE}>＋ 新しいタグ...</option>
          </select>
          {tagMode === CUSTOM_TAG_VALUE && (
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              placeholder="タグ名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">期日</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          />
          {dueDate && (
            <button className="text-xs text-cream/50 hover:text-alert" onClick={() => setDueDate("")}>
              クリア
            </button>
          )}
        </div>

        <button
          className={task.myDayDate === today ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={onToggleMyDay}
        >
          ☀ {task.myDayDate === today ? "マイデイから削除" : "マイデイに追加"}
        </button>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="メモ"
          rows={3}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />

        {/* 繰り返し設定 */}
        <div className="rounded-lg border border-cream/10 p-3">
          <label className="flex items-center gap-2 text-xs text-cream/70">
            <input
              type="checkbox"
              checked={recurrenceEnabled}
              onChange={(e) => setRecurrenceEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            繰り返し
          </label>
          {recurrenceEnabled && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={recurrence.type}
                  onChange={(e) => setRecurrence({ ...recurrence, type: e.target.value as RecurrenceType })}
                  className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                >
                  {(Object.keys(RECURRENCE_TYPE_LABELS) as RecurrenceType[]).map((t) => (
                    <option key={t} value={t}>
                      {RECURRENCE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-cream/60">間隔</span>
                <input
                  type="number"
                  min={1}
                  value={recurrence.interval}
                  onChange={(e) => setRecurrence({ ...recurrence, interval: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                />
              </div>

              {recurrence.type === "weekly" && (
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_JP.map((label, w) => {
                    const active = (recurrence.weekdays ?? []).includes(w);
                    return (
                      <button
                        key={w}
                        onClick={() => {
                          const cur = recurrence.weekdays ?? [];
                          const next = active ? cur.filter((x) => x !== w) : [...cur, w];
                          setRecurrence({ ...recurrence, weekdays: next });
                        }}
                        className={active ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              {recurrence.type === "monthlyDate" && (
                <div className="flex items-center gap-2 text-xs text-cream/60">
                  <span>毎月</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={recurrence.day ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                  />
                  <span>日</span>
                </div>
              )}

              {recurrence.type === "monthlyWeekday" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
                  <span>毎月</span>
                  <select
                    value={recurrence.ordinal ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, ordinal: Number(e.target.value) as 1 | 2 | 3 | 4 | -1 })}
                    className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                  >
                    {([1, 2, 3, 4, -1] as (1 | 2 | 3 | 4 | -1)[]).map((o) => (
                      <option key={o} value={o}>
                        {ORDINAL_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={recurrence.weekday ?? 5}
                    onChange={(e) => setRecurrence({ ...recurrence, weekday: Number(e.target.value) })}
                    className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                  >
                    {WEEKDAY_JP.map((label, w) => (
                      <option key={w} value={w}>
                        {label}曜日
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {recurrence.type === "yearly" && (
                <div className="flex items-center gap-2 text-xs text-cream/60">
                  <span>毎年</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={recurrence.month ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, month: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                  />
                  <span>月</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={recurrence.day ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                  />
                  <span>日</span>
                </div>
              )}
              <p className="text-[10px] text-cream/40">完了にすると自動で次回の期日に進み、完了状態には戻りません。</p>
            </div>
          )}
        </div>

        {/* サブタスク: 親から一段ずらして表示 */}
        <div>
          <h4 className="mb-1.5 text-xs font-bold text-cream/70">サブタスク</h4>
          <div className="space-y-1.5 pl-4">
            {subtasks.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2 rounded-lg bg-ink/50 px-2 py-1.5">
                <button
                  onClick={() => toggleSubtask(sub)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
                    sub.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
                  }`}
                >
                  {sub.completed ? "✓" : ""}
                </button>
                <span className={`flex-1 text-xs text-cream ${sub.completed ? "text-cream/40 line-through" : ""}`}>
                  {sub.title}
                </span>
                <button className="text-cream/40 hover:text-alert" onClick={() => deleteSubtask(sub)} aria-label="削除">
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder="+ サブタスクを追加"
                className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
              />
              <button className="btn-pill-outline text-xs" onClick={addSubtask}>
                追加
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-between gap-2 border-t border-cream/10 pt-3">
        <button className="text-xs text-alert" onClick={onDelete}>
          タスクを削除
        </button>
        <button className="btn-pill text-sm" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}
