"use client";

import { useState } from "react";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { parseHmsToSeconds } from "@/lib/time";
import type { DailyTask, MasterTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";

export default function AddTaskDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const [mode, setMode] = useState<"master" | "free">("master");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("00:10:00");

  async function insertTask(
    taskCategory: string,
    taskName: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    start: boolean
  ) {
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const now = Date.now();
    const task: DailyTask = {
      id: uid(),
      date,
      order: count,
      masterTaskId,
      category: taskCategory,
      name: taskName,
      estimatedSeconds,
      status: start ? "running" : "pending",
      segments: start ? [{ start: now }] : [],
      accumulatedMs: 0,
      startedAt: start ? now : undefined,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    onClose();
  }

  // マスタから選ぶ場合はタップ1回で即追加+開始する
  async function selectMaster(master: MasterTask) {
    await insertTask(master.category, master.name, master.estimatedSeconds, master.id, true);
  }

  async function submitFreeform(start: boolean) {
    if (!category.trim() || !name.trim()) return;
    const estimatedSeconds = parseHmsToSeconds(estimate);
    const master = await findOrCreateMasterTask(category, name, estimatedSeconds);
    await insertTask(category.trim(), name.trim(), estimatedSeconds, master.id, start);
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

      {mode === "master" ? (
        <>
          <p className="mb-2 text-xs text-cream/50">タップするとすぐに追加して開始します。</p>
          <MasterTaskPicker onSelect={selectMaster} />
        </>
      ) : (
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
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => submitFreeform(false)}>
              追加のみ
            </button>
            <button className="btn-pill text-sm" onClick={() => submitFreeform(true)}>
              追加してすぐ開始
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
