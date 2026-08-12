import { db } from "./db";
import { computeIqrBounds, isOutlier } from "./stats";
import type { WorkRecord } from "./types";

function groupKey(r: WorkRecord): string {
  return r.masterTaskId ?? `${r.category}::${r.name}`;
}

/**
 * 実績を「同じ作業」(masterTaskId、無ければ区分::作業名)ごとにグループ化し、
 * グループ内(＝他の日・平均と比べて)でIQR外れ値判定を行う。manualOverride=true の
 * レコードは自動判定の対象外とし、既に手動設定されているexcludedFromStatsの値を
 * そのまま使う（ユーザー指定を尊重）。DBへは書き込まない純粋な計算関数で、
 * 実績一覧から都度リアルタイムに外れ値を求めたい場合(残業分析など)にも使える。
 */
export function computeRecordOutliers(records: WorkRecord[]): Map<string, boolean> {
  const groups = new Map<string, WorkRecord[]>();
  for (const r of records) {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result = new Map<string, boolean>();
  for (const group of groups.values()) {
    const autoTargets = group.filter((r) => !r.manualOverride);
    const bounds = computeIqrBounds(autoTargets.map((r) => r.seconds));
    for (const r of autoTargets) {
      result.set(r.id, isOutlier(r.seconds, bounds));
    }
    for (const r of group) {
      if (r.manualOverride) result.set(r.id, !!r.excludedFromStats);
    }
  }
  return result;
}

/**
 * 同一作業ごとにIQR外れ値判定を行い、excludedFromStats を更新する。
 * manualOverride=true のレコードは対象外（ユーザー指定を尊重）。
 */
export async function recomputeOutliersForAll(): Promise<void> {
  const all = await db.records.toArray();
  const outlierFlags = computeRecordOutliers(all);

  const updates: { id: string; excludedFromStats: boolean; excludeReason?: "auto-iqr" }[] = [];
  for (const r of all) {
    if (r.manualOverride) continue;
    const outlier = outlierFlags.get(r.id) ?? false;
    if (r.excludedFromStats !== outlier || r.excludeReason !== (outlier ? "auto-iqr" : undefined)) {
      updates.push({ id: r.id, excludedFromStats: outlier, excludeReason: outlier ? "auto-iqr" : undefined });
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

// 集計に復活させる。以後の自動判定（手動で明示的に再計算した場合のみ）でも
// 上書きされないよう、manualOverrideは立てたままにする
export async function clearManualOverride(recordId: string): Promise<void> {
  await db.records.update(recordId, {
    excludedFromStats: false,
    excludeReason: undefined,
    manualOverride: true,
  });
}
