import { db } from "./db";
import type { DailyTask, WorkRecord } from "./types";

export interface ArchiveFile {
  app: "koutei-hyo";
  version: 1;
  kind: "archive";
  exportedAt: string;
  beforeDate: string; // この日付より前のデータをアーカイブした
  records: WorkRecord[];
  dailyTasks: DailyTask[];
}

// 指定日より前の実績・日次タスクをまとめて書き出し、件数を返す（削除はしない）
export async function buildArchive(beforeDate: string): Promise<ArchiveFile> {
  const records = await db.records.where("date").below(beforeDate).toArray();
  const dailyTasks = await db.dailyTasks.where("date").below(beforeDate).toArray();
  return {
    app: "koutei-hyo",
    version: 1,
    kind: "archive",
    exportedAt: new Date().toISOString(),
    beforeDate,
    records,
    dailyTasks,
  };
}

// 指定日より前の実績・日次タスクを削除する。事前に buildArchive でエクスポートしておくこと
export async function deleteArchivedRange(beforeDate: string): Promise<{ deletedRecords: number; deletedDailyTasks: number }> {
  return db.transaction("rw", db.records, db.dailyTasks, async () => {
    const recordIds = await db.records.where("date").below(beforeDate).primaryKeys();
    const dailyTaskIds = await db.dailyTasks.where("date").below(beforeDate).primaryKeys();
    await db.records.bulkDelete(recordIds);
    await db.dailyTasks.bulkDelete(dailyTaskIds);
    return { deletedRecords: recordIds.length, deletedDailyTasks: dailyTaskIds.length };
  });
}
