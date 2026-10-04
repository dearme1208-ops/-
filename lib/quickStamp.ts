import { db, uid } from "./db";
import { findOrCreateMasterTask } from "./master";
import { finishDailyTask } from "./tasks";
import { todayStr } from "./time";
import type { DailyTask, QuickStamp } from "./types";

// 打刻(📍)。計測の開始・完了を押す余裕がない時に、ボタン1回で時刻だけ残しておき、
// 落ち着いてから「打刻から次の打刻まで」を実績に変える

export async function addQuickStamp(at: number = Date.now(), note?: string): Promise<QuickStamp> {
  const stamp: QuickStamp = { id: uid(), date: todayStr(new Date(at)), at, ...(note?.trim() ? { note: note.trim() } : {}) };
  await db.quickStamps.add(stamp);
  return stamp;
}

export interface StampSpan {
  stamp: QuickStamp;
  /**
   * 区間の始まり。ふつうは打刻した時刻だが、直前に計測していた作業が終わってから打刻するまでの
   * 間に何も記録が無ければ、その作業が終わった時刻から始める(作業を終えてから打刻を押すまでの
   * 時間も、この打刻の作業をしていたとみなす)
   */
  fromAt: number;
  /** 始まりを、直前の作業が終わった時刻にさかのぼらせたか */
  startedFromMeasure?: boolean;
  /** 区間の終わり(次の打刻、またはその前に計測を始めた時刻)。どちらも無ければ undefined */
  nextAt?: number;
  /** 区間の終わりが、計測の開始で決まったか */
  endedByMeasure?: boolean;
}

export interface MeasuredSegment {
  start: number;
  /** 計測中なら undefined */
  end?: number;
}

/** 直前の作業の終わりまでさかのぼるのは、この時間以内の空白だけ(寝ていた間などまで含めないように) */
export const STAMP_BACKFILL_MAX_MS = 3 * 3600_000;

/**
 * 打刻を時刻順に並べ、それぞれ「次の打刻まで」の区間にする。
 * 打刻の後で作業の計測を始めていれば、そこで区間を終える(計測した時間を二重に記録しないように)。
 * 打刻の前に計測していた作業が終わっていて、その間に記録が無ければ、始まりをその終わりまでさかのぼる。
 * measured はその日の計測の区間(打刻から作った作業は含めない)
 */
export function stampSpans(stamps: QuickStamp[], measured: MeasuredSegment[] = [], now: number = Date.now()): StampSpan[] {
  const sorted = [...stamps].sort((a, b) => a.at - b.at);
  return sorted.map((stamp, i) => {
    const prevAt = sorted[i - 1]?.at ?? -Infinity;
    const nextStamp = sorted[i + 1]?.at;

    let fromAt = stamp.at;
    let startedFromMeasure = false;
    const measuringNow = measured.some((m) => m.start < stamp.at && (m.end ?? now) > stamp.at);
    if (!measuringNow) {
      const lastEnd = measured
        .map((m) => m.end)
        .filter((e): e is number => e !== undefined && e > prevAt && e < stamp.at && stamp.at - e <= STAMP_BACKFILL_MAX_MS)
        .reduce<number | undefined>((mx, e) => (mx === undefined || e > mx ? e : mx), undefined);
      if (lastEnd !== undefined) {
        fromAt = lastEnd;
        startedFromMeasure = true;
      }
    }

    const firstMeasure = measured
      .map((m) => m.start)
      .filter((t) => t > stamp.at)
      .reduce<number | undefined>((m, t) => (m === undefined || t < m ? t : m), undefined);
    const base = { stamp, fromAt, ...(startedFromMeasure ? { startedFromMeasure } : {}) };
    if (firstMeasure !== undefined && (nextStamp === undefined || firstMeasure < nextStamp)) {
      return { ...base, nextAt: firstMeasure, endedByMeasure: true };
    }
    return { ...base, nextAt: nextStamp };
  });
}

/** よく使う一言(新しい順・重複なし)。打刻直後の候補に出す */
export function recentStampNotes(stamps: QuickStamp[], limit = 6): string[] {
  const out: string[] = [];
  for (const s of [...stamps].sort((a, b) => b.at - a.at)) {
    const n = s.note?.trim();
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 打刻の区間を実績に変える。実績だけを足すのではなく、その区間を計測した作業として本日の作業に置き、
 * 通常の「完了」と同じ処理で完了にする(本日の作業の「完了」に並び、実績・想定時間の学習・
 * 完了の知らせも普段どおりになる)。作業のIDを打刻に残し、二重に記録しないようにする
 */
export async function convertStampToRecord(
  stamp: QuickStamp,
  category: string,
  name: string,
  startedAt: number,
  endedAt: number
): Promise<void> {
  const master = await findOrCreateMasterTask(category, name, 0);
  const segments = [{ start: startedAt, end: endedAt }];
  const order = await db.dailyTasks.where("date").equals(stamp.date).count();
  // 計測中として置くと、完了にするまでの一瞬に自動の処理(予測超過の確認など)が反応するので、
  // 区間を閉じた一時停止の状態で置いてから完了にする
  const task: DailyTask = {
    id: uid(),
    date: stamp.date,
    order,
    masterTaskId: master.id,
    category: master.category,
    name: master.name,
    estimatedSeconds: master.estimatedSeconds,
    hasPlan: false,
    status: "paused",
    segments,
    accumulatedMs: endedAt - startedAt,
    startedAt,
    stoppedAt: endedAt,
    isSpontaneous: true,
  };
  await db.dailyTasks.add(task);
  await finishDailyTask(task, { segments, startedAt, endAtMs: endedAt });
  await db.quickStamps.update(stamp.id, { recordId: task.id, recordLabel: `${master.category} / ${master.name}`, skipped: false });
}
