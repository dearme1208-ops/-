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

  return (
    <Modal title="計測時間に加算" onClose={onClose}>
      <p className="mb-3 text-sm text-cream/70">
        「{taskName}」を完了にせず、計測時間だけ加算します。
      </p>
      {gapSeconds > 0 && (
        <div className="mb-4 rounded-lg bg-ink/50 p-3">
          <p className="text-xs text-cream/60">
            基本労働時間内で、まだ計測されていない時間:{" "}
            <span className="font-bold text-cream">{formatHms(gapSeconds)}</span>
          </p>
          <button className="btn-pill mt-2 text-sm" onClick={() => onConfirm(gapSeconds)}>
            この時間を加算する
          </button>
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs text-cream/60">手動で加算する時間 (hh:mm:ss)</label>
        <div className="flex items-center gap-2">
          <input
            value={manualTime}
            onChange={(e) => setManualTime(e.target.value)}
            className="flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream tabular-nums"
          />
          <button className="btn-pill-outline text-sm" onClick={() => onConfirm(parseHmsToSeconds(manualTime))}>
            加算する
          </button>
        </div>
      </div>
    </Modal>
  );
}
