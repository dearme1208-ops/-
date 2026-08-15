"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeProjectProgress } from "@/lib/projectStage";
import { recordBelongsToProject } from "@/lib/projects";
import { findOrCreateMasterTask } from "@/lib/master";
import { computeRemainingEstimatedSeconds } from "@/lib/tasks";
import { daysBetweenDateStrs, formatHms, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { DailyTask, ProjectItem, ProjectStage } from "@/lib/types";

// Claudeモード専用の「プロジェクト」体験。既存のProjectsSection(ガント/カレンダー/
// 系統図/CSV入出力/単価計算等)は踏襲せず、期日までの見通しをClaudeが一言添える
// カード一覧に絞った。データは他モードと同じprojectsテーブルを使う
export default function ClaudeProjectsSection({ onAddedToToday }: { onAddedToToday?: () => void }) {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const today = todayStr();
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newStageTitle, setNewStageTitle] = useState<Record<string, string>>({});

  const totalSecondsByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of projects ?? []) {
      const seconds = (records ?? [])
        .filter((r) => recordBelongsToProject(r, p.id))
        .reduce((sum, r) => sum + r.seconds, 0);
      map.set(p.id, seconds);
    }
    return map;
  }, [projects, records]);

  const active = (projects ?? []).filter((p) => !p.completedAt).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const done = (projects ?? []).filter((p) => p.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  async function addProject() {
    const title = newTitle.trim();
    if (!title || !newDueDate) return;
    const item: ProjectItem = {
      id: uid(),
      title,
      category: "プロジェクト",
      workName: title,
      dueDate: newDueDate,
      createdAt: Date.now(),
    };
    await db.projects.add(item);
    setNewTitle("");
    setNewDueDate("");
  }

  async function toggleComplete(project: ProjectItem) {
    await db.projects.update(project.id, {
      completedAt: project.completedAt ? undefined : Date.now(),
    });
  }

  async function deleteProject(project: ProjectItem) {
    await db.projects.delete(project.id);
    showUndoToast(`「${project.title}」を取り消しました`, async () => {
      await db.projects.add(project);
    });
  }

  async function toggleStage(project: ProjectItem, stage: ProjectStage) {
    const stages = (project.stages ?? []).map((s) => (s.id === stage.id ? { ...s, completed: !s.completed } : s));
    await db.projects.update(project.id, { stages });
  }

  async function addStage(project: ProjectItem) {
    const title = (newStageTitle[project.id] ?? "").trim();
    if (!title) return;
    const stages = [...(project.stages ?? []), { id: uid(), title, completed: false }];
    await db.projects.update(project.id, { stages });
    setNewStageTitle((prev) => ({ ...prev, [project.id]: "" }));
  }

  async function addToToday(project: ProjectItem) {
    const master = await findOrCreateMasterTask(project.category, project.workName, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, project.category, project.workName, master.estimatedSeconds);
    const count = (await db.dailyTasks.where("date").equals(today).toArray()).length;
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: count,
      masterTaskId: master.id,
      category: project.category,
      name: project.workName,
      estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
      projectId: project.id,
    };
    await db.dailyTasks.add(task);
    onAddedToToday?.();
  }

  function insight(project: ProjectItem): string {
    const remaining = daysBetweenDateStrs(today, project.dueDate);
    const progress = computeProjectProgress(project.stages);
    if (remaining < 0) return `期日を${Math.abs(remaining)}日過ぎています。状況を見直すことをおすすめします。`;
    if (progress !== null && progress >= 1) return "すべての段階が完了しています。仕上げの確認をどうぞ。";
    if (remaining <= 3 && (progress ?? 0) < 0.5) return `期日まで残り${remaining}日です。優先度を上げることをおすすめします。`;
    if (remaining === 0) return "今日が期日です。";
    return `期日まで残り${remaining}日。順調に進んでいます。`;
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-1 p-4">
        <h2 className="font-display text-lg font-bold text-cream">プロジェクト</h2>
        <p className="text-sm text-cream/60">
          {active.length === 0
            ? "進行中のプロジェクトはありません。"
            : `進行中のプロジェクトが${active.length}件あります。`}
        </p>
      </div>

      <div className="panel space-y-2 p-4">
        <label className="block text-xs font-bold text-cream/60">新しいプロジェクト</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="例: 新サイトの制作"
            className="w-full min-w-0 flex-1 rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            className="rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
          <button className="btn-pill text-xs" onClick={addProject} disabled={!newTitle.trim() || !newDueDate}>
            追加
          </button>
        </div>
      </div>

      {active.length === 0 && (
        <p className="px-1 py-6 text-center text-sm text-cream/40">まだプロジェクトが登録されていません。</p>
      )}

      {active.map((project) => {
        const progress = computeProjectProgress(project.stages);
        const totalSeconds = totalSecondsByProject.get(project.id) ?? 0;
        const overdue = project.dueDate < today;
        return (
          <div key={project.id} className={`panel space-y-3 p-4 ${overdue ? "ring-1 ring-alert/40" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-bold text-cream">{project.title}</h3>
                <p className="text-xs text-cream/40">
                  期日 {project.dueDate}
                  {totalSeconds > 0 && <span className="ml-2">これまで {formatHms(totalSeconds)}</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-pill-outline text-[11px]" onClick={() => addToToday(project)}>
                  本日の作業に追加
                </button>
                <button className="btn-pill-outline text-[11px]" onClick={() => toggleComplete(project)}>
                  完了にする
                </button>
                <button className="text-xs text-cream/30 hover:text-alert" onClick={() => deleteProject(project)}>
                  ✕
                </button>
              </div>
            </div>

            <p className={`text-sm ${overdue ? "font-bold text-alert" : "text-cream/60"}`}>
              <span className="text-cream/40">Claude: </span>
              {insight(project)}
            </p>

            {progress !== null && (
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/40">
                <div className="h-full rounded-full bg-alert/70" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}

            {(project.stages ?? []).length > 0 && (
              <div className="space-y-1">
                {(project.stages ?? []).map((stage) => (
                  <label key={stage.id} className="flex items-center gap-2 text-sm text-cream/80">
                    <input
                      type="checkbox"
                      checked={stage.completed}
                      onChange={() => toggleStage(project, stage)}
                      className="h-4 w-4 rounded border-cream/30 bg-ink accent-alert"
                    />
                    <span className={stage.completed ? "text-cream/40 line-through" : ""}>{stage.title}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                value={newStageTitle[project.id] ?? ""}
                onChange={(e) => setNewStageTitle((prev) => ({ ...prev, [project.id]: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addStage(project)}
                placeholder="+ 段階を追加"
                className="w-40 rounded-lg border border-transparent bg-transparent px-1 py-1 text-xs text-cream/60 focus:border-cream/15 focus:outline-none"
              />
            </div>
          </div>
        );
      })}

      {done.length > 0 && (
        <details className="panel p-4">
          <summary className="cursor-pointer font-display text-sm font-bold text-cream/60">
            完了したプロジェクト {done.length}件
          </summary>
          <div className="mt-2 space-y-1.5">
            {done.map((project) => (
              <div key={project.id} className="flex items-center justify-between rounded-lg bg-ink/20 px-3 py-1.5 opacity-60">
                <span className="text-sm text-cream/60 line-through">{project.title}</span>
                <button className="text-xs text-cream/40 hover:text-cream" onClick={() => toggleComplete(project)}>
                  戻す
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
