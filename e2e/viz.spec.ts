import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, seed } from "./helpers";

// 数字を読まずに見て分かる可視化(今日のリング・砂時計・いつもの幅・期日の山 など)

const M = [MASTER, { ...MASTER, id: "m2", name: "電話対応", category: "総務" }, { ...MASTER, id: "m3", name: "掃除", category: "家事" }];
const done = (id: string, m: string, name: string, cat: string, from: string, to: string, est = 0, d = 0) =>
  dailyTask({
    id, date: jstDate(d), masterTaskId: m, name, category: cat, status: "done", estimatedSeconds: est,
    segments: [{ start: jstAt(from, d), end: jstAt(to, d) }], accumulatedMs: jstAt(to) - jstAt(from), startedAt: jstAt(from, d), endedAt: jstAt(to, d),
  });
// 資料作成は過去10回すべて40分 → いつもの幅は40〜40分
const history = Array.from({ length: 10 }, (_, i) => done("h" + i, "m1", "資料作成", "業務", "09:00", "09:40", 1800, -i - 1));
const records = Array.from({ length: 14 }, (_, i) => ({
  id: "r" + i, date: jstDate(-(i % 7)), category: ["業務", "総務"][i % 2], name: "x", masterTaskId: "m1", seconds: 1800, startedAt: 0, endedAt: 0, excludedFromStats: false,
}));

test("今日タブ: リング・砂時計・次の予定・いつもの幅・1週間の積み木・調子の地図が出て、完了タブに予定と実績が出る", async ({ page }) => {
  await page.clock.install({ time: jstAt("16:10") });
  await seed(page, {
    settings: { "today.taskViewTab": "running" },
    stores: {
      masterTasks: M,
      records,
      dailyTasks: [
        ...history,
        done("d0", "m2", "電話対応", "総務", "08:30", "09:00", 1800),
        dailyTask({ id: "run", date: jstDate(), masterTaskId: "m1", name: "資料作成", status: "running", estimatedSeconds: 2400, hasPlan: true, segments: [{ start: jstAt("15:50") }], startedAt: jstAt("15:50") }),
        dailyTask({ id: "p1", date: jstDate(), order: 5, masterTaskId: "m2", name: "電話対応", category: "総務", estimatedSeconds: 1800, scheduledTime: "16:40" }),
      ],
    },
  });
  await expect(page.getByTestId("next-schedule")).toContainText("16:40");
  await expect(page.getByTestId("next-schedule")).toContainText("電話対応");
  await expect(page.getByTestId("range-band")).toContainText("いつもは40〜40分（10回の記録）");
  await expect(page.getByTestId("day-ring")).toBeVisible();
  await expect(page.getByTestId("hourglass")).toContainText("18:00までに収まる？");
  await expect(page.getByTestId("hourglass")).toContainText("収まる");
  await expect(page.getByTestId("week-blocks")).toContainText("業務");
  await expect(page.getByTestId("condition-heatmap")).toBeVisible();

  await page.getByRole("button", { name: /完了/ }).filter({ hasText: "(1)" }).first().click();
  await expect(page.getByTestId("plan-actual")).toContainText("電話対応");
});

test("ToDoタブの期日の山: 日を押すとその日の期日が出る / 案件タブの山登り: 遅れている案件が分かる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      todoLists: [{ id: "l", title: "仕事", order: 0, createdAt: 0 }],
      todoTasks: [
        { id: "t1", listId: "l", title: "見積もり送付", completed: false, important: false, order: 0, createdAt: 0, dueDate: jstDate(2) },
        { id: "t2", listId: "l", title: "済んだもの", completed: true, important: false, order: 1, createdAt: 0, dueDate: jstDate(2) },
      ],
      projects: [
        // 10日前に登録して期日まであと3日、段階は1/3 → 遅れ気味
        { id: "pa", title: "B社 提案", dueDate: jstDate(3), createdAt: jstAt("09:00", -10), stages: [{ id: "s1", title: "ヒアリング", completed: true }, { id: "s2", title: "資料", completed: false, dueDate: jstDate(2) }, { id: "s3", title: "提出", completed: false }] },
      ],
    },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  const terrain = page.getByTestId("due-terrain");
  await expect(terrain).toBeVisible();
  await terrain.getByRole("button", { name: /期日2件/ }).click();
  const day = page.getByTestId("due-terrain-day");
  await expect(day).toContainText("見積もり送付");
  await expect(day).toContainText("B社 提案／資料");
  await expect(day).not.toContainText("済んだもの");

  await page.locator(".tab-chip", { hasText: "案件" }).first().click();
  const climb = page.getByTestId("project-climb");
  await expect(climb).toContainText("B社 提案");
  await expect(climb).toContainText("段階 1/3");
  await expect(climb).toContainText("あと3日");
  await expect(climb.locator(".text-alert", { hasText: "B社 提案" })).toBeVisible();
});

test("相手待ちの砂時計: 待った日数の長い順に並び、催促の目安を過ぎたものは赤で「⏰」、押すと開く", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  const todo = (id: string, title: string, tag: string, daysAgo: number) => ({
    id, listId: "l", title, completed: false, important: false, order: 0, createdAt: 0, tag, tagChangedAt: jstAt("09:00", -daysAgo),
  });
  await seed(page, {
    stores: {
      todoLists: [{ id: "l", title: "仕事", order: 0, createdAt: 0 }],
      todoTasks: [todo("a", "見積もりの返事", "客先確認中", 5), todo("b", "稟議の承認", "社内確認中", 1), todo("c", "自分で進める", "対応中", 9)],
      projects: [{ id: "p", title: "B社 提案", dueDate: jstDate(10), createdAt: jstAt("09:00", -10), tag: "客先確認中", tagChangedAt: jstAt("09:00", -1) }],
    },
  });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  const panel = page.getByTestId("waiting-hourglass");
  await expect(panel).toContainText("2件待ち・催促どき 1件");
  const rows = panel.getByTestId("waiting-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("見積もりの返事");
  await expect(rows.nth(0)).toContainText("客先確認中・6日目 ⏰");
  await expect(rows.nth(1)).toContainText("稟議の承認");
  await expect(rows.nth(1)).not.toContainText("⏰");
  await expect(panel).not.toContainText("自分で進める");
  // 案件はToDoタブには出さず、案件タブに出す
  await expect(panel).not.toContainText("B社 提案");
  await rows.nth(0).click();
  await expect(page.getByRole("heading", { name: "タスクの詳細" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "タイトル" })).toHaveValue("見積もりの返事");

  await page.getByRole("button", { name: "閉じる" }).click();
  await page.locator(".tab-chip", { hasText: "案件" }).first().click();
  const projectPanel = page.getByTestId("waiting-hourglass");
  await expect(projectPanel).toContainText("B社 提案");
  await expect(projectPanel).toContainText("客先確認中・2日目");
});
