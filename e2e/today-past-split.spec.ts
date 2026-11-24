import { expect, test, type Page } from "@playwright/test";
import { MASTER, MIN, clickButton, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 本日の作業: 過去の日を見て直す・完了した作業を時刻で分ける・2つをまとめる

type Rec = { id: string; masterTaskId: string; name: string; seconds: number; startedAt: number; endedAt: number };
type Daily = { id: string; name: string; masterTaskId: string; status: string; accumulatedMs: number; startedAt: number; endedAt: number; segments: { start: number; end?: number }[] };

const MASTER2 = { ...MASTER, id: "m2", name: "電話対応" };

const done = (id: string, from: string, to: string, offsetDays = 0, extra: Record<string, unknown> = {}) =>
  dailyTask({
    id,
    date: jstDate(offsetDays),
    status: "done",
    segments: [{ start: jstAt(from, offsetDays), end: jstAt(to, offsetDays) }],
    accumulatedMs: jstAt(to, offsetDays) - jstAt(from, offsetDays),
    recordedMs: jstAt(to, offsetDays) - jstAt(from, offsetDays),
    recordedSegmentCount: 1,
    startedAt: jstAt(from, offsetDays),
    endedAt: jstAt(to, offsetDays),
    stoppedAt: jstAt(to, offsetDays),
    ...extra,
  });
const record = (id: string, from: string, to: string, seconds: number, offsetDays = 0) => ({
  id,
  date: jstDate(offsetDays),
  category: "業務",
  name: "資料作成",
  masterTaskId: "m1",
  seconds,
  startedAt: jstAt(from, offsetDays),
  endedAt: jstAt(to, offsetDays),
  excludedFromStats: false,
  segments: [{ start: jstAt(from, offsetDays), end: jstAt(to, offsetDays) }],
});

async function openDoneMore(page: Page, nth = 0) {
  await page.getByRole("button", { name: "そのほかの操作" }).nth(nth).click();
  await page.waitForTimeout(200);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("20:00") });
});

test("前日を開いて完了した作業の終了時刻を直すと、前日の実績も直る。今日へ戻れる", async ({ page }) => {
  await seed(page, {
    stores: { masterTasks: [MASTER], dailyTasks: [done("y1", "09:00", "10:00", -1)], records: [record("ry", "09:00", "10:00", 3600, -1)] },
  });
  await page.getByRole("button", { name: "前日" }).click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("past-day-view")).toBeVisible();
  await expect(page.getByText("を表示中")).toBeVisible();
  await expect(page.getByText(`${jstDate(-1)} の作業リスト`)).toBeVisible();
  // 過去の日には開始・追加の操作を出さない
  await expect(page.locator("button", { hasText: "作業を追加" })).toBeHidden();

  await page.locator("[data-testid='past-day-view'] button[aria-label='編集']:not([title])").first().click();
  await page.locator(".modal-scrim input[type=time]").nth(1).fill("09:45");
  await clickButton(page, /^保存$/);
  await page.waitForTimeout(300);
  const d = (await readOne<Daily>(page, "dailyTasks", "y1"))!;
  expect(d.endedAt).toBe(jstAt("09:45", -1));
  expect(d.accumulatedMs).toBe(45 * MIN);
  const r = (await readOne<Rec>(page, "records", "ry"))!;
  expect(r.seconds).toBe(45 * 60);
  expect(r.endedAt).toBe(jstAt("09:45", -1));

  await page.locator("button", { hasText: "今日へ戻る" }).click();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("past-day-view")).toBeHidden();
  await expect(page.getByText(`${jstDate()} の作業リスト`)).toBeVisible();
});

test("完了した作業を時刻で2つに分ける(同じ作業なら実績はそのまま)。元に戻せる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: { masterTasks: [MASTER], dailyTasks: [done("d1", "09:00", "10:00")], records: [record("r1", "09:00", "10:00", 3600)] },
  });
  await openDoneMore(page);
  await clickButton(page, "分ける…");
  await page.getByLabel("分ける時刻").fill("09:20");
  await clickButton(page, "この時刻で分ける");
  const tasks = (await readAll<Daily>(page, "dailyTasks")).sort((a, b) => a.startedAt - b.startedAt);
  expect(tasks).toHaveLength(2);
  expect(tasks[0].accumulatedMs).toBe(20 * MIN);
  expect(tasks[0].endedAt).toBe(jstAt("09:20"));
  expect(tasks[1].status).toBe("done");
  expect(tasks[1].accumulatedMs).toBe(40 * MIN);
  expect(tasks[1].startedAt).toBe(jstAt("09:20"));
  const recs = await readAll<Rec>(page, "records");
  expect(recs).toHaveLength(1);
  expect(recs[0].seconds).toBe(3600);

  await page.getByRole("button", { name: "元に戻す" }).click();
  await page.waitForTimeout(300);
  expect(await readAll<Daily>(page, "dailyTasks")).toHaveLength(1);
  expect((await readOne<Daily>(page, "dailyTasks", "d1"))!.accumulatedMs).toBe(60 * MIN);
});

test("分けた後ろを別の作業にすると、その分の時間が別の作業の実績へ移る", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: { masterTasks: [MASTER, MASTER2], dailyTasks: [done("d1", "09:00", "10:00")], records: [record("r1", "09:00", "10:00", 3600)] },
  });
  await openDoneMore(page);
  await clickButton(page, "分ける…");
  await page.getByLabel("分ける時刻").fill("09:20");
  await page.getByText("後ろの分を別の作業にする").click();
  await page.getByLabel("後ろの分の作業名").fill("電話対応");
  await clickButton(page, "この時刻で分ける");
  const recs = await readAll<Rec>(page, "records");
  expect(recs.find((r) => r.masterTaskId === "m1")!.seconds).toBe(20 * 60);
  expect(recs.find((r) => r.masterTaskId === "m2")!.seconds).toBe(40 * 60);
  const second = (await readAll<Daily>(page, "dailyTasks")).find((t) => t.id !== "d1")!;
  expect(second.name).toBe("電話対応");
  expect(second.masterTaskId).toBe("m2");
});

test("同じ作業の完了2つを1つにまとめる(実績はそのまま)", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [done("d1", "09:00", "09:30"), done("d2", "11:00", "11:20", 0, { order: 1 })],
      records: [{ ...record("r1", "09:00", "11:20", 50 * 60), segments: [{ start: jstAt("09:00"), end: jstAt("09:30") }, { start: jstAt("11:00"), end: jstAt("11:20") }] }],
    },
  });
  await openDoneMore(page);
  await clickButton(page, "まとめる…");
  await clickButton(page, "1つにまとめる");
  const tasks = await readAll<Daily>(page, "dailyTasks");
  expect(tasks).toHaveLength(1);
  expect(tasks[0].accumulatedMs).toBe(50 * MIN);
  expect(tasks[0].segments).toHaveLength(2);
  expect(tasks[0].startedAt).toBe(jstAt("09:00"));
  expect(tasks[0].endedAt).toBe(jstAt("11:20"));
  const recs = await readAll<Rec>(page, "records");
  expect(recs).toHaveLength(1);
  expect(recs[0].seconds).toBe(50 * 60);
});
