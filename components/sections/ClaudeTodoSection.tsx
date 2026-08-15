"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { TodoTask } from "@/lib/types";

// Claudeモード専用の「タスク」体験。既存のTodoSection(リスト/かんばん/ガント/カレンダー/
// 系統図の切り替え、複数選択、CSV入出力等)は踏襲せず、リストごとに整理された1本の
// キャプチャ用の流れに絞った。データは他モードと同じtodoLists/todoTasksテーブルを使う
export default function ClaudeTodoSection() {
  const lists = useLiveQuery(() => db.todoLists.orderBy("order").toArray(), []);
  const allTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const [newTitle, setNewTitle] = useState("");
  const [newListId, setNewListId] = useState<string>("");
  const [newListTitle, setNewListTitle] = useState("");
  const today = todayStr();

  const topLevelTasks = useMemo(() => (allTasks ?? []).filter((t) => !t.parentTaskId), [allTasks]);
  const subtaskCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of allTasks ?? []) {
      if (!t.parentTaskId) continue;
      map.set(t.parentTaskId, (map.get(t.parentTaskId) ?? 0) + 1);
    }
    return map;
  }, [allTasks]);

  const targetListId = newListId || lists?.[0]?.id || "";

  // 締切が近い/過ぎているタスクを優先し、次に何をすべきかをClaudeなりに1件だけ提案する
  const suggestion = useMemo(() => {
    const incomplete = topLevelTasks.filter((t) => !t.completed);
    const withDue = incomplete.filter((t) => t.dueDate);
    const overdue = withDue.filter((t) => t.dueDate! < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    if (overdue.length > 0) return { task: overdue[0], reason: "期限を過ぎているため" };
    const dueToday = withDue.filter((t) => t.dueDate === today);
    if (dueToday.length > 0) return { task: dueToday[0], reason: "今日が期限のため" };
    const upcoming = withDue.sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    if (upcoming.length > 0) return { task: upcoming[0], reason: "一番期限が近いため" };
    if (incomplete.length > 0) return { task: incomplete[0], reason: "登録が一番古いため" };
    return null;
  }, [topLevelTasks, today]);

  async function addList() {
    if (!newListTitle.trim()) return;
    const id = uid();
    await db.todoLists.add({ id, title: newListTitle.trim(), order: lists?.length ?? 0, createdAt: Date.now() });
    setNewListTitle("");
    setNewListId(id);
  }

  async function addTask() {
    const title = newTitle.trim();
    if (!title || !targetListId) return;
    const count = (allTasks ?? []).filter((t) => t.listId === targetListId && !t.parentTaskId).length;
    const task: TodoTask = {
      id: uid(),
      listId: targetListId,
      title,
      important: false,
      completed: false,
      order: count,
      createdAt: Date.now(),
    };
    await db.todoTasks.add(task);
    setNewTitle("");
  }

  async function toggleComplete(task: TodoTask) {
    await db.todoTasks.update(task.id, {
      completed: !task.completed,
      completedAt: !task.completed ? Date.now() : undefined,
    });
  }

  async function updateTitle(task: TodoTask, title: string) {
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) return;
    await db.todoTasks.update(task.id, { title: trimmed });
  }

  async function updateDueDate(task: TodoTask, dueDate: string) {
    await db.todoTasks.update(task.id, { dueDate: dueDate || undefined });
  }

  async function deleteTask(task: TodoTask) {
    const subs = (allTasks ?? []).filter((t) => t.parentTaskId === task.id);
    await db.todoTasks.bulkDelete([task.id, ...subs.map((s) => s.id)]);
    showUndoToast(`「${task.title}」を取り消しました`, async () => {
      await db.todoTasks.bulkAdd([task, ...subs]);
    });
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-1 p-4">
        <h2 className="font-display text-lg font-bold text-cream">タスク</h2>
        {suggestion ? (
          <p className="text-sm text-cream/70">
            <span className="text-cream/40">Claude: </span>
            次はこれをおすすめします「{suggestion.task.title}」({suggestion.reason})
          </p>
        ) : (
          <p className="text-sm text-cream/50">未完了のタスクはありません。よい状態です。</p>
        )}
      </div>

      <div className="panel space-y-2 p-4">
        <label className="block text-xs font-bold text-cream/60">新しいタスク</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          {lists && lists.length > 0 && (
            <select
              value={targetListId}
              onChange={(e) => setNewListId(e.target.value)}
              className="rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream sm:w-40"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          )}
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="例: 見積書を送る"
            className="w-full min-w-0 flex-1 rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
          <button className="btn-pill text-xs" onClick={addTask} disabled={!newTitle.trim() || !targetListId}>
            追加
          </button>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input
            value={newListTitle}
            onChange={(e) => setNewListTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addList()}
            placeholder="+ 新しいリスト名"
            className="w-48 rounded-lg border border-transparent bg-transparent px-1 py-1 text-xs text-cream/60 focus:border-cream/15 focus:outline-none"
          />
          {newListTitle.trim() && (
            <button className="btn-pill-outline text-[11px]" onClick={addList}>
              作成
            </button>
          )}
        </div>
      </div>

      {(lists ?? []).length === 0 && (
        <p className="px-1 py-6 text-center text-sm text-cream/40">
          まだリストがありません。上の欄からリストを作ってみましょう。
        </p>
      )}

      {(lists ?? []).map((list) => {
        const listTasks = topLevelTasks.filter((t) => t.listId === list.id);
        const incomplete = listTasks
          .filter((t) => !t.completed)
          .sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99"));
        const completed = listTasks.filter((t) => t.completed);
        if (listTasks.length === 0) return null;
        return (
          <div key={list.id} className="panel space-y-2 p-4">
            <h3 className="font-display text-sm font-bold text-cream/80">
              {list.title} <span className="ml-1 font-sans text-xs font-normal text-cream/40">{incomplete.length}件</span>
            </h3>
            <div className="space-y-1.5">
              {incomplete.map((task) => {
                const overdue = !!task.dueDate && task.dueDate < today;
                const subCount = subtaskCountByParent.get(task.id) ?? 0;
                return (
                  <div key={task.id} className="rounded-lg bg-ink/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleComplete(task)}
                        aria-label="完了"
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-cream/40"
                      />
                      <input
                        key={task.id + task.title}
                        defaultValue={task.title}
                        onBlur={(e) => updateTitle(task, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className="min-w-0 flex-1 bg-transparent text-sm text-cream focus:outline-none focus:ring-1 focus:ring-cream/30"
                      />
                      <button className="shrink-0 text-xs text-cream/30 hover:text-alert" onClick={() => deleteTask(task)}>
                        ✕
                      </button>
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-2 pl-6">
                      {subCount > 0 && <span className="shrink-0 text-[10px] text-cream/30">{subCount}件のサブタスク</span>}
                      <input
                        key={task.id + (task.dueDate ?? "")}
                        type="date"
                        defaultValue={task.dueDate ?? ""}
                        onChange={(e) => updateDueDate(task, e.target.value)}
                        className={`w-[8.5rem] shrink-0 rounded border border-transparent bg-transparent px-0.5 text-[11px] focus:border-cream/20 focus:outline-none ${
                          overdue ? "font-bold text-alert" : "text-cream/40"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
              {incomplete.length === 0 && <p className="px-1 text-xs text-cream/30">未完了のタスクはありません。</p>}
            </div>
            {completed.length > 0 && (
              <details className="pt-1">
                <summary className="cursor-pointer text-xs text-cream/40">完了済み {completed.length}件</summary>
                <div className="mt-1.5 space-y-1">
                  {completed.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 rounded-lg bg-ink/20 px-3 py-1.5 opacity-50">
                      <button
                        onClick={() => toggleComplete(task)}
                        aria-label="未完了に戻す"
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-cream bg-cream text-[10px] text-ink"
                      >
                        ✓
                      </button>
                      <span className="min-w-0 flex-1 truncate text-sm text-cream/60 line-through">{task.title}</span>
                      <button className="shrink-0 text-xs text-cream/30 hover:text-alert" onClick={() => deleteTask(task)}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
