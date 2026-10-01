import { expect, test } from "@playwright/test";
import { jstAt, jstDate, seed } from "./helpers";

// 統合ボードの「📈 進捗」: ToDo・案件を1件1行で、進み具合・期日に対するペース・最近の動きを並べる

const lists = [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }];
const todo = (t: Record<string, unknown>) => ({ listId: "l1", important: false, completed: false, order: 0, createdAt: jstAt("09:00", -10), ...t });

test("ボードに置いていないものも含めて危ない順に並び、状態で絞り込め、押すと詳細が開く", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "board.viewMode": "progress" },
    stores: {
      todoLists: lists,
      todoTasks: [
        todo({ id: "a", title: "A社見積", dueDate: jstDate(-2) }),
        todo({ id: "b", title: "資料整理", dueDate: jstDate(2) }),
        todo({ id: "b1", parentTaskId: "b", title: "下書き", completed: true, completedAt: jstAt("09:00") }),
        todo({ id: "b2", parentTaskId: "b", title: "清書" }),
        todo({ id: "b3", parentTaskId: "b", title: "提出" }),
        todo({ id: "c", title: "棚卸し", createdAt: jstAt("09:00", -40) }),
        todo({ id: "done", title: "終わったこと", completed: true, completedAt: jstAt("08:00") }),
      ],
      projects: [
        {
          id: "p1",
          title: "新機能開発",
          category: "開発",
          workName: "x",
          dueDate: jstDate(30),
          createdAt: jstAt("09:00", -1),
          stages: [
            { id: "s1", title: "設計", completed: true, completedAt: jstAt("09:00") },
            { id: "s2", title: "実装", completed: false },
          ],
        },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "統合ボード" }).first().click();
  const rows = page.getByTestId("progress-row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("A社見積");
  await expect(rows.nth(0)).toContainText("期限切れ");
  await expect(rows.nth(0)).toContainText("2日超過");
  await expect(rows.nth(1)).toContainText("資料整理");
  await expect(rows.nth(1)).toContainText("遅れ気味");
  await expect(rows.nth(1)).toContainText("1/3");
  await expect(rows.nth(1)).toContainText("次: 清書");
  await expect(rows.nth(2)).toContainText("棚卸し");
  await expect(rows.nth(2)).toContainText("停滞");
  await expect(rows.nth(3)).toContainText("新機能開発");
  await expect(rows.nth(3)).toContainText("順調");
  // 今日片付いたのは サブタスク1・段階1・ToDo1
  await expect(page.getByTestId("progress-view")).toContainText("3件");

  await page.getByRole("button", { name: /停滞 1/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("棚卸し");
  await page.getByRole("button", { name: /停滞 1/ }).click();
  await page.getByRole("button", { name: "📁 案件" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "すべて" }).click();

  await rows.filter({ hasText: "資料整理" }).click();
  await expect(page.locator(".modal-scrim").getByText("資料整理").first()).toBeVisible();
});
