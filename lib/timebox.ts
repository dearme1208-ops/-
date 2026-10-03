import type { DailyTask } from "./types";

// タイムボックス(時間割)。「全部急ぎ」で全部を気にしていると何も進まないので、
// 作業ごとに時間の枠を先に決め、枠の間はその1つだけに集中し、時間が来たら途中でも止める。
// 枠の始まりは既存の予定時刻(DailyTask.scheduledTime)を使い、その時刻に自動で開始する。
// 枠の終わりは DailyTask.timeboxEnd(HH:MM)

/** 開始が枠の始まりからこの分数以内なら「時間どおりに始めた」 */
export const ON_TIME_START_MIN = 5;
/** 枠の終わりからこの分数以内に止めていれば「時間どおりに止めた」 */
export const ON_TIME_STOP_MIN = 2;

export function hmToMin(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
}

export function minToHm(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function hmToMs(date: string, hm: string): number | null {
  const min = hmToMin(hm);
  if (min === null) return null;
  return new Date(date + "T00:00:00").getTime() + min * 60000;
}

export interface TimeboxSlot {
  id: string;
  start: string;
  end: string;
}

/**
 * 選んだ作業を、開始時刻から順に枠へ割り当てる。枠と枠の間にはgap分の小休止を挟む。
 * 休憩帯(昼休みなど)にかかる枠は、休憩帯の後ろへずらす
 */
export function layoutTimeboxes(
  items: { id: string; minutes: number }[],
  startHm: string,
  gapMin: number,
  breaks: { start: string; end: string }[] = []
): TimeboxSlot[] {
  let cursor = hmToMin(startHm) ?? 9 * 60;
  const ranges = breaks
    .map((b) => ({ s: hmToMin(b.start), e: hmToMin(b.end) }))
    .filter((r): r is { s: number; e: number } => r.s !== null && r.e !== null && r.e > r.s)
    .sort((a, b) => a.s - b.s);
  const slots: TimeboxSlot[] = [];
  for (const item of items) {
    const len = Math.max(5, Math.round(item.minutes));
    let start = cursor;
    // 休憩帯と重なる間は、その休憩帯の終わりへ送る(連続する休憩帯もまとめて越える)
    for (let moved = true; moved; ) {
      moved = false;
      for (const r of ranges) {
        if (start < r.e && start + len > r.s) {
          start = r.e;
          moved = true;
        }
      }
    }
    slots.push({ id: item.id, start: minToHm(start), end: minToHm(start + len) });
    cursor = start + len + Math.max(0, gapMin);
  }
  return slots;
}

export interface TimeboxOnDay {
  task: DailyTask;
  startMs: number;
  endMs: number;
}

/** その日の時間割(枠の始まりと終わりが両方ある作業)を時刻順に */
export function timeboxesOf(tasks: DailyTask[], date: string): TimeboxOnDay[] {
  const out: TimeboxOnDay[] = [];
  for (const task of tasks) {
    if (task.date !== date || !task.scheduledTime || !task.timeboxEnd) continue;
    const startMs = hmToMs(date, task.scheduledTime);
    const endMs = hmToMs(date, task.timeboxEnd);
    if (startMs === null || endMs === null || endMs <= startMs) continue;
    out.push({ task, startMs, endMs });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** 今の枠・次の枠 */
export function timeboxNow(boxes: TimeboxOnDay[], now: number): { current?: TimeboxOnDay; next?: TimeboxOnDay } {
  const current = boxes.find((b) => b.startMs <= now && now < b.endMs);
  const next = boxes.find((b) => b.startMs > now);
  return { current, next };
}

/** 枠の終わりを過ぎても計測中のままで、まだ「時間です」を出していない作業 */
export function findEndedTimeboxes(tasks: DailyTask[], date: string, now: number): DailyTask[] {
  return timeboxesOf(tasks, date)
    .filter((b) => now >= b.endMs && b.task.status === "running" && !b.task.timeboxEndHandled)
    .map((b) => b.task);
}

/**
 * 枠を延ばす。延ばした分、この枠より後ろでまだ始まっていない枠も同じだけ後ろへずらす
 * (延長が次の枠に食い込んで、次の枠の始まりで二重に計測が始まらないように)。
 * 書き換える作業ごとの変更を返す
 */
export function extendTimebox(
  tasks: DailyTask[],
  taskId: string,
  minutes: number
): { id: string; changes: Partial<DailyTask> }[] {
  const target = tasks.find((t) => t.id === taskId);
  if (!target?.timeboxEnd || !target.scheduledTime) return [];
  const oldEnd = hmToMin(target.timeboxEnd)!;
  const updates: { id: string; changes: Partial<DailyTask> }[] = [
    { id: target.id, changes: { timeboxEnd: minToHm(oldEnd + minutes), timeboxEndHandled: false } },
  ];
  for (const t of tasks) {
    if (t.id === target.id || t.date !== target.date || !t.scheduledTime || !t.timeboxEnd) continue;
    // まだ枠が始まっていない作業(未着手・一時停止中)だけをずらす。計測中・完了は動かさない
    if (t.status !== "pending" && t.status !== "paused") continue;
    const s = hmToMin(t.scheduledTime);
    const e = hmToMin(t.timeboxEnd);
    if (s === null || e === null || s < oldEnd) continue;
    updates.push({ id: t.id, changes: { scheduledTime: minToHm(s + minutes), timeboxEnd: minToHm(e + minutes) } });
  }
  return updates;
}

export interface TimeboxReviewRow {
  task: DailyTask;
  startMs: number;
  endMs: number;
  /** 枠の中で実際に計測した時間 */
  workedMs: number;
  startedOnTime: boolean;
  /** 枠の終わりで止めたか。まだ枠が終わっていない・一度も始めていないならundefined */
  stoppedOnTime?: boolean;
  started: boolean;
}

/** 時間割を守れたか(時間どおりに始めた・時間どおりに止めた) */
export function reviewTimeboxes(boxes: TimeboxOnDay[], now: number): TimeboxReviewRow[] {
  return boxes.map(({ task, startMs, endMs }) => {
    const segs = task.segments.map((s) => ({ start: s.start, end: s.end ?? now }));
    const started = segs.length > 0;
    const firstStart = started ? Math.min(...segs.map((s) => s.start)) : undefined;
    const workedMs = segs.reduce((sum, s) => sum + Math.max(0, Math.min(s.end, endMs) - Math.max(s.start, startMs)), 0);
    // 枠の終わりの後も続けていた時間(枠の外で始めた区間は「別の時間にやった」ので数えない)
    const overranMs = segs
      .filter((s) => s.start < endMs)
      .reduce((max, s) => Math.max(max, s.end - endMs), 0);
    return {
      task,
      startMs,
      endMs,
      workedMs,
      started,
      startedOnTime: firstStart !== undefined && firstStart <= startMs + ON_TIME_START_MIN * 60000,
      stoppedOnTime: !started || now < endMs ? undefined : overranMs <= ON_TIME_STOP_MIN * 60000,
    };
  });
}
