import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, openTaskTab, seed } from "./helpers";

// サブタスクは名前だけでは何のことか分からないため、ToDoタブの外(本日の作業・報告)では
// 親タスク名を「親 › 子」で添える

const todos = () => [
  { id: "p", listId: "l1", title: "A社見積", important: false, completed: false, order: 0, createdAt: 0 },
  { id: "c", listId: "l1", parentTaskId: "p", title: "見積作成", important: false, completed: false, order: 0, createdAt: 0, dueDate: jstDate(-1) },
];
const lists = [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }];
const master = { ...MASTER, name: "見積作成" };

test("本日の作業: サブタスクから追加した作業のカード・期限の一覧・完了確認に親タスク名が出る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [master],
      todoLists: lists,
      todoTasks: todos(),
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), name: "見積作成", todoTaskId: "c" })],
    },
  });
  // 作業カードの「元Todo」
  await expect(page.getByRole("button", { name: "A社見積 › 見積作成" })).toBeVisible();

  // 予定タブの「期限切れ」の一覧
  await page.locator("button", { hasText: /期限切れ/ }).first().click();
  await expect(page.locator(".modal-scrim").getByText("A社見積 ›")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".modal-scrim button[aria-label='閉じる']").first().click().catch(() => {});

  // 作業を終えたときの「元のTodoはこれで完了ですか?」
  await clickButton(page, /^開始$/);
  await openTaskTab(page, "実行中");
  await clickButton(page, /^終了$/);
  await expect(page.getByText("元のTodo「A社見積 › 見積作成」はこれで完了ですか?")).toBeVisible();
});

test("週報: 作業時間ランキングと完了したことに、サブタスクの親タスク名が出る", async ({ page }) => {
  await page.clock.install({ time: jstAt("18:00") });
  const t: Record<string, unknown>[] = todos();
  t[1] = { ...t[1], completed: true, completedAt: jstAt("11:00") };
  await seed(page, {
    stores: {
      masterTasks: [master],
      todoLists: lists,
      todoTasks: t,
      records: [
        { id: "r1", date: jstDate(), category: "業務", name: "見積作成", masterTaskId: "m1", todoTaskId: "c", seconds: 3600, startedAt: jstAt("10:00"), endedAt: jstAt("11:00"), excludedFromStats: false },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "日報・週報・月報" }).click();
  await page.locator("button", { hasText: /^週報$/ }).click();
  await expect(page.getByText("A社見積 › 見積作成").first()).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("button", { hasText: "ダウンロード (.txt)" }).click()]);
  const text = readFileSync((await download.path())!, "utf-8");
  expect(text).toContain("1. 業務 / A社見積 › 見積作成 - 合計 01:00:00");
  expect(text).toMatch(/サブタスク 1件\n- A社見積 › 見積作成/);
});
