import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 各モードの使い勝手の底上げ(計測中の作業の小窓・ツールバーの段組み・円相の配置)を固定する

const running = () => dailyTask({ id: "a", date: jstDate(), name: "資料作成", status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") });

test("独自の画面のモードで計測中の作業が画面外に出ると、左下に小窓が出て一時停止できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: jstAt("10:00") });
  // 計測中の行が画面の外へ出るくらい、後ろに作業を並べておく
  const more = Array.from({ length: 12 }, (_, i) => dailyTask({ id: "p" + i, date: jstDate(), order: i + 1, name: `作業${i + 1}` }));
  await seed(page, { settings: { "theme.visualMode": "mountain", "powerpro.mainMenu": "false" }, stores: { masterTasks: [MASTER], dailyTasks: [running(), ...more] } });
  const pill = page.getByTestId("running-now-pill");
  const card = page.locator("[data-running-card]").locator("visible=true").first();
  // 計測中の行が見えている間は出さない
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(pill).toHaveCount(0);
  // 見えなくなると出る
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("資料作成");
  await pill.getByRole("button", { name: "一時停止" }).click();
  await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "a"))?.status).toBe("paused");
  await expect(pill).toHaveCount(0);
});

test("本日の作業: スマホではトラブル・突発作業の2つが1段目、ほかの操作は2段目の1行に収まる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
  const trouble = await page.getByRole("button", { name: "⚡ トラブル発生" }).boundingBox();
  const add = await page.getByRole("button", { name: "+ 突発作業を追加" }).boundingBox();
  expect(Math.abs(trouble!.y - add!.y)).toBeLessThan(4);
  const sub = page.getByTestId("today-toolbar-sub");
  const box = await sub.boundingBox();
  expect(box!.height).toBeLessThan(60);
  for (const name of ["🧭 今日の段取り", "🗓 明日の下書き", "⏱ 時間割"]) {
    const b = await sub.getByRole("button", { name }).boundingBox();
    expect(Math.abs(b!.y - box!.y)).toBeLessThan(12);
  }
});

test("禅: 円相の線が名前・時間・ボタンに重ならない(ボタンは円の内側)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, { settings: { "theme.visualMode": "zen" }, stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
  const circle = (await page.locator(".zen-circle").boundingBox())!;
  const cx = circle.x + circle.width / 2;
  const cy = circle.y + circle.height / 2;
  const r = (circle.width / 2) * 0.8; // 円の半径(viewBox 240 に対して r=96)
  for (const name of ["完了にする", "一時停止"]) {
    const b = (await page.getByRole("button", { name }).boundingBox())!;
    for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
      expect(Math.hypot(x - cx, y - cy)).toBeLessThan(r - 4);
    }
  }
});

test.describe("完了の「元に戻す」", () => {
  test("押し間違えた「終了」を元に戻すと、計測中に戻り、作った実績も消える", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, { settings: { "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
    await page.getByRole("button", { name: "終了", exact: true }).first().click();
    await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "a"))?.status).toBe("done");
    await expect.poll(async () => (await readAll(page, "records")).length).toBe(1);
    await page.getByRole("button", { name: /元に戻す（完了を取り消す）/ }).click();
    await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "a"))?.status).toBe("running");
    expect(await readAll(page, "records")).toHaveLength(0);
  });

  test("同じ作業の実績に合算した完了を戻すと、実績は合算前の時間に戻る", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    const rec = { id: "r1", date: jstDate(), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 600, startedAt: jstAt("08:00"), endedAt: jstAt("08:10"), excludedFromStats: false, method: "" };
    await seed(page, {
      settings: { "theme.visualMode": "terminal", "powerpro.mainMenu": "false" },
      stores: { masterTasks: [MASTER], dailyTasks: [running()], records: [rec] },
    });
    // どのモードの完了ボタンからでも戻せる(ターミナルモードの「完了にする」)
    await page.getByRole("button", { name: "完了にする" }).first().click();
    await expect.poll(async () => (await readOne<{ seconds: number }>(page, "records", "r1"))?.seconds).toBeGreaterThanOrEqual(600 + 30 * 60);
    await page.getByRole("button", { name: /元に戻す（完了を取り消す）/ }).click();
    await expect.poll(async () => (await readOne<{ seconds: number }>(page, "records", "r1"))?.seconds).toBe(600);
    expect((await readOne<{ status: string }>(page, "dailyTasks", "a"))?.status).toBe("running");
  });
});

test("計測中のカードに、今の時刻と終わる見込みを描いたアナログ時計が出る(一時停止中は出さない)", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "today.taskViewTab": "running" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date: jstDate(), name: "資料作成", status: "running", estimatedSeconds: 2400, hasPlan: true, segments: [{ start: jstAt("09:50") }], startedAt: jstAt("09:50") }),
        dailyTask({ id: "b", date: jstDate(), order: 1, name: "電話", status: "paused", segments: [{ start: jstAt("09:00"), end: jstAt("09:20") }], accumulatedMs: 1_200_000 }),
      ],
    },
  });
  const clock = page.getByTestId("task-clock");
  await expect(clock).toHaveCount(1);
  await expect(clock.locator("svg")).toHaveAttribute("aria-label", /今 10:0\d/);
  await expect(clock).toContainText("終わる見込み");
});
