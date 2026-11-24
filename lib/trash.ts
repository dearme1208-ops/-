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

/** 「元に戻す」を押した時、控えが既にゴミ箱から戻されていた場合の知らせ */
export const TRASH_ALREADY_RESTORED_MESSAGE = "ゴミ箱から既に戻されています";

/** ゴミ箱に入れた控えが既に無い(ゴミ箱から戻した/完全に消した)か。trashIdが無ければfalse。
 *  「元に戻す」はこれがtrueなら何もしない(二重に足さない・消したものを蘇らせない) */
export async function isTrashItemGone(trashId: string | null | undefined): Promise<boolean> {
  return !!trashId && !(await db.trash.get(trashId));
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
  // 実績・作業マスタを戻したら、そのマスタの想定時間を数え直す(master.tsはこのファイルを読むので遅延読み込み)
  const masterIds = new Set<string>();
  for (const group of item.rows) {
    if (group.table === "records") {
      for (const row of group.rows as { masterTaskId?: string }[]) if (row.masterTaskId) masterIds.add(row.masterTaskId);
    } else if (group.table === "masterTasks") {
      for (const row of group.rows as { id?: string }[]) if (row.id) masterIds.add(row.id);
    }
  }
  if (masterIds.size > 0 && restored > 0) {
    const { recomputeEstimateFromRecords } = await import("./master");
    for (const mid of masterIds) await recomputeEstimateFromRecords(mid);
  }
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
