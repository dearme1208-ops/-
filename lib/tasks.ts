import { db, uid } from "./db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "./master";
import { diffHmToSeconds } from "./time";
import type { DailyTask, MasterTask, TimeSegment, WorkRecord } from "./types";
import type { ScheduleRow } from "./scheduleCsv";
import { fireCompletionPopup } from "./completionPopup";

// 同日・同じ作業の実績が既にある場合に、実働区間(segments)を合算する。
// 既存の実績にsegmentsが無い(この機能追加より前に作られた記録など、区間が不明な記録)場合は、
// 既存のstartedAt〜endedAtをひとつの区間とみなして引き継ぐ(それ以前の挙動を再現する近似値)
export function mergeRecordSegments(existing: WorkRecord, newSegments: TimeSegment[]): TimeSegment[] {
  const prev = existing.segments ?? [{ start: existing.startedAt, end: existing.endedAt }];
  return [...prev, ...newSegments].sort((a, b) => a.start - b.start);
}

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

// マスタの想定時間から、その日の各作業インスタンスの「残り想定時間」を求める。
// TodaySection内の予測ロジックと同じ考え方を、演出テーマの警告演出など
// TodaySectionの外からも使えるよう純粋関数として切り出したもの
export function computePredictedSecondsByTaskId(
  tasks: DailyTask[],
  masterTasks: MasterTask[],
  now: number
): Map<string, number> {
  const map = new Map<string, number>();
  const groups = new Map<string, DailyTask[]>();
  for (const t of tasks) {
    const key = `${t.category}::${t.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.order - b.order);
    const master = sorted[0]?.masterTaskId ? masterTasks.find((m) => m.id === sorted[0].masterTaskId) : undefined;
    const rawPredicted = master?.estimatedSeconds ?? sorted[0]?.estimatedSeconds ?? 0;
    let cumulative = 0;
    for (const t of sorted) {
      const remaining = rawPredicted - cumulative;
      map.set(t.id, remaining > 0 ? remaining : rawPredicted);
      cumulative += segmentsAccumulatedMs(t, now) / 1000;
    }
  }
  return map;
}

// 現在計測中、かつ想定時間を超過している作業のIDを返す
export function computeRunningOverrunTaskIds(
  tasks: DailyTask[],
  predictedSecondsByTaskId: Map<string, number>,
  now: number
): string[] {
  return tasks
    .filter((t) => {
      if (t.status !== "running") return false;
      const predSec = predictedSecondsByTaskId.get(t.id) ?? 0;
      if (predSec <= 0) return false;
      return segmentsAccumulatedMs(t, now) / 1000 > predSec;
    })
    .map((t) => t.id);
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
    stoppedAt: nowMs,
    isProvisional: false,
  });

  // 仮計測(まだ何の作業か確定していない未計測時間)は「完了した作業」として
  // 可視化する対象ではないため、ポップアップは出さない
  if (!task.isProvisional) {
    fireCompletionPopup({ category: task.category, name: task.name, seconds, estimatedSeconds: task.estimatedSeconds });
  }

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
    // endAtMsで打ち切り時刻を過去方向に指定した場合(放置作業の復旧時など)でも、
    // 既存の実績の終了時刻をそれより後退させてしまわないようにする
    await db.records.update(existing.id, {
      seconds: existing.seconds + seconds,
      endedAt: Math.max(existing.endedAt, closeAt),
      isTrouble: existing.isTrouble || task.isTrouble,
      segments: mergeRecordSegments(existing, segments),
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
      segments,
    });
  }

  await recomputeEstimateFromRecords(masterTaskId);
}

// 「実績編集」タブでの実績(WorkRecord)の開始/終了時刻の手動編集は、その実績の元になった
// dailyTasksの側には反映されない独立したデータだった。そのため編集後も「本日の作業」タブの
// 「前の作業の終了時刻から開始/再開する」といった提案が編集前の古い時刻のまま出てしまう
// 問題があった。編集した境界(開始/終了)に対応するdailyTasksのインスタンス(同じ日付・
// masterTaskId・案件/段階の完了済み作業のうち、開始側なら一番早いもの・終了側なら一番遅いもの)
// を探し、そちらのstartedAt/endedAtも合わせて更新する。対応するインスタンスが見つからない
// (CSVインポート等、dailyTasks由来ではない実績)場合は何もしない
export async function syncDailyTaskBoundaryFromRecord(
  record: Pick<WorkRecord, "date" | "masterTaskId" | "projectId" | "stageId">,
  edge: "start" | "end",
  newTime: number
): Promise<void> {
  if (!record.masterTaskId) return;
  const candidates = (await db.dailyTasks.where("date").equals(record.date).toArray())
    .filter(
      (t) =>
        t.status === "done" &&
        t.masterTaskId === record.masterTaskId &&
        (t.projectId ?? null) === (record.projectId ?? null) &&
        (t.stageId ?? null) === (record.stageId ?? null)
    )
    .sort((a, b) => a.order - b.order);
  if (candidates.length === 0) return;
  const target = edge === "start" ? candidates[0] : candidates[candidates.length - 1];

  const segments =
    target.segments.length > 0
      ? target.segments.map((s, i) =>
          edge === "start" ? (i === 0 ? { ...s, start: newTime } : s) : i === target.segments.length - 1 ? { ...s, end: newTime } : s
        )
      : [edge === "start" ? { start: newTime, end: target.endedAt ?? newTime } : { start: target.startedAt ?? newTime, end: newTime }];
  if (segments.some((s) => s.end !== undefined && s.end <= s.start)) return;

  await db.dailyTasks.update(target.id, {
    ...(edge === "start" ? { startedAt: newTime } : { endedAt: newTime }),
    segments,
    accumulatedMs: segments.reduce((sum, s) => sum + ((s.end ?? newTime) - s.start), 0),
  });
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

// 放置されていた作業を、確認している「今この瞬間」まで計測して元の日(task.date)の実績として完了する。
// 睡眠など日をまたいで実際に継続していた作業を、24:00で打ち切らず起きた時点までまとめて
// 前日実績にしたい場合に使う(finishDailyTaskはendAtMs省略時に現在時刻を使う点を利用している)
export async function finishOrphanedDailyTaskNow(task: DailyTask): Promise<void> {
  await finishDailyTask(task);
}

// 放置されていた作業を、実績に一切反映せずに削除する(記録せず取り消したい場合)
export async function discardOrphanedDailyTask(task: DailyTask): Promise<void> {
  await db.dailyTasks.delete(task.id);
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
