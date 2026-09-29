import { expect, type Page } from "@playwright/test";

// IndexedDB(koutei-hyo)へテスト用データを直接入れて、アプリを開き直す。
// 画面操作だけで前提を作ると遅く不安定なので、前提はDBへ直接書き、
// 検証したい操作だけを画面で行う
export type Rows = Record<string, unknown>[];

export const STORES = [
  "dailyTasks",
  "records",
  "masterTasks",
  "projects",
  "todoTasks",
  "todoLists",
  "conditionLogs",
  "memoBoards",
  "memoNotes",
] as const;

export const BASE_SETTINGS: Record<string, string> = {
  "onboarding.completed": "true",
  "todo.reminderEnabled": "false",
  "theme.applyWording": "false",
  // 体調記録は当日最初の開始時に確認モーダルを挟むため、操作テストでは切っておく
  "condition.enabled": "false",
  "today.standardWorkStart": "09:00",
  "today.standardWorkEnd": "18:00",
};

export async function seed(
  page: Page,
  data: { settings?: Record<string, string>; stores?: Partial<Record<(typeof STORES)[number], Rows>> } = {}
): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".tab-chip") !== null, undefined, { timeout: 30_000 });
  await page.evaluate(
    async ({ stores, settings, storeNames }) => {
      // アプリ(Dexie)がデータベースを作り終える前に開くと、テーブルの無い空のDBを
      // 先に作ってしまうため、アプリ側の作成完了を待ってから開く
      for (let i = 0; i < 100; i++) {
        const dbs = await indexedDB.databases();
        if (dbs.some((d) => d.name === "koutei-hyo" && (d.version ?? 0) > 1)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const req = indexedDB.open("koutei-hyo");
      const db: IDBDatabase = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const run = (name: string, fn: (s: IDBObjectStore) => void) =>
        new Promise<void>((res, rej) => {
          const tx = db.transaction(name, "readwrite");
          fn(tx.objectStore(name));
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
      for (const name of storeNames) await run(name, (s) => s.clear());
      await run("settings", (s) => {
        s.clear();
        for (const [key, value] of Object.entries(settings)) s.put({ key, value });
      });
      for (const [name, rows] of Object.entries(stores)) {
        await run(name, (s) => (rows as unknown[]).forEach((r) => s.put(r)));
      }
      db.close();
    },
    { stores: data.stores ?? {}, settings: { ...BASE_SETTINGS, ...(data.settings ?? {}) }, storeNames: [...STORES] }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".tab-chip") !== null, undefined, { timeout: 30_000 });
  // 設定・データの読み込み(useLiveQuery)が落ち着くのを待つ
  await page.waitForTimeout(800);
}

export async function readAll<T = Record<string, unknown>>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(async (name) => {
    const req = indexedDB.open("koutei-hyo");
    const db: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    const rows = await new Promise<unknown[]>((res) => {
      const q = db.transaction(name).objectStore(name).getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return rows;
  }, store) as Promise<T[]>;
}

export async function readOne<T = Record<string, unknown>>(page: Page, store: string, id: string): Promise<T | undefined> {
  return (await readAll<T & { id?: string; key?: string }>(page, store)).find((r) => r.id === id || r.key === id);
}

// ページ側(=テスト用のタイムゾーン)で見た今日の日付
export async function today(page: Page, offsetDays = 0): Promise<string> {
  return page.evaluate((off) => {
    const d = new Date();
    d.setDate(d.getDate() + off);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, offsetDays);
}

export async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => Date.now());
}

export async function openTaskTab(page: Page, tab: "実行中" | "予定" | "完了"): Promise<void> {
  await page.locator("button", { hasText: `${tab}(` }).first().click();
  await page.waitForTimeout(250);
}

export async function clickButton(page: Page, text: string | RegExp): Promise<void> {
  await page.locator("button", { hasText: text }).first().click();
  await page.waitForTimeout(300);
}

export async function expectVisible(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
}

export interface DailyTaskSeed {
  id: string;
  date: string;
  order?: number;
  category?: string;
  name?: string;
  masterTaskId?: string;
  status?: "pending" | "running" | "paused" | "done";
  segments?: { start: number; end?: number }[];
  accumulatedMs?: number;
  [key: string]: unknown;
}

export function dailyTask(t: DailyTaskSeed): Record<string, unknown> {
  return {
    order: 0,
    category: "業務",
    name: "資料作成",
    masterTaskId: "m1",
    estimatedSeconds: 0,
    hasPlan: false,
    status: "pending",
    segments: [],
    accumulatedMs: 0,
    isSpontaneous: true,
    ...t,
  };
}

export const MASTER = {
  id: "m1",
  category: "業務",
  name: "資料作成",
  estimatedSeconds: 1800,
  isFavorite: false,
  sampleCount: 0,
  createdAt: 0,
  updatedAt: 0,
};

// テストのタイムゾーン(Asia/Tokyo)で見た「今日」のHH:MMの時刻(epoch ms)。
// page.clock.install({ time: jstAt("10:00") }) のように使う
export function jstDate(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}
export function jstAt(hm: string, offsetDays = 0): number {
  return new Date(`${jstDate(offsetDays)}T${hm}:00+09:00`).getTime();
}
export const MIN = 60_000;
