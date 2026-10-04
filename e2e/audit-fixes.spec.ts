import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 点検で見つけた不具合の修正を確かめる

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("14:00") });
});

test("今日の記録を別の画面で書き換えたら、本日の作業の入力欄も追従する(古い内容で上書きしない)", async ({ page }) => {
  await seed(page, { settings: { "today.collapseExtras": "false" } });
  const box = page.getByPlaceholder("タスクに縛られない、今日の気づき・メモを自由に書けます");
  await box.fill("朝のメモ");
  await page.waitForTimeout(300);
  // 実績編集の「記録の履歴」で、今日のメモを書き換える
  await page.locator(".tab-chip", { hasText: "実績編集" }).first().click();
  await page.getByRole("button", { name: /記録の履歴/ }).click();
  const hist = page.locator("textarea:visible").first();
  await expect(hist).toHaveValue("朝のメモ");
  await hist.fill("別の画面で直したメモ");
  await hist.blur();
  await page.locator(".tab-chip", { hasText: "本日" }).first().click();
  await expect(box).toHaveValue("別の画面で直したメモ");
});

test("禅モード: 仮計測は「今やっていること」に数えず、作業を始めると仮計測は一時停止する", async ({ page }) => {
  await seed(page, {
    settings: { "theme.visualMode": "zen" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "p", date: jstDate(), category: "未計測", name: "未計測", masterTaskId: undefined, estimatedSeconds: 0, isProvisional: true, status: "running", segments: [{ start: jstAt("13:00") }] })],
      todoLists: [{ id: "l", title: "今", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t", listId: "l", title: "見積書を送る", completed: false, important: false, order: 0, createdAt: 0 }],
    },
  });
  await expect(page.getByText("見積書を送る").first()).toBeVisible();
  await page.getByRole("button", { name: "はじめる" }).click();
  await expect.poll(async () => (await readOne<{ status: string }>(page, "dailyTasks", "p"))?.status).toBe("paused");
  await expect
    .poll(async () => (await readAll<{ name: string; status: string }>(page, "dailyTasks")).filter((d) => d.status === "running").map((d) => d.name))
    .toEqual(["見積書を送る"]);
});

test("ターミナル: 完了済みの作業を start で始め直しても、前の記録の区間は消えない", async ({ page }) => {
  await seed(page, {
    settings: { "theme.visualMode": "terminal", "powerpro.mainMenu": "false" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "d", date: jstDate(), status: "done", segments: [{ start: jstAt("09:00"), end: jstAt("10:00") }], accumulatedMs: 3600_000 })],
    },
  });
  const input = page.getByLabel("コマンド");
  await input.fill("start 資料作成");
  await input.press("Enter");
  await expect(page.getByTestId("terminal-command")).toContainText("▶ 開始: 業務/資料作成");
  const done = await readOne<{ status: string; segments: unknown[] }>(page, "dailyTasks", "d");
  expect(done).toMatchObject({ status: "done" });
  expect(done!.segments).toHaveLength(1);
  expect((await readAll(page, "dailyTasks")).length).toBe(2);
});

test("突発作業の自由入力: 同じ作業名が別の区分にあれば知らせ、選べる。1日の最初の開始なら体調を聞く", async ({ page }) => {
  await seed(page, {
    settings: { "condition.enabled": "true" },
    stores: { masterTasks: [{ ...MASTER, id: "s1", category: "睡眠", name: "静養" }] },
  });
  await page.getByRole("button", { name: "+ 突発作業を追加" }).click();
  await page.getByRole("button", { name: "自由入力" }).click();
  await page.getByPlaceholder("例: 資料作成").fill("休憩");
  await page.getByPlaceholder("例: 見積書の作成").fill("静養");
  const hint = page.getByTestId("same-name-hint");
  await expect(hint).toBeVisible();
  await hint.getByRole("button", { name: "睡眠 / 静養 を使う" }).click();
  await expect(page.getByPlaceholder("例: 資料作成")).toHaveValue("睡眠");
  await page.getByRole("button", { name: "追加してすぐ開始" }).click();
  // 1日の最初の開始なので、ほかの開始操作と同じく体調を聞く
  await expect(page.getByText("体調を記録してから始めますか?")).toBeVisible();
  await page.locator(".modal-scrim").getByRole("button").last().click();
  await expect.poll(async () => (await readAll<{ masterTaskId: string; status: string }>(page, "dailyTasks")).map((d) => [d.masterTaskId, d.status])).toEqual([["s1", "running"]]);
  expect((await readAll(page, "masterTasks")).length).toBe(1);
});
