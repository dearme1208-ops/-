import { db } from "./db";
import type { TrashItem, TrashKind } from "./types";

// ゴミ箱: 削除した行を7日間とっておく。各画面の削除処理は、消す直前の行を putInTrash に渡すだけでよい。
// 戻す時は、同じidの行が既にある(作り直された等)場合はその行を上書きしない(新しいデータを壊さない)。

export const TRASH_KEEP_DAYS = 7;
const KEEP_MS = TRASH_KEEP_DAYS * 24 * 60 * 60 * 1000;

type TableName = keyof typeof db & string;

/** 消した行をゴミ箱に入れる。tables は { テーブル名: 行の配列 }。空の配列は無視する。
 *  削除と同じトランザクションの中で呼ぶ場合は、そのトランザクションに db.trash を含めること */
export async function putInTrash(kind: TrashKind, label: string, tables: Record<string, unknown[]>): Promise<string | null> {
  const rows = Object.entries(tables)
    .filter(([, r]) => Array.isArray(r) && r.length > 0)
    .map(([table, r]) => ({ table, rows: r }));
  if (rows.length === 0) return null;
  const item: TrashItem = { id: crypto.randomUUID(), kind, label, deletedAt: Date.now(), rows };
  await db.trash.add(item);
  return item.id;
}

/** ゴミ箱から戻す。戻した行数と、既に同じidがあって戻さなかった行数を返す */
export async function restoreFromTrash(id: string): Promise<{ restored: number; skipped: number } | null> {
  const tableNames = new Set<string>(["trash"]);
  const item = await db.trash.get(id);
  if (!item) return null;
  for (const r of item.rows) tableNames.add(r.table);
  const tables = [...tableNames].map((n) => db.table(n));
  let restored = 0;
  let skipped = 0;
  await db.transaction("rw", tables, async () => {
    for (const group of item.rows) {
      const t = db.table(group.table);
      for (const row of group.rows as { [k: string]: unknown }[]) {
        const key = (row as Record<string, unknown>)[t.schema.primKey.keyPath as string] as string | undefined;
        if (key !== undefined && (await t.get(key))) {
          skipped++;
          continue;
        }
        await t.add(row);
        restored++;
      }
    }
    await db.trash.delete(id);
  });
  return { restored, skipped };
}

/** ゴミ箱から完全に消す */
export async function deleteFromTrash(id: string): Promise<void> {
  await db.trash.delete(id);
}

/** 7日より古いものを消す(起動時に1日1回呼ぶ) */
export async function purgeOldTrash(now = Date.now()): Promise<number> {
  return db.trash.where("deletedAt").below(now - KEEP_MS).delete();
}

export type { TableName };
