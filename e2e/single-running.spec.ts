import { expect, test, type Page } from "@playwright/test";
import { MASTER, clickButton, clickInCard, dailyTask, jstAt, jstDate, openTaskTab, readAll, readOne, seed } from "./helpers";

// 作業の実測は同時に1つだけ。仮計測・休憩明け・予定の自動開始・トラブル対応・ショートカット・
// 前日から計測中の作業など、計測が始まるいろいろな場面で、計測中が2つ以上のまま残らないことを確かめる

type Daily = { id: string; status: string; name: string; isProvisional?: boolean; isTrouble?: boolean; segments: { start: number; end?: number }[] };

const runningOf = async (page: Page) => (await readAll<Daily>(page, "dailyTasks")).filter((t) => t.status === "running");
// 計測中の作業が1つ以下に落ち着くこと(一瞬2つになっても、すぐ後の方だけになる)
const expectSingle = async (page: Page) => expect.poll(async () => (await runningOf(page)).length).toBeLessThanOrEqual(1);
const prov = (start: string) =>
  dailyTask({ id: "p", date: jstDate(), order: 9, category: "未分類", name: "仮計測中", masterTaskId: undefined, status: "running", isProvisional: true, segments: [{ start: jstAt(start) }], startedAt: jstAt(start) });
const paused = (id: string, name: string, from: string, to: string, order = 0) =>
  dailyTask({ id, date: jstDate(), order, name, status: "paused", segments: [{ start: jstAt(from), end: jstAt(to) }], accumulatedMs: jstAt(to) - jstAt(from), startedAt: jstAt(from), stoppedAt: jstAt(to) });

test("仮計測中にスペースキーで一時停止中の作業を再開すると、仮計測は止まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { settings: { "today.provisionalEnabled": "true" }, stores: { masterTasks: [MASTER], dailyTasks: [paused("a", "資料作成", "09:00", "09:30"), prov("09:30")] } });
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Space");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("running");
  await expectSingle(page);
  const p = (await readOne<Daily>(page, "dailyTasks", "p"))!;
  expect(p.status).toBe("paused");
});

test("休憩(強制ストップ)明けの仮計測と、休憩前の作業が同時に進まない", async ({ page }) => {
  await page.clock.install({ time: jstAt("11:58") });
  await seed(page, {
    settings: {
      "today.provisionalEnabled": "true",
      "today.untrackedThresholdMinutes": "5",
      "today.provisionalBreakRanges": JSON.stringify([{ start: "12:00", end: "12:10", forceStop: true, checklist: [] }]),
    },
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "a", date: jstDate(), status: "running", segments: [{ start: jstAt("11:00") }], startedAt: jstAt("11:00") })] },
  });
  await page.clock.fastForward("03:00");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("paused");
  // 休憩明けに何も始めないでいると仮計測が始まる
  for (let i = 0; i < 4; i++) await page.clock.fastForward("05:00");
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).some((t) => t.isProvisional && t.status === "running")).toBe(true);
  await expectSingle(page);
  // そこで休憩前の作業を再開すると、仮計測は止まる
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Space");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("running");
  await expectSingle(page);
});

test("仮計測中に予定の時刻が来ても、確認してから切り替わり、同時には進まない", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "today.provisionalEnabled": "true" },
    stores: { masterTasks: [MASTER], dailyTasks: [prov("09:40"), dailyTask({ id: "s", date: jstDate(), name: "定例会議", scheduledTime: "10:05" })] },
  });
  await page.clock.fastForward("06:00");
  await expect(page.getByText("予定の時刻になりました").first()).toBeVisible();
  await expectSingle(page);
  await clickButton(page, "一時停止して開始する");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "s"))?.status).toBe("running");
  await expectSingle(page);
});

test("仮計測中のトラブル発生→対応終了で、仮計測とトラブル対応が同時に進まない", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { settings: { "today.provisionalEnabled": "true", "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [prov("09:40")] } });
  await clickButton(page, "⚡ トラブル発生");
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isTrouble)?.status).toBe("running");
  await expectSingle(page);
  await page.clock.fastForward("10:00");
  await openTaskTab(page, "実行中");
  await clickInCard(page, "トラブル ", "終了");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "p"))?.status).toBe("running");
  await expectSingle(page);
});

test("計測中に予定の自動開始で「一時停止して開始する」を選ぶと、前の作業は止まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") }),
        dailyTask({ id: "s", date: jstDate(), order: 1, name: "定例会議", scheduledTime: "10:05" }),
      ],
    },
  });
  await page.clock.fastForward("06:00");
  await expect(page.getByText("予定の時刻になりました").first()).toBeVisible();
  await expectSingle(page);
  await clickButton(page, "一時停止して開始する");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "s"))?.status).toBe("running");
  await expectSingle(page);
});

test("前日から計測中のまま(睡眠など)で今日の作業を始めると、前日の作業はその時刻で止まり、24:00打ち切りも選べる", async ({ page }) => {
  await page.clock.install({ time: jstAt("07:00") });
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "sleep", date: jstDate(-1), name: "睡眠", status: "running", segments: [{ start: jstAt("23:00", -1) }], startedAt: jstAt("23:00", -1) }),
        dailyTask({ id: "a", date: jstDate(), name: "朝の支度" }),
      ],
    },
  });
  // 放置の確認は後回しにして、今日の作業を始める
  await expect(page.getByText("日をまたいで放置された作業があります")).toBeVisible();
  await page.getByRole("button", { name: "閉じる" }).first().click();
  await clickInCard(page, "朝の支度", "開始");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "sleep"))?.status).toBe("paused");
  await expectSingle(page);
  const sleep = (await readOne<Daily>(page, "dailyTasks", "sleep"))!;
  const a = (await readOne<Daily>(page, "dailyTasks", "a"))!;
  expect(sleep.segments[0].end).toBe(a.segments[0].start);
  // 開き直すと、止まった前日の作業を24:00で打ち切って完了にする選択肢が出る
  await page.reload();
  await expect(page.getByRole("button", { name: /24:00で打ち切り/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /そのまま完了する/ })).toBeVisible();
});

test("別のモード(ターミナル)のコマンドで作業を始めても、計測中だった作業は止まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "theme.visualMode": "terminal", "powerpro.mainMenu": "false" },
    stores: {
      masterTasks: [MASTER, { ...MASTER, id: "m2", name: "電話対応" }],
      dailyTasks: [dailyTask({ id: "a", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") })],
    },
  });
  const input = page.getByLabel("コマンド");
  await input.fill("start 電話対応");
  await input.press("Enter");
  await expect.poll(async () => (await runningOf(page)).map((d) => d.name)).toEqual(["電話対応"]);
  expect((await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("paused");
});
