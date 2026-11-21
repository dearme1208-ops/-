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

// バックアップをファイルに書くためのJSONを、いくつかの文字列に分けて返す(順につなげると
// JSON.stringify(data) と同じ構造のJSONになる)。Blobやファイルへはこの配列のまま渡す。
// 全体を1つの文字列にすると、画像やメールを多く添付したデータではブラウザが扱える
// 文字列の長さの上限を超えて書き出しそのものが失敗する(=控えが取れなくなる)ため、
// テーブルごと・一定の大きさごとに区切る。字下げは付けない(復元はどちらの形でも読める)
const BACKUP_CHUNK_CHARS = 4_000_000;

export function backupJsonParts(data: BackupFile): string[] {
  const { tables, ...head } = data;
  const headJson = JSON.stringify(head);
  // 先頭の項目(app・version・exportedAt)の後ろにtablesを続ける
  const parts: string[] = [`${headJson.slice(0, -1)}${headJson === "{}" ? "" : ","}"tables":{`];
  Object.keys(tables).forEach((name, tableIndex) => {
    parts.push(`${tableIndex > 0 ? "," : ""}${JSON.stringify(name)}:[`);
    let chunk = "";
    tables[name].forEach((row, rowIndex) => {
      // undefinedの行はJSON.stringifyが配列の中でnullにするのと同じ扱いにする
      chunk += (rowIndex > 0 ? "," : "") + (JSON.stringify(row) ?? "null");
      if (chunk.length >= BACKUP_CHUNK_CHARS) {
        parts.push(chunk);
        chunk = "";
      }
    });
    parts.push(chunk + "]");
  });
  parts.push("}}");
  return parts;
}

/** 復元の確認に出す、ファイルの中身のあらまし(主なデータの件数) */
export function summarizeBackup(data: BackupFile): { label: string; count: number | null }[] {
  const count = (names: string[]): number | null => {
    const present = names.filter((name) => Array.isArray(data.tables?.[name]));
    if (present.length === 0) return null; // このファイルには入っていない(復元しても今のデータに触れない)
    return present.reduce((sum, name) => sum + data.tables[name].length, 0);
  };
  return [
    { label: "作業", count: count(["dailyTasks"]) },
    { label: "実績", count: count(["records"]) },
    { label: "ToDo", count: count(["todoTasks"]) },
    { label: "案件", count: count(["projects"]) },
    { label: "メモ", count: count(["memoNotes"]) },
  ];
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
  // 中身が配列でないテーブルは壊れているとみなして触れない(以前は空として扱い、
  // そのテーブルの今のデータを消してしまっていた)
  const valid = (name: string) => known.has(name) && Array.isArray(data.tables[name]);
  const names = fileTableNames.filter(valid);
  const skippedTables = fileTableNames.filter((name) => !valid(name));
  let restoredTables = 0;
  let restoredRows = 0;
  await db.transaction("rw", db.tables, async () => {
    for (const name of names) {
      const rows = data.tables[name] as unknown[];
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
