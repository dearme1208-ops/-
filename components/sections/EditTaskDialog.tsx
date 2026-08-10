"use client";

import { useState } from "react";
import { formatClock, formatHms } from "@/lib/time";
import { TROUBLE_DETAIL_OPTIONS } from "@/lib/trouble";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

const DAY_MS = 86400000;

// "YYYY-MM-DD" + "HH:MM" をその日のローカル時刻のepoch msに変換する
function toEpoch(date: string, hm: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

export default function EditTaskDialog({
  task,
  onSave,
  onClose,
}: {
  task: DailyTask;
  onSave: (
    category: string,
    name: string,
    actualSeconds?: number,
    note?: string,
    startedAt?: number,
    endedAt?: number
  ) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState(task.category);
  const [name, setName] = useState(task.name);
  const fallbackNow = Date.now();
  const originalStart = task.startedAt ?? task.segments[0]?.start ?? fallbackNow;
  const originalEnd = task.endedAt ?? task.segments[task.segments.length - 1]?.end ?? fallbackNow;
  const [startTime, setStartTime] = useState(formatClock(originalStart));
  const [endTime, setEndTime] = useState(formatClock(originalEnd));
  // <input type="time">はHH:MMまでしか扱えず秒が丸められるため、実際に編集していない
  // 側はこのフラグで判別し、秒まで含めた元のepoch値をそのまま使う（丸めによって
  // 一時停止区間と矛盾する時刻に化けてしまうのを防ぐ）
  const [startTouched, setStartTouched] = useState(false);
  const [endTouched, setEndTouched] = useState(false);
  const [note, setNote] = useState(task.note ?? "");
  const isDone = task.status === "done";

  // 開始・終了それぞれ、編集していなければ元の値(秒まで正確)、編集していれば
  // 入力欄のHH:MMをこの作業の日付にあてはめた値を使う。開始が終了以降になって
  // しまう場合は、日をまたいで前日から始まっていたとみなし開始日を1日前にずらす
  // （例: 前日20:40〜日付が変わった後の0:12、といった作業を登録できるようにするため）
  const rawStart = startTouched ? toEpoch(task.date, startTime) : originalStart;
  const rawEnd = endTouched ? toEpoch(task.date, endTime) : originalEnd;
  const crossesMidnight = rawStart >= rawEnd;
  const resolvedStart = crossesMidnight ? rawStart - DAY_MS : rawStart;
  const durationSeconds = Math.round((rawEnd - resolvedStart) / 1000);
  const invalidRange = isDone && durationSeconds <= 0;

  function save() {
    if (!category.trim() || !name.trim()) return;
    if (invalidRange) return;
    if (!isDone) {
      onSave(category.trim(), name.trim(), undefined, note.trim() || undefined);
      onClose();
      return;
    }
    onSave(
      category.trim(),
      name.trim(),
      undefined,
      note.trim() || undefined,
      startTouched ? resolvedStart : undefined,
      endTouched ? rawEnd : undefined
    );
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
            <label className="mb-1 block text-xs text-cream/60">開始〜終了時刻</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setStartTouched(true);
                }}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
              <span className="text-cream/50">〜</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setEndTouched(true);
                }}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
            </div>
            <p className={`mt-1 text-xs tabular-nums ${invalidRange ? "text-alert" : "text-cream/60"}`}>
              {invalidRange ? "開始と終了の時刻が同じです" : `実績時間 ${formatHms(durationSeconds)}`}
            </p>
            {crossesMidnight && !invalidRange && (
              <p className="mt-1 text-xs text-alert">
                終了より遅い開始時刻のため、前日の{startTime}から日をまたいで始まったものとして保存します。
              </p>
            )}
            <p className="mt-1 text-[10px] text-cream/40">
              開始か終了のどちらかを変更すると、実績時間はその差分から自動的に再計算されます。区分・作業名・時刻の変更は、紐づく実績（集計・ランキングなどに使われるデータ）にも反映されます。
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
