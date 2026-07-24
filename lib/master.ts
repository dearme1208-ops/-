import { db, uid } from "./db";
import type { MasterTask } from "./types";

export async function findOrCreateMasterTask(
  category: string,
  name: string,
  initialEstimatedSeconds = 0
): Promise<MasterTask> {
  const cat = category.trim();
  const nm = name.trim();
  const existing = await db.masterTasks
    .filter((t) => t.category === cat && t.name === nm)
    .first();
  if (existing) return existing;

  const now = Date.now();
  const task: MasterTask = {
    id: uid(),
    category: cat,
    name: nm,
    estimatedSeconds: initialEstimatedSeconds,
    isFavorite: false,
    sampleCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.masterTasks.add(task);
  return task;
}

// 実績が貯まったら、その平均値で想定時間を自動更新する
export async function recomputeEstimateFromRecords(masterTaskId: string): Promise<void> {
  const records = await db.records
    .where("masterTaskId")
    .equals(masterTaskId)
    .filter((r) => !r.excludedFromStats)
    .toArray();
  if (records.length === 0) return;
  const avg = records.reduce((sum, r) => sum + r.seconds, 0) / records.length;
  await db.masterTasks.update(masterTaskId, {
    estimatedSeconds: Math.round(avg),
    sampleCount: records.length,
    updatedAt: Date.now(),
  });
}
