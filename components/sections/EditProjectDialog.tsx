"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { db, uid } from "@/lib/db";
import type { ProjectItem, ProjectStage } from "@/lib/types";
import { computeProjectProgress } from "@/lib/projectStage";
import Modal from "@/components/ui/Modal";

// 段階1行分。件名・期日をその場で編集できる入力欄を持つ
function StageRow({
  stage,
  onToggle,
  onSetTitle,
  onSetDueDate,
  onSetCompletedCount,
  onSetTargetCount,
  onRemove,
  dragHandleProps,
}: {
  stage: ProjectStage;
  onToggle: (id: string) => void;
  onSetTitle: (id: string, value: string) => void;
  onSetDueDate: (id: string, value: string) => void;
  onSetCompletedCount: (id: string, value: string) => void;
  onSetTargetCount: (id: string, value: string) => void;
  onRemove: (id: string) => void;
  dragHandleProps?: { attributes: ReturnType<typeof useSortable>["attributes"]; listeners: ReturnType<typeof useSortable>["listeners"] };
}) {
  const isCountBased = stage.targetCount != null;
  const isDone = isCountBased ? (stage.completedCount ?? 0) >= (stage.targetCount ?? 0) : stage.completed;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-ink/50 px-2 py-1.5">
      {dragHandleProps && (
        <button
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
          className="shrink-0 cursor-grab px-0.5 text-cream/30 active:cursor-grabbing"
          aria-label="段階を並び替え"
        >
          ⠿
        </button>
      )}
      {!isCountBased && (
        <button
          onClick={() => onToggle(stage.id)}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
            stage.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
          }`}
        >
          {stage.completed ? "✓" : ""}
        </button>
      )}
      {isCountBased && (
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
            isDone ? "border-cream bg-cream text-ink" : "border-cream/40"
          }`}
        >
          {isDone ? "✓" : ""}
        </span>
      )}
      <input
        value={stage.title}
        onChange={(e) => onSetTitle(stage.id, e.target.value)}
        className={`min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-xs text-cream focus:border-cream/20 focus:outline-none ${
          isDone ? "text-cream/40 line-through" : ""
        }`}
      />
      {isCountBased ? (
        <div className="flex shrink-0 items-center gap-1 text-[11px] text-cream/70">
          <input
            type="number"
            min={0}
            value={stage.completedCount ?? 0}
            onChange={(e) => onSetCompletedCount(stage.id, e.target.value)}
            className="w-12 rounded-md border border-cream/20 bg-ink px-1 py-1 text-right text-cream"
          />
          <span>/</span>
          <input
            type="number"
            min={1}
            value={stage.targetCount ?? ""}
            onChange={(e) => onSetTargetCount(stage.id, e.target.value)}
            className="w-12 rounded-md border border-cream/20 bg-ink px-1 py-1 text-right text-cream"
          />
          <span>件</span>
        </div>
      ) : (
        <button
          onClick={() => onSetTargetCount(stage.id, "1")}
          className="shrink-0 text-[10px] text-cream/40 hover:text-cream"
          title="この段階を件数（見積り件数など）で進捗管理する"
        >
          件数管理にする
        </button>
      )}
      <input
        type="date"
        value={stage.dueDate ?? ""}
        onChange={(e) => onSetDueDate(stage.id, e.target.value)}
        className="w-32 shrink-0 rounded-md border border-cream/20 bg-ink px-1.5 py-1 text-[11px] text-cream"
      />
      <button className="text-cream/40 hover:text-alert" onClick={() => onRemove(stage.id)} aria-label="削除">
        ✕
      </button>
    </div>
  );
}

function SortableStageRow(props: {
  stage: ProjectStage;
  onToggle: (id: string) => void;
  onSetTitle: (id: string, value: string) => void;
  onSetDueDate: (id: string, value: string) => void;
  onSetCompletedCount: (id: string, value: string) => void;
  onSetTargetCount: (id: string, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <StageRow {...props} dragHandleProps={{ attributes, listeners }} />
    </div>
  );
}

export default function EditProjectDialog({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  const [title, setTitle] = useState(project.title);
  const [category, setCategory] = useState(project.category);
  const [workName, setWorkName] = useState(project.workName);
  const [dueDate, setDueDate] = useState(project.dueDate);
  const [hourlyRateStr, setHourlyRateStr] = useState(project.hourlyRate?.toString() ?? "");
  const [stages, setStages] = useState<ProjectStage[]>(project.stages ?? []);
  const [newStageTitle, setNewStageTitle] = useState("");
  const [newStageTargetCount, setNewStageTargetCount] = useState("");

  function addStage() {
    if (!newStageTitle.trim()) return;
    const target = Number(newStageTargetCount);
    const hasTarget = newStageTargetCount.trim() !== "" && Number.isFinite(target) && target > 0;
    setStages((prev) => [
      ...prev,
      {
        id: uid(),
        title: newStageTitle.trim(),
        completed: false,
        ...(hasTarget ? { targetCount: target, completedCount: 0 } : {}),
      },
    ]);
    setNewStageTitle("");
    setNewStageTargetCount("");
  }
  function toggleStage(id: string) {
    setStages((prev) =>
      prev.map((s) => (s.id === id ? { ...s, completed: !s.completed, completedAt: !s.completed ? Date.now() : undefined } : s))
    );
  }
  function removeStage(id: string) {
    setStages((prev) => prev.filter((s) => s.id !== id));
  }
  function setStageTitle(id: string, value: string) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, title: value } : s)));
  }
  function setStageDueDate(id: string, value: string) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, dueDate: value || undefined } : s)));
  }
  const stageSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  function handleStageDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setStages((prev) => arrayMove(prev, oldIndex, newIndex));
  }
  function setStageCompletedCount(id: string, value: string) {
    const n = Math.max(0, Math.round(Number(value)));
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, completedCount: Number.isFinite(n) ? n : 0 } : s)));
  }
  function setStageTargetCount(id: string, value: string) {
    const trimmed = value.trim();
    setStages((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (trimmed === "") {
          const { targetCount, completedCount, ...rest } = s;
          return rest;
        }
        const n = Math.max(1, Math.round(Number(trimmed)));
        return { ...s, targetCount: Number.isFinite(n) ? n : undefined, completedCount: s.completedCount ?? 0 };
      })
    );
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
                進捗 {Math.round((computeProjectProgress(stages) ?? 0) * 100)}%
              </span>
            )}
          </h4>
          <div className="space-y-1.5">
            <DndContext sensors={stageSensors} collisionDetection={closestCenter} onDragEnd={handleStageDragEnd}>
              <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                {stages.map((stage) => (
                  <SortableStageRow
                    key={stage.id}
                    stage={stage}
                    onToggle={toggleStage}
                    onSetTitle={setStageTitle}
                    onSetDueDate={setStageDueDate}
                    onSetCompletedCount={setStageCompletedCount}
                    onSetTargetCount={setStageTargetCount}
                    onRemove={removeStage}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <div className="flex items-center gap-2">
              <input
                value={newStageTitle}
                onChange={(e) => setNewStageTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addStage()}
                placeholder="+ 段階を追加（例: 要件定義）"
                className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
              />
              <input
                type="number"
                min={1}
                value={newStageTargetCount}
                onChange={(e) => setNewStageTargetCount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addStage()}
                placeholder="目標件数(任意)"
                className="w-24 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
              />
              <button className="btn-pill-outline text-xs" onClick={addStage}>
                追加
              </button>
            </div>
            <p className="text-[10px] text-cream/40">
              目標件数を入力すると、見積り件数・チーム移籍数のように「件数」で進捗を管理できます（未入力ならチェックのみの通常の段階になります）。
            </p>
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
