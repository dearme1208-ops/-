"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { fireConfetti } from "@/lib/confetti";
import { completeProjectStage, isStageDone, openStageTitles } from "@/lib/projectStage";
import { findOriginTodo, setProjectCompleted } from "@/lib/projects";
import { completeTodoWithUndoToast } from "@/lib/progressActions";
import { showUndoToast } from "@/lib/toast";
import { todayStr } from "@/lib/time";
import { todoLabel } from "@/lib/todoLabel";
import type { DailyTask, ProjectItem, TodoTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export type LinkedCompletionConfirm =
  | { kind: "stage"; task: DailyTask }
  | { kind: "project"; task: DailyTask }
  | { kind: "todo"; task: DailyTask };

// 案件の完了まわりの続きの確認(どの画面からでも同じ流れにする)
//  allStagesDone: 最後の段階が済んだ →「案件も完了にしますか」
//  openStages:    未完了の段階が残る案件を完了にしようとした → 先に知らせる
//  originTodo:    案件を完了にした → 元のToDoも完了にするか
export type ProjectCascadeStep = "allStagesDone" | "openStages" | "originTodo";
export interface ProjectCascade {
  step: ProjectCascadeStep;
  projectId: string;
  /** 元のToDoを尋ねない(呼び出し側が別に尋ねる場合) */
  skipOriginTodo?: boolean;
}

/** 案件を完了にして「元に戻す」付きの知らせを出す(画面ごとの完了報告を持たない画面の既定) */
export async function completeProjectWithToast(project: ProjectItem): Promise<void> {
  const r = await setProjectCompleted(project.id, true);
  if (!r) return;
  fireConfetti();
  showUndoToast(`「${project.title}」を完了にしました`, r.undo);
}

export function ProjectCascadeDialog({
  cascade,
  onCompleteProject = completeProjectWithToast,
  onCompleteTodo,
  onClose,
}: {
  cascade: ProjectCascade;
  onCompleteProject?: (project: ProjectItem) => Promise<void>;
  /** 元のToDoを完了にする(省略時は「元に戻す」付きで完了にする) */
  onCompleteTodo?: (todo: TodoTask) => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ProjectCascadeStep>(cascade.step);
  const project = useLiveQuery(() => db.projects.get(cascade.projectId), [cascade.projectId]);
  const origin = useLiveQuery(() => findOriginTodo(cascade.projectId), [cascade.projectId]);
  if (!project) return null;

  async function completeAndContinue(p: ProjectItem) {
    await onCompleteProject(p);
    const o = cascade.skipOriginTodo ? undefined : await findOriginTodo(p.id);
    if (o && !o.completed) setStep("originTodo");
    else onClose();
  }

  if (step === "allStagesDone") {
    if (project.completedAt) return null;
    return (
      <Modal title="段階がすべて完了しました" onClose={onClose}>
        <p className="mb-4 text-sm text-cream/80">案件「{project.title}」も完了にしますか?</p>
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            まだ続ける
          </button>
          <button className="btn-pill text-sm" onClick={() => completeAndContinue(project)}>
            案件も完了にする
          </button>
        </div>
      </Modal>
    );
  }

  if (step === "openStages") {
    const open = openStageTitles(project);
    return (
      <Modal title="未完了の段階があります" onClose={onClose}>
        <p className="mb-2 text-sm text-cream/80">
          案件「{project.title}」には、まだ済んでいない段階が{open.length}件あります。
        </p>
        <p className="mb-4 rounded-lg border border-alert/40 bg-alert/5 p-2 text-xs text-alert">「{open.join("」「")}」</p>
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            やめる
          </button>
          <button className="btn-pill text-sm" onClick={() => completeAndContinue(project)}>
            それでも完了にする
          </button>
        </div>
      </Modal>
    );
  }

  if (!origin || origin.completed) return null;
  return (
    <Modal title="元のToDo" onClose={onClose}>
      <p className="mb-4 text-sm text-cream/80">案件「{project.title}」の元になったToDo「{origin.title}」も完了にしますか?</p>
      <div className="flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={onClose}>
          そのままにする
        </button>
        <button
          className="btn-pill text-sm"
          onClick={async () => {
            if (onCompleteTodo) await onCompleteTodo(origin);
            else await completeTodoWithUndoToast(origin, todayStr());
            onClose();
          }}
        >
          ToDoも完了にする
        </button>
      </div>
    </Modal>
  );
}

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
  // 段階・案件を済ませたあとの続きの確認(案件も完了にするか・元のToDoも完了にするか)
  const [cascade, setCascade] = useState<ProjectCascade | null>(null);
  if (cascade) {
    return <ProjectCascadeDialog cascade={cascade} onCompleteTodo={(t) => onCompleteTodo(t.id)} onClose={onDone} />;
  }

  if (confirm.kind === "stage") {
    const project = confirmTask.projectId ? projectMap.get(confirmTask.projectId) : undefined;
    const stage = project?.stages?.find((s) => s.id === confirmTask.stageId);
    if (!project || !stage) return null;
    const isCountBased = stage.targetCount != null;
    const stages = project.stages ?? [];
    const idx = stages.findIndex((s) => s.id === stage.id);
    // 件数管理の段階は completed が立たないため、目標件数に達していれば完了として扱う
    const incompletePrevious = stages.slice(0, idx).filter((s) => !isStageDone(s));
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
              // 開いた時点の写しではなく、最新の案件の同じ段階に当てる
              const r = await completeProjectStage(project.id, stage.id);
              if (r?.offerProjectCompletion) setCascade({ step: "allStagesDone", projectId: project.id });
              else onDone();
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
    const open = openStageTitles(project);
    // 作業カードに元のToDoが付いていれば、このあとの「Todoの進捗確認」で尋ねるので重ねない
    const skipOriginTodo = !!confirmTask.todoTaskId;
    return (
      <Modal title="案件の進捗確認" onClose={onDone}>
        <p className="mb-1 text-sm text-cream/80">「{confirmTask.name}」の作業を完了しました。</p>
        <p className="mb-4 text-sm text-cream/80">案件「{project.title}」はこれで完了ですか?</p>
        {open.length > 0 && (
          <p className="mb-4 rounded-lg border border-alert/40 bg-alert/5 p-2 text-xs text-alert">
            ⚠ まだ済んでいない段階が{open.length}件あります（「{open.join("」「")}」）。
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onDone}>
            まだ続く（時間だけ記録）
          </button>
          <button
            className="btn-pill text-sm"
            onClick={async () => {
              await completeProjectWithToast(project);
              const o = skipOriginTodo ? undefined : await findOriginTodo(project.id);
              if (o && !o.completed) setCascade({ step: "originTodo", projectId: project.id });
              else onDone();
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
      <p className="mb-4 text-sm text-cream/80">元のTodo「{todoLabel(todo, todoTaskMap)}」はこれで完了ですか?</p>
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
