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

// 体調は「記録した時点から、次に体調を変更するまで」有効なものとして扱う。
// 各実績(WorkRecord)の作業時間中に体調が切り替わっていた場合は、切り替え前後で
// より長い時間を占めていた方の体調にその実績全体を割り当てる（多数決）。
// 想定時間との比較（想定÷実績）を体調レベルごとに平均して生産性の目安とする
export function computeProductivityByCondition(
  conditionLogs: ConditionLog[],
  records: WorkRecord[],
  masterTasks: MasterTask[]
): ConditionProductivityRow[] {
  const estimatedByKey = new Map<string, number>();
  for (const m of masterTasks) {
    if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }

  const logsByDate = new Map<string, ConditionLog[]>();
  for (const log of conditionLogs) {
    if (!logsByDate.has(log.date)) logsByDate.set(log.date, []);
    logsByDate.get(log.date)!.push(log);
  }
  for (const logs of logsByDate.values()) logs.sort((a, b) => a.loggedAt - b.loggedAt);

  function levelActiveAt(date: string, ms: number): string | null {
    const logs = logsByDate.get(date);
    if (!logs) return null;
    let active: string | null = null;
    for (const log of logs) {
      if (log.loggedAt > ms) break;
      active = log.level;
    }
    return active;
  }

  // 実績の作業時間[startedAt, endedAt)を、その間に発生した体調切り替えで区切り、
  // 区間ごとの経過時間をレベル別に合計して最も長いレベルを返す
  function dominantLevel(date: string, startedAt: number, endedAt: number): string | null {
    const startLevel = levelActiveAt(date, startedAt);
    const end = Math.max(endedAt, startedAt);
    if (end <= startedAt) return startLevel;

    const logs = logsByDate.get(date) ?? [];
    const switchesInRange = logs.filter((log) => log.loggedAt > startedAt && log.loggedAt < end);
    if (switchesInRange.length === 0) return startLevel;

    const durationByLevel = new Map<string, number>();
    let cursor = startedAt;
    let currentLevel = startLevel;
    for (const log of switchesInRange) {
      if (currentLevel) {
        durationByLevel.set(currentLevel, (durationByLevel.get(currentLevel) ?? 0) + (log.loggedAt - cursor));
      }
      cursor = log.loggedAt;
      currentLevel = log.level;
    }
    if (currentLevel) {
      durationByLevel.set(currentLevel, (durationByLevel.get(currentLevel) ?? 0) + (end - cursor));
    }
    if (durationByLevel.size === 0) return null;

    let best: string | null = null;
    let bestDuration = -1;
    for (const [level, duration] of durationByLevel) {
      if (duration > bestDuration) {
        bestDuration = duration;
        best = level;
      }
    }
    return best;
  }

  const byLevel = new Map<string, { sumPct: number; count: number }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.startedAt || r.seconds <= 0) continue;
    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (!estimatedSeconds) continue;
    const level = dominantLevel(r.date, r.startedAt, r.endedAt);
    if (!level) continue;
    const pct = (estimatedSeconds / r.seconds) * 100;
    if (!byLevel.has(level)) byLevel.set(level, { sumPct: 0, count: 0 });
    const entry = byLevel.get(level)!;
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
