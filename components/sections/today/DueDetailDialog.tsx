"use client";

import { daysBetweenDateStrs, formatDateJp } from "@/lib/time";
import type { ProjectItem, TodoTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 予定タブ上部の「期限切れ・本日期限」の件数から開く一覧。選ぶとToDo/案件の詳細へ移動する
export default function DueDetailDialog({
  kind,
  date,
  todoItems,
  projectItems,
  onOpenTodo,
  onOpenProject,
  onClose,
}: {
  kind: "todo" | "project";
  date: string;
  todoItems: TodoTask[];
  projectItems: ProjectItem[];
  onOpenTodo: (id: string) => void;
  onOpenProject: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title={kind === "todo" ? "⚠ 期限切れ・本日期限のToDo" : "⚠ 期限切れ・本日期限の案件"} onClose={onClose}>
      <div className="space-y-1.5">
        {kind === "todo" &&
          todoItems.map((t) => {
            const daysOverdue = daysBetweenDateStrs(t.dueDate!, date);
            return (
              <button
                key={t.id}
                className="flex w-full items-center gap-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2 text-left"
                onClick={() => onOpenTodo(t.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-cream">{t.title}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-cream/50">
                    {t.tag && <span>{t.tag}</span>}
                    {t.category && <span>{t.category}</span>}
                    {t.customer && <span>{t.customer}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs font-bold text-alert">
                  {formatDateJp(t.dueDate!)}
                  <div className="text-[10px]">{daysOverdue > 0 ? `${daysOverdue}日超過` : "本日期限"}</div>
                </div>
              </button>
            );
          })}
        {kind === "project" &&
          projectItems.map((p) => {
            const daysOverdue = daysBetweenDateStrs(p.dueDate, date);
            return (
              <button
                key={p.id}
                className="flex w-full items-center gap-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2 text-left"
                onClick={() => onOpenProject(p.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-cream">{p.title}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] text-cream/50">
                    {p.tag && <span>{p.tag}</span>}
                    <span>{p.category}</span>
                    <span>{p.workName}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs font-bold text-alert">
                  {formatDateJp(p.dueDate)}
                  <div className="text-[10px]">{daysOverdue > 0 ? `${daysOverdue}日超過` : "本日期限"}</div>
                </div>
              </button>
            );
          })}
        {((kind === "todo" && todoItems.length === 0) || (kind === "project" && projectItems.length === 0)) && (
          <p className="px-1 py-4 text-sm text-cream/50">対象はありません。</p>
        )}
      </div>
    </Modal>
  );
}
