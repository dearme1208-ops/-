import { expect, test } from "@playwright/test";
import { jstAt, readAll, seed } from "./helpers";

// ToDoの「コピーして追加」: コピーできたことが分かり(見出し・帯・知らせ)、知らせから取り消せる

type Todo = { id: string; title: string; parentTaskId?: string };

test("コピーして追加すると、コピーを開いていると分かる帯と知らせが出て、「元に戻す」でコピーが消える", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "todo.view": "list:l" },
    stores: {
      todoLists: [{ id: "l", title: "仕事", order: 0, createdAt: 0 }],
      todoTasks: [
        { id: "a", listId: "l", title: "見積もり送付", completed: false, important: false, order: 0, createdAt: 0, myDayDate: undefined },
        { id: "s", listId: "l", parentTaskId: "a", title: "金額の確認", completed: false, important: false, order: 0, createdAt: 0 },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name: "仕事" }).first().click();
  await page.getByText("見積もり送付").first().click();
  await expect(page.getByRole("heading", { name: "タスクの詳細" })).toBeVisible();

  await page.getByRole("button", { name: "コピーして追加" }).click();
  await expect(page.getByRole("heading", { name: "タスクの詳細（コピー）" })).toBeVisible();
  await expect(page.getByTestId("todo-copied-notice")).toContainText("「見積もり送付」をコピーして、新しいタスクとして追加しました");
  await expect(page.getByText("「見積もり送付」をコピーして追加しました（サブタスク1件も）。開いているのはコピーです")).toBeVisible();
  await expect.poll(async () => (await readAll<Todo>(page, "todoTasks")).length).toBe(4);

  await page.getByRole("button", { name: /元に戻す/ }).first().click();
  await expect.poll(async () => (await readAll<Todo>(page, "todoTasks")).map((t) => t.id).sort()).toEqual(["a", "s"]);
  // 元のタスクを開いた状態に戻る(帯は出ない)
  await expect(page.getByRole("heading", { name: "タスクの詳細" })).toBeVisible();
  await expect(page.getByTestId("todo-copied-notice")).toHaveCount(0);
});
