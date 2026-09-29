import { expect, test } from "@playwright/test";
import { MASTER, MIN, clickButton, dailyTask, jstAt, jstDate, openTaskTab, readAll, readOne, seed } from "./helpers";

// 本日の作業タブの基本操作(追加・開始・一時停止・終了・時間の加算・手動記録・再開・
// 編集・削除)が、画面上も記録(本日の作業・実績)の上も今の通りに動くことを固定する

type Daily = { id: string; status: string; segments: { start: number; end?: number }[]; endedAt?: number; name: string; method?: string; note?: string };
type Rec = { id: string; seconds: number; startedAt: number; endedAt: number; method?: string; note?: string; name: string };

const near = (actual: number | undefined, expected: number, tolMs = 5000) =>
  expect(Math.abs((actual ?? NaN) - expected)).toBeLessThanOrEqual(tolMs);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("自由入力で突発作業を追加すると、手段付きで予定に並ぶ", async ({ page }) => {
  await seed(page);
  await clickButton(page, "+ 突発作業を追加");
  await clickButton(page, "自由入力");
  await page.getByPlaceholder("例: 資料作成").fill("経理");
  await page.getByPlaceholder("例: 見積書の作成").fill("請求書発行");
  await page.getByPlaceholder("例: Excel、マクロ、クエリ、Claude").fill("マクロ");
  await clickButton(page, "追加のみ");
  await openTaskTab(page, "予定");
  await expect(page.getByText("請求書発行").first()).toBeVisible();
  const tasks = await readAll<Daily & { category: string }>(page, "dailyTasks");
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ category: "経理", name: "請求書発行", status: "pending", method: "マクロ" });
});

test("開始→一時停止→再開→終了で区間が2つ残り、実績は実働分だけになる", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await openTaskTab(page, "予定");
  await clickButton(page, /^開始$/);
  await page.clock.fastForward("10:00");
  await openTaskTab(page, "実行中");
  await clickButton(page, "一時停止");
  await page.clock.fastForward("05:00");
  await clickButton(page, /^再開$/);
  await page.clock.fastForward("10:00");
  await clickButton(page, /^終了$/);

  const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
  expect(d.status).toBe("done");
  expect(d.segments).toHaveLength(2);
  const [rec] = await readAll<Rec>(page, "records");
  near(rec.seconds * 1000, 20 * MIN);
  near(rec.endedAt, jstAt("10:25"));
});

test("「時間を加算」した分は実績に含まれる", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await openTaskTab(page, "予定");
  await clickButton(page, /^開始$/);
  await page.clock.fastForward("10:00");
  await openTaskTab(page, "実行中");
  await clickButton(page, "時間を加算");
  await page.getByText("手動で加算する時間").locator("..").locator("input").fill("00:05:00");
  await clickButton(page, /^加算する$/);
  await clickButton(page, /^終了$/);
  const [rec] = await readAll<Rec>(page, "records");
  near(rec.seconds * 1000, 15 * MIN);
});

test("止め忘れた作業は、終了時刻を指定して完了できる", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await openTaskTab(page, "予定");
  await clickButton(page, /^開始$/);
  await page.clock.fastForward("30:00");
  await openTaskTab(page, "実行中");
  await clickButton(page, "時刻を指定して終了");
  await clickButton(page, "15分前");
  await clickButton(page, "この時刻で終了");
  const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
  expect(d.status).toBe("done");
  const [rec] = await readAll<Rec>(page, "records");
  // 入力欄が分単位のため、秒の端数ぶん最大1分ずれる
  near(rec.seconds * 1000, 15 * MIN, 60_000);
  near(rec.endedAt, jstAt("10:15"), 60_000);
});

test("未着手の作業を「手動で記録」すると、入力した所要時間の実績になる", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await openTaskTab(page, "予定");
  await clickButton(page, "手動で記録");
  await page.getByPlaceholder("所要時間 hh:mm:ss").fill("00:25:00");
  await clickButton(page, "この時間で終了");
  const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
  expect(d.status).toBe("done");
  const [rec] = await readAll<Rec>(page, "records");
  expect(rec.seconds).toBe(25 * 60);
});

test("一時停止したまま後で完了しても、終了時刻は止めた時刻になる", async ({ page }) => {
  const date = jstDate();
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({
          id: "d1",
          date,
          status: "paused",
          segments: [{ start: jstAt("09:00"), end: jstAt("09:40") }],
          accumulatedMs: 40 * MIN,
          startedAt: jstAt("09:00"),
          stoppedAt: jstAt("09:40"),
        }),
      ],
    },
  });
  await openTaskTab(page, "実行中");
  await clickButton(page, /^終了$/);
  const [rec] = await readAll<Rec>(page, "records");
  expect(rec.seconds).toBe(40 * 60);
  expect(rec.endedAt).toBe(jstAt("09:40"));
});

test("完了済みの作業を「続きから」再開すると同じ作業のまま計測が続き、実績は1件に合算される", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await openTaskTab(page, "予定");
  await clickButton(page, /^開始$/);
  await page.clock.fastForward("10:00");
  await openTaskTab(page, "実行中");
  await clickButton(page, /^終了$/);

  await clickButton(page, "✅ 業務 / 資料作成");
  await clickButton(page, "続きから開始する");
  await page.clock.fastForward("05:00");
  await openTaskTab(page, "実行中");
  await clickButton(page, /^終了$/);

  const tasks = await readAll<Daily>(page, "dailyTasks");
  expect(tasks).toHaveLength(1);
  expect(tasks[0].segments).toHaveLength(2);
  const records = await readAll<Rec>(page, "records");
  expect(records).toHaveLength(1);
  near(records[0].seconds * 1000, 15 * MIN);
});

test("完了済みの作業のメモ・手段を編集すると、その作業の実績にも反映される", async ({ page }) => {
  const date = jstDate();
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({
          id: "d1",
          date,
          status: "done",
          segments: [{ start: jstAt("09:00"), end: jstAt("09:30") }],
          accumulatedMs: 30 * MIN,
          startedAt: jstAt("09:00"),
          endedAt: jstAt("09:30"),
        }),
      ],
      records: [
        { id: "r1", date, category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 1800, startedAt: jstAt("09:00"), endedAt: jstAt("09:30"), excludedFromStats: false },
      ],
    },
  });
  await page.locator("button[aria-label='編集']:not([title])").first().click();
  await page.getByPlaceholder("例: Excel、マクロ、クエリ、Claude").fill("Claude");
  await page.getByPlaceholder("振り返りなど自由に（任意）").fill("テンプレ化した");
  await clickButton(page, /^保存$/);
  const rec = (await readOne<Rec>(page, "records", "r1"))!;
  expect(rec).toMatchObject({ method: "Claude", note: "テンプレ化した", seconds: 1800 });
  const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
  expect(d).toMatchObject({ method: "Claude", note: "テンプレ化した" });
});

test("完了済みの作業を実績ごと削除でき、「元に戻す」で復元できる", async ({ page }) => {
  const date = jstDate();
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "d1", date, status: "done", segments: [{ start: jstAt("09:00"), end: jstAt("09:30") }], accumulatedMs: 30 * MIN }),
      ],
      records: [
        { id: "r1", date, category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 1800, startedAt: jstAt("09:00"), endedAt: jstAt("09:30"), excludedFromStats: false },
      ],
    },
  });
  await clickButton(page, /^削除$/);
  // 「実績も削除」は既定でON
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await clickButton(page, "削除する");
  expect(await readAll(page, "dailyTasks")).toHaveLength(0);
  expect(await readAll(page, "records")).toHaveLength(0);
  await clickButton(page, "元に戻す");
  expect(await readAll(page, "dailyTasks")).toHaveLength(1);
  expect((await readOne<Rec>(page, "records", "r1"))?.seconds).toBe(1800);
});
