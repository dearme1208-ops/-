import { beforeEach, describe, expect, it } from "vitest";
import { beforeRestoreFileName, exportBackup, importBackup, isNewerBackupVersion } from "@/lib/backup";
import { db } from "@/lib/db";
import type { MasterTask } from "@/lib/types";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("バックアップの書き出し→復元", () => {
  it("書き出した内容を復元すると、変更履歴を含めて元どおりになる", async () => {
    await db.todoTasks.add({ id: "t1", listId: "l1", title: "見積", tag: "客先確認中", important: false, completed: false, order: 0, createdAt: 1000 });
    await db.todoTasks.update("t1", { dueDate: "2026-10-01" });
    await db.todoTasks.update("t1", { dueDate: "2026-10-05" });
    await db.projects.add({ id: "p1", title: "案件", category: "c", workName: "w", dueDate: "2026-10-10", createdAt: 1000, stages: [{ id: "s1", title: "段階", completed: false, tag: "社内確認中" }] });
    const before = { todos: await db.todoTasks.toArray(), projects: await db.projects.toArray() };
    const file = JSON.parse(JSON.stringify(await exportBackup()));
    await Promise.all(db.tables.map((t) => t.clear()));
    await importBackup(file);
    expect(await db.todoTasks.toArray()).toEqual(before.todos);
    expect(await db.projects.toArray()).toEqual(before.projects);
  });

  it("変更履歴の記録を始める前のバックアップを復元しても、作成日を「その状況になった日」にしない(日数が過大に出ないように)", async () => {
    const old = {
      app: "koutei-hyo" as const,
      version: 2,
      exportedAt: "2026-01-01T00:00:00Z",
      tables: {
        todoTasks: [{ id: "t1", listId: "l1", title: "見積", tag: "客先確認中", important: false, completed: false, order: 0, createdAt: new Date("2025-06-01").getTime() }],
        projects: [{ id: "p1", title: "案件", category: "c", workName: "w", dueDate: "2026-10-10", createdAt: new Date("2025-06-01").getTime(), tag: "客先確認中", stages: [{ id: "s1", title: "段階", completed: false, tag: "社内確認中" }] }],
      },
    };
    await importBackup(old);
    expect((await db.todoTasks.get("t1"))!.tagChangedAt).toBeUndefined();
    const p = (await db.projects.get("p1"))!;
    expect(p.tagChangedAt).toBeUndefined();
    expect(p.stages![0].tagChangedAt).toBeUndefined();
  });
});

describe("壊れたバックアップの復元", () => {
  it("中身が配列でないテーブルは、今のデータを消さずに飛ばす", async () => {
    await db.records.put({ id: "keep", date: "2026-09-29", category: "業務", name: "x", masterTaskId: "m", seconds: 1, startedAt: 0, endedAt: 1, excludedFromStats: false });
    const { skippedTables } = await importBackup({ app: "koutei-hyo", version: 2, exportedAt: "", tables: { records: {} as unknown as unknown[] } });
    expect(skippedTables).toEqual(["records"]);
    expect(await db.records.get("keep")).toBeTruthy();
  });

  it("途中で失敗したら、どのテーブルも書き換えない", async () => {
    await db.records.put({ id: "keep", date: "2026-09-29", category: "業務", name: "x", masterTaskId: "m", seconds: 1, startedAt: 0, endedAt: 1, excludedFromStats: false });
    // 主キーに使えない値(オブジェクト)の行で書き込みを失敗させる
    const bad = { id: {}, category: "a", name: "b", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 };
    await expect(importBackup({ app: "koutei-hyo", version: 2, exportedAt: "", tables: { records: [], masterTasks: [bad] } as unknown as Record<string, unknown[]> })).rejects.toBeTruthy();
    expect(await db.records.get("keep")).toBeTruthy();
  });
});

describe("復元の安全策", () => {
  const master = (id: unknown, name = "b") => ({ id, category: "a", name, estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });

  it("主キーが重複した行があっても復元全体は失敗せず、後の行が残る", async () => {
    const r = await importBackup({ app: "koutei-hyo", version: 2, exportedAt: "", tables: { masterTasks: [master("m1", "前"), master("m1", "後"), master("m2")] } });
    expect(await db.masterTasks.count()).toBe(2);
    expect((await db.masterTasks.get("m1"))!.name).toBe("後");
    expect(r.restoredRows).toBe(2);
  });

  it("idの無い行・オブジェクトでない行は落とし、残りは復元する", async () => {
    const r = await importBackup({ app: "koutei-hyo", version: 2, exportedAt: "", tables: { masterTasks: [master(undefined), master(""), null, "x", master("ok")] } });
    expect((await db.masterTasks.toArray()).map((m) => m.id)).toEqual(["ok"]);
    expect(r.droppedRows).toBe(4);
  });

  it("設定(主キーがkey)はkeyで判定する", async () => {
    await importBackup({ app: "koutei-hyo", version: 2, exportedAt: "", tables: { settings: [{ key: "a", value: 1 }, { value: 2 }] } });
    expect(await db.settings.count()).toBe(1);
  });

  it("新しい版の形式のファイルは、今のデータに触れずに断る", async () => {
    await db.masterTasks.put(master("keep") as MasterTask);
    expect(isNewerBackupVersion({ version: 3 })).toBe(true);
    expect(isNewerBackupVersion({ version: 2 })).toBe(false);
    await expect(importBackup({ app: "koutei-hyo", version: 3, exportedAt: "", tables: { masterTasks: [] } })).rejects.toThrow(/version 3/);
    expect(await db.masterTasks.get("keep")).toBeTruthy();
  });

  it("復元前の自動書き出しのファイル名に日時が入る", () => {
    expect(beforeRestoreFileName(new Date(2026, 10, 24, 9, 5, 7))).toBe("koutei-hyo_before-restore_2026-11-24_090507.json");
  });
});
