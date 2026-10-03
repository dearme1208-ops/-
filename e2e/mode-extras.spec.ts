import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 各演出モードに足した機能(lib/modeExtras.ts・forestLife.ts・persona.ts・terminalCommands.ts)

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("14:00") });
});

const mode = (m: string, extra: Record<string, string> = {}) => ({ "theme.visualMode": m, "powerpro.mainMenu": "false", ...extra });
const todo = (id: string, title: string, dueDate?: string) => ({ id, listId: "l", title, completed: false, important: false, order: 0, createdAt: 0, dueDate });

test("森: 記録した日に木が立つ(暮らしの手入れの欄は出さない)", async ({ page }) => {
  const records = ["-12", "-8", "-4"].map((d, i) => ({
    id: "r" + i, date: jstDate(Number(d)), category: "家事", name: "風呂掃除", masterTaskId: "m3", seconds: 1200,
    startedAt: jstAt("20:00", Number(d)), endedAt: jstAt("20:20", Number(d)), excludedFromStats: false,
  }));
  await seed(page, {
    settings: mode("home"),
    stores: { masterTasks: [{ ...MASTER, id: "m3", category: "家事", name: "風呂掃除" }], records },
  });
  await expect(page.getByTestId("forest-grove")).toContainText("木が3本");
  await expect(page.getByTestId("forest-care")).toHaveCount(0);
});

test("ペルソナ風: 期日の迫る仕事が予告状になる", async ({ page }) => {
  await seed(page, { settings: mode("persona5"), stores: { todoTasks: [todo("t", "請求書の確認", jstDate(2))] } });
  const card = page.getByTestId("persona-calling-card");
  await expect(card).toContainText("予告状");
  await expect(card).toContainText("請求書の確認");
  await expect(card).toContainText("期日まで あと2日");
});

test("ターミナル: コマンドでToDoの追加・開始・完了ができる", async ({ page }) => {
  await seed(page, { settings: mode("terminal"), stores: { masterTasks: [MASTER] } });
  const input = page.getByLabel("コマンド");
  const run = async (c: string) => {
    await input.fill(c);
    await input.press("Enter");
  };
  await run("todo 明日までに見積書を送る @営業");
  await expect(page.getByTestId("terminal-command")).toContainText("+ ToDo: 見積書を送る");
  await run("start 資料作成");
  await expect(page.getByTestId("terminal-command")).toContainText("▶ 開始: 業務/資料作成");
  await page.clock.fastForward("10:00");
  await run("done");
  await expect(page.getByTestId("terminal-command")).toContainText("✓ 完了: 業務/資料作成");
  const todos = await readAll<{ title: string; dueDate: string; category: string }>(page, "todoTasks");
  expect(todos[0]).toMatchObject({ title: "見積書を送る", dueDate: jstDate(1), category: "営業" });
  expect((await readAll<{ status: string }>(page, "dailyTasks"))[0].status).toBe("done");
});

test("登山: 日没までに下りられなければ、未着手の区間を明日に回せる", async ({ page }) => {
  await seed(page, {
    settings: mode("mountain", { "today.standardWorkEnd": "15:00" }),
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "a", date: jstDate(), estimatedSeconds: 7200 })] },
  });
  const plan = page.getByTestId("mountain-plan");
  await expect(plan).toContainText("このままでは日没までに下りられません");
  await plan.getByRole("button", { name: "明日に回す" }).click();
  await expect.poll(async () => (await readOne<{ date: string }>(page, "dailyTasks", "a"))?.date).toBe(jstDate(1));
});

test("ロボトミー: 期限切れのToDoは収容違反。鎮圧すると今日の作業に入る", async ({ page }) => {
  await seed(page, { settings: mode("lobotomy"), stores: { todoTasks: [todo("t", "請求書の確認", jstDate(-3))] } });
  const breach = page.getByTestId("lobotomy-breach");
  await expect(breach).toContainText("収容違反 1件");
  await breach.getByRole("button", { name: "鎮圧する" }).click();
  await expect.poll(async () => (await readAll<{ name: string; todoTaskId: string }>(page, "dailyTasks")).map((d) => [d.name, d.todoTaskId])).toEqual([["請求書の確認", "t"]]);
});

test("冒険者: クエストを受注すると今日の冒険に加わる", async ({ page }) => {
  await seed(page, { settings: mode("adventurer"), stores: { todoTasks: [todo("t", "自由研究", jstDate(5))] } });
  await page.getByTestId("adventurer-board").getByRole("button", { name: "受注する" }).click();
  await expect.poll(async () => (await readAll(page, "dailyTasks")).length).toBe(1);
});

test("なつやすみ: 今月が期限のToDoが宿題になり、チェックで終わる", async ({ page }) => {
  const [, m] = jstDate().split("-").map(Number);
  await seed(page, { settings: mode("natsuyasumi"), stores: { todoTasks: [todo("t", "読書感想文", jstDate())] } });
  const hw = page.getByTestId("natsu-homework");
  await expect(hw).toContainText(`${m}月のしゅくだい`);
  await hw.getByLabel("「読書感想文」をおわりにする").check();
  await expect.poll(async () => (await readOne<{ completed: boolean }>(page, "todoTasks", "t"))?.completed).toBe(true);
});

test("流行り神: 想定を超えた作業に原因を結ぶと相関図に出る", async ({ page }) => {
  await seed(page, {
    settings: mode("hayarigami"),
    stores: {
      masterTasks: [MASTER],
      records: [{ id: "r", date: jstDate(), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 3600, startedAt: jstAt("09:00"), endedAt: jstAt("10:00"), excludedFromStats: false }],
    },
  });
  const panel = page.getByTestId("hayarigami-deduction");
  await expect(panel).toContainText("想定より30分超過");
  await panel.getByRole("button", { name: "割り込み" }).click();
  await expect(panel).toContainText("相関図");
  await expect(panel).toContainText("業務 / 資料作成(1)");
});

test("パワプロ: 働きすぎが続くとケガ率が上がる", async ({ page }) => {
  const records = [-1, -2, -3].map((d) => ({ id: "r" + d, date: jstDate(d), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 10 * 3600, startedAt: jstAt("08:00", d), endedAt: jstAt("18:00", d), excludedFromStats: false }));
  await seed(page, { settings: mode("powerpro"), stores: { records } });
  await expect(page.getByTestId("powerpro-injury")).toContainText("「休む」コマンドを選ぶ時です");
});

test("禅・図書館・ハブの追加表示", async ({ page }) => {
  await seed(page, { settings: mode("zen") });
  await page.getByRole("button", { name: "始める前に、一分だけ息を整える" }).click();
  await expect(page.getByText("あと 60 秒")).toBeVisible();
  await page.getByLabel("今日の一行").fill("静かな一日");

  await seed(page, { settings: mode("library"), stores: { todoTasks: [todo("t", "読書感想文", jstDate(-1))] } });
  await expect(page.getByTestId("library-counter")).toContainText("延滞");

  await seed(page, { settings: mode("hub") });
  await expect(page.getByTestId("hub-timeline")).toBeVisible();
});

test("原点: Excelに書き出せる", async ({ page }) => {
  await seed(page, { settings: mode("origin"), stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "a", date: jstDate(), estimatedSeconds: 1800 })] } });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excelに書き出す" }).click()]);
  expect(download.suggestedFilename()).toBe(`koutei-hyo_${jstDate()}.xlsx`);
});
