import { db } from "./db";

// 復元しても意味がないため書き出さないテーブル。気象予報は取得時刻とセットの
// 自動取得キャッシュで、復元した時点では既に古くなっている（地点そのものは
// weatherPlacesに入っており、そちらは書き出される）
const CACHE_TABLES = new Set(["weatherForecasts"]);

// バックアップ対象はdb.tablesから毎回求める。ここに一覧を直書きすると、テーブルを
// 追加したときに追記を忘れてそのテーブルだけ書き出されない事故が起きるため
// （実際にメモ・統合ボード・マンダラ等が長らく書き出されていなかった）
function backupTableNames(): string[] {
  return db.tables.map((t) => t.name).filter((name) => !CACHE_TABLES.has(name));
}

export interface BackupFile {
  app: "koutei-hyo";
  // 1 = 一部のテーブルしか含まない旧形式、2 = キャッシュを除く全テーブルを含む
  version: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const name of backupTableNames()) {
    tables[name] = await db.table(name).toArray();
  }
  return { app: "koutei-hyo", version: 2, exportedAt: new Date().toISOString(), tables };
}

// 現在のデータを、バックアップファイルに含まれるテーブルの分だけ置き換える
// （元に戻せないため呼び出し側で確認を取ること）。
// ファイルに無いテーブルには触れない。これにより旧形式(version 1)のファイルを
// 復元しても、そこに含まれていないメモ・統合ボード等が巻き添えで消えることはない。
// このアプリが知らないテーブルが入っていた場合（新しい版で取ったバックアップを
// 古い版で復元しようとした場合など）は復元できないため、skippedTablesで返す
export async function importBackup(
  data: BackupFile
): Promise<{ restoredTables: number; restoredRows: number; skippedTables: string[] }> {
  const known = new Set(db.tables.map((t) => t.name));
  const fileTableNames = Object.keys(data.tables ?? {});
  const names = fileTableNames.filter((name) => known.has(name));
  const skippedTables = fileTableNames.filter((name) => !known.has(name));
  let restoredTables = 0;
  let restoredRows = 0;
  await db.transaction("rw", db.tables, async () => {
    for (const name of names) {
      const rows = data.tables[name];
      const table = db.table(name);
      await table.clear();
      if (rows && rows.length > 0) {
        await table.bulkAdd(rows);
        restoredRows += rows.length;
      }
      restoredTables++;
    }
  });
  return { restoredTables, restoredRows, skippedTables };
}
