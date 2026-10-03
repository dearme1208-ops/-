import { db, uid } from "./db";
import { addManualRecord } from "./tasks";
import { todayStr } from "./time";
import type { QuickStamp } from "./types";

// 打刻(📍)。計測の開始・完了を押す余裕がない時に、ボタン1回で時刻だけ残しておき、
// 落ち着いてから「打刻から次の打刻まで」を実績に変える

export async function addQuickStamp(at: number = Date.now(), note?: string): Promise<QuickStamp> {
  const stamp: QuickStamp = { id: uid(), date: todayStr(new Date(at)), at, ...(note?.trim() ? { note: note.trim() } : {}) };
  await db.quickStamps.add(stamp);
  return stamp;
}

export interface StampSpan {
  stamp: QuickStamp;
  /** 区間の終わり(次の打刻、またはその前に計測を始めた時刻)。どちらも無ければ undefined */
  nextAt?: number;
  /** 区間の終わりが、計測の開始で決まったか */
  endedByMeasure?: boolean;
}

/**
 * 打刻を時刻順に並べ、それぞれ「次の打刻まで」の区間にする。
 * 打刻の後で作業の計測を始めていれば、そこで区間を終える(計測した時間を二重に記録しないように)。
 * measureStarts はその日の計測の開始時刻
 */
export function stampSpans(stamps: QuickStamp[], measureStarts: number[] = []): StampSpan[] {
  const sorted = [...stamps].sort((a, b) => a.at - b.at);
  return sorted.map((stamp, i) => {
    const nextStamp = sorted[i + 1]?.at;
    const firstMeasure = measureStarts.filter((t) => t > stamp.at).reduce<number | undefined>((m, t) => (m === undefined || t < m ? t : m), undefined);
    if (firstMeasure !== undefined && (nextStamp === undefined || firstMeasure < nextStamp)) {
      return { stamp, nextAt: firstMeasure, endedByMeasure: true };
    }
    return { stamp, nextAt: nextStamp };
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

/** 打刻の区間を実績に変える。実績のIDを打刻に残し、二重に記録しないようにする */
export async function convertStampToRecord(
  stamp: QuickStamp,
  category: string,
  name: string,
  startedAt: number,
  endedAt: number
): Promise<void> {
  const recordId = await addManualRecord(stamp.date, category, name, startedAt, endedAt);
  await db.quickStamps.update(stamp.id, { recordId, recordLabel: `${category} / ${name}`, skipped: false });
}
