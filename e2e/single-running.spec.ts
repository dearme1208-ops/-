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

test.describe("仮計測中に突発作業を追加して開始する", () => {
  const setup = async (page: Page) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, { settings: { "today.provisionalEnabled": "true", "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [prov("09:40")] } });
    await page.getByRole("button", { name: "+ 突発作業を追加" }).click();
    // 仮計測の割り当て欄にも「自由入力」があるので、後から開いた追加画面の方を押す
    await page.getByRole("button", { name: "自由入力" }).last().click();
    await page.getByPlaceholder("例: 資料作成").fill("総務");
    await page.getByPlaceholder("例: 見積書の作成").fill("電話対応");
    await page.getByPlaceholder("例: Excel、マクロ、クエリ、Claude").fill("電話");
    await page.getByRole("button", { name: "追加してすぐ開始" }).click();
    await expect(page.getByText("未計測(仮計測)が計測中です")).toBeVisible();
    await expectSingle(page);
  };
  const added = async (page: Page) => (await readAll<Daily & { method?: string; category: string }>(page, "dailyTasks")).find((t) => t.name === "電話対応");

  test("「合算する」: 仮計測の開始時刻から計測し、仮計測は消え、手段も引き継ぐ", async ({ page }) => {
    await setup(page);
    await clickButton(page, /今回の作業に合算する/);
    await expect.poll(async () => (await added(page))?.status).toBe("running");
    const t = (await added(page))!;
    expect(t.segments[0].start).toBe(jstAt("09:40"));
    expect(t.method).toBe("電話");
    expect(await readOne<Daily>(page, "dailyTasks", "p")).toBeUndefined();
    await expectSingle(page);
  });

  test("「自動計測をやめる」: 今から計測し、仮計測分は記録しない", async ({ page }) => {
    await setup(page);
    await clickButton(page, /自動計測をやめる/);
    await expect.poll(async () => (await added(page))?.status).toBe("running");
    expect((await added(page))!.segments[0].start).toBeGreaterThanOrEqual(jstAt("10:00"));
    expect(await readOne<Daily>(page, "dailyTasks", "p")).toBeUndefined();
    expect(await readAll(page, "records")).toHaveLength(0);
  });

  test("「キャンセル」: 何も追加せず、仮計測はそのまま続く", async ({ page }) => {
    await setup(page);
    await clickButton(page, "キャンセル");
    expect(await added(page)).toBeUndefined();
    expect((await readOne<Daily>(page, "dailyTasks", "p"))?.status).toBe("running");
  });
});
