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

// ダウンロードしたアーカイブに入っている行だけを削除する。
// 以前は削除ボタンを押した時点で「指定日より前」を検索し直していたため、ダウンロードの後に
// 追加した過去日の実績(ファイルに入っていない)まで一緒に消えていた。
// ダウンロードの後に書き換えた行も、ファイルの内容とは違う=控えが無いので消さずに残し、
// 件数をkeptChangedで返す
export async function deleteArchivedItems(
  archive: Pick<ArchiveFile, "records" | "dailyTasks">
): Promise<{ deletedRecords: number; deletedDailyTasks: number; keptChanged: number }> {
  return db.transaction("rw", db.records, db.dailyTasks, async () => {
    let keptChanged = 0;
    // 行の中身は書き出した時と同じ並びで保存されているので、文字列にして比べれば足りる。
    // 万一並びが違って「変わった」と判定されても、消さずに残る側に倒れるだけで害はない
    const unchangedIds = async <T extends { id: string }>(
      exported: T[],
      getCurrent: (ids: string[]) => Promise<(T | undefined)[]>
    ) => {
      const current = await getCurrent(exported.map((row) => row.id));
      const ids: string[] = [];
      exported.forEach((row, i) => {
        const now = current[i];
        if (!now) return; // 既に無い
        if (JSON.stringify(now) === JSON.stringify(row)) ids.push(row.id);
        else keptChanged++;
      });
      return ids;
    };
    const recordIds = await unchangedIds(archive.records, (ids) => db.records.bulkGet(ids));
    const dailyTaskIds = await unchangedIds(archive.dailyTasks, (ids) => db.dailyTasks.bulkGet(ids));
    await db.records.bulkDelete(recordIds);
    await db.dailyTasks.bulkDelete(dailyTaskIds);
    return { deletedRecords: recordIds.length, deletedDailyTasks: dailyTaskIds.length, keptChanged };
  });
}

/** 読み込んだJSONが月次アーカイブのファイルか(全体バックアップとは形が違い、tablesを持たない) */
export function isArchiveFile(data: unknown): data is ArchiveFile {
  if (!data || typeof data !== "object") return false;
  const d = data as Partial<ArchiveFile>;
  return d.app === "koutei-hyo" && d.kind === "archive" && Array.isArray(d.records) && Array.isArray(d.dailyTasks);
}

// アーカイブを今のデータに足し戻す。以前は書き出して削除する一方で、戻す手段が無かった
// (「バックアップから復元」に渡しても別形式として弾かれていた)。
// 今あるデータは消さない。同じidの行が既にある場合も今の内容を優先して上書きしない
// (アーカイブを取った後に手直しした行を、古い内容へ巻き戻さないため)
export async function restoreArchive(
  archive: Pick<ArchiveFile, "records" | "dailyTasks">
): Promise<{ restoredRecords: number; restoredDailyTasks: number; skippedExisting: number }> {
  const hasId = (row: unknown): row is { id: string } =>
    !!row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" && (row as { id: string }).id !== "";
  const records = archive.records.filter(hasId);
  const dailyTasks = archive.dailyTasks.filter(hasId);
  return db.transaction("rw", db.records, db.dailyTasks, async () => {
    const existingRecords = await db.records.bulkGet(records.map((r) => r.id));
    const existingDailyTasks = await db.dailyTasks.bulkGet(dailyTasks.map((t) => t.id));
    const newRecords = records.filter((_, i) => !existingRecords[i]);
    const newDailyTasks = dailyTasks.filter((_, i) => !existingDailyTasks[i]);
    await db.records.bulkPut(newRecords);
    await db.dailyTasks.bulkPut(newDailyTasks);
    return {
      restoredRecords: newRecords.length,
      restoredDailyTasks: newDailyTasks.length,
      skippedExisting: records.length - newRecords.length + (dailyTasks.length - newDailyTasks.length),
    };
  });
}
