import { expect, test } from "@playwright/test";
import { jstAt, readAll, seed } from "./helpers";

// ゴミ箱: 消したToDoが設定の「ゴミ箱」に入り、「戻す」でサブタスクごと元に戻る

type Todo = { id: string; title: string; parentTaskId?: string };

test("ToDoを削除すると設定のゴミ箱に入り、「戻す」でサブタスクごと戻る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "todo.view": "list:l" },
    stores: {
      todoLists: [{ id: "l", title: "仕事", order: 0, createdAt: 0 }],
      todoTasks: [
        { id: "a", listId: "l", title: "見積もり作成", completed: false, important: false, order: 0, createdAt: 0 },
        { id: "s", listId: "l", parentTaskId: "a", title: "金額の確認", completed: false, important: false, order: 0, createdAt: 0 },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name: "仕事" }).first().click();
  await page.getByText("見積もり作成").first().click();
  await expect(page.getByRole("heading", { name: "タスクの詳細" })).toBeVisible();
  await page.getByRole("button", { name: "タスクを削除" }).click();
  await expect.poll(async () => (await readAll<Todo>(page, "todoTasks")).length).toBe(0);

  await page.locator(".tab-chip", { hasText: "設定" }).first().click();
  await page.locator("button[aria-pressed]", { hasText: "💾 データ" }).click();
  const panel = page.getByTestId("trash-panel");
  await expect(panel).toBeVisible();
  const item = panel.getByTestId("trash-item").filter({ hasText: "ToDo「見積もり作成」とサブタスク1件" });
  await expect(item).toBeVisible();
  await expect(item).toContainText("あと7日で消えます");
  await item.getByRole("button", { name: "戻す" }).click();

  await expect.poll(async () => (await readAll<Todo>(page, "todoTasks")).map((t) => t.id).sort()).toEqual(["a", "s"]);
  await expect(panel.getByTestId("trash-item")).toHaveCount(0);
  await expect(panel).toContainText("ゴミ箱は空です");

  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await expect(page.getByText("見積もり作成").first()).toBeVisible();
});
