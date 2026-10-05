import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readOne, seed } from "./helpers";

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
