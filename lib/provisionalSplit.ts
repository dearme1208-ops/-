import { db, uid } from "./db";
import { finishDailyTask } from "./tasks";
import type { DailyTask, TimeSegment } from "./types";
import { dailyTaskLinksOf } from "./workContext";

// 仮計測(まだ何の作業か決めていない計測)を、途中の時刻で2つに分けて別々の作業へ割り当てるための計算。
// 「15:20までは資料作成、そこからは電話対応」のように、1つの未計測時間に複数の作業が入っていた時に使う

/** 区間を at で前後に分ける。前は全て閉じた区間、後は計測中の区間(end なし)をそのまま残す */
export function splitSegmentsAt(segments: TimeSegment[], at: number): { before: TimeSegment[]; after: TimeSegment[] } {
  const before: TimeSegment[] = [];
  const after: TimeSegment[] = [];
  for (const s of segments) {
    const end = s.end;
    if (end !== undefined && end <= at) before.push(s);
    else if (s.start >= at) after.push(s);
    else {
      // at をまたぐ区間は at で切る
      before.push({ start: s.start, end: at });
      after.push(end === undefined ? { start: at } : { start: at, end });
    }
  }
  return { before: before.filter((s) => s.end! > s.start), after };
}

/** 閉じた区間の合計(ms)。計測中の区間は数えない */
export function closedSegmentsMs(segments: TimeSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.end !== undefined ? s.end - s.start : 0), 0);
}

/** 計測中の区間を now で閉じる */
export function closeSegmentsAt(segments: TimeSegment[], now: number): TimeSegment[] {
  return segments.map((s) => (s.end === undefined ? { start: s.start, end: Math.max(s.start, now) } : s)).filter((s) => s.end! > s.start);
}

/** "HH:MM" を、date の日のその時刻(ms)にする */
export function clockOnDate(date: string, hm: string): number {
  return new Date(`${date}T${hm.padStart(5, "0")}:00`).getTime();
}

/** 区切る時刻の初期値: 始まりと今の真ん中を、分に丸めたもの */
export function defaultSplitAt(start: number, now: number): number {
  const mid = start + (now - start) / 2;
  return Math.round(mid / 60_000) * 60_000;
}

/**
 * 作業に区間を足した後の区間の並び。「続きから」再開した作業は、前回までに実績へ反映した区間が
 * 先頭 recordedSegmentCount 個にあり、完了時はその後ろだけを新しい分として足す(lib/tasks.ts finishDailyTask)。
 * 全体を時刻順に並べ直すと、過去の時刻の区間(休憩帯・仮計測の割り当て)が反映済みの間に入り込み、
 * 反映済みの区間を二重に数えて新しい区間を落としていた。反映済みの先頭は動かさず、残りだけを時刻順にする
 * (計測中の区間は常に最後に置く)
 */
export function appendSegmentsKeepingRecorded(
  task: { segments: TimeSegment[]; recordedSegmentCount?: number },
  added: TimeSegment[]
): TimeSegment[] {
  const count = Math.min(task.recordedSegmentCount ?? 0, task.segments.length);
  const prefix = task.segments.slice(0, count);
  const tail = [...task.segments.slice(count), ...added].sort(
    (a, b) => Number(a.end === undefined) - Number(b.end === undefined) || a.start - b.start
  );
  return [...prefix, ...tail];
}

/** 仮計測の区間を、閉じた区間と計測中の区間の始まりに分ける(割り当て先へ実際の区間のまま引き継ぐため) */
export function provisionalCarry(segments: TimeSegment[]): { closed: TimeSegment[]; openStart: number | null } {
  const closed = segments.filter((s) => s.end !== undefined && s.end > s.start);
  const open = segments.find((s) => s.end === undefined);
  return { closed, openStart: open ? open.start : null };
}

/** その日の翌日0:00(ms) */
export function nextMidnightOf(date: string): number {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * 日をまたいだ作業を「0時で分ける」ときの区間。元の日の分は翌0:00までの区間(実績へ反映済みの先頭は除く)、
 * 今日の分は今日0:00以降の区間(計測中ならそのまま計測中)。間の日(2日以上前の作業)は数えない
 */
export function midnightSplitParts(
  task: { date: string; segments: TimeSegment[]; recordedSegmentCount?: number },
  today: string
): { recorded: TimeSegment[]; yesterday: TimeSegment[]; today: TimeSegment[] } {
  const count = Math.min(task.recordedSegmentCount ?? 0, task.segments.length);
  const recorded = task.segments.slice(0, count);
  const rest = task.segments.slice(count);
  const yesterday = splitSegmentsAt(rest, nextMidnightOf(task.date)).before;
  const todayPart = splitSegmentsAt(rest, new Date(`${today}T00:00:00`).getTime()).after.filter(
    (s) => s.end === undefined || s.end > s.start
  );
  return { recorded, yesterday, today: todayPart };
}

/**
 * 日をまたいで計測中(または0時をまたいで一時停止)のまま残った作業を、0時で2つに分ける。
 * 元の日の分は翌0:00(24:00)で終えて元の日の実績にし、今日の分は同じ紐付けのまま今日の作業として
 * 0:00から続ける(計測中だったものは計測中のまま)。作った今日の作業のIDを返す(今日の分が無ければnull)
 */
// 「0時で分ける」の連打などで同じ作業を並行して分けると、今日の分が2件できて二重に数えていた
const splittingOrphanIds = new Set<string>();

export async function splitOrphanAtMidnight(task: DailyTask, today: string): Promise<string | null> {
  if (splittingOrphanIds.has(task.id)) return null;
  splittingOrphanIds.add(task.id);
  try {
    return await splitOrphanAtMidnightOnce(task, today);
  } finally {
    splittingOrphanIds.delete(task.id);
  }
}

async function splitOrphanAtMidnightOnce(task: DailyTask, today: string): Promise<string | null> {
  const cur = await db.dailyTasks.get(task.id);
  if (!cur || cur.date >= today || (cur.status !== "running" && cur.status !== "paused")) return null;
  const parts = midnightSplitParts(cur, today);
  const dayEnd = nextMidnightOf(cur.date);
  const segments = [...parts.recorded, ...parts.yesterday];
  if (parts.yesterday.length === 0 && !cur.recordedSegmentCount && !(cur.manualAdjustmentMs ?? 0)) {
    // 元の日に計った分が無い(0時より後だけ)なら、元の日の記録は作らない
    await db.dailyTasks.delete(cur.id);
  } else {
    const accumulatedMs = (cur.recordedMs ?? 0) + closedSegmentsMs(parts.yesterday);
    const stoppedAt = Math.min(cur.stoppedAt ?? dayEnd, dayEnd);
    // 一時停止(区間はすべて閉じている)にしてから完了にすると、終了は最後の区間の終わり(24:00)になる
    // (先に一時停止として書き込むと、ほかで完了済みになっていた作業を上書きしてしまうので、
    //  一時停止の状態は finishDailyTask へ渡すだけにする)
    // ほかのタブなどで先に完了されていたら、今日の分も作らない(二重に数えないように)
    const claimed = await finishDailyTask({ ...cur, segments, status: "paused", accumulatedMs, stoppedAt });
    if (!claimed) return null;
  }
  if (parts.today.length === 0) return null;
  const finished = await db.dailyTasks.get(cur.id);
  const todays = await db.dailyTasks.where("date").equals(today).toArray();
  const open = parts.today.some((s) => s.end === undefined);
  const keepProvisional = !!cur.isProvisional && !todays.some((t) => t.isProvisional);
  const copy: DailyTask = {
    id: uid(),
    date: today,
    order: todays.length,
    masterTaskId: cur.isProvisional ? cur.masterTaskId : (finished?.masterTaskId ?? cur.masterTaskId),
    category: cur.category,
    name: cur.name,
    estimatedSeconds: cur.estimatedSeconds,
    hasPlan: cur.hasPlan,
    status: open ? "running" : "paused",
    segments: parts.today,
    accumulatedMs: closedSegmentsMs(parts.today),
    startedAt: parts.today[0].start,
    ...(open ? {} : { stoppedAt: parts.today[parts.today.length - 1].end }),
    isSpontaneous: true,
    ...dailyTaskLinksOf(cur),
    ...(cur.isTrouble ? { isTrouble: true } : {}),
    ...(keepProvisional ? { isProvisional: true } : {}),
    // 0時からさかのぼって始まるので、開いた直後に超過の確認を出さない
    overrunPromptShown: true,
    overrunPromptDismissedAt: Date.now(),
  };
  await db.dailyTasks.add(copy);
  return copy.id;
}
