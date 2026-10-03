import { expect, test } from "@playwright/test";
import { jstAt, jstDate, readAll, seed } from "./helpers";

// Claudeモードのワークスペース: 話し言葉の入力、作業中の表示、覚えていること、本物のClaudeへの引き継ぎ

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

const CLAUDE = { "theme.visualMode": "claude", "theme.applyWording": "true" };

test("話し言葉で書くと、期限・見込み・分類を受け取ってタスクにし、そのまま取り組める", async ({ page }) => {
  await seed(page, { settings: CLAUDE });
  await expect(page.getByTestId("claude-greeting")).toContainText("こんにちは");
  const box = page.getByTestId("claude-composer").locator("textarea");
  await box.fill("明日までに見積書を送る 30分 @営業");
  const understood = page.getByTestId("claude-understood");
  await expect(understood).toContainText("見積書を送る");
  await expect(understood).toContainText("期限 明日");
  await expect(understood).toContainText("見込み 30分");
  await expect(understood).toContainText("@営業");
  await box.press("Enter");
  await expect(box).toHaveValue("");

  const todos = await readAll<{ title: string; dueDate: string; category: string; estimateMinutes: number }>(page, "todoTasks");
  expect(todos).toHaveLength(1);
  expect(todos[0]).toMatchObject({ title: "見積書を送る", dueDate: jstDate(1), category: "営業", estimateMinutes: 30 });

  await page.getByTestId("claude-todo").getByRole("button", { name: "▸ 今から取り組む" }).click();
  await expect(page.getByTestId("claude-working")).toContainText("見積書を送る");
  const daily = await readAll<{ status: string; estimatedSeconds: number }>(page, "dailyTasks");
  expect(daily[0]).toMatchObject({ status: "running", estimatedSeconds: 1800 });
});

test("「プロジェクトにする」で送ると、期日つきのプロジェクトになる(期日が無ければ1週間後)", async ({ page }) => {
  await seed(page, { settings: CLAUDE });
  await page.getByRole("button", { name: "プロジェクトにする" }).click();
  await page.getByTestId("claude-composer").locator("textarea").fill("新サイトの制作");
  await page.getByRole("button", { name: "プロジェクトとして登録" }).click();
  const projects = await readAll<{ title: string; dueDate: string }>(page, "projects");
  expect(projects).toEqual([expect.objectContaining({ title: "新サイトの制作", dueDate: jstDate(7) })]);
  await expect(page.getByText("新サイトの制作").first()).toBeVisible();
});

test("覚えていることを忘れられ、自分で書き足したことは引き継ぎ文に入る", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const records = Array.from({ length: 12 }, (_, i) => ({
    id: "r" + i, date: jstDate(-i), category: "業務", name: "会議", masterTaskId: "m2", seconds: 1800,
    startedAt: jstAt("09:30", -i), endedAt: jstAt("10:00", -i), excludedFromStats: false,
  }));
  await seed(page, { settings: CLAUDE, stores: { records } });
  const memory = page.getByTestId("claude-memory");
  await memory.locator("summary").click();
  await expect(memory).toContainText("「業務 / 会議」は、たいてい30分ほどかかる");
  await memory.getByRole("listitem").filter({ hasText: "会議" }).getByRole("button", { name: "忘れる" }).click();
  await expect(memory).not.toContainText("「業務 / 会議」は");
  await expect(memory.getByRole("button", { name: "忘れた1件を思い出す" })).toBeVisible();

  await memory.getByPlaceholder("覚えておいてほしいこと（例: 午後は電話が多い）").fill("午後は電話が多い");
  await memory.getByRole("button", { name: "覚えておく" }).click();
  await expect(memory).toContainText("午後は電話が多い");

  await page.getByTestId("claude-connect").getByRole("button", { name: "引き継ぎ文をコピー" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("# 工程表アプリからの引き継ぎ");
  expect(copied).toContain("- 午後は電話が多い");
  expect(copied).not.toContain("会議」は");
});

test("Claudeモードからも、進捗・時間割のやり取り画面を開ける", async ({ page }) => {
  await seed(page, { settings: CLAUDE });
  await page.getByTestId("claude-connect").getByRole("button", { name: "進捗・時間割をやり取りする" }).click();
  await expect(page.getByText("① 依頼文をコピーしてClaudeに貼る")).toBeVisible();
});
