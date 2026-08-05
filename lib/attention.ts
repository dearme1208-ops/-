import type { MasterTask, WorkRecord } from "./types";

export interface AttentionRow {
  masterTaskId: string;
  category: string;
  name: string;
  estimatedSeconds: number;
  avgSeconds: number;
  overRatio: number; // 例: 0.35 = 35%超過
  sampleCount: number;
}

const THRESHOLD = 0.3;

export function computeAttentionList(masterTasks: MasterTask[], records: WorkRecord[]): AttentionRow[] {
  const byMaster = new Map<string, WorkRecord[]>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId) continue;
    if (!byMaster.has(r.masterTaskId)) byMaster.set(r.masterTaskId, []);
    byMaster.get(r.masterTaskId)!.push(r);
  }

  const rows: AttentionRow[] = [];
  for (const task of masterTasks) {
    const recs = byMaster.get(task.id);
    if (!recs || recs.length === 0 || task.estimatedSeconds <= 0) continue;
    const avgSeconds = recs.reduce((s, r) => s + r.seconds, 0) / recs.length;
    const overRatio = avgSeconds / task.estimatedSeconds - 1;
    if (overRatio >= THRESHOLD) {
      rows.push({
        masterTaskId: task.id,
        category: task.category,
        name: task.name,
        estimatedSeconds: task.estimatedSeconds,
        avgSeconds,
        overRatio,
        sampleCount: recs.length,
      });
    }
  }
  return rows.sort((a, b) => b.overRatio - a.overRatio);
}

export interface EstimationAccuracyPoint {
  key: string;
  label: string;
  value: number; // 平均超過率(%)。0=想定通り、+20=平均20%超過、-10=平均10%早く終わった
}

// 想定時間が設定されている作業の「実績/想定 - 1」を月ごとに平均し、見積り精度の推移を出す
export function computeEstimationAccuracyTrend(
  masterTasks: MasterTask[],
  records: WorkRecord[],
  monthsCount = 6
): EstimationAccuracyPoint[] {
  const estimatedByMaster = new Map<string, number>();
  for (const task of masterTasks) {
    if (task.estimatedSeconds > 0) estimatedByMaster.set(task.id, task.estimatedSeconds);
  }

  const byMonth = new Map<string, { sumRatio: number; count: number }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId) continue;
    const estimatedSeconds = estimatedByMaster.get(r.masterTaskId);
    if (!estimatedSeconds) continue;
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { sumRatio: 0, count: 0 });
    const entry = byMonth.get(month)!;
    entry.sumRatio += r.seconds / estimatedSeconds - 1;
    entry.count += 1;
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-monthsCount)
    .map(([month, { sumRatio, count }]) => ({
      key: month,
      label: month.slice(5) + "月",
      value: Math.round((sumRatio / count) * 1000) / 10,
    }));
}
