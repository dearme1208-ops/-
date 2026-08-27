"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import type { TodoTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

const CHECK_INTERVAL_MS = 15000;

// ToDoに設定した通知(リマインダー)時刻になったら、タブに関わらず画面へポップアップで
// 知らせる。期日の近さ(日単位)を知らせるTodoReminderModalとは別物で、こちらは
// 分単位で指定した正確な日時に一度だけ発火する。発火済みはreminderFiredAtに記録し、
// アプリを再読み込みしても二度と表示しない(reminderAtを設定し直すとまた発火できるようになる)
export default function TodoReminderPopup({ onViewDetail }: { onViewDetail: (taskId: string) => void }) {
  const allTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const [now, setNow] = useState(() => Date.now());
  const [dueQueue, setDueQueue] = useState<TodoTask[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!allTasks) return;
    const due = allTasks.filter(
      (t) => t.reminderAt !== undefined && t.reminderAt <= now && !t.reminderFiredAt && !t.completed
    );
    if (due.length === 0) return;
    (async () => {
      for (const t of due) {
        await db.todoTasks.update(t.id, { reminderFiredAt: Date.now() });
        notify("🔔 ToDoの通知時刻です", t.title, `todo-reminder-${t.id}`);
      }
    })();
    setDueQueue((prev) => [...prev, ...due]);
    setDismissed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, allTasks]);

  function dismissOne(id: string) {
    setDueQueue((prev) => prev.filter((t) => t.id !== id));
  }

  function viewDetail(task: TodoTask) {
    dismissOne(task.id);
    onViewDetail(task.id);
  }

  if (dueQueue.length === 0 || dismissed) return null;

  return (
    <Modal title="🔔 ToDoの通知時刻です" onClose={() => setDismissed(true)}>
      <div className="space-y-2">
        {dueQueue.map((task) => (
          <div key={task.id} className="rounded-lg border border-alert/30 bg-ink/50 p-3">
            <div className="text-sm font-bold text-cream">{task.title}</div>
            {task.action && <div className="text-xs text-cream/60">{task.action}</div>}
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <button className="btn-pill-outline text-xs" onClick={() => dismissOne(task.id)}>
                閉じる
              </button>
              <button className="btn-pill text-xs" onClick={() => viewDetail(task)}>
                詳細確認
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
