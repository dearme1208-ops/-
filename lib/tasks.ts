import { db, uid } from "./db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "./master";
import { diffHmToSeconds } from "./time";
import type { DailyTask } from "./types";
import type { ScheduleRow } from "./scheduleCsv";

// 一時停止中/完了時点で確定している合計時間（「時間を加算」による手動加算分を含む。
// 計測中セグメントの経過分は含まない）
export function baseAccumulatedMs(task: DailyTask): number {
  return task.accumulatedMs + (task.manualAdjustmentMs ?? 0);
}

// 現時点での合計時間（計測中なら現在進行中のセグメントの経過分も含む）
export function segmentsAccumulatedMs(task: DailyTask, now: number): number {
  let total = baseAccumulatedMs(task);
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
// TodaySection内のcommitFinishと同じ内容だが、UI状態を持たない箇所からも呼べるよう独立させたもの。
// endAtMsを指定すると、計測中セグメントをその時刻で打ち切る（例: 日をまたいで放置された
// 作業を、実際の停止時刻が分からないため元の日の24:00で打ち切って確定する場合など）。
// 省略時は現在時刻で打ち切る（通常の完了操作と同じ挙動）
export async function finishDailyTask(task: DailyTask, endAtMs?: number): Promise<void> {
  const nowMs = Date.now();
  const closeAt = endAtMs ?? nowMs;
  let segments = task.segments;
  if (task.status === "running") {
    segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Math.max(s.start, closeAt) } : s
    );
  }
  const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
  const seconds = Math.round(accumulatedMs / 1000);
  const startedAt = task.startedAt ?? closeAt;

  await db.dailyTasks.update(task.id, {
    segments,
    status: "done",
    accumulatedMs,
    startedAt,
    endedAt: closeAt,
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
    .filter((r) => r.masterTaskId === masterTaskId && r.projectId === task.projectId && r.stageId === task.stageId)
    .first();

  if (existing) {
    await db.records.update(existing.id, {
      seconds: existing.seconds + seconds,
      endedAt: closeAt,
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
      endedAt: closeAt,
      excludedFromStats: false,
      projectId: task.projectId,
      stageId: task.stageId,
      isTrouble: task.isTrouble,
    });
  }

  await recomputeEstimateFromRecords(masterTaskId);
}

// 日をまたいで「計測中」「一時停止中」のまま放置されたタスクを探す（statusが running/paused で、
// dateが本日より前のもの）。本日の作業タブは日付ごとに絞り込んで表示するため、これらは
// 画面上からは見えなくなる一方、running のものは内部的に経過時間が計測され続けてしまう
export async function findOrphanedDailyTasks(todayDateStr: string): Promise<DailyTask[]> {
  return db.dailyTasks
    .where("date")
    .below(todayDateStr)
    .filter((t) => t.status === "running" || t.status === "paused")
    .toArray();
}

// 放置されていた作業を、実際の停止時刻が分からないため元の日の24:00(23:59:59)で打ち切って完了にする
export async function finishOrphanedDailyTask(task: DailyTask): Promise<void> {
  const dayEndMs = new Date(task.date + "T23:59:59").getTime();
  await finishDailyTask(task, dayEndMs);
}

// 放置されていた作業を、今日の作業として引き継いで計測を続ける（日付を今日に付け替えるのみ。
// 計測中のセグメントはそのままなので、経過時間の計測は途切れず続く）
export async function moveDailyTaskToToday(task: DailyTask, todayDateStr: string): Promise<void> {
  const count = (await db.dailyTasks.where("date").equals(todayDateStr).toArray()).length;
  await db.dailyTasks.update(task.id, { date: todayDateStr, order: count });
}

// カレンダー予定などをCSVから「本日の作業」に取り込む。scheduledTimeを持つ
// 未着手タスクとして登録し、その時刻になったら自動的に差し込み開始される
export async function importScheduleRows(rows: ScheduleRow[]): Promise<{ created: number }> {
  let created = 0;
  const countByDate = new Map<string, number>();
  for (const row of rows) {
    if (!countByDate.has(row.date)) {
      countByDate.set(row.date, (await db.dailyTasks.where("date").equals(row.date).toArray()).length);
    }
    const order = countByDate.get(row.date)!;
    countByDate.set(row.date, order + 1);

    const estimatedSeconds = row.endTime ? diffHmToSeconds(row.startTime, row.endTime) : 0;
    const master = await findOrCreateMasterTask(row.category, row.name, estimatedSeconds);
    const task: DailyTask = {
      id: uid(),
      date: row.date,
      order,
      masterTaskId: master.id,
      category: row.category,
      name: row.name,
      estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
      scheduledTime: row.startTime,
      note: row.notes,
    };
    await db.dailyTasks.add(task);
    created++;
  }
  return { created };
}
