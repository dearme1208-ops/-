"use client";

import { useMemo, useState } from "react";
import { formatClock, formatHms } from "@/lib/time";
import { DEFAULT_TROUBLE_DETAIL_OPTIONS } from "@/lib/trouble";
import { parsePresetList } from "@/lib/todo";
import { useSetting } from "@/lib/settings";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";

const DAY_MS = 86400000;

// "YYYY-MM-DD" + "HH:MM" をその日のローカル時刻のepoch msに変換する
function toEpoch(date: string, hm: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
}

export default function EditTaskDialog({
  task,
  previousTaskEndedAt,
  onSave,
  onClose,
}: {
  task: DailyTask;
  previousTaskEndedAt?: number | null;
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
  const isDone = task.status === "done";
  // 計測中/一時停止中の作業は、まだ終了していないため開始時刻だけをさかのぼって
  // 修正できるようにする(終了は完了後にこのダイアログの別枠で編集する)
  const isInProgress = task.status === "running" || task.status === "paused";
  const originalStart = task.startedAt ?? task.segments[0]?.start ?? fallbackNow;
  const originalEnd = task.endedAt ?? task.segments[task.segments.length - 1]?.end ?? fallbackNow;
  const [startTime, setStartTime] = useState(formatClock(originalStart));
  const [endTime, setEndTime] = useState(formatClock(originalEnd));
  // <input type="time">はHH:MMまでしか扱えず秒が丸められるため、実際に編集していない
  // 側はこのフラグで判別し、秒まで含めた元のepoch値をそのまま使う（丸めによって
  // 一時停止区間と矛盾する時刻に化けてしまうのを防ぐ）
  const [startTouched, setStartTouched] = useState(false);
  const [endTouched, setEndTouched] = useState(false);
  // 「前の作業の終了時刻を使う」ボタンを押した際は、入力欄の表示用文字列(HH:MMまでしか
  // 持てず秒が丸まる)とは別に、前の作業の終了時刻を秒まで正確なepoch値のまま覚えておく。
  // 入力欄をその後さらに手で触った場合はこの値を捨て、通常どおり入力欄の値(分単位)を使う
  const [preciseStart, setPreciseStart] = useState<number | null>(null);
  const [note, setNote] = useState(task.note ?? "");
  const [showMasterPicker, setShowMasterPicker] = useState(false);
  const [troubleDetailOptionsJson] = useSetting("trouble.detailOptions", JSON.stringify(DEFAULT_TROUBLE_DETAIL_OPTIONS));
  const troubleDetailOptions = useMemo(() => parsePresetList(troubleDetailOptionsJson), [troubleDetailOptionsJson]);

  function useStartTime(hm: string) {
    setStartTime(hm);
    setStartTouched(true);
    setPreciseStart(null);
  }
  function usePreviousEndAsStart(endedAt: number) {
    setStartTime(formatClock(endedAt));
    setStartTouched(true);
    setPreciseStart(endedAt);
  }

  // 開始・終了それぞれ、編集していなければ元の値(秒まで正確)、編集していれば
  // 入力欄のHH:MMをこの作業の日付にあてはめた値を使う。開始が終了以降になって
  // しまう場合は、日をまたいで前日から始まっていたとみなし開始日を1日前にずらす
  // （例: 前日20:40〜日付が変わった後の0:12、といった作業を登録できるようにするため）。
  // ただし「前の作業の終了時刻を使う」で入れた場合は、丸めずpreciseStartをそのまま使う
  const rawStart = startTouched ? (preciseStart ?? toEpoch(task.date, startTime)) : originalStart;
  const rawEnd = endTouched ? toEpoch(task.date, endTime) : originalEnd;
  const crossesMidnight = rawStart >= rawEnd;
  const resolvedStart = crossesMidnight ? rawStart - DAY_MS : rawStart;
  const durationSeconds = Math.round((rawEnd - resolvedStart) / 1000);
  const invalidRange = isDone && durationSeconds <= 0;

  // 計測中/一時停止中の作業では、開始時刻は「最初の区間が一時停止した時刻」(それが
  // 無ければ現在時刻)より前でなければならない(それより後だと矛盾するため)
  const firstSegmentBound = task.segments[0]?.end ?? fallbackNow;
  const inProgressInvalid = isInProgress && resolvedStart >= firstSegmentBound;

  function save() {
    if (!category.trim() || !name.trim()) return;
    if (invalidRange || inProgressInvalid) return;
    if (isDone) {
      onSave(
        category.trim(),
        name.trim(),
        undefined,
        note.trim() || undefined,
        startTouched ? resolvedStart : undefined,
        endTouched ? rawEnd : undefined
      );
      onClose();
      return;
    }
    if (isInProgress) {
      onSave(category.trim(), name.trim(), undefined, note.trim() || undefined, startTouched ? resolvedStart : undefined);
      onClose();
      return;
    }
    onSave(category.trim(), name.trim(), undefined, note.trim() || undefined);
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
        <button type="button" className="btn-pill-outline text-xs" onClick={() => setShowMasterPicker(true)}>
          作業マスタから選択
        </button>
        {task.isTrouble && troubleDetailOptions.length > 0 && (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1.5">
              {troubleDetailOptions.map((opt) => (
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
            <p className="text-[10px] text-cream/40">あくまで参考の候補です。上の詳細作業名欄には自由に入力できます。</p>
          </div>
        )}
        {isDone && (
          <div>
            <label className="mb-1 block text-xs text-cream/60">開始〜終了時刻</label>
            {previousTaskEndedAt != null && (
              <p className="mb-1 text-[11px] tabular-nums text-cream/50">
                参考: 前の作業の終了時刻 {formatClock(previousTaskEndedAt)}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => useStartTime(e.target.value)}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
              {previousTaskEndedAt != null && (
                <button
                  type="button"
                  className="btn-pill-outline text-xs"
                  title="直前に完了した作業の終了時刻を開始時刻として使います"
                  onClick={() => usePreviousEndAsStart(previousTaskEndedAt)}
                >
                  前の作業の終了({formatClock(previousTaskEndedAt)})を使う
                </button>
              )}
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
            {/* 前の作業の終了時刻を基準に、今選んでいる開始時刻がどちらにどれだけずれているかをその場で見せる。
                ネイティブの時刻ピッカー(画面全体を覆うダイヤル等)を開いている間はこの案内が隠れてしまうが、
                ピッカーを閉じて戻ってくれば即座に確認できる */}
            {previousTaskEndedAt != null && !invalidRange && (
              <p className={`mt-1 text-xs tabular-nums ${resolvedStart < previousTaskEndedAt ? "text-alert" : "text-cream/50"}`}>
                {resolvedStart < previousTaskEndedAt
                  ? `⚠ 前の作業の終了(${formatClock(previousTaskEndedAt)})より${formatHms(
                      Math.round((previousTaskEndedAt - resolvedStart) / 1000)
                    )}早い開始です`
                  : `前の作業の終了(${formatClock(previousTaskEndedAt)})から${formatHms(
                      Math.round((resolvedStart - previousTaskEndedAt) / 1000)
                    )}後の開始です`}
              </p>
            )}
            <p className="mt-1 text-[10px] text-cream/40">
              開始か終了のどちらかを変更すると、実績時間はその差分から自動的に再計算されます。区分・作業名・時刻の変更は、紐づく実績（集計・ランキングなどに使われるデータ）にも反映されます。
            </p>
          </div>
        )}
        {isInProgress && (
          <div>
            <label className="mb-1 block text-xs text-cream/60">開始時刻</label>
            {previousTaskEndedAt != null && (
              <p className="mb-1 text-[11px] tabular-nums text-cream/50">
                参考: 前の作業の終了時刻 {formatClock(previousTaskEndedAt)}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => useStartTime(e.target.value)}
                className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
              {previousTaskEndedAt != null && (
                <button
                  type="button"
                  className="btn-pill-outline text-xs"
                  title="直前に完了した作業の終了時刻を開始時刻として使います"
                  onClick={() => usePreviousEndAsStart(previousTaskEndedAt)}
                >
                  前の作業の終了({formatClock(previousTaskEndedAt)})を使う
                </button>
              )}
            </div>
            {inProgressInvalid && (
              <p className="mt-1 text-xs text-alert">
                {task.segments[0]?.end !== undefined
                  ? "この作業が最初に一時停止した時刻より前にしてください"
                  : "現在時刻より前にしてください"}
              </p>
            )}
            {crossesMidnight && !inProgressInvalid && (
              <p className="mt-1 text-xs text-alert">前日の{startTime}から日をまたいで始まっていたものとして保存します。</p>
            )}
            {previousTaskEndedAt != null && !inProgressInvalid && (
              <p className={`mt-1 text-xs tabular-nums ${resolvedStart < previousTaskEndedAt ? "text-alert" : "text-cream/50"}`}>
                {resolvedStart < previousTaskEndedAt
                  ? `⚠ 前の作業の終了(${formatClock(previousTaskEndedAt)})より${formatHms(
                      Math.round((previousTaskEndedAt - resolvedStart) / 1000)
                    )}早い開始です`
                  : `前の作業の終了(${formatClock(previousTaskEndedAt)})から${formatHms(
                      Math.round((resolvedStart - previousTaskEndedAt) / 1000)
                    )}後の開始です`}
              </p>
            )}
            <p className="mt-1 text-[10px] text-cream/40">
              終了はまだ確定していないため編集できません(完了後に開始〜終了をまとめて編集できます)。
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
      {showMasterPicker && (
        <CategoryWorkNameDialog
          title="作業マスタから選択"
          confirmLabel="この内容を使う"
          defaultCategory={category}
          defaultWorkName={name}
          onConfirm={(newCategory, newName) => {
            setCategory(newCategory);
            setName(newName);
            setShowMasterPicker(false);
          }}
          onClose={() => setShowMasterPicker(false)}
        />
      )}
    </Modal>
  );
}
