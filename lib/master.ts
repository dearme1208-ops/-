import { db, uid } from "./db";
import type { MasterTask } from "./types";
import type { ParsedMasterRow } from "./masterCsv";

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

// 大量の実績CSVを取り込む際に使う一括版。行ごとにテーブル全体を走査するのを避けるため、
// 既存マスタを1回だけ読み込み、未登録の組み合わせだけをbulkAddする。
export async function bulkFindOrCreateMasterTasks(
  pairs: { category: string; name: string }[]
): Promise<Map<string, MasterTask>> {
  const existing = await db.masterTasks.toArray();
  const map = new Map<string, MasterTask>();
  for (const t of existing) map.set(`${t.category}::${t.name}`, t);

  const now = Date.now();
  const toCreate: MasterTask[] = [];
  for (const { category, name } of pairs) {
    const key = `${category}::${name}`;
    if (map.has(key)) continue;
    const task: MasterTask = {
      id: uid(),
      category,
      name,
      estimatedSeconds: 0,
      isFavorite: false,
      sampleCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    map.set(key, task);
    toCreate.push(task);
  }
  if (toCreate.length > 0) {
    await db.masterTasks.bulkAdd(toCreate);
  }
  return map;
}

// 全マスタの想定時間を、現在の外れ値判定を反映した実績平均で再計算する。
// 一括インポート直後など、想定時間が外れ値込みの平均のまま残ってしまった場合の復旧用。
export async function recomputeAllMasterEstimates(): Promise<void> {
  const allIds = (await db.masterTasks.toArray()).map((t) => t.id);
  await recomputeEstimatesForMasterTasks(allIds);
}

// recomputeEstimateFromRecordsの一括版。全実績を1回だけ読み込み、対象マスタIDごとに平均を計算して更新する。
export async function recomputeEstimatesForMasterTasks(masterTaskIds: Iterable<string>): Promise<void> {
  const idSet = new Set(masterTaskIds);
  if (idSet.size === 0) return;
  const allRecords = await db.records.toArray();
  const grouped = new Map<string, number[]>();
  for (const r of allRecords) {
    if (!r.masterTaskId || !idSet.has(r.masterTaskId) || r.excludedFromStats) continue;
    if (!grouped.has(r.masterTaskId)) grouped.set(r.masterTaskId, []);
    grouped.get(r.masterTaskId)!.push(r.seconds);
  }

  const now = Date.now();
  await db.transaction("rw", db.masterTasks, async () => {
    for (const [id, secs] of grouped) {
      const avg = secs.reduce((sum, s) => sum + s, 0) / secs.length;
      await db.masterTasks.update(id, {
        estimatedSeconds: Math.round(avg),
        sampleCount: secs.length,
        updatedAt: now,
      });
    }
  });
}

// CSVから作業マスタを一括登録・更新する。id一致 → 区分+作業名一致 → 新規作成の順でマッチングする
export async function upsertMasterTasksFromCsv(
  rows: ParsedMasterRow[]
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  const now = Date.now();

  await db.transaction("rw", db.masterTasks, async () => {
    for (const row of rows) {
      let existing: MasterTask | undefined;
      if (row.id) {
        existing = await db.masterTasks.get(row.id);
      }
      if (!existing) {
        existing = await db.masterTasks
          .filter((t) => t.category === row.category && t.name === row.name)
          .first();
      }

      if (existing) {
        await db.masterTasks.update(existing.id, {
          category: row.category,
          name: row.name,
          estimatedSeconds: row.estimatedSeconds,
          isFavorite: row.isFavorite,
          updatedAt: now,
        });
        updated++;
      } else {
        const task: MasterTask = {
          id: row.id || uid(),
          category: row.category,
          name: row.name,
          estimatedSeconds: row.estimatedSeconds,
          isFavorite: row.isFavorite,
          sampleCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        await db.masterTasks.add(task);
        created++;
      }
    }
  });

  return { created, updated };
}
