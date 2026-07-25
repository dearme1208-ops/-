"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export default function EditTaskDialog({ task, onClose }: { task: DailyTask; onClose: () => void }) {
  const [category, setCategory] = useState(task.category);
  const [name, setName] = useState(task.name);

  async function save() {
    if (!category.trim() || !name.trim()) return;
    const renamed = category.trim() !== task.category || name.trim() !== task.name;
    await db.dailyTasks.update(task.id, {
      category: category.trim(),
      name: name.trim(),
      // 名前が変わった場合、既存のマスタ紐付けは終了時に付け直す（区分/作業名との不整合を防ぐ）
      ...(renamed ? { masterTaskId: undefined } : {}),
    });
    onClose();
  }

  return (
    <Modal title="作業内容を編集" onClose={onClose}>
      <div className="space-y-2">
        <input
          placeholder="業務区分（大項目）"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          autoFocus
        />
        <input
          placeholder="詳細作業名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}
