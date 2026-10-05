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

  await page.getByText("仕様書・現状のデータを個別に渡す").click();
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
        { op: "updateSubtask", todoId: "t1", subtaskId: "t1a", tag: "客先確認中" },
        { op: "updateTodo", todoId: "t1", appendNotes: "返事待ち" },
        // サブタスクのあるToDoの対応状況は自動で決まるので、本体への変更は受け付けない
        { op: "updateTodo", todoId: "t1", tag: "客先確認中" },
        { op: "updateStage", projectTitle: "無い案件", stageTitle: "x", completed: true },
      ],
    }),
    "```",
  ].join("\n");
  await page.getByLabel("進捗の更新").fill(reply);
  await page.getByRole("button", { name: "内容を確認" }).click();
  await expect(page.getByTestId("sync-op-ok")).toHaveCount(4);
  await expect(page.getByTestId("sync-op-ng")).toHaveCount(2);
  await expect(page.getByTestId("sync-op-ng").filter({ hasText: "無い案件" })).toHaveCount(1);
  await expect(page.getByTestId("sync-op-ng").filter({ hasText: "updateSubtask" })).toHaveCount(1);
  await expect(page.getByTestId("sync-plan")).toContainText("案件「A社見積」の段階「見積作成」: 完了にする");
  // 確認しただけでは何も変わっていない
  expect((await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))!.stages[1].completed).toBe(false);

  await page.getByRole("button", { name: "4件を反映する" }).click();
  await expect.poll(async () => (await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))!.stages[1].completed).toBe(true);
  expect(await readOne(page, "todoTasks", "t1a")).toMatchObject({ completed: true, tag: "客先確認中" });
  expect(await readOne(page, "todoTasks", "t1")).toMatchObject({ notes: `経緯\n[${jstDate()}] 返事待ち` });
  const stage = (await readOne<{ stages: { completedAt: number }[] }>(page, "projects", "p1"))!.stages[1];
  expect(new Date(stage.completedAt).getDate()).toBe(new Date(jstAt("12:00", -1)).getDate());

  await page.getByRole("button", { name: "↩ 今の反映を取り消す" }).click();
  await expect(page.getByText("直前の反映を取り消しました。")).toBeVisible();
  await expect.poll(async () => (await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))!.stages[1].completed).toBe(false);
  expect(await readOne(page, "todoTasks", "t1")).toMatchObject({ notes: "経緯" });
  expect((await readOne<{ tag?: string }>(page, "todoTasks", "t1a"))!.tag).toBeUndefined();
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

test("依頼文をワンタップでコピーでき、コピーできない環境では全文を出して保存もできる", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [{ id: "t1", listId: "l1", title: "B社対応", important: false, completed: false, order: 0, createdAt: 0 }],
    },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name: "🤖 AIと進捗をやり取り" }).click();
  await page.getByRole("button", { name: "📈 進捗を登録してもらう" }).click();
  await expect(page.getByText("コピーしました。Claudeとの会話に貼り付けてください。")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("進捗を「工程表」アプリに登録するアシスタント");
  expect(copied).toContain("koutei-progress-update");
  expect(copied).toContain('"id": "t1"');

  // クリップボードが使えない場合
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
  });
  await page.getByRole("button", { name: "📝 議事録・メールからToDoにしてもらう" }).click();
  await expect(page.getByText("自動でコピーできませんでした。")).toBeVisible();
  await expect(page.getByLabel("依頼文")).toHaveValue(/議事録・メールから/);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "ファイルで保存（.txt）" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^koutei-prompt-notes-.*\.txt$/);
});

test("今の案件・ToDoを、頼みごと抜きの一覧としてそのままコピー・保存できる(データは変わらない)", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      todoLists: lists,
      todoTasks: [
        { id: "t1", listId: "l1", title: "B社対応", important: true, completed: false, order: 0, createdAt: 0, dueDate: jstDate(2) },
        { id: "t1a", listId: "l1", parentTaskId: "t1", title: "資料送付", important: false, completed: false, order: 0, createdAt: 0 },
      ],
      projects: [{ id: "p1", title: "A社の見積", category: "営業", workName: "見積", dueDate: jstDate(5), createdAt: 0, stages: [] }],
    },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name: "🤖 AIと進捗をやり取り" }).click();
  const box = page.getByTestId("plain-list");
  await box.getByRole("button", { name: "📋 一覧をコピー" }).click();
  await expect(box.getByText("コピーしました。")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("# 案件・ToDoの一覧");
  expect(copied).toContain("### A社の見積");
  expect(copied).toContain(`- 期日 ${jstDate(5)}（あと5日）`);
  expect(copied).toMatch(/- \[ \] B社対応（★重要・期日 .*（あと2日））/);
  expect(copied).toContain("  - [ ] 資料送付");
  // 頼みごとや仕様書・IDは入れない
  expect(copied).not.toContain("アシスタント");
  expect(copied).not.toContain("koutei-");
  expect(copied).not.toContain('"id"');

  const [dl] = await Promise.all([page.waitForEvent("download"), box.getByRole("button", { name: "⬇ 一覧を保存（.md）" }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^koutei-list-.*\.md$/);
});
