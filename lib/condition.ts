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

// 日付ごとの体調ログから、任意の時刻に有効だった体調レベル、および任意の作業時間
// [startedAt, endedAt)における「多数決」レベルを求める関数を組み立てる
function buildConditionLookup(conditionLogs: ConditionLog[]) {
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

  return { dominantLevel };
}

// 指定した作業時間[startedAt, endedAt]中、集計(生産性分析など)と同じ「多数決」ロジックで
// 有効だったとみなせる体調レベルを返す。本日の作業画面での表示にも使い、集計と表示の
// 前提を一致させる（体調の記録がその作業中に無くても、直前の記録が繰り越される）
export function dominantConditionLevel(
  conditionLogs: ConditionLog[],
  date: string,
  startedAt: number,
  endedAt: number
): string | null {
  const { dominantLevel } = buildConditionLookup(conditionLogs);
  return dominantLevel(date, startedAt, endedAt);
}

interface LeveledRecord {
  record: WorkRecord;
  level: string;
}

// 体調を記録している間に行われた実績を、それぞれ多数決で決まる体調レベルに割り当てる
function attributeRecordsByCondition(conditionLogs: ConditionLog[], records: WorkRecord[]): LeveledRecord[] {
  const { dominantLevel } = buildConditionLookup(conditionLogs);
  const out: LeveledRecord[] = [];
  for (const r of records) {
    if (r.excludedFromStats || !r.startedAt || r.seconds <= 0) continue;
    const level = dominantLevel(r.date, r.startedAt, r.endedAt);
    if (!level) continue;
    out.push({ record: r, level });
  }
  return out;
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

  const byLevel = new Map<string, { sumPct: number; count: number }>();
  for (const { record: r, level } of attributeRecordsByCondition(conditionLogs, records)) {
    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (!estimatedSeconds) continue;
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

export interface ConditionVarianceLevelStat {
  level: string;
  avgProductivityPct: number;
  sampleCount: number;
}

export interface ConditionVarianceRow {
  masterTaskId: string;
  category: string;
  name: string;
  estimatedSeconds: number;
  levels: ConditionVarianceLevelStat[]; // 体調レベルごとの平均達成度（達成度の高い順）
  rangePct: number; // レベル間の達成度の最大差（ポイント）。大きいほど体調に左右されやすい
}

// 作業ごとに、体調レベル別の達成度（想定÷実績）を比べ、レベル間の差が大きい
// （＝体調によって所要時間の増減が激しい）作業を、差の大きい順にピックアップする
export function computeConditionVarianceByTask(
  conditionLogs: ConditionLog[],
  records: WorkRecord[],
  masterTasks: MasterTask[],
  minSamplesPerLevel = 2,
  minLevels = 2
): ConditionVarianceRow[] {
  const masterById = new Map(masterTasks.map((m) => [m.id, m]));

  const byTaskLevel = new Map<string, Map<string, { sumPct: number; count: number }>>();
  for (const { record: r, level } of attributeRecordsByCondition(conditionLogs, records)) {
    if (!r.masterTaskId) continue;
    const master = masterById.get(r.masterTaskId);
    if (!master || master.estimatedSeconds <= 0) continue;
    const pct = (master.estimatedSeconds / r.seconds) * 100;
    if (!byTaskLevel.has(r.masterTaskId)) byTaskLevel.set(r.masterTaskId, new Map());
    const levelMap = byTaskLevel.get(r.masterTaskId)!;
    if (!levelMap.has(level)) levelMap.set(level, { sumPct: 0, count: 0 });
    const entry = levelMap.get(level)!;
    entry.sumPct += pct;
    entry.count += 1;
  }

  const rows: ConditionVarianceRow[] = [];
  for (const [masterTaskId, levelMap] of byTaskLevel) {
    const master = masterById.get(masterTaskId)!;
    const levels: ConditionVarianceLevelStat[] = [];
    for (const [level, { sumPct, count }] of levelMap) {
      if (count < minSamplesPerLevel) continue;
      levels.push({ level, avgProductivityPct: Math.round(sumPct / count), sampleCount: count });
    }
    if (levels.length < minLevels) continue;
    levels.sort((a, b) => Number(b.level) - Number(a.level));

    const values = levels.map((l) => l.avgProductivityPct);
    const rangePct = Math.max(...values) - Math.min(...values);
    rows.push({
      masterTaskId,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
      levels,
      rangePct,
    });
  }

  return rows.sort((a, b) => b.rangePct - a.rangePct);
}

export interface ConditionShiftRow {
  masterTaskId: string;
  category: string;
  name: string;
  avgDelta: number; // 正: 作業後に体調が上向きやすい、負: 下向きやすい（体調レベルの変化量の平均）
  sampleCount: number;
  improvedCount: number;
  worsenedCount: number;
  unchangedCount: number;
}

// 各実績について「開始時点で有効だった体調」と「終了時点から見て次に記録された体調」を比較し、
// 作業ごとに体調レベルの変化量(後-前)を平均する。プラスが大きいほどその作業をした後に体調が
// 上向きやすく、マイナスが大きいほど下向きやすい傾向を表す。体調は「記録した時点から、次に
// 体調を変更するまで」有効なものとして扱う（アプリ全体で共通の考え方）ため、前後どちらも
// 日をまたいで直前・直後の記録をそのまま引き継ぐ。作業のたびに記録し直さなくても、
// 1日数回の記録があれば間の作業すべてに前後の体調が割り当てられる
export function computeConditionShiftByTask(
  conditionLogs: ConditionLog[],
  records: WorkRecord[],
  masterTasks: MasterTask[],
  minSamples = 3
): ConditionShiftRow[] {
  const masterById = new Map(masterTasks.map((m) => [m.id, m]));
  const sortedLogs = [...conditionLogs].sort((a, b) => a.loggedAt - b.loggedAt);

  function levelBefore(ms: number): string | null {
    let active: string | null = null;
    for (const log of sortedLogs) {
      if (log.loggedAt > ms) break;
      active = log.level;
    }
    return active;
  }

  function levelAfter(ms: number): string | null {
    for (const log of sortedLogs) {
      if (log.loggedAt > ms) return log.level;
    }
    return null;
  }

  const byTask = new Map<
    string,
    { sumDelta: number; count: number; improved: number; worsened: number; unchanged: number }
  >();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId || !r.startedAt || !r.endedAt || r.seconds <= 0) continue;
    const before = levelBefore(r.startedAt);
    const after = levelAfter(r.endedAt);
    if (!before || !after) continue;
    const delta = Number(after) - Number(before);
    if (!byTask.has(r.masterTaskId)) {
      byTask.set(r.masterTaskId, { sumDelta: 0, count: 0, improved: 0, worsened: 0, unchanged: 0 });
    }
    const entry = byTask.get(r.masterTaskId)!;
    entry.sumDelta += delta;
    entry.count += 1;
    if (delta > 0) entry.improved += 1;
    else if (delta < 0) entry.worsened += 1;
    else entry.unchanged += 1;
  }

  const rows: ConditionShiftRow[] = [];
  for (const [masterTaskId, { sumDelta, count, improved, worsened, unchanged }] of byTask) {
    if (count < minSamples) continue;
    const master = masterById.get(masterTaskId);
    if (!master) continue;
    rows.push({
      masterTaskId,
      category: master.category,
      name: master.name,
      avgDelta: Math.round((sumDelta / count) * 100) / 100,
      sampleCount: count,
      improvedCount: improved,
      worsenedCount: worsened,
      unchangedCount: unchanged,
    });
  }

  return rows.sort((a, b) => b.avgDelta - a.avgDelta);
}
