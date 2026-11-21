import { beforeEach, describe, expect, it } from "vitest";
import { buildArchive, deleteArchivedItems, isArchiveFile, restoreArchive } from "./archive";
import { backupJsonParts, exportBackup, importBackup, summarizeBackup, type BackupFile } from "./backup";
import { db } from "./db";
import type { DailyTask, WorkRecord } from "./types";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const record = (id: string, date: string, extra: Partial<WorkRecord> = {}): WorkRecord => ({
  id,
  date,
  category: "業務",
  name: "資料",
  masterTaskId: "m",
  seconds: 60,
  startedAt: 1,
  endedAt: 2,
  excludedFromStats: false,
  ...extra,
});
const task = (id: string, date: string) => ({ id, date, masterTaskId: "m", category: "業務", name: "資料", order: 0 }) as unknown as DailyTask;

describe("月次アーカイブ", () => {
  it("削除するのはダウンロードした行だけ。後から足した過去日の行・書き換えた行は残す", async () => {
    await db.records.bulkAdd([record("r1", "2026-09-10"), record("r2", "2026-09-11"), record("r3", "2026-10-05")]);
    await db.dailyTasks.bulkAdd([task("d1", "2026-09-10"), task("d2", "2026-10-05")]);
    const archive = await buildArchive("2026-10-01");
    expect(archive.records.map((r) => r.id).sort()).toEqual(["r1", "r2"]);

    // ダウンロードの後に: 過去日の実績を追加し、r2を手直しする
    await db.records.add(record("late", "2026-09-20"));
    await db.dailyTasks.add(task("lateTask", "2026-09-20"));
    await db.records.update("r2", { seconds: 999 });

    const result = await deleteArchivedItems(archive);
    expect(result).toEqual({ deletedRecords: 1, deletedDailyTasks: 1, keptChanged: 1 });
    expect((await db.records.toCollection().primaryKeys()).sort()).toEqual(["late", "r2", "r3"]);
    expect((await db.dailyTasks.toCollection().primaryKeys()).sort()).toEqual(["d2", "lateTask"]);
  });

  it("アーカイブのファイルは今のデータに足し戻せる(何も消さず、既にある行は上書きしない)", async () => {
    await db.records.bulkAdd([record("r1", "2026-09-10"), record("r2", "2026-09-11"), record("r3", "2026-10-05")]);
    await db.dailyTasks.bulkAdd([task("d1", "2026-09-10")]);
    const file = JSON.parse(JSON.stringify(await buildArchive("2026-10-01")));
    expect(isArchiveFile(file)).toBe(true);
    await deleteArchivedItems(file);
    expect(await db.records.count()).toBe(1);

    // 戻す前に、同じidの行が手元に1つだけ残っている(手直し済み)状況を作る
    await db.records.add(record("r2", "2026-09-11", { seconds: 999 }));
    await db.todoLists.add({ id: "l1", title: "タスク", order: 0, createdAt: 1 });

    const result = await restoreArchive(file);
    expect(result).toEqual({ restoredRecords: 1, restoredDailyTasks: 1, skippedExisting: 1 });
    expect((await db.records.toCollection().primaryKeys()).sort()).toEqual(["r1", "r2", "r3"]);
    expect((await db.records.get("r2"))!.seconds).toBe(999);
    expect(await db.records.get("r1")).toEqual(record("r1", "2026-09-10"));
    expect(await db.dailyTasks.count()).toBe(1);
    expect(await db.todoLists.count()).toBe(1);
  });

  it("全体のバックアップはアーカイブとはみなさない", async () => {
    expect(isArchiveFile(await exportBackup())).toBe(false);
    expect(isArchiveFile(null)).toBe(false);
  });
});

describe("バックアップの分割書き出し", () => {
  it("分割した文字列をつなぐと、まとめて書き出した時と同じ内容になり、そのまま復元できる", async () => {
    await db.records.bulkAdd([record("r1", "2026-09-10", { name: '改行\nと"引用"' }), record("r2", "2026-09-11")]);
    await db.todoLists.add({ id: "l1", title: "タスク", order: 0, createdAt: 1 });
    const data = await exportBackup();
    const parts = backupJsonParts(data);
    expect(parts.length).toBeGreaterThan(3);
    const parsed = JSON.parse(parts.join("")) as BackupFile;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(data)));
    expect(Object.keys(parsed)).toEqual(["app", "version", "exportedAt", "tables"]);

    await Promise.all(db.tables.map((t) => t.clear()));
    await importBackup(parsed);
    expect(await db.records.count()).toBe(2);
    expect(await db.todoLists.count()).toBe(1);
  });

  it("復元前のあらまし: 主なデータの件数を出し、ファイルに無い種類は「無い」と分かる", () => {
    const summary = summarizeBackup({ app: "koutei-hyo", version: 1, exportedAt: "", tables: { records: [{}, {}], todoTasks: [] } });
    expect(summary).toEqual([
      { label: "作業", count: null },
      { label: "実績", count: 2 },
      { label: "ToDo", count: 0 },
      { label: "案件", count: null },
      { label: "メモ", count: null },
    ]);
  });
});
