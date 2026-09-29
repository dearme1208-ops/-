"use client";

import { db } from "@/lib/db";
import type { DailyTask, ProjectItem } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 兼務・並行作業向けに、主案件以外にも作業時間を按分したい案件を選ぶ
export default function SecondaryProjectsDialog({
  task,
  projects,
  primaryProjectTitle,
  onChange,
  onClose,
}: {
  task: DailyTask;
  projects: ProjectItem[];
  primaryProjectTitle: string;
  onChange: (task: DailyTask) => void;
  onClose: () => void;
}) {
  const selectable = projects.filter((p) => p.id !== task.projectId && !p.completedAt);
  return (
    <Modal title="追加の案件タグ" onClose={onClose}>
      <p className="mb-3 text-xs text-cream/60">
        兼務・並行作業などで、主案件(
        {primaryProjectTitle}
        )以外にもこの作業の時間を按分したい案件を選べます。集計・レポートの時間合算にのみ使われ、段階の進捗などには影響しません。
      </p>
      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {selectable.map((p) => {
          const checked = task.secondaryProjectIds?.includes(p.id) ?? false;
          return (
            <label key={p.id} className="flex items-center gap-2 rounded-lg bg-ink/50 px-3 py-2 text-sm text-cream/80">
              <input
                type="checkbox"
                checked={checked}
                onChange={async (e) => {
                  const current = task.secondaryProjectIds ?? [];
                  const next = e.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id);
                  await db.dailyTasks.update(task.id, { secondaryProjectIds: next });
                  onChange({ ...task, secondaryProjectIds: next });
                }}
                className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
              />
              {p.title}
            </label>
          );
        })}
        {selectable.length === 0 && <p className="text-sm text-cream/50">選択できる他の案件がありません。</p>}
      </div>
    </Modal>
  );
}
