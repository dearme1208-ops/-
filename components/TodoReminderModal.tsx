"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { completeTodoTask, effectiveDueDate } from "@/lib/todo";
import { daysBetweenDateStrs, formatDateJp, todayStr } from "@/lib/time";
import { notify } from "@/lib/notifications";
import type { TodoTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// Todoの期日が近づいている・過ぎている未完了タスクを、タブに関わらずアプリを開いた際に
// ポップアップで知らせる。「期限切れ」タブのような常設一覧と違い、こちらは見落とし防止の
// ための能動的な通知。1回のセッション中に確認・完了にした項目は再表示しない
export default function TodoReminderModal() {
  const today = todayStr();
  const [reminderEnabledStr] = useSetting("todo.reminderEnabled", "true");
  const reminderEnabled = reminderEnabledStr === "true";
  const [daysBeforeStr] = useSetting("todo.reminderDaysBefore", "1");
  const daysBefore = Math.max(0, Number(daysBeforeStr) || 0);

  const allTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
  const [dismissedAll, setDismissedAll] = useState(false);
  const [notifiedOnce, setNotifiedOnce] = useState(false);

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const t of allTasks ?? []) {
      if (!t.parentTaskId) continue;
      if (!map.has(t.parentTaskId)) map.set(t.parentTaskId, []);
      map.get(t.parentTaskId)!.push(t);
    }
    return map;
  }, [allTasks]);

  const dueSoonTasks = useMemo(() => {
    if (!reminderEnabled) return [];
    return (allTasks ?? [])
      .filter((t) => !t.parentTaskId && !t.completed)
      .map((t) => ({ task: t, due: effectiveDueDate(t, subtasksByParent.get(t.id) ?? []) }))
      .filter((x): x is { task: TodoTask; due: string } => !!x.due && daysBetweenDateStrs(today, x.due) <= daysBefore)
      .filter((x) => !acknowledgedIds.has(x.task.id))
      .sort((a, b) => a.due.localeCompare(b.due));
  }, [allTasks, subtasksByParent, reminderEnabled, daysBefore, today, acknowledgedIds]);

  useEffect(() => {
    if (dueSoonTasks.length === 0 || notifiedOnce) return;
    notify(
      "Todoの期日が近づいています",
      `${dueSoonTasks.length}件のタスクが期日間近・超過です`,
      "todo-reminder"
    );
    setNotifiedOnce(true);
  }, [dueSoonTasks.length, notifiedOnce]);

  function acknowledge(id: string) {
    setAcknowledgedIds((prev) => new Set(prev).add(id));
  }

  async function complete(task: TodoTask) {
    await completeTodoTask(task, today);
    acknowledge(task.id);
  }

  if (!reminderEnabled || dueSoonTasks.length === 0 || dismissedAll) return null;

  return (
    <Modal title="期日が近いTodoがあります" onClose={() => setDismissedAll(true)}>
      <p className="mb-3 text-sm text-cream/70">
        期日まであと{daysBefore}日以内、または既に期日を過ぎている未完了のタスクです。
      </p>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {dueSoonTasks.map(({ task, due }) => {
          const overdue = due < today;
          return (
            <div key={task.id} className="rounded-lg border border-alert/30 bg-ink/50 p-3">
              <div className={`text-xs ${overdue ? "font-bold text-alert" : "text-cream/50"}`}>
                {formatDateJp(due)}
                {overdue ? "（期限切れ）" : due === today ? "（本日）" : ""}
              </div>
              <div className="text-sm font-bold text-cream">{task.title}</div>
              {task.action && <div className="text-xs text-cream/60">{task.action}</div>}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button className="btn-pill-outline text-xs" onClick={() => acknowledge(task.id)}>
                  後で確認する
                </button>
                <button className="btn-pill text-xs" onClick={() => complete(task)}>
                  完了にする
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
