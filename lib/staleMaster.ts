import type { MasterTask, WorkRecord } from "./types";

export interface StaleMasterRow {
  task: MasterTask;
  lastUsedDate: string | null;
  daysSinceLastUse: number;
}

// 最終実績日からthresholdDays以上経過している（一度も実績がない場合は登録日を起点にする）
// お気に入り以外・未アーカイブの作業マスタを、アーカイブ候補として検出する
export function computeStaleMasterTasks(
  masterTasks: MasterTask[],
  records: WorkRecord[],
  thresholdDays: number,
  today: string
): StaleMasterRow[] {
  const lastUsedByMaster = new Map<string, string>();
  for (const r of records) {
    if (!r.masterTaskId) continue;
    const cur = lastUsedByMaster.get(r.masterTaskId);
    if (!cur || r.date > cur) lastUsedByMaster.set(r.masterTaskId, r.date);
  }
  const todayMs = new Date(today + "T00:00:00").getTime();
  const rows: StaleMasterRow[] = [];
  for (const t of masterTasks) {
    if (t.archived || t.isFavorite) continue;
    const lastUsedDate = lastUsedByMaster.get(t.id) ?? null;
    const daysSinceLastUse = Math.round(
      (todayMs - (lastUsedDate ? new Date(lastUsedDate + "T00:00:00").getTime() : t.createdAt)) / 86400000
    );
    if (daysSinceLastUse >= thresholdDays) {
      rows.push({ task: t, lastUsedDate, daysSinceLastUse });
    }
  }
  return rows.sort((a, b) => b.daysSinceLastUse - a.daysSinceLastUse);
}
