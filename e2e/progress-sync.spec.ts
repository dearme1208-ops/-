import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { jstAt, jstDate, readOne, seed } from "./helpers";

// 別のAIに案件・ToDoの進捗を登録してもらう: 仕様書と現状を渡し、返ってきた更新を確認して反映する

const lists = [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }];

test("仕様書と現状を書き出し、AIの返答を貼り付けて確認・反映・取り消しができる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [
        { id: "t1", listId: "l1", title: "B社対応", important: false, completed: false, order: 0, createdAt: 0, notes: "経緯" },
        { id: "t1a", listId: "l1", parentTaskId: "t1", title: "資料送付", important: false, completed: false, order: 0, createdAt: 0 },
      ],
      projects: [
        {
          id: "p1",
          title: "A社見積",
          category: "営業",
          workName: "見積",
          dueDate: jstDate(10),
          createdAt: jstAt("09:00", -10),
          fromImport: false,
          stages: [
            { id: "s1", title: "ヒアリング", completed: true },
            { id: "s2", title: "見積作成", completed: false },
          ],
        },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "案件" }).first().click();
  await page.getByRole("button", { name: "🤖 AIと進捗をやり取り" }).click();

  const [specDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /仕様書（.md）をダウンロード/ }).click()]);
  expect(specDl.suggestedFilename()).toMatch(/\.md$/);
  expect(readFileSync((await specDl.path())!, "utf-8")).toContain("koutei-progress-update");

  const [snapDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /現状を書き出す/ }).click()]);
  const snap = JSON.parse(readFileSync((await snapDl.path())!, "utf-8"));
  expect(snap.format).toBe("koutei-progress-snapshot");
  expect(snap.projects[0].stages.map((s: { id: string }) => s.id)).toEqual(["s1", "s2"]);
  expect(snap.todos[0].subtasks[0].id).toBe("t1a");

  // AIの返答(前後の文章とコードブロックつき)をそのまま貼り付ける
  const reply = [
    "以下のとおり更新します。",
    "```json",
    JSON.stringify({
      format: "koutei-progress-update",
      version: 1,
      operations: [
        { op: "updateStage", projectId: "p1", stageId: "s2", completed: true, completedDate: jstDate(-1) },
        { op: "updateSubtask", todoId: "t1", subtaskId: "t1a", completed: true },
        { op: "updateTodo", todoId: "t1", tag: "客先確認中", appendNotes: "返事待ち" },
        { op: "updateStage", projectTitle: "無い案件", stageTitle: "x", completed: true },
      ],
    }),
    "```",
  ].join("\n");
  await page.getByLabel("進捗の更新").fill(reply);
  await page.getByRole("button", { name: "内容を確認" }).click();
  await expect(page.getByTestId("sync-op-ok")).toHaveCount(3);
  await expect(page.getByTestId("sync-op-ng")).toContainText("無い案件");
  await expect(page.getByTestId("sync-plan")).toContainText("案件「A社見積」の段階「見積作成」: 完了にする");
  // 確認しただけでは何も変わっていない
  expect((await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))!.stages[1].completed).toBe(false);

  await page.getByRole("button", { name: "3件を反映する" }).click();
  await expect.poll(async () => (await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))!.stages[1].completed).toBe(true);
  expect(await readOne(page, "todoTasks", "t1a")).toMatchObject({ completed: true });
  expect(await readOne(page, "todoTasks", "t1")).toMatchObject({ tag: "客先確認中", notes: `経緯\n[${jstDate()}] 返事待ち` });
  const stage = (await readOne<{ stages: { completedAt: number }[] }>(page, "projects", "p1"))!.stages[1];
  expect(new Date(stage.completedAt).getDate()).toBe(new Date(jstAt("12:00", -1)).getDate());

  await page.getByRole("button", { name: "↩ 今の反映を取り消す" }).click();
  await expect(page.getByText("直前の反映を取り消しました。")).toBeVisible();
  await expect.poll(async () => (await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))!.stages[1].completed).toBe(false);
  expect(await readOne(page, "todoTasks", "t1")).toMatchObject({ notes: "経緯" });
  expect((await readOne<{ tag?: string }>(page, "todoTasks", "t1"))!.tag).toBeUndefined();
});

test("ToDoタブからも開け、形式の違うものは取り込まない", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { stores: { todoLists: lists } });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name: "🤖 AIと進捗をやり取り" }).click();
  await page.getByLabel("進捗の更新").fill('{"format":"koutei-progress-snapshot","version":1}');
  await page.getByRole("button", { name: "内容を確認" }).click();
  await expect(page.getByText(/取り込めません: "format"/)).toBeVisible();
  await page.getByLabel("進捗の更新").fill("よろしくお願いします");
  await page.getByRole("button", { name: "内容を確認" }).click();
  await expect(page.getByText(/JSONとして読めませんでした/)).toBeVisible();
});
