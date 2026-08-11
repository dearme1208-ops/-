"use client";

import { useState } from "react";
import { db, uid } from "@/lib/db";
import type { ProjectItem, ProjectStage } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export default function EditProjectDialog({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  const [title, setTitle] = useState(project.title);
  const [category, setCategory] = useState(project.category);
  const [workName, setWorkName] = useState(project.workName);
  const [dueDate, setDueDate] = useState(project.dueDate);
  const [hourlyRateStr, setHourlyRateStr] = useState(project.hourlyRate?.toString() ?? "");
  const [stages, setStages] = useState<ProjectStage[]>(project.stages ?? []);
  const [newStageTitle, setNewStageTitle] = useState("");

  function addStage() {
    if (!newStageTitle.trim()) return;
    setStages((prev) => [...prev, { id: uid(), title: newStageTitle.trim(), completed: false }]);
    setNewStageTitle("");
  }
  function toggleStage(id: string) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, completed: !s.completed } : s)));
  }
  function removeStage(id: string) {
    setStages((prev) => prev.filter((s) => s.id !== id));
  }
  function setStageDueDate(id: string, value: string) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, dueDate: value || undefined } : s)));
  }

  async function save() {
    if (!title.trim() || !category.trim() || !workName.trim() || !dueDate) return;
    const rate = Number(hourlyRateStr);
    await db.projects.update(project.id, {
      title: title.trim(),
      category: category.trim(),
      workName: workName.trim(),
      dueDate,
      hourlyRate: hourlyRateStr.trim() !== "" && Number.isFinite(rate) && rate >= 0 ? rate : undefined,
      stages,
    });
    onClose();
  }

  return (
    <Modal title="案件を編集" onClose={onClose}>
      <div className="space-y-2">
        <input
          placeholder="件名"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          autoFocus
        />
        <input
          placeholder="業務区分（大項目）"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <input
          placeholder="詳細作業名"
          value={workName}
          onChange={(e) => setWorkName(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-cream/60">期日</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-cream/60">この案件専用の単価</label>
          <input
            type="number"
            min={0}
            step={100}
            value={hourlyRateStr}
            onChange={(e) => setHourlyRateStr(e.target.value)}
            placeholder="デフォルトを使用"
            className="w-28 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-right text-sm text-cream"
          />
          <span className="text-xs text-cream/60">円/時間</span>
        </div>
        <div className="border-t border-cream/10 pt-2">
          <h4 className="mb-1.5 text-xs font-bold text-cream/70">
            段階（マイルストーン）
            {stages.length > 0 && (
              <span className="ml-2 font-normal text-cream/50">
                {stages.filter((s) => s.completed).length}/{stages.length}完了（
                {Math.round((stages.filter((s) => s.completed).length / stages.length) * 100)}%）
              </span>
            )}
          </h4>
          <div className="space-y-1.5">
            {stages.map((stage) => (
              <div key={stage.id} className="flex items-center gap-2 rounded-lg bg-ink/50 px-2 py-1.5">
                <button
                  onClick={() => toggleStage(stage.id)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
                    stage.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
                  }`}
                >
                  {stage.completed ? "✓" : ""}
                </button>
                <span className={`flex-1 text-xs text-cream ${stage.completed ? "text-cream/40 line-through" : ""}`}>
                  {stage.title}
                </span>
                <input
                  type="date"
                  value={stage.dueDate ?? ""}
                  onChange={(e) => setStageDueDate(stage.id, e.target.value)}
                  className="w-32 shrink-0 rounded-md border border-cream/20 bg-ink px-1.5 py-1 text-[11px] text-cream"
                />
                <button className="text-cream/40 hover:text-alert" onClick={() => removeStage(stage.id)} aria-label="削除">
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={newStageTitle}
                onChange={(e) => setNewStageTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addStage()}
                placeholder="+ 段階を追加（例: 要件定義）"
                className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
              />
              <button className="btn-pill-outline text-xs" onClick={addStage}>
                追加
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}
