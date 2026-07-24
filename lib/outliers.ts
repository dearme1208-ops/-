import { db } from "./db";
import { computeIqrBounds, isOutlier } from "./stats";
import type { WorkRecord } from "./types";

function groupKey(r: WorkRecord): string {
  return r.masterTaskId ?? `${r.category}::${r.name}`;
}

/**
 * 同一作業ごとにIQR外れ値判定を行い、excludedFromStats を更新する。
 * manualOverride=true のレコードは対象外（ユーザー指定を尊重）。
 */
export async function recomputeOutliersForAll(): Promise<void> {
  const all = await db.records.toArray();
  const groups = new Map<string, WorkRecord[]>();
  for (const r of all) {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const updates: { id: string; excludedFromStats: boolean; excludeReason?: "auto-iqr" }[] = [];
  for (const records of groups.values()) {
    const autoTargets = records.filter((r) => !r.manualOverride);
    const bounds = computeIqrBounds(autoTargets.map((r) => r.seconds));
    for (const r of autoTargets) {
      const outlier = isOutlier(r.seconds, bounds);
      if (r.excludedFromStats !== outlier || r.excludeReason !== (outlier ? "auto-iqr" : undefined)) {
        updates.push({ id: r.id, excludedFromStats: outlier, excludeReason: outlier ? "auto-iqr" : undefined });
      }
    }
  }

  if (updates.length === 0) return;
  await db.transaction("rw", db.records, async () => {
    for (const u of updates) {
      await db.records.update(u.id, { excludedFromStats: u.excludedFromStats, excludeReason: u.excludeReason });
    }
  });
}

export async function setManualOverride(recordId: string, excluded: boolean): Promise<void> {
  await db.records.update(recordId, {
    excludedFromStats: excluded,
    excludeReason: excluded ? "manual" : undefined,
    manualOverride: true,
  });
}

export async function clearManualOverride(recordId: string): Promise<void> {
  await db.records.update(recordId, { manualOverride: false });
  await recomputeOutliersForAll();
}
