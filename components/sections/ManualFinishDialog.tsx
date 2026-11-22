"use client";

import { useState } from "react";
import { parseHmsToSeconds } from "@/lib/time";
import Modal from "@/components/ui/Modal";

export default function ManualFinishDialog({
  taskName,
  onConfirm,
  onClose,
}: {
  taskName: string;
  onConfirm: (seconds: number) => void;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState("00:10:00");

  // 文言はカードの「かかった時間だけ記録」にそろえる(「終了」と書くと、計測を止める操作と取り違えやすい)
  return (
    <Modal title={`「${taskName}」のかかった時間だけ記録`} onClose={onClose}>
      <p className="mb-2 text-xs text-cream/60">
        計測し忘れていた場合、実際にかかった時間だけを入力して記録し、完了にできます。
      </p>
      <input
        placeholder="所要時間 hh:mm:ss"
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        autoFocus
      />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm" onClick={() => onConfirm(parseHmsToSeconds(duration))}>
          この時間で記録して完了
        </button>
      </div>
    </Modal>
  );
}
