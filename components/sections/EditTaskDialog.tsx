"use client";

import { useState } from "react";
import { formatHms, parseHmsToSeconds } from "@/lib/time";
import { TROUBLE_DETAIL_OPTIONS } from "@/lib/trouble";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export default function EditTaskDialog({
  task,
  onSave,
  onClose,
}: {
  task: DailyTask;
  onSave: (category: string, name: string, actualSeconds?: number, note?: string) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(task.category);
  const [name, setName] = useState(task.name);
  const [actualTime, setActualTime] = useState(formatHms(Math.round(task.accumulatedMs / 1000)));
  const [note, setNote] = useState(task.note ?? "");
  const isDone = task.status === "done";

  function save() {
    if (!category.trim() || !name.trim()) return;
    onSave(category.trim(), name.trim(), isDone ? parseHmsToSeconds(actualTime) : undefined, note.trim() || undefined);
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
        {task.isTrouble && (
          <div className="flex flex-wrap gap-1.5">
            {TROUBLE_DETAIL_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className="btn-pill-outline text-xs"
                onClick={() => setName((v) => (v ? `${opt} ${v}` : opt))}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {isDone && (
          <div>
            <label className="mb-1 block text-xs text-cream/60">実績時間 (hh:mm:ss)</label>
            <input
              placeholder="hh:mm:ss"
              value={actualTime}
              onChange={(e) => setActualTime(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream tabular-nums"
            />
            <p className="mt-1 text-[10px] text-cream/40">
              区分・作業名・実績時間の変更は、紐づく実績（集計・ランキングなどに使われるデータ）にも反映されます。
            </p>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs text-cream/60">一言メモ</label>
          <textarea
            placeholder="振り返りなど自由に（任意）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
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
