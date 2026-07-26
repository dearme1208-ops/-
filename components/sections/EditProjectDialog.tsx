"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import type { ProjectItem } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export default function EditProjectDialog({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  const [title, setTitle] = useState(project.title);
  const [category, setCategory] = useState(project.category);
  const [workName, setWorkName] = useState(project.workName);
  const [dueDate, setDueDate] = useState(project.dueDate);

  async function save() {
    if (!title.trim() || !category.trim() || !workName.trim() || !dueDate) return;
    await db.projects.update(project.id, {
      title: title.trim(),
      category: category.trim(),
      workName: workName.trim(),
      dueDate,
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
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}
