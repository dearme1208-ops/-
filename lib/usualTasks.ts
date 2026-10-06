import type { MasterTask, WorkRecord } from "./types";

// 「いつもの作業」: 過去の実績から、今の時間帯・曜日(平日/休日)によくやっている作業を選ぶ。
// 作業を追加する時に、毎回マスタから探したり名前を入れたりしなくて済むよう一番上に出す

const isWeekend = (date: string) => {
  const d = new Date(`${date}T00:00:00`).getDay();
  return d === 0 || d === 6;
};

/**
 * 過去 days 日の実績のうち、今と同じ平日/休日で、開始時刻が今の前後 windowHours 時間に入るものを
 * 作業マスタごとに数え、多い順(同数なら最近やった順)に limit 件返す。
 * 2回以上やったものだけを「いつもの」とみなす
 */
export function pickUsualMasters(
  records: WorkRecord[],
  masters: MasterTask[],
  now: Date,
  { limit = 3, windowHours = 1.5, exclude = new Set<string>() }: { limit?: number; windowHours?: number; exclude?: Set<string> } = {}
): MasterTask[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekend = isWeekend(todayStr);
  const byId = new Map(masters.filter((m) => !m.archived).map((m) => [m.id, m]));
  const score = new Map<string, { count: number; last: number }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId || !byId.has(r.masterTaskId) || exclude.has(r.masterTaskId)) continue;
    if (isWeekend(r.date) !== weekend) continue;
    const s = new Date(r.startedAt);
    const min = s.getHours() * 60 + s.getMinutes();
    const diff = Math.min(Math.abs(min - nowMin), 1440 - Math.abs(min - nowMin));
    if (diff > windowHours * 60) continue;
    const cur = score.get(r.masterTaskId) ?? { count: 0, last: 0 };
    score.set(r.masterTaskId, { count: cur.count + 1, last: Math.max(cur.last, r.startedAt) });
  }
  return [...score.entries()]
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)
    .slice(0, limit)
    .map(([id]) => byId.get(id)!);
}
