import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, seed } from "./helpers";

// 📍打刻: 忙しくて計測を押せない時に時刻だけ残し、後で実績に変える

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("打刻ボタンで時刻と一言を残し、次の打刻までを実績にできる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await seed(page, { stores: { masterTasks: [MASTER] } });

  // 1回目: 押して一言を入れる
  await page.getByRole("button", { name: "打刻(今の時刻を残す)" }).click();
  await expect(page.getByTestId("quick-stamp-sheet")).toContainText("10:00 を打刻しました");
  await page.getByLabel("打刻の一言").fill("資料");
  await page.getByRole("button", { name: "残す", exact: true }).click();
  await expect(page.getByTestId("quick-stamp-sheet")).toHaveCount(0);

  // 2回目: 40分後に押すだけ(一言なし)。一言の候補に前回の「資料」が出る
  await page.clock.fastForward("40:00");
  await page.getByRole("button", { name: "打刻(今の時刻を残す)" }).click();
  await expect(page.getByTestId("quick-stamp-sheet").getByRole("button", { name: "資料" })).toBeVisible();
  await page.getByTestId("quick-stamp-sheet").getByRole("button", { name: "閉じる" }).click();

  const panel = page.getByTestId("quick-stamp-panel");
  await expect(panel).toContainText("未記録 2件");
  await expect(panel).toContainText("10:00〜10:40");
  await expect(panel).toContainText("40分");

  // 1件目を実績に。一言「資料」から作業マスタ「資料作成」が候補として選ばれている
  await panel.getByRole("button", { name: "実績にする" }).first().click();
  await expect(page.getByPlaceholder("詳細作業名")).toHaveValue("資料作成");
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(panel).toContainText("✓ 業務 / 資料作成");
  await expect(panel).toContainText("未記録 1件");

  const records = await readAll<{ name: string; seconds: number; startedAt: number }>(page, "records");
  expect(records).toHaveLength(1);
  expect(records[0].name).toBe("資料作成");
  expect(records[0].seconds).toBe(40 * 60);
  // 打刻した時刻を秒まで含めてそのまま使う(押した瞬間なので、10:00ちょうどから数秒以内)
  expect(records[0].startedAt - jstAt("10:00")).toBeGreaterThanOrEqual(0);
  expect(records[0].startedAt - jstAt("10:00")).toBeLessThan(60_000);

  // 2件目は記録しない
  await panel.getByRole("button", { name: "記録しない" }).click();
  await expect(panel).toContainText("すべて記録済み");
});

test("押し間違えた打刻はその場で取り消せる。設定でボタンを隠せる", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "打刻(今の時刻を残す)" }).click();
  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByTestId("quick-stamp-panel")).toHaveCount(0);
  expect(await readAll(page, "quickStamps")).toHaveLength(0);

  await seed(page, { settings: { "today.quickStampButton": "false" } });
  await expect(page.getByRole("button", { name: "打刻(今の時刻を残す)" })).toHaveCount(0);
});

test("ホーム画面ショートカット(/?stamp=1)で開くと打刻される", async ({ page }) => {
  await seed(page);
  await page.goto("/?stamp=1");
  await expect(page.getByTestId("quick-stamp-sheet")).toBeVisible();
  await expect(page.getByTestId("quick-stamp-panel")).toContainText("10:00〜今");
});

test("本日の作業を独自画面に差し替えるモード(禅など)でも、右下のボタンから打刻して実績にできる", async ({ page }) => {
  await seed(page, { settings: { "theme.visualMode": "zen" }, stores: { masterTasks: [MASTER] } });
  const dock = page.getByTestId("quick-stamp-dock");
  await dock.getByRole("button", { name: "打刻(今の時刻を残す)" }).click();
  await page.getByLabel("打刻の一言").fill("資料");
  await page.getByRole("button", { name: "残す", exact: true }).click();
  await dock.getByRole("button", { name: "未記録の打刻 1" }).click();
  await page.locator(".modal-scrim").getByTestId("quick-stamp-panel").getByRole("button", { name: "実績にする" }).click();
  await page.getByLabel("終了時刻").fill("10:30");
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(page.locator(".modal-scrim").getByTestId("quick-stamp-panel")).toContainText("✓ 業務 / 資料作成");
  const records = await readAll<{ seconds: number }>(page, "records");
  // 開始は打刻した瞬間(秒まで)、終了は入力した10:30
  expect(records).toHaveLength(1);
  expect(Math.abs(records[0].seconds - 30 * 60)).toBeLessThan(60);
});

test("打刻の後で計測を始めた作業があれば、打刻の区間はその開始時刻までになる", async ({ page }) => {
  const date = new Date(jstAt("10:00") + 9 * 3600_000).toISOString().slice(0, 10);
  await page.clock.install({ time: jstAt("12:00") });
  await seed(page, {
    stores: {
      quickStamps: [{ id: "s1", date, at: jstAt("10:00"), note: "電話" }],
      dailyTasks: [dailyTask({ id: "t1", date, status: "running", segments: [{ start: jstAt("10:45") }] })],
    },
  });
  await expect(page.getByTestId("quick-stamp-panel")).toContainText("10:00〜10:45");
  await expect(page.getByTestId("quick-stamp-panel")).toContainText("計測開始まで");
});

test("メニュー画面から始まるモードでも、ショートカット(/?stamp=1)なら今日を開いて打刻する", async ({ page }) => {
  await seed(page, { settings: { "theme.visualMode": "va11halla", "powerpro.mainMenu": "true" } });
  await page.goto("/?stamp=1");
  await expect(page.getByTestId("quick-stamp-sheet")).toBeVisible();
  expect(await readAll(page, "quickStamps")).toHaveLength(1);
});

test("打刻を実績にすると、本日の作業の「完了」に並ぶ。「作業マスタから探す」はマスタの一覧から開き、選ぶと入る", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER, { ...MASTER, id: "m9", category: "家事", name: "風呂掃除" }],
      quickStamps: [
        { id: "s1", date: jstDate(), at: jstAt("08:00") },
        { id: "s2", date: jstDate(), at: jstAt("08:30") },
      ],
    },
  });
  await page.getByTestId("quick-stamp-panel").getByRole("button", { name: "実績にする" }).first().click();
  await page.getByRole("button", { name: "作業マスタから探す" }).click();
  // 自由入力ではなく、最初からマスタの一覧が出ている
  const picker = page.locator(".modal-scrim").last();
  await picker.getByRole("button", { name: /風呂掃除/ }).click();
  await expect(page.getByPlaceholder("業務区分（大項目）")).toHaveValue("家事");
  await expect(page.getByPlaceholder("詳細作業名")).toHaveValue("風呂掃除");
  await page.getByRole("button", { name: "記録する" }).click();

  await expect(page.getByTestId("quick-stamp-panel")).toContainText("✓ 家事 / 風呂掃除");
  const daily = await readAll<{ name: string; status: string; segments: { start: number; end: number }[] }>(page, "dailyTasks");
  expect(daily).toEqual([expect.objectContaining({ name: "風呂掃除", status: "done" })]);
  expect(daily[0].segments).toEqual([{ start: jstAt("08:00"), end: jstAt("08:30") }]);
  const records = await readAll<{ name: string; seconds: number }>(page, "records");
  expect(records).toEqual([expect.objectContaining({ name: "風呂掃除", seconds: 1800 })]);
  // 本日の作業の「完了」タブに並んでいる
  await page.getByRole("button", { name: /完了/ }).filter({ hasText: "(1)" }).first().click();
  await expect(page.getByText("風呂掃除").first()).toBeVisible();
});

test("直前の作業が終わってから打刻するまでの時間も、打刻の区間に入る(13:54に終わり14:14に打刻 → 13:54から)", async ({ page }) => {
  await page.clock.install({ time: jstAt("14:20") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "nte", date: jstDate(), status: "done", segments: [{ start: jstAt("13:30"), end: jstAt("13:54") }], accumulatedMs: 24 * 60_000 })],
      quickStamps: [{ id: "s", date: jstDate(), at: jstAt("14:14") + 23_000 }],
    },
  });
  const panel = page.getByTestId("quick-stamp-panel");
  await expect(panel).toContainText("13:54〜今");
  await expect(panel).toContainText("前の作業の終わりから");
  await panel.getByRole("button", { name: "実績にする" }).click();
  await expect(page.getByLabel("開始時刻")).toHaveValue("13:54");
  await page.getByPlaceholder("業務区分（大項目）").fill("業務");
  await page.getByPlaceholder("詳細作業名").fill("資料作成");
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(panel).toContainText("✓ 業務 / 資料作成");
  // 実績にした打刻には「計測開始まで」などの注記を出さない
  await expect(panel).not.toContainText("計測開始まで");
  const made = (await readAll<{ id: string; segments: { start: number }[] }>(page, "dailyTasks")).find((d) => d.id !== "nte");
  expect(made!.segments[0].start).toBe(jstAt("13:54"));
});

test("実績にした打刻は、作った作業の時刻と時間を出す(「〜今」や打刻からの経過時間にしない)", async ({ page }) => {
  await page.clock.install({ time: jstAt("16:16") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "made", date: jstDate(), category: "睡眠", name: "静養", status: "done", segments: [{ start: jstAt("14:14"), end: jstAt("15:57") }], accumulatedMs: 103 * 60_000, startedAt: jstAt("14:14"), endedAt: jstAt("15:57") }),
      ],
      quickStamps: [{ id: "s", date: jstDate(), at: jstAt("14:14"), recordId: "made", recordLabel: "睡眠 / 静養" }],
    },
  });
  const panel = page.getByTestId("quick-stamp-panel");
  await expect(panel).toContainText("14:14〜15:57");
  await expect(panel).toContainText("1時間43分");
  await expect(panel).not.toContainText("〜今");
});
