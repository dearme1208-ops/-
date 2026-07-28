"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "@/lib/master";
import { formatClock, formatMsClock, jsWeekdayToApp, todayStr } from "@/lib/time";
import {
  getNotificationPermission,
  notify,
  requestNotificationPermission,
} from "@/lib/notifications";
import type { DailyTask, TimeSegment, Weekday } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import AddTaskDialog from "@/components/sections/AddTaskDialog";
import EditTaskDialog from "@/components/sections/EditTaskDialog";
import ManualFinishDialog from "@/components/sections/ManualFinishDialog";

const OVERRUN_REPROMPT_MS = 20 * 60 * 1000;

function segmentsAccumulatedMs(task: DailyTask, now: number): number {
  let total = task.accumulatedMs;
  const running = task.segments.find((s) => s.end === undefined);
  if (running) total += now - running.start;
  return total;
}

export default function TodaySection() {
  const date = todayStr();
  const [now, setNow] = useState(() => Date.now());
  const [weekday, setWeekday] = useState<Weekday>(() => jsWeekdayToApp(new Date()) ?? 1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [notifPermission, setNotifPermission] = useState<string>("default");
  const [overrunTask, setOverrunTask] = useState<DailyTask | null>(null);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);
  const [manualFinishTask, setManualFinishTaskTarget] = useState<DailyTask | null>(null);

  const tasks = useLiveQuery(
    () => db.dailyTasks.where("date").equals(date).sortBy("order"),
    [date]
  );
  const favorites = useLiveQuery(
    () => db.masterTasks.filter((t) => t.isFavorite).toArray(),
    []
  );

  useEffect(() => {
    setNotifPermission(getNotificationPermission());
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 予定超過チェック（通知 + 20分超過の画面確認）
  useEffect(() => {
    if (!tasks) return;
    for (const task of tasks) {
      if (task.status !== "running" || task.estimatedSeconds <= 0) continue;
      const elapsedMs = segmentsAccumulatedMs(task, now);
      const estMs = task.estimatedSeconds * 1000;
      if (elapsedMs > estMs && !task.notifiedOverrun) {
        notify("予定時間を超過しました", `${task.category} / ${task.name}`);
        db.dailyTasks.update(task.id, { notifiedOverrun: true });
      }
      const sinceDismiss = task.overrunPromptDismissedAt ? now - task.overrunPromptDismissedAt : Infinity;
      if (
        elapsedMs > estMs + OVERRUN_REPROMPT_MS &&
        (!task.overrunPromptShown || sinceDismiss > OVERRUN_REPROMPT_MS) &&
        !overrunTask
      ) {
        setOverrunTask(task);
      }
    }
  }, [now, tasks, overrunTask]);

  const nextTaskId = useMemo(() => {
    if (!tasks) return null;
    const next = tasks.find((t) => t.status === "pending" || t.status === "paused" || t.status === "running");
    return next?.id ?? null;
  }, [tasks]);

  // 想定時間から、このまま順番どおり進めた場合の各作業の終了予定時刻を計算する
  const projectedFinishByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    if (!tasks) return map;
    let cursor = now;
    for (const task of tasks) {
      if (task.status === "done" || task.estimatedSeconds <= 0) continue;
      if (task.status === "running") {
        const remainingMs = Math.max(0, task.estimatedSeconds * 1000 - segmentsAccumulatedMs(task, now));
        const finish = now + remainingMs;
        map.set(task.id, finish);
        cursor = Math.max(cursor, finish);
      } else if (task.status === "paused") {
        const remainingMs = Math.max(0, task.estimatedSeconds * 1000 - task.accumulatedMs);
        const finish = now + remainingMs;
        map.set(task.id, finish);
        cursor = Math.max(cursor, finish);
      } else {
        cursor += task.estimatedSeconds * 1000;
        map.set(task.id, cursor);
      }
    }
    return map;
  }, [tasks, now]);

  // 完了済みだけを最後に沈める。実行中/一時停止中/未着手はもとの順番のまま
  // （開始・一時停止のたびにカードが並び替わって誤タップを誘発しないようにするため）
  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks].sort((a, b) => {
      const doneDiff = Number(a.status === "done") - Number(b.status === "done");
      return doneDiff || a.order - b.order;
    });
  }, [tasks]);

  // 直近の「停止」時刻（完了した作業の終了時刻、または一時停止中の作業が
  // 一時停止した時刻のうち最新のもの）。さかのぼって開始/再開する際の起点にする
  const lastStopTime = useMemo(() => {
    if (!tasks) return null;
    const stops: number[] = [];
    for (const t of tasks) {
      if (t.status === "done" && t.endedAt) stops.push(t.endedAt);
      if (t.status === "paused") {
        const lastSeg = t.segments[t.segments.length - 1];
        if (lastSeg?.end) stops.push(lastSeg.end);
      }
    }
    return stops.length > 0 ? Math.max(...stops) : null;
  }, [tasks]);

  // 未計測時間: 最初の作業を始めてから今まで(または最後に完了した時刻まで)の
  // 経過時間から、実際に計測された合計時間を差し引いた「空白」の時間
  const untrackedSeconds = useMemo(() => {
    if (!tasks || tasks.length === 0) return 0;
    const startTimes = tasks.filter((t) => t.startedAt).map((t) => t.startedAt!);
    if (startTimes.length === 0) return 0;
    const windowStart = Math.min(...startTimes);
    const anyActive = tasks.some((t) => t.status === "running" || t.status === "pending" || t.status === "paused");
    const doneEnds = tasks.filter((t) => t.status === "done" && t.endedAt).map((t) => t.endedAt!);
    const windowEnd = anyActive ? now : doneEnds.length > 0 ? Math.max(...doneEnds) : now;
    const trackedMs = tasks.reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0);
    const windowMs = Math.max(0, windowEnd - windowStart);
    return Math.max(0, Math.round((windowMs - trackedMs) / 1000));
  }, [tasks, now]);

  async function generateFromTemplate() {
    const items = await db.templateItems.where("weekday").equals(weekday).sortBy("order");
    if (items.length === 0) {
      alert(`${WEEKDAY_LABELS[weekday]}曜日のテンプレートが空です。先に「曜日別テンプレート」で登録してください。`);
      return;
    }
    const existing = await db.dailyTasks.where("date").equals(date).toArray();
    if (existing.length > 0) {
      if (!confirm("本日の作業リストは既にあります。テンプレートから再生成すると、進行中の記録は失われます。よろしいですか?")) {
        return;
      }
      await db.dailyTasks.bulkDelete(existing.map((e) => e.id));
    }
    const newTasks: DailyTask[] = items.map((item, idx) => ({
      id: uid(),
      date,
      order: idx,
      masterTaskId: item.masterTaskId,
      category: item.category,
      name: item.name,
      estimatedSeconds: item.estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: false,
    }));
    await db.dailyTasks.bulkAdd(newTasks);
  }

  async function startTask(task: DailyTask, startAt: number = Date.now()) {
    const segments = [...task.segments, { start: startAt }];
    await db.dailyTasks.update(task.id, {
      segments,
      status: "running",
      startedAt: task.startedAt ?? startAt,
    });
  }

  async function deleteTask(task: DailyTask) {
    if (!confirm(`「${task.name}」を本日の作業リストから削除しますか?`)) return;
    await db.dailyTasks.delete(task.id);
  }

  async function pauseTask(task: DailyTask) {
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Date.now() } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs });
  }

  // 作業を完了として確定する。同日・同じマスタの実績が既にあれば合算する
  async function commitFinish(
    task: DailyTask,
    segments: TimeSegment[],
    accumulatedMs: number,
    startedAtOverride?: number
  ) {
    const seconds = Math.round(accumulatedMs / 1000);
    const nowMs = Date.now();
    const startedAt = startedAtOverride ?? task.startedAt ?? nowMs;
    await db.dailyTasks.update(task.id, {
      segments,
      status: "done",
      accumulatedMs,
      startedAt,
      endedAt: nowMs,
    });

    let masterTaskId = task.masterTaskId;
    if (!masterTaskId) {
      const master = await findOrCreateMasterTask(task.category, task.name, task.estimatedSeconds);
      masterTaskId = master.id;
    }

    const existing = await db.records
      .where("date")
      .equals(date)
      .filter((r) => r.masterTaskId === masterTaskId)
      .first();

    if (existing) {
      await db.records.update(existing.id, {
        seconds: existing.seconds + seconds,
        endedAt: nowMs,
      });
    } else {
      await db.records.add({
        id: uid(),
        date,
        category: task.category,
        name: task.name,
        masterTaskId,
        seconds,
        startedAt,
        endedAt: nowMs,
        excludedFromStats: false,
      });
    }

    await recomputeEstimateFromRecords(masterTaskId);
    if (overrunTask?.id === task.id) setOverrunTask(null);
  }

  async function finishTask(task: DailyTask) {
    let segments = task.segments;
    if (task.status === "running") {
      segments = task.segments.map((s, i) =>
        i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Date.now() } : s
      );
    }
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start), 0);
    await commitFinish(task, segments, accumulatedMs);
  }

  // 計測し忘れた場合に、実際の所要時間を直接入力して終了する
  async function manualFinish(task: DailyTask, manualSeconds: number) {
    if (manualSeconds <= 0) return;
    const nowMs = Date.now();
    const startedAt = nowMs - manualSeconds * 1000;
    const segments: TimeSegment[] = [{ start: startedAt, end: nowMs }];
    await commitFinish(task, segments, manualSeconds * 1000, startedAt);
  }

  async function addFavoriteAndStart(masterTaskId: string) {
    const master = await db.masterTasks.get(masterTaskId);
    if (!master) return;
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const id = uid();
    const task: DailyTask = {
      id,
      date,
      order: count,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
  }

  // 作業名を入力せずにすぐ計測を開始し、内容は後から編集する
  async function startTrouble() {
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const nowMs = Date.now();
    const task: DailyTask = {
      id: uid(),
      date,
      order: count,
      category: "トラブル対応",
      name: `トラブル ${formatClock(nowMs)}`,
      estimatedSeconds: 0,
      status: "running",
      segments: [{ start: nowMs }],
      accumulatedMs: 0,
      startedAt: nowMs,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
  }

  async function enableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
  }

  return (
    <div className="space-y-4">
      {(!tasks || tasks.length === 0) && (
        <div className="panel p-5">
          <h2 className="mb-3 font-display text-lg font-bold">本日の作業リストを生成</h2>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value) as Weekday)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
            >
              {([1, 2, 3, 4, 5] as Weekday[]).map((w) => (
                <option key={w} value={w}>
                  {WEEKDAY_LABELS[w]}曜日
                </option>
              ))}
            </select>
            <button className="btn-pill" onClick={generateFromTemplate}>
              テンプレートから生成
            </button>
          </div>
        </div>
      )}

      {notifPermission !== "granted" && notifPermission !== "unsupported" && (
        <div className="panel flex items-center justify-between p-4">
          <p className="text-sm text-cream/80">予定超過を通知でお知らせできます。</p>
          <button className="btn-pill-outline text-sm" onClick={enableNotifications}>
            通知を許可
          </button>
        </div>
      )}

      {favorites && favorites.length > 0 && (
        <div className="panel p-4">
          <h3 className="mb-2 font-display text-sm font-bold text-cream/80">★ お気に入り（ワンタップで追加+開始）</h3>
          <div className="flex flex-wrap gap-2">
            {favorites.map((f) => (
              <button
                key={f.id}
                onClick={() => addFavoriteAndStart(f.id)}
                className="rounded-full border border-cream/30 bg-ink px-4 py-2 text-sm text-cream hover:bg-cream/10"
              >
                ★ {f.category} / {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">{date} の作業リスト</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill-danger text-sm" onClick={startTrouble}>
            ⚡ トラブル発生
          </button>
          <button className="btn-pill-outline text-sm" onClick={() => setShowAddDialog(true)}>
            + 突発作業を追加
          </button>
          {tasks && tasks.length > 0 && (
            <button className="btn-pill-outline text-sm" onClick={generateFromTemplate}>
              再生成
            </button>
          )}
        </div>
      </div>

      {untrackedSeconds > 0 && (
        <div className="panel flex items-center justify-between p-3">
          <span className="text-sm text-cream/70">未計測時間</span>
          <span className="font-display text-lg font-bold text-alert tabular-nums">
            {formatMsClock(untrackedSeconds * 1000)}
          </span>
        </div>
      )}

      <div className="space-y-3">
        {sortedTasks.map((task) => {
          const elapsedMs = segmentsAccumulatedMs(task, now);
          const estMs = task.estimatedSeconds * 1000;
          const overEstimate = task.estimatedSeconds > 0 && elapsedMs > estMs;
          const isNext = task.id === nextTaskId;
          const cardClass =
            task.status === "running"
              ? "border-cream ring-2 ring-cream/50 bg-cream/[0.04]"
              : task.status === "paused"
                ? "border-cream/40"
                : isNext
                  ? "border-cream/60 ring-1 ring-cream/40"
                  : "";
          return (
            <div
              key={task.id}
              className={`panel p-4 ${cardClass} ${task.status === "done" ? "opacity-50" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-cream/60">
                    <span className="flex items-center gap-1">
                      {task.status === "running" && (
                        <span className="flex items-center gap-1 font-bold text-cream">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-alert" />
                          計測中
                        </span>
                      )}
                      {task.status === "paused" && <span className="text-cream/70">‖ 一時停止中</span>}
                      {task.category} {task.isSpontaneous && <span className="ml-1 text-alert">突発</span>}
                      {isNext && task.status === "pending" && <span className="ml-2 text-cream">▶ 次の作業</span>}
                    </span>
                    {task.status !== "done" && (
                      <>
                        <button
                          onClick={() => setEditingTask(task)}
                          className="text-cream/40 hover:text-cream"
                          aria-label="編集"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => deleteTask(task)}
                          className="text-cream/40 hover:text-alert"
                          aria-label="削除"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                  <div className="font-display text-base font-bold">{task.name}</div>
                  <div className="text-xs text-cream/50">
                    予定 {formatMsClock(estMs)}
                    {projectedFinishByTaskId.has(task.id) && (
                      <span className="ml-2 text-cream/70">
                        終了予定 {formatClock(projectedFinishByTaskId.get(task.id)!)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-display text-2xl font-bold tabular-nums ${overEstimate ? "text-alert" : "text-cream"}`}>
                    {formatMsClock(elapsedMs)}
                  </div>
                  <div className="mt-1 flex flex-wrap justify-end gap-2">
                    {task.status === "pending" && (
                      <>
                        <button className="btn-pill text-xs" onClick={() => startTask(task)}>
                          開始
                        </button>
                        {lastStopTime && (
                          <button
                            className="btn-pill-outline text-xs"
                            onClick={() => startTask(task, lastStopTime)}
                          >
                            さかのぼって開始
                          </button>
                        )}
                        <button
                          className="btn-pill-outline text-xs"
                          onClick={() => setManualFinishTaskTarget(task)}
                        >
                          手動で記録
                        </button>
                      </>
                    )}
                    {task.status === "running" && (
                      <>
                        <button className="btn-pill-outline text-xs" onClick={() => pauseTask(task)}>
                          一時停止
                        </button>
                        <button className="btn-pill text-xs" onClick={() => finishTask(task)}>
                          終了
                        </button>
                      </>
                    )}
                    {task.status === "paused" && (
                      <>
                        <button className="btn-pill-outline text-xs" onClick={() => startTask(task)}>
                          再開
                        </button>
                        {lastStopTime && (
                          <button
                            className="btn-pill-outline text-xs"
                            onClick={() => startTask(task, lastStopTime)}
                          >
                            さかのぼって再開
                          </button>
                        )}
                        <button className="btn-pill text-xs" onClick={() => finishTask(task)}>
                          終了
                        </button>
                        <button
                          className="btn-pill-outline text-xs"
                          onClick={() => setManualFinishTaskTarget(task)}
                        >
                          手動で記録
                        </button>
                      </>
                    )}
                    {task.status === "done" && <span className="text-xs text-cream/50">完了</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showAddDialog && <AddTaskDialog date={date} onClose={() => setShowAddDialog(false)} />}

      {editingTask && <EditTaskDialog task={editingTask} onClose={() => setEditingTask(null)} />}

      {manualFinishTask && (
        <ManualFinishDialog
          taskName={manualFinishTask.name}
          onClose={() => setManualFinishTaskTarget(null)}
          onConfirm={async (seconds) => {
            await manualFinish(manualFinishTask, seconds);
            setManualFinishTaskTarget(null);
          }}
        />
      )}

      {overrunTask && (
        <Modal title="まだこの作業中ですか?">
          <p className="mb-4 text-sm text-cream/80">
            「{overrunTask.name}」が予定時間を大幅に超過しています。
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="btn-pill-outline text-sm"
              onClick={async () => {
                await db.dailyTasks.update(overrunTask.id, {
                  overrunPromptShown: true,
                  overrunPromptDismissedAt: Date.now(),
                });
                setOverrunTask(null);
              }}
            >
              続けている
            </button>
            <button
              className="btn-pill text-sm"
              onClick={async () => {
                await finishTask(overrunTask);
              }}
            >
              終了する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
