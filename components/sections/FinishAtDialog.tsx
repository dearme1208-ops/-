"use client";

import { useState } from "react";
import { formatClock, formatHms } from "@/lib/time";
import Modal from "@/components/ui/Modal";

// "HH:MM"をその日のローカル時刻のepoch msに変換する
function toEpoch(hm: string): number | null {
  const [hh, mm] = hm.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

// 計測を止め忘れた場合に、実際に終わった時刻を指定して終了するためのダイアログ。
// 開始時刻はそのまま(既に正しく記録されている)、終了時刻だけをさかのぼって直接指定する
export default function FinishAtDialog({
  taskName,
  startedAt,
  onConfirm,
  onClose,
}: {
  taskName: string;
  /** 計測中セグメントの開始時刻。これより前は終了時刻として指定できない */
  startedAt: number;
  onConfirm: (endAtMs: number) => void;
  onClose: () => void;
}) {
  const [time, setTime] = useState(() => formatClock(Date.now()));
  const endAt = toEpoch(time);
  const invalid = endAt === null || endAt <= startedAt;
  const durationSeconds = endAt !== null ? Math.round((endAt - startedAt) / 1000) : null;

  function offsetMinutesAgo(minutes: number) {
    setTime(formatClock(Date.now() - minutes * 60000));
  }

  return (
    <Modal title={`「${taskName}」の終了時刻を指定`} onClose={onClose}>
      <p className="mb-3 text-xs text-cream/60">
        止め忘れていた場合、実際に作業が終わった時刻を指定して終了できます。開始時刻(
        {formatClock(startedAt)})はそのまま、終了時刻だけをさかのぼって直接指定します。
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" className="btn-pill-outline text-xs" onClick={() => offsetMinutesAgo(0)}>
          たった今
        </button>
        <button type="button" className="btn-pill-outline text-xs" onClick={() => offsetMinutesAgo(5)}>
          5分前
        </button>
        <button type="button" className="btn-pill-outline text-xs" onClick={() => offsetMinutesAgo(15)}>
          15分前
        </button>
        <button type="button" className="btn-pill-outline text-xs" onClick={() => offsetMinutesAgo(30)}>
          30分前
        </button>
        <button type="button" className="btn-pill-outline text-xs" onClick={() => offsetMinutesAgo(60)}>
          1時間前
        </button>
      </div>
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        autoFocus
      />
      <p className={`mt-2 text-xs tabular-nums ${invalid ? "text-alert" : "text-cream/60"}`}>
        {invalid
          ? "開始時刻より後の時刻を指定してください"
          : `実績時間 ${formatHms(durationSeconds ?? 0)}`}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          className="btn-pill text-sm"
          disabled={invalid}
          onClick={() => {
            if (endAt !== null && !invalid) onConfirm(endAt);
          }}
        >
          この時刻で終了
        </button>
      </div>
    </Modal>
  );
}
