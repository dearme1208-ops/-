"use client";

import { useState } from "react";
import { findOrCreateMasterTask } from "@/lib/master";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { formatClock, formatMsClock, parseHmsToSeconds } from "@/lib/time";
import type { DailyTask, MasterTask } from "@/lib/types";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";

type Mode = "today" | "master" | "free";

export default function ProvisionalTaskCard({
  task,
  now,
  candidateTasks,
  onAssignExisting,
  onAssignNew,
  onFinishAsIs,
}: {
  task: DailyTask;
  now: number;
  candidateTasks: DailyTask[];
  onAssignExisting: (targetId: string) => void | Promise<void>;
  onAssignNew: (
    category: string,
    name: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined
  ) => void | Promise<void>;
  onFinishAsIs: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>(candidateTasks.length > 0 ? "today" : "master");
  const [selectedMaster, setSelectedMaster] = useState<MasterTask | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("00:10:00");

  const elapsedMs = segmentsAccumulatedMs(task, now);

  async function confirmMaster() {
    if (!selectedMaster) return;
    await onAssignNew(selectedMaster.category, selectedMaster.name, selectedMaster.estimatedSeconds, selectedMaster.id);
  }

  async function confirmFree() {
    if (!category.trim() || !name.trim()) return;
    const estimatedSeconds = parseHmsToSeconds(estimate);
    const master = await findOrCreateMasterTask(category.trim(), name.trim(), estimatedSeconds);
    await onAssignNew(category.trim(), name.trim(), estimatedSeconds, master.id);
  }

  return (
    <div className="panel border-2 border-alert bg-alert/[0.06] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1 text-xs font-bold text-alert">
            <span className="h-2 w-2 animate-pulse rounded-full bg-alert" />
            仮計測中（未割り当て）
          </div>
          <div className="font-display text-base font-bold">{task.name}</div>
          {task.startedAt && (
            <div className="text-xs text-cream/50">{formatClock(task.startedAt)} から未計測が続いています</div>
          )}
        </div>
        <div className="font-display text-2xl font-bold tabular-nums text-alert">{formatMsClock(elapsedMs)}</div>
      </div>

      <div className="mt-3 border-t border-cream/10 pt-3">
        <p className="mb-2 text-xs text-cream/60">この時間をどの作業に割り当てますか？</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {candidateTasks.length > 0 && (
            <button
              className={mode === "today" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setMode("today")}
            >
              本日の作業から選択
            </button>
          )}
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

        {mode === "today" && (
          <div className="space-y-1.5">
            {candidateTasks.length === 0 && (
              <p className="text-xs text-cream/50">本日の作業に選択できる作業がありません。</p>
            )}
            {candidateTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => onAssignExisting(t.id)}
                className="block w-full rounded-lg bg-ink/60 px-3 py-2 text-left text-sm text-cream hover:bg-ink"
              >
                <span className="text-cream/50">{t.category}</span> {t.name}
                <span className="ml-2 text-xs text-cream/40">{t.status === "paused" ? "（一時停止中）" : "（未着手）"}</span>
              </button>
            ))}
          </div>
        )}

        {mode === "master" && (
          <div className="space-y-2">
            <MasterTaskPicker selectedId={selectedMaster?.id} onSelect={setSelectedMaster} />
            <div className="flex justify-end">
              <button className="btn-pill text-sm" onClick={confirmMaster} disabled={!selectedMaster}>
                この作業に割り当てる
              </button>
            </div>
          </div>
        )}

        {mode === "free" && (
          <div className="space-y-2">
            <input
              placeholder="業務区分（大項目）"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <input
              placeholder="詳細作業名"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <input
              placeholder="想定時間 hh:mm:ss"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <div className="flex justify-end">
              <button className="btn-pill text-sm" onClick={confirmFree} disabled={!category.trim() || !name.trim()}>
                この作業に割り当てる
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex justify-end border-t border-cream/10 pt-3">
          <button className="btn-pill-outline text-xs" onClick={onFinishAsIs}>
            割り当てずに終了
          </button>
        </div>
      </div>
    </div>
  );
}
