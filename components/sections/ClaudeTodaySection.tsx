"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatMsClock, todayStr, formatClock } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { DailyTask } from "@/lib/types";

// Claudeモード専用の「本日の作業」体験。既存のTodaySection(予定インポート・位置情報・
// 天気・自動配分等の多機能タブ)は踏襲せず、Claudeとの対話ログのような、今やっていることに
// 集中するための最小構成の画面をゼロから作った。データは他のモードと同じdailyTasksテーブルを
// そのまま使うため、モードを切り替えても記録は失われない
export default function ClaudeTodaySection() {
  const date = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const [now, setNow] = useState(Date.now());
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const items = useMemo(
    () => (tasks ?? []).filter((t) => !t.isProvisional).sort((a, b) => a.order - b.order),
    [tasks]
  );
  const runningTask = items.find((t) => t.status === "running") ?? null;
  const totalMs = items.reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0);
  const doneCount = items.filter((t) => t.status === "done").length;

  const summaryLine =
    items.length === 0
      ? "まだ何も記録がありません。下の欄に今から取り組むことを書いて、始めてみましょう。"
      : `${doneCount}件のタスクを完了し、これまでに合計 ${formatMsClock(totalMs)} 集中しています。`;

  async function addTask(startImmediately: boolean) {
    const name = content.trim();
    if (!name) return;
    const cat = category.trim() || "未分類";
    const master = await findOrCreateMasterTask(cat, name, 0);
    const startAt = Date.now();
    // 「今、これに集中する」という単一フォーカスの体験にするため、開始と同時に
    // 他に実行中のタスクがあれば先に一時停止しておく(二重に計測が進むのを防ぐ)
    if (startImmediately && runningTask) await pauseTask(runningTask);
    const task: DailyTask = {
      id: uid(),
      date,
      order: items.length,
      masterTaskId: master.id,
      category: cat,
      name,
      estimatedSeconds: 0,
      hasPlan: false,
      status: startImmediately ? "running" : "pending",
      segments: startImmediately ? [{ start: startAt }] : [],
      accumulatedMs: 0,
      startedAt: startImmediately ? startAt : undefined,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    setContent("");
    setCategory("");
  }

  async function startTask(task: DailyTask) {
    if (runningTask && runningTask.id !== task.id) await pauseTask(runningTask);
    const segments = [...task.segments, { start: Date.now() }];
    await db.dailyTasks.update(task.id, {
      segments,
      status: "running",
      startedAt: task.startedAt ?? Date.now(),
    });
  }

  async function pauseTask(task: DailyTask) {
    const closeAt = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs });
  }

  async function completeTask(task: DailyTask) {
    await finishDailyTask(task);
  }

  async function deleteTask(task: DailyTask) {
    await db.dailyTasks.delete(task.id);
    showUndoToast(`「${task.name}」を取り消しました`, async () => {
      await db.dailyTasks.add(task);
    });
  }

  function statusLine(task: DailyTask): string {
    const elapsed = formatMsClock(segmentsAccumulatedMs(task, now));
    if (task.status === "running") return `実行中です。経過 ${elapsed}`;
    if (task.status === "paused") return `一時停止中です。これまで ${elapsed}`;
    if (task.status === "done") return `完了しました。所要時間 ${elapsed}`;
    return "まだ開始していません。準備ができたら始めましょう。";
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-1 p-4">
        <h2 className="font-display text-lg font-bold text-cream">今日の集中</h2>
        <p className="text-sm text-cream/60">{summaryLine}</p>
        {runningTask && (
          <div className="mt-2 flex items-center gap-2 text-sm text-alert">
            <span className="claude-pulse-dot inline-flex h-2 w-2 rounded-full bg-alert" aria-hidden="true" />
            実行中: {runningTask.category} · {runningTask.name}
            <span className="tabular-nums font-bold">
              {formatMsClock(segmentsAccumulatedMs(runningTask, now))}
            </span>
          </div>
        )}
      </div>

      <div className="panel space-y-2 p-4">
        <label className="block text-xs font-bold text-cream/60">今、何に取り組みますか？</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="分類（任意）"
            className="w-full rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream sm:w-40"
          />
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask(true)}
            placeholder="例: 見積書を作成する"
            className="w-full min-w-0 flex-1 rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-pill-outline text-xs" onClick={() => addTask(false)} disabled={!content.trim()}>
            追加のみ
          </button>
          <button className="btn-pill text-xs" onClick={() => addTask(true)} disabled={!content.trim()}>
            開始する
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-cream/40">今日のセッションはまだ空です。</p>
        )}
        {[...items].reverse().map((task) => (
          <div key={task.id} className={`panel space-y-2 p-4 ${task.status === "done" ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div>
                <p className="text-[11px] text-cream/40">
                  あなた{task.startedAt ? ` · ${formatClock(task.startedAt)}` : ""}
                </p>
                <p className="font-medium text-cream">
                  {task.category && <span className="text-cream/50">{task.category} · </span>}
                  {task.name}
                </p>
              </div>
            </div>
            <p className={`text-sm ${task.status === "running" ? "font-bold text-alert" : "text-cream/60"}`}>
              <span className="text-cream/40">Claude: </span>
              {statusLine(task)}
            </p>
            <div className="flex flex-wrap gap-2">
              {task.status === "pending" && (
                <button className="btn-pill text-xs" onClick={() => startTask(task)}>
                  開始
                </button>
              )}
              {task.status === "paused" && (
                <button className="btn-pill text-xs" onClick={() => startTask(task)}>
                  再開
                </button>
              )}
              {task.status === "running" && (
                <button className="btn-pill-outline text-xs" onClick={() => pauseTask(task)}>
                  一時停止
                </button>
              )}
              {task.status !== "done" && (
                <button className="btn-pill-outline text-xs" onClick={() => completeTask(task)}>
                  完了にする
                </button>
              )}
              <button className="text-xs text-cream/40 hover:text-alert" onClick={() => deleteTask(task)}>
                取り消す
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
