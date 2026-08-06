import { db, uid } from "./db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "./master";
import type { DailyTask } from "./types";

export function segmentsAccumulatedMs(task: DailyTask, now: number): number {
  let total = task.accumulatedMs;
  const running = task.segments.find((s) => s.end === undefined);
  if (running) total += now - running.start;
  return total;
}

// 同日中に同じ大項目・詳細作業名の作業が既に登録されていた場合、直近のインスタンス
// 自身の想定時間からその実績分を差し引いた「残りの想定時間」を返す（早く終わって
// いれば繰り越し、使い切っていれば0）。まだ本日登録されていなければマスタの
// 想定時間をそのまま返す。
// ※ マスタのestimatedSecondsは作業完了のたびに実績から再計算され得るため、
//   その場ではなく各インスタンス自身が生成時に持っていたestimatedSecondsを
//   基準に繰り越しを計算する（そうしないと直前に完了した実績の影響で
//   基準そのものがずれてしまう）
export async function computeRemainingEstimatedSeconds(
  date: string,
  category: string,
  name: string,
  masterEstimatedSeconds: number
): Promise<number> {
  const sameDay = await db.dailyTasks
    .where("date")
    .equals(date)
    .filter((t) => !t.isProvisional && t.category === category && t.name === name)
    .toArray();
  if (sameDay.length === 0) return masterEstimatedSeconds;
  const last = sameDay.reduce((a, b) => (b.order > a.order ? b : a));
  const spentSeconds = Math.round(last.accumulatedMs / 1000);
  return Math.max(0, last.estimatedSeconds - spentSeconds);
}

// 実行中/一時停止中の作業をその場で完了として確定する（アプリを閉じる際の一括完了などに使用）。
// TodaySection内のcommitFinishと同じ内容だが、UI状態を持たない箇所からも呼べるよう独立させたもの
export async function finishDailyTask(task: DailyTask): Promise<void> {
  let segments = task.segments;
  if (task.status === "running") {
    segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Date.now() } : s
    );
  }
  const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start), 0);
  const seconds = Math.round(accumulatedMs / 1000);
  const nowMs = Date.now();
  const startedAt = task.startedAt ?? nowMs;

  await db.dailyTasks.update(task.id, {
    segments,
    status: "done",
    accumulatedMs,
    startedAt,
    endedAt: nowMs,
    isProvisional: false,
  });

  let masterTaskId = task.masterTaskId;
  if (!masterTaskId) {
    const master = await findOrCreateMasterTask(task.category, task.name, task.estimatedSeconds);
    masterTaskId = master.id;
  }

  const existing = await db.records
    .where("date")
    .equals(task.date)
    .filter((r) => r.masterTaskId === masterTaskId && r.projectId === task.projectId)
    .first();

  if (existing) {
    await db.records.update(existing.id, {
      seconds: existing.seconds + seconds,
      endedAt: nowMs,
      isTrouble: existing.isTrouble || task.isTrouble,
    });
  } else {
    await db.records.add({
      id: uid(),
      date: task.date,
      category: task.category,
      name: task.name,
      masterTaskId,
      seconds,
      startedAt,
      endedAt: nowMs,
      excludedFromStats: false,
      projectId: task.projectId,
      isTrouble: task.isTrouble,
    });
  }

  await recomputeEstimateFromRecords(masterTaskId);
}
