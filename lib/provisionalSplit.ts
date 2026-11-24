import { db, uid } from "./db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "./master";
import { findMergeTargetRecord, finishDailyTask, mergeRecordSegments, sameAttribution } from "./tasks";
import type { DailyTask, TimeSegment, WorkRecord } from "./types";
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

// ---- 完了した作業を時刻で分ける・2つをまとめる(本日の作業の「分ける…」「まとめる…」) ----
// 実績(WorkRecord)は日付×作業マスタ×帰属先ごとの合算なので、同じ作業のまま分ける・まとめる時は実績を変えない。
// 別の作業になる分だけ、秒数と区間を元の実績から引いて移す先の実績へ足す

/** 変えた行の、変える前と後(後は書き込んだ後にDBから読み直したもの)。元に戻す時に使う */
export interface DoneTaskEditUndo {
  tasks: { id: string; before: DailyTask | null; after: DailyTask | null }[];
  records: { id: string; before: WorkRecord | null; after: WorkRecord | null }[];
  masterIds: string[];
}

export type DoneTaskEditResult =
  | { status: "ok"; taskId: string; undo: DoneTaskEditUndo }
  | { status: "rejected"; message: string };

/** 閉じた区間 base から remove の時間帯を取り除く */
export function subtractSegments(base: TimeSegment[], remove: TimeSegment[]): TimeSegment[] {
  let rest = base.filter((s) => s.end !== undefined && s.end > s.start).map((s) => ({ start: s.start, end: s.end! }));
  for (const r of remove) {
    if (r.end === undefined) continue;
    const next: { start: number; end: number }[] = [];
    for (const s of rest) {
      if (r.end <= s.start || r.start >= s.end) {
        next.push(s);
        continue;
      }
      if (s.start < r.start) next.push({ start: s.start, end: r.start });
      if (r.end < s.end) next.push({ start: r.end, end: s.end });
    }
    rest = next;
  }
  return rest;
}

async function masterIdOf(t: DailyTask): Promise<string | undefined> {
  if (t.masterTaskId) return t.masterTaskId;
  const m = await db.masterTasks.filter((x) => x.category === t.category.trim() && x.name === t.name.trim()).first();
  return m?.id;
}

/** 実績から秒数と区間を引く(0以下になれば実績ごと消す) */
async function takeFromRecord(rec: WorkRecord, seconds: number, segs: TimeSegment[]): Promise<void> {
  const remaining = rec.seconds - seconds;
  if (remaining <= 0) {
    await db.records.delete(rec.id);
    return;
  }
  const rest = rec.segments ? subtractSegments(rec.segments, segs) : undefined;
  await db.records.update(
    rec.id,
    rest && rest.length > 0
      ? { seconds: remaining, segments: rest, startedAt: rest[0].start, endedAt: Math.max(...rest.map((s) => s.end!)) }
      : { seconds: remaining, segments: undefined }
  );
}

/** 同じ日・同じ帰属先の実績へ足す(無ければ作る)。足した実績のIDを返す */
async function giveToRecord(t: DailyTask, masterId: string, seconds: number, segs: TimeSegment[]): Promise<string> {
  const closed = segs.filter((s) => s.end !== undefined);
  const startedAt = closed[0]?.start ?? t.startedAt ?? 0;
  const endedAt = Math.max(...closed.map((s) => s.end!), t.endedAt ?? startedAt);
  const existing = await findMergeTargetRecord(t.date, masterId, t);
  if (existing) {
    await db.records.update(existing.id, {
      seconds: existing.seconds + seconds,
      startedAt: Math.min(existing.startedAt, startedAt),
      endedAt: Math.max(existing.endedAt, endedAt),
      segments: existing.segments ? mergeRecordSegments(existing, closed) : undefined,
      isTrouble: existing.isTrouble || t.isTrouble,
    });
    return existing.id;
  }
  const id = uid();
  await db.records.add({
    id,
    date: t.date,
    category: t.category,
    name: t.name,
    masterTaskId: masterId,
    seconds,
    startedAt,
    endedAt,
    excludedFromStats: false,
    projectId: t.projectId,
    stageId: t.stageId,
    todoTaskId: t.todoTaskId,
    isTrouble: t.isTrouble,
    method: t.method?.trim() || undefined,
    secondaryProjectIds: t.secondaryProjectIds,
    segments: closed,
  });
  return id;
}

/** 変える前の行を控え、fn で書き換えた後の行を読み直して undo を組み立てる */
async function withUndo(
  taskIds: string[],
  recordIdsBefore: string[],
  fn: () => Promise<{ taskId: string; recordIdsAfter: string[] } | { rejected: string }>
): Promise<DoneTaskEditResult> {
  return db.transaction("rw", db.dailyTasks, db.records, db.masterTasks, async (): Promise<DoneTaskEditResult> => {
    const tasksBefore = new Map<string, DailyTask | null>();
    for (const id of taskIds) tasksBefore.set(id, (await db.dailyTasks.get(id)) ?? null);
    const recBefore = new Map<string, WorkRecord | null>();
    for (const id of recordIdsBefore) recBefore.set(id, (await db.records.get(id)) ?? null);
    const r = await fn();
    if ("rejected" in r) return { status: "rejected", message: r.rejected };
    const allTaskIds = new Set([...taskIds, r.taskId]);
    const tasks: DoneTaskEditUndo["tasks"] = [];
    for (const id of allTaskIds) tasks.push({ id, before: tasksBefore.get(id) ?? null, after: (await db.dailyTasks.get(id)) ?? null });
    const records: DoneTaskEditUndo["records"] = [];
    for (const id of new Set([...recordIdsBefore, ...r.recordIdsAfter])) {
      const before = recBefore.has(id) ? recBefore.get(id)! : null;
      const after = (await db.records.get(id)) ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after)) records.push({ id, before, after });
    }
    const masterIds = [
      ...new Set(
        [...tasks.flatMap((t) => [t.before?.masterTaskId, t.after?.masterTaskId]), ...records.flatMap((x) => [x.before?.masterTaskId, x.after?.masterTaskId])].filter(
          (v): v is string => !!v
        )
      ),
    ];
    return { status: "ok", taskId: r.taskId, undo: { tasks: tasks.filter((t) => JSON.stringify(t.before) !== JSON.stringify(t.after)), records, masterIds } };
  });
}

async function recomputeAll(ids: string[]) {
  for (const id of ids) await recomputeEstimateFromRecords(id);
}

export interface SplitSecondPart {
  category: string;
  name: string;
  /** 省略時は区分・作業名から作業マスタを探す(無ければ作る) */
  masterTaskId?: string;
}

/**
 * 完了した作業を atMs で2つの完了した作業に分ける。前半は元の作業(IDはそのまま)、後半は新しい作業。
 * 「時間を加算」で足した分(区間に現れない分)は前半に残す。
 * secondPart で後半を別の作業にした時は、後半の秒数・区間を元の実績から新しい作業の実績へ移す
 */
export async function splitDoneDailyTask(taskId: string, atMs: number, secondPart?: SplitSecondPart): Promise<DoneTaskEditResult> {
  const pre = await db.dailyTasks.get(taskId);
  if (!pre || pre.status !== "done") return { status: "rejected", message: "完了した作業だけ分けられます" };
  let second: { category: string; name: string; masterTaskId?: string } | undefined;
  if (secondPart) {
    const category = secondPart.category.trim();
    const name = secondPart.name.trim();
    if (!category || !name) return { status: "rejected", message: "後半の区分と作業名を入れてください" };
    const masterTaskId = secondPart.masterTaskId ?? (category === pre.category && name === pre.name ? pre.masterTaskId : undefined) ?? (await findOrCreateMasterTask(category, name)).id;
    second = { category, name, masterTaskId };
  }
  const oldMasterId = await masterIdOf(pre);
  const oldRec = oldMasterId ? await findMergeTargetRecord(pre.date, oldMasterId, pre) : undefined;
  const newId = uid();
  const secondMasterId = second?.masterTaskId ?? oldMasterId;
  const moving = !!secondMasterId && secondMasterId !== oldMasterId;
  const newTarget = moving ? await findMergeTargetRecord(pre.date, secondMasterId!, pre) : undefined;
  const result = await withUndo([taskId], [oldRec?.id, newTarget?.id].filter((v): v is string => !!v), async () => {
    const cur = await db.dailyTasks.get(taskId);
    if (!cur || cur.status !== "done" || JSON.stringify(cur) !== JSON.stringify(pre)) return { rejected: "その間に作業が変わりました。もう一度お試しください" };
    if (cur.segments.some((s) => s.end === undefined)) return { rejected: "計測中の区間がある作業は分けられません" };
    const { before, after: rawAfter } = splitSegmentsAt(cur.segments, atMs);
    const after = rawAfter.filter((s) => s.end! > s.start);
    const afterMs = closedSegmentsMs(after);
    const firstMs = cur.accumulatedMs - afterMs;
    if (before.length === 0 || after.length === 0 || afterMs <= 0 || firstMs <= 0) {
      return { rejected: "開始と終了の間の、作業していた時刻を選んでください" };
    }
    const firstEnd = before[before.length - 1].end!;
    await db.dailyTasks.update(cur.id, {
      segments: before,
      accumulatedMs: firstMs,
      recordedMs: firstMs,
      recordedSegmentCount: before.length,
      endedAt: firstEnd,
    });
    const dayCount = await db.dailyTasks.where("date").equals(cur.date).count();
    const secondTask: DailyTask = {
      id: newId,
      date: cur.date,
      order: dayCount,
      masterTaskId: secondMasterId,
      category: second?.category ?? cur.category,
      name: second?.name ?? cur.name,
      estimatedSeconds: cur.estimatedSeconds,
      ...(cur.hasPlan !== undefined ? { hasPlan: cur.hasPlan } : {}),
      status: "done",
      segments: after,
      accumulatedMs: afterMs,
      recordedMs: afterMs,
      recordedSegmentCount: after.length,
      startedAt: after[0].start,
      endedAt: cur.endedAt ?? after[after.length - 1].end,
      ...(cur.stoppedAt !== undefined ? { stoppedAt: cur.stoppedAt } : {}),
      isSpontaneous: cur.isSpontaneous,
      ...dailyTaskLinksOf(cur),
      ...(cur.isTrouble ? { isTrouble: true } : {}),
    };
    await db.dailyTasks.add(secondTask);
    const recordIdsAfter: string[] = [];
    if (moving && oldRec) {
      const sec = Math.round(afterMs / 1000);
      const latestOld = await db.records.get(oldRec.id);
      if (latestOld) await takeFromRecord(latestOld, sec, after);
      recordIdsAfter.push(await giveToRecord(secondTask, secondMasterId!, sec, after));
    }
    return { taskId: newId, recordIdsAfter };
  });
  if (result.status === "ok") await recomputeAll(result.undo.masterIds);
  return result;
}

/**
 * 同じ日の完了した作業2つを1つにまとめる。keepId の作業を残し(区間をつなげ、合計を足す)、otherId は消す。
 * 名前・作業マスタ・案件などの紐付けは nameFrom の側のものにする。紐付けが違う時は、
 * もう片方の秒数・区間をその実績から残す側の実績へ移す(同じなら実績はそのまま)
 */
export async function mergeDoneDailyTasks(keepId: string, otherId: string, nameFrom: "keep" | "other" = "keep"): Promise<DoneTaskEditResult> {
  if (keepId === otherId) return { status: "rejected", message: "別の作業を選んでください" };
  const [k0, o0] = [await db.dailyTasks.get(keepId), await db.dailyTasks.get(otherId)];
  if (!k0 || !o0 || k0.status !== "done" || o0.status !== "done") return { status: "rejected", message: "完了した作業どうしだけまとめられます" };
  if (k0.date !== o0.date) return { status: "rejected", message: "同じ日の作業だけまとめられます" };
  const src0 = nameFrom === "keep" ? k0 : o0;
  const moved0 = nameFrom === "keep" ? o0 : k0;
  const srcMaster = await masterIdOf(src0);
  const movedMaster = await masterIdOf(moved0);
  const moving = !!movedMaster && !!srcMaster && !(movedMaster === srcMaster && sameAttribution(moved0, src0));
  const movedRec = moving ? await findMergeTargetRecord(moved0.date, movedMaster!, moved0) : undefined;
  const target = moving ? await findMergeTargetRecord(src0.date, srcMaster!, src0) : undefined;
  const result = await withUndo([keepId, otherId], [movedRec?.id, target?.id].filter((v): v is string => !!v), async () => {
    const k = await db.dailyTasks.get(keepId);
    const o = await db.dailyTasks.get(otherId);
    if (!k || !o || JSON.stringify(k) !== JSON.stringify(k0) || JSON.stringify(o) !== JSON.stringify(o0)) {
      return { rejected: "その間に作業が変わりました。もう一度お試しください" };
    }
    if ([...k.segments, ...o.segments].some((s) => s.end === undefined)) return { rejected: "計測中の区間がある作業はまとめられません" };
    const segments = [...k.segments, ...o.segments].sort((a, b) => a.start - b.start);
    const accumulatedMs = k.accumulatedMs + o.accumulatedMs;
    const src = nameFrom === "keep" ? k : o;
    const starts = [k.startedAt ?? k.segments[0]?.start, o.startedAt ?? o.segments[0]?.start].filter((v): v is number => v !== undefined);
    const ends = [k.endedAt, o.endedAt, ...segments.map((s) => s.end)].filter((v): v is number => v !== undefined);
    const merged: DailyTask = {
      ...k,
      category: src.category,
      name: src.name,
      masterTaskId: srcMaster ?? src.masterTaskId,
      segments,
      accumulatedMs,
      recordedMs: (k.recordedMs ?? k.accumulatedMs) + (o.recordedMs ?? o.accumulatedMs),
      recordedSegmentCount: segments.length,
      startedAt: starts.length ? Math.min(...starts) : undefined,
      endedAt: ends.length ? Math.max(...ends) : undefined,
      note: [k.note, o.note].filter(Boolean).join(" / ") || undefined,
      projectId: src.projectId,
      stageId: src.stageId,
      todoTaskId: src.todoTaskId,
      method: src.method,
      secondaryProjectIds: src.secondaryProjectIds,
      isTrouble: src.isTrouble,
    };
    for (const key of Object.keys(merged) as (keyof DailyTask)[]) if (merged[key] === undefined) delete merged[key];
    await db.dailyTasks.put(merged);
    await db.dailyTasks.delete(otherId);
    const recordIdsAfter: string[] = [];
    if (moving && movedRec) {
      const moved = nameFrom === "keep" ? o : k;
      const sec = Math.round(moved.accumulatedMs / 1000);
      const latest = await db.records.get(movedRec.id);
      if (latest) await takeFromRecord(latest, sec, moved.segments);
      recordIdsAfter.push(await giveToRecord(merged, srcMaster!, sec, moved.segments));
    }
    return { taskId: keepId, recordIdsAfter };
  });
  if (result.status === "ok") await recomputeAll(result.undo.masterIds);
  return result;
}

/** 分ける・まとめるを取り消す。その後に作業か実績が変わっていれば何もせず false(新しい変更を上書きしない) */
export async function undoDoneTaskEdit(u: DoneTaskEditUndo): Promise<boolean> {
  const ok = await db.transaction("rw", db.dailyTasks, db.records, async () => {
    for (const t of u.tasks) if (JSON.stringify((await db.dailyTasks.get(t.id)) ?? null) !== JSON.stringify(t.after)) return false;
    for (const r of u.records) if (JSON.stringify((await db.records.get(r.id)) ?? null) !== JSON.stringify(r.after)) return false;
    for (const t of u.tasks) {
      if (t.before) await db.dailyTasks.put(t.before);
      else await db.dailyTasks.delete(t.id);
    }
    for (const r of u.records) {
      if (r.before) await db.records.put(r.before);
      else await db.records.delete(r.id);
    }
    return true;
  });
  if (ok) await recomputeAll(u.masterIds);
  return ok;
}
