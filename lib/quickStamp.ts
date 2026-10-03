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
  /** 次の打刻の時刻。最後の打刻なら undefined */
  nextAt?: number;
}

/** 打刻を時刻順に並べ、それぞれ「次の打刻まで」の区間にする */
export function stampSpans(stamps: QuickStamp[]): StampSpan[] {
  const sorted = [...stamps].sort((a, b) => a.at - b.at);
  return sorted.map((stamp, i) => ({ stamp, nextAt: sorted[i + 1]?.at }));
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
