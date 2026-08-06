import type { ConditionLog, MasterTask, WorkRecord } from "./types";

export const CONDITION_LEVELS = [
  { level: "5", emoji: "😀", label: "とても良い" },
  { level: "4", emoji: "🙂", label: "良い" },
  { level: "3", emoji: "😐", label: "ふつう" },
  { level: "2", emoji: "🙁", label: "やや悪い" },
  { level: "1", emoji: "😣", label: "悪い" },
];

export interface ConditionProductivityRow {
  level: string;
  avgProductivityPct: number; // 100 = 想定通り、100超は想定より速く終えられた傾向
  sampleCount: number;
}

// 体調記録に紐付いた作業（記録時点で計測中だった作業）について、その日の実績時間を
// 想定時間と比較し、体調レベルごとの平均達成度（生産性）を算出する
export function computeProductivityByCondition(
  conditionLogs: ConditionLog[],
  records: WorkRecord[],
  masterTasks: MasterTask[]
): ConditionProductivityRow[] {
  const estimatedByKey = new Map<string, number>();
  for (const m of masterTasks) {
    if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }
  const actualByDateKey = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const key = `${r.date}::${r.category}::${r.name}`;
    actualByDateKey.set(key, (actualByDateKey.get(key) ?? 0) + r.seconds);
  }

  const byLevel = new Map<string, { sumPct: number; count: number }>();
  for (const log of conditionLogs) {
    if (!log.category || !log.name) continue;
    const estimatedSeconds = estimatedByKey.get(`${log.category}::${log.name}`);
    if (!estimatedSeconds) continue;
    const actualSeconds = actualByDateKey.get(`${log.date}::${log.category}::${log.name}`);
    if (!actualSeconds) continue;
    const pct = (estimatedSeconds / actualSeconds) * 100;
    if (!byLevel.has(log.level)) byLevel.set(log.level, { sumPct: 0, count: 0 });
    const entry = byLevel.get(log.level)!;
    entry.sumPct += pct;
    entry.count += 1;
  }

  return [...byLevel.entries()]
    .map(([level, { sumPct, count }]) => ({
      level,
      avgProductivityPct: Math.round(sumPct / count),
      sampleCount: count,
    }))
    .sort((a, b) => Number(b.level) - Number(a.level));
}
