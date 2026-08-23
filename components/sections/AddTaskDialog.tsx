"use client";

import { useState } from "react";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { computeRemainingEstimatedSeconds } from "@/lib/tasks";
import { formatClock, parseHmsToSeconds } from "@/lib/time";
import type { DailyTask, MasterTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import VoiceInputButton from "@/components/ui/VoiceInputButton";

export default function AddTaskDialog({
  date,
  provisionalRunning,
  lastStopTime,
  onRequestConflictStart,
  onAdded,
  onClose,
}: {
  date: string;
  provisionalRunning: boolean;
  lastStopTime?: number | null;
  onRequestConflictStart: (category: string, name: string, estimatedSeconds: number, masterTaskId: string | undefined) => void;
  // 実際に追加できた時に、その作業が実行中("running")・未着手("pending")のどちらとして
  // 追加されたかを渡す(未計測との競合で呼び出し元に処理を委ねた場合は呼ばれない。
  // その場合はrequestStartNew側で別途「実行中」への切り替えが行われる)
  onAdded?: (status: "running" | "pending") => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"master" | "free">("master");
  const [selectedMaster, setSelectedMaster] = useState<MasterTask | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("00:10:00");
  // 登録時点では実際の所要時間が読めないことが多いため、既定では「予定」を設定しない
  // （目安に近い「予測」はマスタの平均値から別途ガントチャートに自動表示される）。
  // チェックした場合のみ、この作業に「予定」を設定する
  const [setPlan, setSetPlan] = useState(false);

  async function insertTask(
    taskCategory: string,
    taskName: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    startAt: number | undefined,
    hasPlan: boolean
  ) {
    // 未計測(仮計測)が既に計測中の状態ですぐ開始しようとした場合、二重計測になって
    // しまうため、ここでは追加せず、呼び出し元（本日タブ）に判断を委ねる
    if (startAt !== undefined && provisionalRunning) {
      onRequestConflictStart(taskCategory, taskName, estimatedSeconds, masterTaskId);
      onClose();
      return;
    }
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const task: DailyTask = {
      id: uid(),
      date,
      order: count,
      masterTaskId,
      category: taskCategory,
      name: taskName,
      estimatedSeconds: hasPlan ? estimatedSeconds : 0,
      hasPlan,
      status: startAt !== undefined ? "running" : "pending",
      segments: startAt !== undefined ? [{ start: startAt }] : [],
      accumulatedMs: 0,
      startedAt: startAt,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    onAdded?.(startAt !== undefined ? "running" : "pending");
    onClose();
  }

  async function submitMaster(startAt: number | undefined) {
    if (!selectedMaster) return;
    // 同日中に同じ大項目・詳細作業名の作業が既にあれば、残りの想定時間を繰り越す
    const estimatedSeconds = setPlan
      ? await computeRemainingEstimatedSeconds(date, selectedMaster.category, selectedMaster.name, selectedMaster.estimatedSeconds)
      : 0;
    await insertTask(selectedMaster.category, selectedMaster.name, estimatedSeconds, selectedMaster.id, startAt, setPlan);
  }

  async function submitFreeform(startAt: number | undefined) {
    if (!category.trim() || !name.trim()) return;
    const estimatedSeconds = setPlan ? parseHmsToSeconds(estimate) : 0;
    const master = await findOrCreateMasterTask(category, name, estimatedSeconds);
    await insertTask(category.trim(), name.trim(), estimatedSeconds, master.id, startAt, setPlan);
  }

  return (
    <Modal title="突発作業を追加" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <button
          className={mode === "master" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setMode("master")}
        >
          マスタから選択
        </button>
        <button
          className={mode === "free" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => setMode("free")}
        >
          自由入力
        </button>
      </div>

      <label className="mb-3 flex items-center gap-1.5 text-xs text-cream/60">
        <input
          type="checkbox"
          checked={setPlan}
          onChange={(e) => setSetPlan(e.target.checked)}
          className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
        />
        この作業の「予定」を設定する
        <span className="text-cream/40">（登録時点では読めないことが多いためオフが既定です。マスタの平均から出る「予測」は別途表示されます）</span>
      </label>

      {mode === "master" ? (
        <div className="space-y-2">
          <MasterTaskPicker selectedId={selectedMaster?.id} onSelect={setSelectedMaster} />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => submitMaster(undefined)} disabled={!selectedMaster}>
              追加のみ
            </button>
            {lastStopTime != null && (
              <button
                className="btn-pill-outline text-sm"
                onClick={() => submitMaster(lastStopTime)}
                disabled={!selectedMaster}
                title="前の作業が終了/一時停止した時刻から、この作業が始まっていたことにします"
              >
                {formatClock(lastStopTime)}から開始
              </button>
            )}
            <button className="btn-pill text-sm" onClick={() => submitMaster(Date.now())} disabled={!selectedMaster}>
              追加してすぐ開始
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs text-cream/60">業務区分（大項目）</label>
            <input
              placeholder="例: 資料作成"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-cream/60">詳細作業名</label>
            <div className="flex items-center gap-2">
              <input
                placeholder="例: 見積書の作成"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
              <VoiceInputButton onResult={(text) => setName((v) => (v ? `${v} ${text}` : text))} />
            </div>
          </div>
          {setPlan && (
            <div>
              <label className="mb-1 block text-xs text-cream/60">想定時間（予定）</label>
              <input
                placeholder="hh:mm:ss"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
                className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
              />
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => submitFreeform(undefined)}>
              追加のみ
            </button>
            {lastStopTime != null && (
              <button
                className="btn-pill-outline text-sm"
                onClick={() => submitFreeform(lastStopTime)}
                title="前の作業が終了/一時停止した時刻から、この作業が始まっていたことにします"
              >
                {formatClock(lastStopTime)}から開始
              </button>
            )}
            <button className="btn-pill text-sm" onClick={() => submitFreeform(Date.now())}>
              追加してすぐ開始
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
