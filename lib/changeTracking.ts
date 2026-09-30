// ToDo・案件・段階の「対応状況(tag)をいつ変えたか」と「期日をどう動かしたか」の記録。
//
// 対応状況や期日は、編集ダイアログ・統合ボード・カレンダーのドラッグ・CSV取り込み・
// 週次レビューなど十数か所から書き換わる。各画面に記録処理を足すと必ず漏れるため、
// DB(Dexie)の作成・更新フック(lib/db.ts)から、ここの関数で一括して記録する。
// フックには「変更された項目だけ」が渡る(put()で丸ごと置き換えた場合も差分になる)

/** 期日の変更1回分 */
export interface DueChange {
  from?: string;
  to?: string;
  at: number;
}

interface Tracked {
  tag?: string;
  dueDate?: string;
  tagChangedAt?: number;
  dueHistory?: DueChange[];
  lastRecurrenceAt?: number;
}

// 1件あたりに残す期日の変更履歴の上限。延期の回数・日数の把握には十分で、DBを肥大させない
const MAX_DUE_HISTORY = 50;

const norm = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * 更新フック用: 変更内容(mods)と変更前(old)から、追加で書き込む記録用の項目を返す。
 * ・tagが変わったら tagChangedAt を今にする
 * ・dueDateが変わったら dueHistory に追記する。ただし繰り返しToDoの完了で次回の期日へ
 *   進んだ場合(lastRecurrenceAtが更新された)は延期ではなく新しい回の始まりなので、履歴を空にする
 * ・put()で丸ごと置き換えた際に記録用の項目が含まれていないと消えてしまうため、
 *   明示的に消そうとしている場合も元の値を残す
 */
export function trackItemUpdate(old: Tracked, mods: Record<string, unknown>, now: number): Partial<Tracked> {
  const out: Partial<Tracked> = {};
  if ("tagChangedAt" in mods && mods.tagChangedAt === undefined && old.tagChangedAt !== undefined) {
    out.tagChangedAt = old.tagChangedAt;
  }
  if ("dueHistory" in mods && mods.dueHistory === undefined && old.dueHistory !== undefined) {
    out.dueHistory = old.dueHistory;
  }
  if ("tag" in mods && norm(mods.tag) !== norm(old.tag)) {
    out.tagChangedAt = now;
  }
  const recurrenceAdvanced =
    "lastRecurrenceAt" in mods && mods.lastRecurrenceAt !== undefined && mods.lastRecurrenceAt !== old.lastRecurrenceAt;
  if ("dueDate" in mods && norm(mods.dueDate) !== norm(old.dueDate)) {
    if (recurrenceAdvanced) {
      out.dueHistory = [];
    } else {
      const entry: DueChange = { at: now };
      if (norm(old.dueDate) !== undefined) entry.from = old.dueDate;
      if (norm(mods.dueDate) !== undefined) entry.to = mods.dueDate as string;
      out.dueHistory = [...(old.dueHistory ?? []), entry].slice(-MAX_DUE_HISTORY);
    }
  }
  return out;
}

/** 作成フック用: 最初から対応状況が付いている場合は、作成時刻をその状況になった時刻とする */
export function trackItemCreate<T extends Tracked & { createdAt?: number }>(obj: T, now: number): void {
  if (norm(obj.tag) !== undefined && obj.tagChangedAt === undefined) obj.tagChangedAt = obj.createdAt ?? now;
}

interface TrackedStage {
  id: string;
  tag?: string;
  tagChangedAt?: number;
}

/**
 * 案件の段階(stages配列)用。段階ごとに対応状況が変わったものだけ tagChangedAt を今にし、
 * 変わっていないものは元の値を引き継ぐ(段階の配列は毎回丸ごと書き換えられるため)。
 * 何も変わらなければnull
 */
export function trackStages<S extends TrackedStage>(oldStages: S[] | undefined, newStages: S[], now: number): S[] | null {
  const oldById = new Map((oldStages ?? []).map((s) => [s.id, s]));
  let changed = false;
  const result = newStages.map((s) => {
    const before = oldById.get(s.id);
    let tagChangedAt = s.tagChangedAt;
    if (!before) {
      if (norm(s.tag) !== undefined && tagChangedAt === undefined) tagChangedAt = now;
    } else if (norm(s.tag) !== norm(before.tag)) {
      tagChangedAt = now;
    } else if (tagChangedAt === undefined) {
      tagChangedAt = before.tagChangedAt;
    }
    if (tagChangedAt === s.tagChangedAt) return s;
    changed = true;
    return { ...s, tagChangedAt };
  });
  return changed ? result : null;
}

// ---- 表示・集計用 ----

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(fromDate + "T00:00:00").getTime();
  const b = new Date(toDate + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

export interface PostponeSummary {
  /** 期日を後ろへずらした回数(前倒しや、期日を初めて設定した・外した変更は数えない) */
  count: number;
  /** ずらした日数の合計 */
  totalDays: number;
}

export function summarizePostpones(history: DueChange[] | undefined): PostponeSummary {
  let count = 0;
  let totalDays = 0;
  for (const h of history ?? []) {
    if (!h.from || !h.to) continue;
    const d = daysBetween(h.from, h.to);
    if (d > 0) {
      count++;
      totalDays += d;
    }
  }
  return { count, totalDays };
}

/** その対応状況になってから何日目か(同じ日なら1日目)。記録が無ければnull */
export function daysInStatus(tagChangedAt: number | undefined, now: number): number | null {
  if (tagChangedAt === undefined) return null;
  const start = new Date(tagChangedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - start.getTime()) / 86400000) + 1;
}

/** 「相手の返事待ち」とみなす対応状況の既定値(設定で変えられる) */
export const DEFAULT_WAITING_TAGS = ["社内確認中", "客先確認中"];
/** 返事待ちが何日目から催促の目安を出すかの既定値 */
export const DEFAULT_WAITING_NUDGE_DAYS = 3;

export interface WaitingInfo {
  tag: string;
  /** その状況になってから何日目か。記録が始まる前から付いていた印ではnull */
  days: number | null;
  /** 催促の目安(nudgeDays日目以上)に達しているか */
  overdue: boolean;
}

/** 相手待ちの対応状況なら、何日目か・催促の目安を過ぎたかを返す。相手待ちでなければnull */
export function waitingInfo(
  item: { tag?: string; tagChangedAt?: number },
  waitingTags: string[],
  nudgeDays: number,
  now: number
): WaitingInfo | null {
  const tag = norm(item.tag) as string | undefined;
  if (!tag || !waitingTags.includes(tag)) return null;
  const days = daysInStatus(item.tagChangedAt, now);
  return { tag, days, overdue: days !== null && days >= nudgeDays };
}
