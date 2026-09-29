"use client";

import { db } from "@/lib/db";
import { fireConfetti } from "@/lib/confetti";
import type { DailyTask, ProjectItem, TodoTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export type LinkedCompletionConfirm =
  | { kind: "stage"; task: DailyTask }
  | { kind: "project"; task: DailyTask }
  | { kind: "todo"; task: DailyTask };

// 案件の段階・案件(段階なし直付け)・ToDoに紐づく作業を完了させた直後に、その紐づく先も
// 完了とみなせるかを尋ねる。どちらを選んでもonDoneで次の確認(キュー)へ進める
export default function LinkedCompletionDialog({
  confirm,
  projectMap,
  todoTaskMap,
  onCompleteTodo,
  onDone,
}: {
  confirm: LinkedCompletionConfirm;
  projectMap: Map<string, ProjectItem>;
  todoTaskMap: Map<string, TodoTask>;
  onCompleteTodo: (todoTaskId: string) => Promise<void>;
  onDone: () => void;
}) {
  const confirmTask = confirm.task;

  if (confirm.kind === "stage") {
    const project = confirmTask.projectId ? projectMap.get(confirmTask.projectId) : undefined;
    const stage = project?.stages?.find((s) => s.id === confirmTask.stageId);
    if (!project || !stage) return null;
    const isCountBased = stage.targetCount != null;
    const stages = project.stages ?? [];
    const idx = stages.findIndex((s) => s.id === stage.id);
    const incompletePrevious = stages.slice(0, idx).filter((s) => !s.completed);
    return (
      <Modal title="段階の進捗確認" onClose={onDone}>
        <p className="mb-1 text-sm text-cream/80">「{confirmTask.name}」の作業を完了しました。</p>
        {isCountBased ? (
          <p className="mb-4 text-sm text-cream/80">
            案件「{project.title}」の段階「{stage.title}」は現在{" "}
            <span className="font-bold">
              {stage.completedCount ?? 0}/{stage.targetCount}件
            </span>
            です。この作業で1件進めますか?
          </p>
        ) : (
          <p className="mb-4 text-sm text-cream/80">案件「{project.title}」の段階「{stage.title}」はこれで完了ですか?</p>
        )}
        {!isCountBased && incompletePrevious.length > 0 && (
          <p className="mb-4 rounded-lg border border-alert/40 bg-alert/5 p-2 text-xs text-alert">
            ⚠ 前の段階「{incompletePrevious.map((s) => s.title).join("」「")}」がまだ完了していません。
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onDone}>
            {isCountBased ? "件数はそのまま（時間だけ記録）" : "まだ続く（時間だけ記録）"}
          </button>
          <button
            className="btn-pill text-sm"
            onClick={async () => {
              const next = (project.stages ?? []).map((s) => {
                if (s.id !== stage.id) return s;
                if (isCountBased) {
                  const count = Math.min(s.targetCount ?? 0, (s.completedCount ?? 0) + 1);
                  const justReachedTarget = count >= (s.targetCount ?? 0) && (s.completedCount ?? 0) < (s.targetCount ?? 0);
                  return { ...s, completedCount: count, completedAt: justReachedTarget ? Date.now() : s.completedAt };
                }
                return { ...s, completed: true, completedAt: Date.now() };
              });
              await db.projects.update(project.id, { stages: next });
              onDone();
            }}
          >
            {isCountBased ? "1件進める" : "この段階を完了にする"}
          </button>
        </div>
      </Modal>
    );
  }

  if (confirm.kind === "project") {
    const project = confirmTask.projectId ? projectMap.get(confirmTask.projectId) : undefined;
    if (!project) return null;
    return (
      <Modal title="案件の進捗確認" onClose={onDone}>
        <p className="mb-1 text-sm text-cream/80">「{confirmTask.name}」の作業を完了しました。</p>
        <p className="mb-4 text-sm text-cream/80">案件「{project.title}」はこれで完了ですか?</p>
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onDone}>
            まだ続く（時間だけ記録）
          </button>
          <button
            className="btn-pill text-sm"
            onClick={async () => {
              await db.projects.update(project.id, { completedAt: Date.now(), autoCompletedByImport: false });
              fireConfetti();
              onDone();
            }}
          >
            この案件を完了にする
          </button>
        </div>
      </Modal>
    );
  }

  const todo = confirmTask.todoTaskId ? todoTaskMap.get(confirmTask.todoTaskId) : undefined;
  if (!todo) return null;
  return (
    <Modal title="Todoの進捗確認" onClose={onDone}>
      <p className="mb-1 text-sm text-cream/80">「{confirmTask.name}」の作業を完了しました。</p>
      <p className="mb-4 text-sm text-cream/80">元のTodo「{todo.title}」はこれで完了ですか?</p>
      <div className="flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={onDone}>
          まだ続く（時間だけ記録）
        </button>
        <button
          className="btn-pill text-sm"
          onClick={async () => {
            await onCompleteTodo(todo.id);
            onDone();
          }}
        >
          Todoを完了にする
        </button>
      </div>
    </Modal>
  );
}
