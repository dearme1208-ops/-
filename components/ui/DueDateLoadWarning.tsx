"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { computeDueDateLoad } from "@/lib/backlogLoad";

// 期日入力欄の下に添える、抱えすぎ防止の予防警告。「入り口で新しい期限切れを増やさない」ため、
// 設定しようとしている日に既に何件の期限が入っているかをその場で気づけるようにする
const WARN_THRESHOLD = 3;

export default function DueDateLoadWarning({
  dateStr,
  excludeTodoId,
  excludeProjectId,
}: {
  dateStr: string | undefined;
  excludeTodoId?: string;
  excludeProjectId?: string;
}) {
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  if (!dateStr || !todoTasks || !projects) return null;

  const load = computeDueDateLoad(todoTasks, projects, dateStr, { todoId: excludeTodoId, projectId: excludeProjectId });
  if (load.total < WARN_THRESHOLD) return null;

  const parts: string[] = [];
  if (load.todoCount > 0) parts.push(`ToDo ${load.todoCount}件`);
  if (load.projectCount > 0) parts.push(`案件 ${load.projectCount}件`);

  return (
    <p className="mt-1 text-[11px] font-bold text-alert">
      ⚠ この日は既に{parts.join("・")}の期限が入っています(計{load.total}件)。詰め込みすぎに注意してください
    </p>
  );
}
