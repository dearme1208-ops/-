import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readOne, seed } from "./helpers";

// 本日の作業は他のタブ・独自画面のモードの間も裏で動き続ける(app/page.tsx)

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("ToDoタブを見ている間に予定の時刻が来ても、その時刻に自動で開始される", async ({ page }) => {
  await seed(page, {
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "s1", date: jstDate(), name: "定例会議", scheduledTime: "10:05" })] },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.clock.fastForward("06:00");
  // 裏で動いている間の見張りは5秒ごとなので、早送りの後、次の見張りまで最大5秒待つ
  await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "s1"))?.status, { timeout: 12_000 }).toBe("running");
  const task = await readOne<{ segments: { start: number }[] }>(page, "dailyTasks", "s1");
  expect(task!.segments[0].start).toBeLessThan(jstAt("10:05") + 2 * 60_000);
});

test("禅モードでも予定の時刻に自動で開始され、計測中なら確認のダイアログが出る。道具から突発作業を追加できる", async ({ page }) => {
  await seed(page, {
    settings: { "theme.visualMode": "zen" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "r1", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }] }),
        dailyTask({ id: "s1", date: jstDate(), order: 1, name: "定例会議", scheduledTime: "10:05" }),
      ],
    },
  });
  await page.clock.fastForward("06:00");
  await expect(page.getByText("予定の時刻になりました").first()).toBeVisible();
  await page.getByRole("button", { name: "一時停止して開始する" }).click();
  await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "s1"))?.status).toBe("running");

  await page.getByRole("button", { name: "道具" }).click();
  await page.getByRole("menuitem", { name: /突発作業を追加/ }).click();
  await expect(page.locator(".modal-scrim").getByText("突発作業を追加").first()).toBeVisible();
});

test("初めて開くタブの読み込みに失敗しても、その画面だけが失敗を知らせ、ほかのタブと予定の自動開始は動き続ける", async ({ page }) => {
  await seed(page, {
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "s1", date: jstDate(), name: "定例会議", scheduledTime: "10:05" })] },
  });
  // 電波が途切れた状態を作る(まだ読み込んでいない画面のプログラムが取得できない)
  await page.route(/\/_next\/static\/chunks\/.*\.js/, (route) => route.abort());
  await page.locator(".tab-chip", { hasText: "ヒートマップ" }).first().click();
  await expect(page.getByTestId("section-error")).toContainText("読み込めませんでした");
  await expect(page.locator(".tab-chip").first()).toBeVisible();
  await page.clock.fastForward("06:00");
  await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "s1"))?.status, { timeout: 12_000 }).toBe("running");
});
