import type { MasterTask, WorkRecord } from "./types";

// 森モード(家庭)の「そろそろの家事」: 繰り返している作業の、前にやってからの日数と、いつもの間隔。
// いつもの間隔より空いたものを上に出す(責めずに「そろそろ」と知らせる)

export interface ChoreInterval {
  master: MasterTask;
  /** 前にやってからの日数 */
  daysSince: number;
  /** いつもの間隔(日)。やった日どうしの間隔の中央値 */
  usualDays: number;
  /** いつもの間隔に対する空き具合(1以上で「そろそろ」) */
  ratio: number;
}

const DAY = 86_400_000;
const dayIndex = (date: string) => Math.round(new Date(`${date}T00:00:00`).getTime() / DAY);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 3日以上(別々の日に)やったことのある作業について、前回からの日数といつもの間隔を出し、
 * 空き具合の大きい順に返す。毎日やるもの(間隔1日)は対象外、今日やったものも出さない
 */
export function choreIntervals(
  records: WorkRecord[],
  masters: MasterTask[],
  today: string,
  recurringTodoIds: Set<string> = new Set()
): ChoreInterval[] {
  const byId = new Map(masters.filter((m) => !m.archived).map((m) => [m.id, m]));
  // 一度でも案件の作業として計ったことのある作業マスタは、案件用の作業とみなして丸ごと外す
  // (案件に紐づける前に計った分など、案件の印のない実績が残っていても出さないように)
  for (const r of records) if ((r.projectId || r.stageId) && r.masterTaskId) byId.delete(r.masterTaskId);
  const days = new Map<string, Set<number>>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId || !byId.has(r.masterTaskId)) continue;
    // 案件の作業や、1回きりのToDoから計った作業は「繰り返す家事」ではない(終わった案件が
    // 「そろそろ」に出ていた)。繰り返しのToDoから計ったものだけは家事として数える
    if (r.projectId || r.stageId) continue;
    if (r.todoTaskId && !recurringTodoIds.has(r.todoTaskId)) continue;
    const set = days.get(r.masterTaskId) ?? new Set<number>();
    set.add(dayIndex(r.date));
    days.set(r.masterTaskId, set);
  }
  const todayIdx = dayIndex(today);
  const out: ChoreInterval[] = [];
  for (const [id, set] of days) {
    if (set.size < 3 || set.has(todayIdx)) continue;
    const sorted = [...set].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((d, i) => d - sorted[i]);
    const usualDays = median(gaps);
    if (usualDays < 2) continue;
    const daysSince = todayIdx - sorted[sorted.length - 1];
    out.push({ master: byId.get(id)!, daysSince, usualDays, ratio: daysSince / usualDays });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
