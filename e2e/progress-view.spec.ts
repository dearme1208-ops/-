import { expect, test } from "@playwright/test";
import { jstAt, jstDate, readAll, readOne, seed } from "./helpers";

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

  await rows.filter({ hasText: "資料整理" }).getByRole("button", { expanded: false }).click();
  await page.getByRole("button", { name: "ToDoの詳細を開く" }).click();
  await expect(page.locator(".modal-scrim").getByText("資料整理").first()).toBeVisible();
});

test("行を開くと累計の線と残りの手順が出て、その場で完了(取り消し可)・今日やるにできる。相手待ちは停滞と分けて数える", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "board.viewMode": "progress" },
    stores: {
      todoLists: lists,
      todoTasks: [
        todo({ id: "w", title: "B社回答待ち", tag: "客先確認中", tagChangedAt: jstAt("09:00", -20), createdAt: jstAt("09:00", -30) }),
        { id: "origin", listId: "l1", title: "新機能開発", important: false, completed: false, order: 1, createdAt: jstAt("09:00", -10), projectId: "p1" },
      ],
      projects: [
        {
          id: "p1",
          title: "新機能開発",
          category: "開発",
          workName: "x",
          dueDate: jstDate(10),
          createdAt: jstAt("09:00", -10),
          stages: [
            { id: "s1", title: "設計", completed: true, completedAt: jstAt("09:00", -5) },
            { id: "s2", title: "実装", completed: false },
            { id: "s3", title: "試験", completed: false },
          ],
        },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "統合ボード" }).first().click();
  const waitingRow = page.getByTestId("progress-row").filter({ hasText: "B社回答待ち" });
  await expect(waitingRow).toContainText("相手待ち");
  await expect(waitingRow).toContainText("客先確認中 21日目");
  await expect(page.getByRole("button", { name: /停滞 0/ })).toBeVisible();

  const row = page.getByTestId("progress-row").filter({ hasText: "新機能開発" }).filter({ hasText: "📁" });
  await expect(row.getByTestId("progress-pace")).toContainText("このペースだと");
  await row.getByRole("button", { expanded: false }).click();
  const detail = row.getByTestId("progress-detail");
  await expect(detail.locator("svg")).toBeVisible();
  await expect(detail.getByTestId("progress-step")).toHaveCount(2);

  // 今日やる → 段階・案件・元のToDoの紐付きで本日の作業に入り、行には「入っています」と出る
  await detail.getByTestId("progress-step").filter({ hasText: "実装" }).getByRole("button", { name: "▶ 今日やる" }).click();
  await expect(detail.getByTestId("progress-step").filter({ hasText: "実装" })).toContainText("今日の作業に入っています");
  const daily = (await readAll<Record<string, unknown>>(page, "dailyTasks")).find((t) => t.name === "実装");
  expect(daily).toMatchObject({ category: "開発", projectId: "p1", stageId: "s2", todoTaskId: "origin", status: "pending" });

  // その場で完了 → 取り消せる
  await detail.getByRole("button", { name: "「試験」を完了にする" }).click();
  await expect(detail.getByTestId("progress-step")).toHaveCount(1);
  await expect(row).toContainText("2/3");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(row).toContainText("1/3");
  const p = await readOne<{ stages: { id: string; completed: boolean }[] }>(page, "projects", "p1");
  expect(p!.stages.find((s) => s.id === "s3")!.completed).toBe(false);
});
