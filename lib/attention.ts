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
