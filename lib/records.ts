import { db } from "./db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "./master";
import { findLinkedDoneTasks } from "./tasks";
import { putInTrash } from "./trash";
import type { WorkRecord } from "./types";

// 実績1件だけを別の作業マスタ(区分/作業名)へ繋ぎ変える。
// 元になった完了済みの本日の作業(同じ日・元のマスタ・同じ案件/ToDo/手段)も一緒に繋ぎ変え、
// 本日の作業の表示と実績が食い違わないようにする。想定時間は新旧両方を数え直す
export async function relinkRecordToMaster(
  recordId: string,
  category: string,
  name: string
): Promise<{ status: "relinked"; oldMasterId?: string; newMasterId: string; movedDailyTasks: number } | { status: "unchanged" | "notFound" | "invalid" }> {
  const cat = category.trim();
  const nm = name.trim();
  if (!cat || !nm) return { status: "invalid" };
  const record = await db.records.get(recordId);
  if (!record) return { status: "notFound" };
  const master = await findOrCreateMasterTask(cat, nm, 0);
  if (master.id === record.masterTaskId && record.category === master.category && record.name === master.name) return { status: "unchanged" };

  const linked = record.masterTaskId && record.masterTaskId !== master.id ? await findLinkedDoneTasks(record) : [];
  await db.transaction("rw", db.records, db.dailyTasks, async () => {
    await db.records.update(recordId, { masterTaskId: master.id, category: master.category, name: master.name });
    for (const t of linked) await db.dailyTasks.update(t.id, { masterTaskId: master.id, category: master.category, name: master.name });
  });
  if (record.masterTaskId && record.masterTaskId !== master.id) await recomputeEstimateFromRecords(record.masterTaskId);
  await recomputeEstimateFromRecords(master.id);
  return { status: "relinked", oldMasterId: record.masterTaskId, newMasterId: master.id, movedDailyTasks: linked.length };
}

/** ゴミ箱の一覧に出す名前。例: 「実績 11/23 総務 / 電話対応 0:30」 */
export function recordTrashLabel(r: Pick<WorkRecord, "date" | "category" | "name" | "seconds">): string {
  const [, mo, d] = r.date.split("-").map(Number);
  const mins = Math.round(r.seconds / 60);
  return `実績 ${mo}/${d} ${r.category} / ${r.name} ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

/** 実績1件を消してゴミ箱に入れる。消す直前の中身とゴミ箱のIDを返す(「元に戻す」に使う) */
export async function deleteRecordToTrash(id: string): Promise<{ snapshot: WorkRecord; trashId: string | null } | undefined> {
  const res = await db.transaction("rw", db.records, db.trash, async () => {
    const snapshot = await db.records.get(id);
    if (!snapshot) return undefined;
    await db.records.delete(id);
    const trashId = await putInTrash("record", recordTrashLabel(snapshot), { records: [snapshot] });
    return { snapshot, trashId };
  });
  if (res?.snapshot.masterTaskId) await recomputeEstimateFromRecords(res.snapshot.masterTaskId);
  return res;
}

/** deleteRecordToTrash を取り消す。同じIDの行が既にあれば上書きしない(false) */
export async function undoDeleteRecord(d: { snapshot: WorkRecord; trashId: string | null }): Promise<boolean> {
  const restored = await db.transaction("rw", db.records, db.trash, async () => {
    if (await db.records.get(d.snapshot.id)) return false;
    await db.records.add(d.snapshot);
    if (d.trashId) await db.trash.delete(d.trashId);
    return true;
  });
  if (restored && d.snapshot.masterTaskId) await recomputeEstimateFromRecords(d.snapshot.masterTaskId);
  return restored;
}
