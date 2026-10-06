import { expect, test } from "@playwright/test";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 第3弾の使いやすさ(ひとこと入力・共有・さがす・操作の履歴・ToDo先送り・今週のまとめ・
// 新しくできること・引き継ぎ・文字の大きさ・重複表示の整理)を固定する

type Todo = { id: string; title: string; dueDate?: string; important: boolean; estimateMinutes?: number };
type Daily = { id: string; name: string; status: string };
const list = { id: "l", title: "仕事", order: 0, createdAt: 0 };

test("ひとこと入力: 書いた内容を読み取り、候補の行き先(期限ありはToDo)に Enter で入る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { stores: { todoLists: [list] } });
  await page.getByRole("button", { name: "✏️ ひとこと" }).click();
  const box = page.getByTestId("quick-capture");
  await box.getByLabel("ひとこと").fill("明日までに見積書を送る 30分 @営業");
  await expect(box).toContainText("見積書を送る");
  await expect(box.getByRole("button", { name: /ToDo/ })).toHaveAttribute("aria-pressed", "true");
  await box.getByLabel("ひとこと").press("Enter");
  await expect.poll(async () => (await readAll<Todo>(page, "todoTasks")).find((t) => t.title === "見積書を送る")?.dueDate).toBe(jstDate(1));
});

test("ひとこと入力: 「今やる」を選ぶと、本日の作業として計測が始まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {});
  await page.keyboard.press("/");
  const box = page.getByTestId("quick-capture");
  await box.getByLabel("ひとこと").fill("郵便を出す");
  await box.getByRole("button", { name: /今やる/ }).click();
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.name === "郵便を出す")?.status).toBe("running");
});

test("他のアプリの「共有」から開くと、ひとこと入力に文が入っている", async ({ page }) => {
  await seed(page, {});
  await page.goto("/share?title=A%E7%A4%BE%E3%81%AE%E4%BB%B6&url=https%3A%2F%2Fexample.com");
  await expect(page.getByTestId("quick-capture")).toBeVisible();
  await expect(page.getByLabel("ひとこと")).toHaveValue(/A社の件[\s\S]*https:\/\/example.com/);
  // URLを含むので、行き先の候補はメモ
  await expect(page.getByTestId("quick-capture").getByRole("button", { name: /メモ/ })).toHaveAttribute("aria-pressed", "true");
});

test("さがす: ToDo・案件・実績をまとめて探し、ToDoを押すと詳細へ移る", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      todoLists: [list],
      todoTasks: [{ id: "t1", listId: "l", title: "A社へ見積を送る", completed: false, important: false, order: 0, createdAt: 0 }],
      projects: [{ id: "p1", title: "A社 新規提案", dueDate: jstDate(5), createdAt: 0 }],
      records: [{ id: "r1", date: jstDate(-1), category: "営業", name: "A社打ち合わせ", masterTaskId: "m1", seconds: 3600, startedAt: 0, endedAt: 0, excludedFromStats: false }],
    },
  });
  await page.getByRole("button", { name: "🔍 さがす" }).click();
  const s = page.getByTestId("global-search");
  await s.getByLabel("さがす言葉").fill("A社");
  await expect(s).toContainText("A社へ見積を送る");
  await expect(s).toContainText("A社 新規提案");
  await expect(s).toContainText("営業 / A社打ち合わせ");
  await s.getByRole("button", { name: /A社へ見積を送る/ }).click();
  await expect(page.getByTestId("global-search")).toHaveCount(0);
});

test("操作の履歴: 消えた「元に戻す」の後からでも、一覧から戻せる", async ({ page }) => {
  await seed(page, { settings: { "today.taskViewTab": "pending" }, stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await page.locator("button[aria-label='削除']").first().click();
  await expect.poll(async () => (await readAll(page, "dailyTasks")).length).toBe(0);
  await page.getByRole("button", { name: "🕘 操作の履歴" }).click();
  const h = page.getByTestId("history");
  await expect(h).toContainText("を削除しました");
  await h.getByRole("button", { name: "↩ 戻す" }).click();
  await expect.poll(async () => (await readAll(page, "dailyTasks")).length).toBe(1);
  await expect(h).toContainText("戻しました");
});

test("ToDoの ⏩ から、期日を明日へワンタップで動かせる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { stores: { todoLists: [list], todoTasks: [{ id: "t1", listId: "l", title: "請求書", completed: false, important: false, order: 0, createdAt: 0, dueDate: jstDate() }] } });
  await page.locator(".tab-chip", { hasText: "ToDo" }).first().click();
  await page.getByRole("button", { name: "期日を動かす" }).first().click();
  await page.getByTestId("quick-due").getByRole("button", { name: /^明日/ }).click();
  await expect.poll(async () => (await readOne<Todo>(page, "todoTasks", "t1"))?.dueDate).toBe(jstDate(1));
});

test("新しくできること: 1回だけ出て、「わかった」で閉じると次から出ない", async ({ page }) => {
  await seed(page, { settings: { "ui.whatsNewSeen": "" } });
  await expect(page.getByTestId("whats-new")).toBeVisible();
  await clickButton(page, "わかった");
  await expect(page.getByTestId("whats-new")).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("whats-new")).toHaveCount(0);
});

test("設定の一番上に最後の控えが出て、機種変更の手順を開ける", async ({ page }) => {
  await seed(page, {});
  await page.getByRole("button", { name: "設定" }).first().click();
  await expect(page.getByTestId("backup-status")).toContainText("最後の控え: まだありません");
  await page.getByRole("button", { name: "📦 機種変更・引き継ぎ" }).click();
  await expect(page.getByTestId("migration-guide")).toContainText("新しい端末で、そのファイルを読み込む");
});

test("文字の大きさ: 「大きめ」を選ぶと画面全体の文字が大きくなる", async ({ page }) => {
  await seed(page, {});
  const base = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.getByRole("button", { name: "設定" }).first().click();
  await page.getByTestId("text-scale").getByRole("button", { name: "大きめ" }).click();
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThan(base);
});

test("今週のまとめ: 金曜には今週の記録の多い作業と終えたことが出る", async ({ page }) => {
  // 2026-10-09 は金曜
  await page.clock.install({ time: new Date("2026-10-09T10:00:00+09:00").getTime() });
  await seed(page, {
    settings: { "today.showWeeklySummary": "true" },
    stores: {
      masterTasks: [MASTER],
      records: [{ id: "r1", date: "2026-10-06", category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 5400, startedAt: 0, endedAt: 0, excludedFromStats: false }],
      todoLists: [list],
      todoTasks: [{ id: "t1", listId: "l", title: "請求書の確認", completed: true, completedAt: new Date("2026-10-07T12:00:00+09:00").getTime(), important: false, order: 0, createdAt: 0 }],
    },
  });
  const card = page.getByTestId("weekly-summary");
  await expect(card).toContainText("今週のまとめ");
  await expect(card).toContainText("業務 / 資料作成");
  await expect(card).toContainText("請求書の確認");
});
