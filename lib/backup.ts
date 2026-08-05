import { db } from "./db";

const TABLE_NAMES = [
  "masterTasks",
  "templateItems",
  "dailyTasks",
  "records",
  "settings",
  "projects",
  "todoLists",
  "todoTasks",
] as const;

export interface BackupFile {
  app: "koutei-hyo";
  version: 1;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    tables[name] = await db.table(name).toArray();
  }
  return { app: "koutei-hyo", version: 1, exportedAt: new Date().toISOString(), tables };
}

// 現在のデータを全て消去し、バックアップの内容で置き換える（元に戻せないため呼び出し側で確認を取ること）
export async function importBackup(data: BackupFile): Promise<{ restoredTables: number; restoredRows: number }> {
  let restoredTables = 0;
  let restoredRows = 0;
  await db.transaction("rw", db.tables, async () => {
    for (const name of TABLE_NAMES) {
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
  return { restoredTables, restoredRows };
}
