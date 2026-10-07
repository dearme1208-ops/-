import { db, uid } from "./db";
import { closeRunningNotification } from "./notifications";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "./master";
import { diffHmToSeconds } from "./time";
import type { DailyTask, MasterTask, TimeSegment, TodoTask, WorkRecord } from "./types";
import { buildWorkContextSources, workNameWithContext } from "./workContext";
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

// 実績(WorkRecord)の帰属先。同じ日・同じ作業マスタでも、案件・段階・ToDo・手段のどれかが
// 違えば別の実績として持つ(合算してしまうと、案件/ToDo別・手段別の集計が先に記録された側へ
// 丸ごと寄ってしまうため)。undefined/null/空文字は「未設定」として同一視する
export interface RecordAttribution {
  projectId?: string;
  stageId?: string;
  todoTaskId?: string;
  method?: string;
}

function sameAttr(a: string | undefined | null, b: string | undefined | null): boolean {
  return (a || undefined) === (b || undefined);
}

export function sameAttribution(a: RecordAttribution, b: RecordAttribution): boolean {
  return (
    sameAttr(a.projectId, b.projectId) &&
    sameAttr(a.stageId, b.stageId) &&
    sameAttr(a.todoTaskId, b.todoTaskId) &&
    sameAttr(a.method?.trim(), b.method?.trim())
  );
}

export function recordMatches(r: WorkRecord, masterTaskId: string, attr: RecordAttribution): boolean {
  return r.masterTaskId === masterTaskId && sameAttribution(r, attr);
}

// 作業インスタンスの完了分を合算すべき、同日・同じ帰属先の既存実績を探す
export async function findMergeTargetRecord(
  date: string,
  masterTaskId: string,
  attr: RecordAttribution
): Promise<WorkRecord | undefined> {
  return db.records
    .where("date")
    .equals(date)
    .filter((r) => recordMatches(r, masterTaskId, attr))
    .first();
}

export interface FinishDailyTaskOptions {
  /** 計測中の区間を閉じる時刻。省略時は現在時刻(止め忘れ・放置の打ち切り時に指定する) */
  endAtMs?: number;
  /** 区間を呼び出し側で組み立て済みの場合(所要時間を直接入力する「手動で記録」など) */
  segments?: TimeSegment[];
  startedAt?: number;
}

// 作業インスタンスを完了として確定し、実績(WorkRecord)へ反映する。完了操作はすべて
// (本日の作業タブ・各テーマ画面・統合ボード・放置作業の後処理)ここを通す。
// 経路ごとに別実装だった頃は、「時間を加算」分や兼務タグが一部の経路で落ちる、
// 終了時刻が実際の停止時刻でなく操作した時刻になる、といった食い違いがあった
// 戻り値: 実際に完了させたか(既に別の操作で完了済みだった場合はfalse)
export async function finishDailyTask(task: DailyTask, endAtOrOptions?: number | FinishDailyTaskOptions): Promise<boolean> {
  const opts: FinishDailyTaskOptions =
    typeof endAtOrOptions === "number" ? { endAtMs: endAtOrOptions } : (endAtOrOptions ?? {});
  const nowMs = Date.now();
  const closeAt = opts.endAtMs ?? nowMs;
  let segments = opts.segments ?? task.segments;
  if (!opts.segments && task.status === "running") {
    segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Math.max(s.start, closeAt) } : s
    );
  }
  // 一度完了した作業を「続きから」再開した場合、前回完了時までの分は既に実績へ反映済み。
  // 今回新たに増えた区間と「時間を加算」分だけを実績に足し、作業全体の合計は
  // 反映済み分に今回分を積み上げて求める(前回の加算分が区間の再集計で消えないように)
  const prevRecordedMs = opts.segments ? 0 : (task.recordedMs ?? 0);
  const prevSegmentCount = opts.segments ? 0 : (task.recordedSegmentCount ?? 0);
  const newSegmentsMs = segments
    .slice(prevSegmentCount)
    .reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
  // 「時間を加算」で足した分は区間には現れないため、ここで合計に織り込む
  // (区間を呼び出し側が直接組み立てた場合は、その区間の長さが所要時間そのもの)
  const workedMs = newSegmentsMs + (opts.segments ? 0 : (task.manualAdjustmentMs ?? 0));
  const accumulatedMs = prevRecordedMs + workedMs;
  const seconds = Math.round(workedMs / 1000);
  const startedAt = opts.startedAt ?? task.startedAt ?? segments[0]?.start ?? closeAt;
  // 一時停止済み(=区間がすべて閉じている)の作業では、完了操作をした時刻ではなく
  // 実際の最後の区間の終了時刻をendedAtにする(定時以降の集計などが、実際には作業して
  // いない時間帯を参照しないように)
  const endedAt = segments.length > 0 ? (segments[segments.length - 1].end ?? closeAt) : closeAt;

  // 「終了」の連打や、同じアプリを複数のタブで開いている場合に、同じ作業の完了が
  // 並行して2回走ると実績が二重に加算されていた。DB上の最新の状態を確かめてから
  // 完了にする処理を1つのトランザクションで行い、先に完了済みになっていれば何もしない
  // (呼び出し側が完了済みの作業を渡した場合は、意図した再確定として通常どおり処理する)
  // 「元に戻す」で完了前の状態へ戻すため、書き換える前の作業を控えておく
  let taskBefore: DailyTask | undefined;
  const claimed = await db.transaction("rw", db.dailyTasks, async () => {
    const current = await db.dailyTasks.get(task.id);
    if (current && current.status === "done" && task.status !== "done") return false;
    taskBefore = current;
    await db.dailyTasks.update(task.id, {
      segments,
      status: "done",
      accumulatedMs,
      // 手動加算分はaccumulatedMsへ織り込み済み。残すとbaseAccumulatedMsで二重に数えてしまう
      manualAdjustmentMs: 0,
      recordedMs: accumulatedMs,
      recordedSegmentCount: segments.length,
      startedAt,
      endedAt,
      // 実際にこの完了操作を行った時刻。「直近に何かを止めた時刻」の判定に使うため、
      // 終了時刻をさかのぼって指定した場合でも現在時刻のままにする
      stoppedAt: nowMs,
      isProvisional: false,
    });
    return true;
  });
  if (!claimed) return false;
  // どの画面・どの経路で終えても、スマホの通知に残っている「計測中」を消す
  void closeRunningNotification();

  let masterTaskId = task.masterTaskId;
  if (!masterTaskId) {
    const master = await findOrCreateMasterTask(task.category, task.name, task.estimatedSeconds);
    masterTaskId = master.id;
  }

  const existing = await findMergeTargetRecord(task.date, masterTaskId, task);
  // 「元に戻す」用: 合算先の実績の元の値、または新しく作った実績のID
  const recordBefore = existing ? { ...existing } : undefined;
  let createdRecordId: string | undefined;

  if (existing) {
    await db.records.update(existing.id, {
      seconds: existing.seconds + seconds,
      startedAt: Math.min(existing.startedAt, startedAt),
      // 終了時刻をさかのぼって指定した場合でも、既存の実績の終了時刻を後退させない
      endedAt: Math.max(existing.endedAt, endedAt),
      isTrouble: existing.isTrouble || task.isTrouble,
      ...(task.secondaryProjectIds ? { secondaryProjectIds: task.secondaryProjectIds } : {}),
      segments: mergeRecordSegments(existing, segments),
    });
  } else {
    createdRecordId = uid();
    await db.records.add({
      id: createdRecordId,
      date: task.date,
      category: task.category,
      name: task.name,
      masterTaskId,
      seconds,
      startedAt,
      endedAt,
      excludedFromStats: false,
      projectId: task.projectId,
      stageId: task.stageId,
      todoTaskId: task.todoTaskId,
      isTrouble: task.isTrouble,
      method: task.method?.trim() || undefined,
      secondaryProjectIds: task.secondaryProjectIds,
      segments,
    });
  }

  await recomputeEstimateFromRecords(masterTaskId);

  // 仮計測(まだ何の作業か確定していない未計測時間)は「完了した作業」として
  // 可視化する対象ではないため、ポップアップは出さない
  if (!task.isProvisional) {
    // 案件の段階・ToDoのサブタスクから追加した作業は「案件名 › 作業名」で出す(lib/workContext.ts)
    const project = task.projectId ? await db.projects.get(task.projectId) : undefined;
    const todo = task.todoTaskId ? await db.todoTasks.get(task.todoTaskId) : undefined;
    const parentTodo = todo?.parentTaskId ? await db.todoTasks.get(todo.parentTaskId) : undefined;
    const finalMasterId = masterTaskId;
    const before = taskBefore;
    fireCompletionPopup({
      category: task.category,
      name: workNameWithContext(task, buildWorkContextSources(project ? [project] : [], [todo, parentTodo].filter((t): t is TodoTask => !!t))),
      seconds: Math.round(accumulatedMs / 1000),
      estimatedSeconds: task.estimatedSeconds,
      // 押し間違えた「終了」を、完了前の状態(計測中なら計測中のまま)へ戻す
      undo: before ? () => undoFinishDailyTask(before, finalMasterId, recordBefore, createdRecordId) : undefined,
      // 次にやる作業をそのまま始められるようにする(トラブル対応など、終えると元の作業へ自動で
      // 戻るものは出さない)
      next: task.resumeTaskIds?.length ? undefined : await pickNextDailyTask(task.date, task.id),
    });
  }
  return true;
}

/**
 * 作業を終えた直後に「次はこれ」として出す作業を選ぶ。ほかに計測中の作業があれば出さない。
 *  1. 予定の時刻が今から90分以内の作業(近い順)
 *  2. 未着手の作業(並び順)
 *  3. 一時停止中の作業(最後に止めたもの)
 */
export async function pickNextDailyTask(
  date: string,
  finishedId: string,
  nowMs: number = Date.now()
): Promise<{ id: string; name: string; hint: string; start: () => Promise<void> } | undefined> {
  const all = await db.dailyTasks.where("date").equals(date).toArray();
  if (all.some((t) => t.status === "running" && t.id !== finishedId && !t.isProvisional)) return undefined;
  const open = all.filter((t) => t.id !== finishedId && !t.isProvisional && !t.isTrouble);
  const now = new Date(nowMs);
  const nowHm = now.getHours() * 60 + now.getMinutes();
  const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const pending = open.filter((t) => t.status === "pending");
  const scheduled = pending
    .filter((t) => t.scheduledTime && hm(t.scheduledTime) - nowHm <= 90 && hm(t.scheduledTime) - nowHm >= -30)
    .sort((a, b) => hm(a.scheduledTime!) - hm(b.scheduledTime!))[0];
  // 予定の時刻がまだ先の作業は「次」にしない(その時刻になれば自動で始まる)
  const firstPending = pending.filter((t) => !t.scheduledTime || hm(t.scheduledTime) <= nowHm + 90).sort((a, b) => a.order - b.order)[0];
  const lastPaused = open.filter((t) => t.status === "paused").sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0))[0];
  const next = scheduled ?? firstPending ?? lastPaused;
  if (!next) return undefined;
  const hint = next === scheduled ? `予定 ${next.scheduledTime}` : next.status === "paused" ? "続きから" : "次の作業";
  return { id: next.id, name: next.name, hint, start: () => startDailyTaskNow(next.id) };
}

/** 未着手なら今から始め、一時停止中なら続きから再開する(「次はこれ」から1タップで始める用) */
export async function startDailyTaskNow(id: string, nowMs: number = Date.now()): Promise<void> {
  await db.transaction("rw", db.dailyTasks, async () => {
    const t = await db.dailyTasks.get(id);
    if (!t || t.status === "running" || t.status === "done") return;
    await db.dailyTasks.update(id, {
      status: "running",
      segments: [...t.segments, { start: nowMs }],
      startedAt: t.startedAt ?? nowMs,
    });
  });
}

/**
 * 完了を取り消して、完了前の状態へ戻す(完了ポップアップの「元に戻す」)。
 * 作業は完了前の状態(計測中・一時停止中)に戻し、実績は合算前の値に戻すか、
 * この完了で新しく作ったものなら消す。想定時間も実績から計算し直す。
 * 計測中に戻した作業は区間が開いたままなので、完了していた間の時間も計測に含まれる
 * (押し間違いをすぐ戻す使い方を想定しているため)
 */
export async function undoFinishDailyTask(
  taskBefore: DailyTask,
  masterTaskId: string,
  recordBefore: WorkRecord | undefined,
  createdRecordId: string | undefined
): Promise<void> {
  await db.transaction("rw", db.dailyTasks, db.records, async () => {
    await db.dailyTasks.put(taskBefore);
    if (recordBefore) await db.records.put(recordBefore);
    else if (createdRecordId) await db.records.delete(createdRecordId);
  });
  await recomputeEstimateFromRecords(masterTaskId);
}

/**
 * 計測中の作業を一時停止する。どの画面からの一時停止もこれを通す。
 * 合計(accumulatedMs)は、それまでの合計に今閉じた区間の長さを足して求める。以前は各画面が
 * 区間の長さを全部足し直していたため、一度完了してから「続きから」再開した作業では、前回の完了時に
 * 合計へ織り込んだ「時間を加算」の分が、一時停止のたびに消えていた
 */
export async function pauseDailyTask(task: DailyTask, at: number = Date.now()): Promise<void> {
  const cur = (await db.dailyTasks.get(task.id)) ?? task;
  const openIdx = cur.segments.findIndex((s) => s.end === undefined);
  if (openIdx < 0 || cur.status !== "running") return;
  const open = cur.segments[openIdx];
  const end = Math.max(open.start, at);
  const segments = cur.segments.map((s, i) => (i === openIdx ? { ...s, end } : s));
  await db.dailyTasks.update(cur.id, { segments, status: "paused", accumulatedMs: cur.accumulatedMs + (end - open.start), stoppedAt: at });
  void closeRunningNotification();
}

/**
 * 計測中の仮計測(未計測の時間を自動で測っているもの)を一時停止する。
 * 本日の作業以外の画面(禅・Claude・ターミナルなど)から作業を始めた時に、仮計測と二重に
 * 計測しないよう呼ぶ。止めた仮計測は本日の作業で、あとから作業に割り当てられる
 */
export async function pauseRunningProvisional(date: string, at: number = Date.now()): Promise<void> {
  const running = await db.dailyTasks.where("date").equals(date).filter((t) => !!t.isProvisional && t.status === "running").toArray();
  for (const t of running) await pauseDailyTask(t, at);
}

/**
 * 作業の実測は同時に1つだけにする。作業を始める入口は本日の作業・お気に入り・予定・
 * 時間割・ショートカット・各モードの画面などに多数あるため、入口ごとではなく、
 * 計測中の作業が2つ以上になったのを見つけた時点でここでまとめて直す。
 *  - 今日の作業(仮計測を含む)は、いちばん後から計測を始めたものだけを残し、ほかはその
 *    開始時刻で一時停止する(止める時刻を今にすると時間が重なって二重に数えるため)。
 *    仮計測が止まった場合は、本日の作業であとから作業に割り当てられる
 *  - 前日以前から計測中のまま残っている作業(睡眠など)は、今日の作業を計測し始めた時刻で
 *    一時停止する。仮計測が始まっただけでは止めない(夜中の未計測で睡眠が切れないように)
 * 一時停止した作業を返す
 */
export async function enforceSingleRunning(today: string): Promise<DailyTask[]> {
  return db.transaction("rw", db.dailyTasks, async () => {
    const openStart = (t: DailyTask) => t.segments.find((s) => s.end === undefined)?.start ?? 0;
    const running = await db.dailyTasks.where("status").equals("running").toArray();
    const todays = running
      .filter((t) => t.date === today)
      // 同じ時刻なら仮計測より本来の作業を残す
      .sort((a, b) => openStart(b) - openStart(a) || Number(!!a.isProvisional) - Number(!!b.isProvisional) || b.order - a.order);
    const paused: DailyTask[] = [];
    const [keep, ...others] = todays;
    for (const t of others) {
      await pauseDailyTask(t, openStart(keep));
      paused.push(t);
    }
    if (keep && !keep.isProvisional) {
      for (const t of running.filter((r) => r.date < today)) {
        await pauseDailyTask(t, openStart(keep));
        paused.push(t);
      }
    }
    return paused;
  });
}

// 計測できずに後からまとめて手入力する実績を1件追加する(実績編集の「過去の実績を追加」、打刻からの記録)。
// 同日・同じ作業の実績が既にあれば、通常の作業完了時と同じルールで合算する(区分・作業名の統一、時間の合算)。
// 追加・合算した実績のIDを返す
export async function addManualRecord(
  date: string,
  category: string,
  name: string,
  startedAt: number,
  endedAt: number
): Promise<string> {
  const master = await findOrCreateMasterTask(category, name, 0);
  const seconds = Math.round((endedAt - startedAt) / 1000);
  const segments = [{ start: startedAt, end: endedAt }];

  // 案件・ToDo・手段の付いていない同日の実績にだけ合算する(本日の作業の完了時と同じ規則)
  const existing = await findMergeTargetRecord(date, master.id, {});
  let id: string;
  if (existing) {
    id = existing.id;
    await db.records.update(existing.id, {
      seconds: existing.seconds + seconds,
      startedAt: Math.min(existing.startedAt, startedAt),
      endedAt: Math.max(existing.endedAt, endedAt),
      segments: mergeRecordSegments(existing, segments),
    });
  } else {
    id = uid();
    await db.records.add({
      id,
      date,
      category: master.category,
      name: master.name,
      masterTaskId: master.id,
      seconds,
      startedAt,
      endedAt,
      excludedFromStats: false,
      segments,
    });
  }
  await recomputeEstimateFromRecords(master.id);
  return id;
}

// 完了済みの作業の開始・終了時刻を編集したとき、合算先の実績(WorkRecord)の開始・終了時刻を
// 追従させる。実績は同日・同じ帰属先の複数の完了分を合算しているため、編集した作業が
// 実績の端(最も早い開始/最も遅い終了)を決めていた場合は、他の完了分と新しい時刻から
// 端を求め直す。端でなかった場合は、新しい時刻の方が外側に出た時だけ広げる
// (dailyTasks由来でない分が合算されていても、その端を勝手に縮めないように)。
// 実績の区間(segments)は編集時に破棄され、定時以降の集計はこの開始〜終了で近似されるため、
// 追従させないと時刻を直しても残業分析などが古い時刻のままになっていた
export async function updateRecordBoundsAfterEdit(
  recordId: string,
  before: DailyTask,
  newStartedAt: number | undefined,
  newEndedAt: number | undefined
): Promise<void> {
  const record = await db.records.get(recordId);
  if (!record) return;
  const others = (await db.dailyTasks.where("date").equals(record.date).toArray()).filter(
    (t) => t.id !== before.id && t.status === "done" && t.masterTaskId === record.masterTaskId && sameAttribution(t, record)
  );
  const otherStarts = others.map((t) => t.startedAt ?? t.segments[0]?.start).filter((v): v is number => v !== undefined);
  const otherEnds = others
    .map((t) => t.endedAt ?? t.segments[t.segments.length - 1]?.end)
    .filter((v): v is number => v !== undefined);
  const updates: Partial<WorkRecord> = {};
  if (newStartedAt !== undefined && newStartedAt !== before.startedAt) {
    updates.startedAt =
      before.startedAt !== undefined && record.startedAt === before.startedAt
        ? Math.min(newStartedAt, ...otherStarts)
        : Math.min(record.startedAt, newStartedAt);
  }
  if (newEndedAt !== undefined && newEndedAt !== before.endedAt) {
    updates.endedAt =
      before.endedAt !== undefined && record.endedAt === before.endedAt
        ? Math.max(newEndedAt, ...otherEnds)
        : Math.max(record.endedAt, newEndedAt);
  }
  if (Object.keys(updates).length > 0) await db.records.update(recordId, updates);
}

// 仮計測(未計測時間の自動計測・移動検知)の作業を、誰も計測していない場合に限って追加する。
// 同じアプリを複数のタブで開いていると、各タブが同時に「計測していない」と判定して
// 仮計測が重複していたため、DB上の最新の状態の確認と追加を1つのトランザクションで行う。
// orderはその日の作業の件数(末尾)にする。戻り値: 追加したか
export async function addProvisionalTaskIfIdle(task: Omit<DailyTask, "order">): Promise<boolean> {
  return db.transaction("rw", db.dailyTasks, async () => {
    const sameDay = await db.dailyTasks.where("date").equals(task.date).toArray();
    if (sameDay.some((t) => t.isProvisional || t.status === "running")) return false;
    await db.dailyTasks.add({ ...task, order: sameDay.length } as DailyTask);
    return true;
  });
}

// 「実績編集」タブでの実績(WorkRecord)の開始/終了時刻の手動編集は、その実績の元になった
// dailyTasksの側には反映されない独立したデータだった。そのため編集後も「本日の作業」タブの
// 「前の作業の終了時刻から開始/再開する」といった提案が編集前の古い時刻のまま出てしまう
// 問題があった。編集した境界(開始/終了)に対応するdailyTasksのインスタンス(同じ日付・
// masterTaskId・案件/段階の完了済み作業のうち、開始側なら一番早いもの・終了側なら一番遅いもの)
// を探し、そちらのstartedAt/endedAtも合わせて更新する。対応するインスタンスが見つからない
// (CSVインポート等、dailyTasks由来ではない実績)場合は何もしない
export async function syncDailyTaskBoundaryFromRecord(
  record: Pick<WorkRecord, "date" | "masterTaskId" | "projectId" | "stageId" | "todoTaskId" | "method">,
  edge: "start" | "end",
  newTime: number
): Promise<void> {
  if (!record.masterTaskId) return;
  const candidates = (await db.dailyTasks.where("date").equals(record.date).toArray())
    .filter(
      (t) =>
        t.status === "done" &&
        t.masterTaskId === record.masterTaskId &&
        sameAttribution(t, record)
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

  // 合計は今の合計に区間の長さが変わった分を足す(区間を足し直すと、完了時に織り込んだ「時間を加算」の分が消える)
  const segSum = (list: TimeSegment[]) => list.reduce((sum, s) => sum + ((s.end ?? newTime) - s.start), 0);
  const accumulatedMs =
    target.segments.length > 0 ? target.accumulatedMs + (segSum(segments) - segSum(target.segments)) : segSum(segments);
  await db.dailyTasks.update(target.id, {
    ...(edge === "start" ? { startedAt: newTime } : { endedAt: newTime }),
    segments,
    accumulatedMs,
    // 実績側を直接編集した結果に合わせたので、この時点の値を「反映済み」とする
    recordedMs: accumulatedMs,
    recordedSegmentCount: segments.length,
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

// 放置されていた「計測中」の作業を、実際の停止時刻が分からないため元の日の24:00(23:59:59)で
// 打ち切って完了にする。一時停止中の作業(=既に区間が閉じている)に対しては、closeAtは
// 使われず実際の最後の一時停止時刻がそのままendedAtになる(finishDailyTask参照)
export async function finishOrphanedDailyTask(task: DailyTask): Promise<void> {
  const dayEndMs = new Date(task.date + "T23:59:59").getTime();
  if (task.status === "paused") {
    // 今日の作業を始めた時に自動で一時停止された(=区間が翌日以降まで延びている)作業を、
    // 元の日の24:00で打ち切る。延びていた分は合計からも差し引く
    const segments = task.segments
      .filter((s) => s.start < dayEndMs)
      .map((s) => (s.end !== undefined && s.end > dayEndMs ? { ...s, end: dayEndMs } : s));
    const len = (list: TimeSegment[]) => list.reduce((sum, s) => sum + ((s.end ?? s.start) - s.start), 0);
    const accumulatedMs = Math.max(0, task.accumulatedMs - (len(task.segments) - len(segments)));
    const trimmed = { ...task, segments, accumulatedMs, stoppedAt: Math.min(task.stoppedAt ?? dayEndMs, dayEndMs) };
    await db.dailyTasks.update(task.id, { segments, accumulatedMs, stoppedAt: trimmed.stoppedAt });
    await finishDailyTask(trimmed);
    return;
  }
  await finishDailyTask(task, dayEndMs);
}

/** 一時停止中の区間が元の日の24:00を越えて延びているか(24:00で打ち切る選択肢を出すかどうか) */
export function extendsPastDayEnd(task: DailyTask): boolean {
  const dayEndMs = new Date(task.date + "T23:59:59").getTime();
  return task.segments.some((s) => (s.end ?? 0) > dayEndMs);
}

// 放置されていた「計測中」の作業を、確認している「今この瞬間」まで計測して元の日(task.date)の
// 実績として完了する。睡眠など日をまたいで実際に継続していた作業を、24:00で打ち切らず
// 起きた時点までまとめて前日実績にしたい場合に使う
// (finishDailyTaskはendAtMs省略時に現在時刻を使う点を利用している)
export async function finishOrphanedDailyTaskNow(task: DailyTask): Promise<void> {
  await finishDailyTask(task);
}

// 放置されていた「一時停止中」の作業を、そのまま(=一時停止した時点の区間そのまま)完了にする。
// 一時停止中の作業は既に全区間が閉じており実際の停止時刻が判明しているため、24:00打ち切りや
// 「今の時刻」といった時刻の選択自体が不要かつ紛らわしい(誤って選ぶと、実際には前日のうちに
// 止まっていたのにendedAtだけ操作した時刻になってしまいかねない)。実装上はfinishDailyTaskが
// 一時停止中の作業に対してはendAtMsを無視して実際の最後の区間終了時刻を使うため、
// finishOrphanedDailyTaskNowと同じ呼び出しで良い(呼び出し側の意図を明確にするための別名)
export async function finishOrphanedDailyTaskAsIs(task: DailyTask): Promise<void> {
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
