import { expect, test } from "@playwright/test";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 本日の作業タブの作業カード上の操作(お気に入り・削除・前の作業の終了時刻からの開始・
// 紐づくToDo/段階の完了・ドラッグでの並べ替え)を固定する

type Daily = { id: string; status: string; name: string; order: number; segments: { start: number }[] };

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("☆でお気に入りに登録すると、作業マスタがお気に入りになる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] },
  });
  await page.locator("button[aria-label='お気に入りに追加']").first().click();
  await expect.poll(async () => (await readOne<{ isFavorite: boolean }>(page, "masterTasks", "m1"))?.isFavorite).toBe(true);
});

test("未着手の作業を✕で削除できる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] },
  });
  page.once("dialog", (d) => d.accept());
  await page.locator("button[aria-label='削除']").first().click();
  await expect.poll(async () => (await readAll(page, "dailyTasks")).length).toBe(0);
});

test("前の作業を止めた時刻から開始できる", async ({ page }) => {
  const date = jstDate();
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "prev", date, name: "前の作業", status: "done", segments: [{ start: jstAt("09:00"), end: jstAt("09:45") }], accumulatedMs: 45 * 60_000, startedAt: jstAt("09:00"), endedAt: jstAt("09:45"), stoppedAt: jstAt("09:45") }),
        dailyTask({ id: "d1", date, order: 1 }),
      ],
    },
  });
  await clickButton(page, "09:45から開始");
  const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
  expect(d.status).toBe("running");
  expect(d.segments[0].start).toBe(jstAt("09:45"));
});

test("カードの「Todoを完了にする」で、紐づくToDoを完了にできる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t1", listId: "l1", title: "見積回答", completed: false, important: false, order: 0, createdAt: 0 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), todoTaskId: "t1" })],
    },
  });
  await expect(page.getByText("📌 元Todo:")).toBeVisible();
  await clickButton(page, "✓ Todoを完了にする");
  await expect.poll(async () => (await readOne<{ completed: boolean }>(page, "todoTasks", "t1"))?.completed).toBe(true);
});

test("カードの「段階を完了にする」で、段階の完了確認が開く", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      projects: [{ id: "p1", title: "案件A", category: "開発", workName: "x", dueDate: jstDate(), createdAt: 0, stages: [{ id: "s1", title: "設計", completed: false }] }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), projectId: "p1", stageId: "s1" })],
    },
  });
  await clickButton(page, "✓ 段階を完了にする");
  await expect(page.getByText("段階の進捗確認")).toBeVisible();
  await clickButton(page, "この段階を完了にする");
  await expect
    .poll(async () => (await readOne<{ stages: { completed: boolean }[] }>(page, "projects", "p1"))?.stages[0].completed)
    .toBe(true);
});

test("未着手の作業はドラッグで並べ替えられる", async ({ page }) => {
  const date = jstDate();
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date, order: 0, name: "作業A" }),
        dailyTask({ id: "b", date, order: 1, name: "作業B" }),
        dailyTask({ id: "c", date, order: 2, name: "作業C" }),
      ],
    },
  });
  const card = (name: string) => page.locator("div[draggable='true']", { hasText: name }).first();
  await card("作業C").dragTo(card("作業A"));
  await expect
    .poll(async () => (await readAll<Daily>(page, "dailyTasks")).sort((x, y) => x.order - y.order).map((t) => t.name))
    .toEqual(["作業C", "作業A", "作業B"]);
});

test("計測中のカードで手段を入れられ、完了するとその手段で実績に残る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "r", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") })],
    },
  });
  await page.getByTestId("task-method").first().click();
  await page.getByLabel("手段").fill("Excel");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("task-method").first()).toHaveText("🛠 手段: Excel");
  expect((await readOne<{ method: string }>(page, "dailyTasks", "r"))?.method).toBe("Excel");
  await page.locator("button", { hasText: /^終了$/ }).first().click();
  await expect.poll(async () => (await readAll<{ method?: string }>(page, "records")).map((r) => r.method)).toEqual(["Excel"]);
});
