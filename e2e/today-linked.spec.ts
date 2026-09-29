import { expect, test } from "@playwright/test";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, openTaskTab, readAll, readOne, seed } from "./helpers";

// 案件の段階・案件・ToDoに紐づいた作業の完了確認と、案件タブからの「すぐ開始」、
// 「今日の段取り」の反映を固定する

type Project = { id: string; completedAt?: number; stages?: { id: string; completed: boolean }[] };
type Todo = { id: string; completed: boolean };
type Daily = { id: string; name: string; order: number; projectId?: string; stageId?: string; todoTaskId?: string };

async function startAndFinish(page: import("@playwright/test").Page) {
  await openTaskTab(page, "予定");
  await clickButton(page, /^開始$/);
  await page.clock.fastForward("05:00");
  await openTaskTab(page, "実行中");
  await clickButton(page, /^終了$/);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("段階の作業を終えると段階の完了を確認し、完了にできる", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      projects: [{ id: "p1", title: "案件A", category: "開発", workName: "機能", dueDate: jstDate(), createdAt: 0, stages: [{ id: "s1", title: "設計", completed: false }] }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), projectId: "p1", stageId: "s1" })],
    },
  });
  await startAndFinish(page);
  await expect(page.getByText("段階の進捗確認")).toBeVisible();
  await clickButton(page, "この段階を完了にする");
  expect((await readOne<Project>(page, "projects", "p1"))?.stages?.[0].completed).toBe(true);
});

test("段階のない案件の作業を終えると案件の完了を確認し、完了にできる", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      projects: [{ id: "p1", title: "案件B", category: "総務", workName: "調整", dueDate: jstDate(), createdAt: 0 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), projectId: "p1" })],
    },
  });
  await startAndFinish(page);
  await expect(page.getByText("案件の進捗確認")).toBeVisible();
  await clickButton(page, "この案件を完了にする");
  expect((await readOne<Project>(page, "projects", "p1"))?.completedAt).toBeTruthy();
});

test("段階とToDoの両方に紐づく作業は、段階→ToDoの順に1つずつ確認する", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      projects: [{ id: "p1", title: "案件D", category: "開発", workName: "機能", dueDate: jstDate(), createdAt: 0, stages: [{ id: "s1", title: "実装", completed: false }] }],
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t1", listId: "l1", title: "実装対応", completed: false, important: false, order: 0, createdAt: 0 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), projectId: "p1", stageId: "s1", todoTaskId: "t1" })],
    },
  });
  await startAndFinish(page);
  await expect(page.getByText("段階の進捗確認")).toBeVisible();
  await clickButton(page, "まだ続く");
  await expect(page.getByText("Todoの進捗確認")).toBeVisible();
  await clickButton(page, "Todoを完了にする");
  await expect(page.getByText("Todoの進捗確認")).toHaveCount(0);
  expect((await readOne<Todo>(page, "todoTasks", "t1"))?.completed).toBe(true);
  expect((await readOne<Project>(page, "projects", "p1"))?.stages?.[0].completed).toBe(false);
});

test("案件タブで段階を「すぐ開始」で追加すると、本日の作業の実行中に切り替わる", async ({ page }) => {
  await seed(page, {
    stores: {
      projects: [{ id: "p1", title: "案件E", category: "開発", workName: "機能", dueDate: jstDate(), createdAt: 0, stages: [{ id: "s1", title: "調査", completed: false }] }],
    },
  });
  await page.locator(".tab-chip", { hasText: "案件" }).first().click();
  await clickButton(page, "＋本日");
  await page.locator("label", { hasText: "追加してすぐ開始する" }).locator("input[type=checkbox]").check();
  await clickButton(page, /^追加する$/);
  await expect(page.locator(".tab-chip[data-active='true']", { hasText: "本日の作業" })).toBeVisible();
  expect((await readOne<{ value: string }>(page, "settings", "today.taskViewTab"))?.value).toBe("running");
  const [d] = await readAll<Daily & { status: string }>(page, "dailyTasks");
  expect(d).toMatchObject({ name: "調査", projectId: "p1", stageId: "s1", status: "running" });
});

test("「今日の段取り」を反映すると、期日順に並べ替えられ、案件・ToDoの紐付きで追加される", async ({ page }) => {
  await seed(page, {
    settings: { "today.provisionalBreakRanges": JSON.stringify([{ start: "12:00", end: "13:00" }]) },
    stores: {
      masterTasks: [{ ...MASTER, id: "mMail", category: "業務", name: "メール対応", estimatedSeconds: 1200 }],
      projects: [{ id: "p1", title: "新機能開発", category: "開発", workName: "実装", dueDate: jstDate(), createdAt: 0, stages: [{ id: "s1", title: "設計", completed: false }] }],
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [
        { id: "tOver", listId: "l1", title: "請求書送付", important: false, completed: false, order: 0, createdAt: 0, dueDate: jstDate(-1) },
        { id: "tTomorrow", listId: "l1", title: "見積回答", important: true, completed: false, order: 1, createdAt: 0, dueDate: jstDate(1) },
      ],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), masterTaskId: "mMail", category: "業務", name: "メール対応" })],
    },
  });
  await clickButton(page, "🧭 今日の段取り");
  const rows = page.locator("ol li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("10:00〜");
  await clickButton(page, "この計画を本日の作業に反映");
  const tasks = (await readAll<Daily>(page, "dailyTasks")).sort((a, b) => a.order - b.order);
  expect(tasks.map((t) => t.name)).toEqual(["請求書送付", "メール対応", "設計", "見積回答"]);
  expect(tasks.find((t) => t.name === "設計")).toMatchObject({ projectId: "p1", stageId: "s1" });
  expect(tasks.find((t) => t.name === "請求書送付")?.todoTaskId).toBe("tOver");
});
