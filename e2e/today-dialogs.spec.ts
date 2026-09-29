import { expect, test } from "@playwright/test";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, openTaskTab, readAll, readOne, seed } from "./helpers";

// 本日の作業タブの確認ダイアログ(体調記録・仮計測との衝突・期限の一覧・追加の案件タグ・
// 超過の確認・テンプレートからの生成)が、今の通りに出て、選んだ結果が記録に反映されることを固定する

type Daily = { id: string; status: string; name: string; isProvisional?: boolean; secondaryProjectIds?: string[]; overrunPromptShown?: boolean; segments: { start: number }[] };

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("当日最初の開始時に体調を尋ね、選んだ体調を記録してから開始する", async ({ page }) => {
  await seed(page, {
    settings: { "condition.enabled": "true" },
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] },
  });
  await openTaskTab(page, "予定");
  await clickButton(page, /^開始$/);
  await expect(page.getByText("体調を記録してから始めますか?")).toBeVisible();
  await page.locator(".modal-scrim").last().locator("button[aria-label='良い']").click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "d1"))?.status).toBe("running");
  expect(await readAll(page, "conditionLogs")).toHaveLength(1);
});

test("仮計測中に新しい作業をすぐ開始しようとすると確認し、合算を選ぶと未計測の開始時刻から計測する", async ({ page }) => {
  await seed(page, {
    settings: { "today.provisionalEnabled": "true" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "p1", date: jstDate(), category: "未分類", name: "仮計測中", masterTaskId: undefined, status: "running", isProvisional: true, segments: [{ start: jstAt("09:45") }], startedAt: jstAt("09:45") }),
      ],
    },
  });
  await clickButton(page, "+ 突発作業を追加");
  await page.locator(".modal-scrim").last().locator("button", { hasText: "自由入力" }).click();
  await page.getByPlaceholder("例: 資料作成").fill("総務");
  await page.getByPlaceholder("例: 見積書の作成").fill("来客対応");
  await clickButton(page, "追加してすぐ開始");
  await expect(page.getByText("未計測(仮計測)が計測中です")).toBeVisible();
  await clickButton(page, "今回の作業に合算する");
  const tasks = await readAll<Daily>(page, "dailyTasks");
  expect(tasks.some((t) => t.isProvisional)).toBe(false);
  const started = tasks.find((t) => t.name === "来客対応")!;
  expect(started.status).toBe("running");
  expect(started.segments[0].start).toBe(jstAt("09:45"));
});

test("予定タブの「期限切れ」から一覧を開き、選ぶとToDoの詳細へ移る", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t1", listId: "l1", title: "請求書送付", completed: false, important: false, order: 0, createdAt: 0, dueDate: jstDate(-2) }],
    },
  });
  await clickButton(page, "期限切れ 1件");
  await expect(page.getByText("⚠ 期限切れ・本日期限のToDo")).toBeVisible();
  await expect(page.getByText("2日超過")).toBeVisible();
  await clickButton(page, "請求書送付");
  await expect(page.locator(".tab-chip[data-active='true']", { hasText: "ToDo" })).toBeVisible();
});

test("作業カードの🏷️から、兼務の追加案件を付け外しできる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      projects: [
        { id: "p1", title: "主案件", category: "開発", workName: "x", dueDate: jstDate(), createdAt: 0 },
        { id: "p2", title: "兼務案件", category: "開発", workName: "y", dueDate: jstDate(), createdAt: 0 },
      ],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), projectId: "p1" })],
    },
  });
  await page.locator("button[aria-label='追加の案件タグ']").first().click();
  const dialog = page.locator(".modal-scrim").last();
  await expect(dialog.getByText("主案件")).toBeVisible();
  await dialog.locator("label", { hasText: "兼務案件" }).locator("input").click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "d1"))?.secondaryProjectIds).toEqual(["p2"]);
});

test("予測を大きく超えて計測が続くと「まだこの作業中ですか?」と確認し、続けるを選ぶと記録する", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [{ ...MASTER, estimatedSeconds: 60 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), estimatedSeconds: 60, hasPlan: true, status: "running", segments: [{ start: jstAt("10:00") }], startedAt: jstAt("10:00") })],
    },
  });
  await page.clock.fastForward("25:00");
  await expect(page.getByText("まだこの作業中ですか?")).toBeVisible();
  await clickButton(page, "続けている");
  expect((await readOne<Daily>(page, "dailyTasks", "d1"))?.overrunPromptShown).toBe(true);
  await expect(page.getByText("まだこの作業中ですか?")).toHaveCount(0);
});

test("曜日のテンプレートから本日の作業リストを生成できる", async ({ page }) => {
  const templates = [1, 2, 3, 4, 5].flatMap((weekday) => [
    { id: `tpl-${weekday}-a`, weekday, order: 0, category: "定例", name: "朝会", estimatedSeconds: 900 },
    { id: `tpl-${weekday}-b`, weekday, order: 1, category: "定例", name: "日報", estimatedSeconds: 600 },
  ]);
  await seed(page, { stores: { templateItems: templates } });
  await clickButton(page, "テンプレートから生成");
  await expect(page.locator(".modal-scrim").last().getByText("本日の作業リストを生成")).toBeVisible();
  await clickButton(page, /^生成する$/);
  const names = (await readAll<Daily & { order: number }>(page, "dailyTasks")).sort((a, b) => a.order - b.order).map((t) => t.name);
  expect(names).toEqual(["朝会", "日報"]);
});
