"use client";

import { useState } from "react";
import { formatHms, parseHmsToSeconds } from "@/lib/time";
import Modal from "@/components/ui/Modal";

export default function AddTimeDialog({
  taskName,
  gapSeconds,
  onConfirm,
  onClose,
}: {
  taskName: string;
  gapSeconds: number;
  onConfirm: (seconds: number) => void;
  onClose: () => void;
}) {
  const [manualTime, setManualTime] = useState("00:10:00");

  // 文言はカードの「時間を足す」にそろえる(ボタンとダイアログで「足す」「加算」と言い方が違うと別の操作に見える)
  return (
    <Modal title="時間を足す" onClose={onClose}>
      <p className="mb-3 text-sm text-cream/70">
        「{taskName}」を完了にせず、計測時間だけ足します。
      </p>
      {gapSeconds > 0 && (
        <div className="mb-4 rounded-lg bg-ink/50 p-3">
          <p className="text-xs text-cream/60">
            基本労働時間内で、まだ計測されていない時間:{" "}
            <span className="font-bold text-cream">{formatHms(gapSeconds)}</span>
          </p>
          <button className="btn-pill mt-2 text-sm" onClick={() => onConfirm(gapSeconds)}>
            この時間を足す
          </button>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs text-cream/60">足す時間 (hh:mm:ss)</label>
        <div className="flex items-center gap-2">
          <input
            value={manualTime}
            onChange={(e) => setManualTime(e.target.value)}
            className="flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream tabular-nums"
          />
          <button className="btn-pill-outline text-sm" onClick={() => onConfirm(parseHmsToSeconds(manualTime))}>
            足す
          </button>
        </div>
      </div>
    </Modal>
  );
}
