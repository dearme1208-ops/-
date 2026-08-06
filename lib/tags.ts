import type { MasterTask, WorkRecord } from "./types";

export interface TagTimeRow {
  tag: string;
  totalSeconds: number;
}

// 作業マスタに付けたタグごとに、紐づく実績の合計時間を集計する
export function computeTimeByTag(records: WorkRecord[], masterTasks: MasterTask[]): TagTimeRow[] {
  const tagsByMaster = new Map<string, string[]>();
  for (const m of masterTasks) {
    if (m.tags && m.tags.length > 0) tagsByMaster.set(m.id, m.tags);
  }
  const totals = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId) continue;
    const tags = tagsByMaster.get(r.masterTaskId);
    if (!tags) continue;
    for (const tag of tags) {
      totals.set(tag, (totals.get(tag) ?? 0) + r.seconds);
    }
  }
  return [...totals.entries()]
    .map(([tag, totalSeconds]) => ({ tag, totalSeconds }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}
