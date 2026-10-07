import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "fs";
import { jstAt, jstDate, readOne, seed } from "./helpers";

// ToDo・案件の「相手待ちの見える化」「延期の記録」「終わった案件を型にする」を、
// 実際の画面操作で確かめる(記録の仕組み自体は lib/changeTracking.test.ts で固定)

const lists = [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }];
const openTab = (page: Page, name: string) => page.locator(".tab-chip", { hasText: name }).first().click();
const project = (p: Record<string, unknown>) => ({ category: "営業", workName: "見積", dueDate: jstDate(10), createdAt: jstAt("09:00", -10), ...p });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test.describe("相手待ちの見える化", () => {
  test("ToDo: 相手待ちの日数と催促の目安が出て、「返事待ち」で待っている日数の長い順に並ぶ", async ({ page }) => {
    await seed(page, {
      stores: {
        todoLists: lists,
        todoTasks: [
          { id: "t1", listId: "l1", title: "A社見積の回答待ち", tag: "客先確認中", tagChangedAt: jstAt("09:00", -3), important: false, completed: false, order: 0, createdAt: 0 },
          { id: "t2", listId: "l1", title: "部長承認待ち", tag: "社内確認中", tagChangedAt: jstAt("09:00", -1), important: false, completed: false, order: 1, createdAt: 0 },
          { id: "t3", listId: "l1", title: "資料作り", tag: "対応中", tagChangedAt: jstAt("09:00", -9), important: false, completed: false, order: 2, createdAt: 0 },
        ],
      },
      // 同じ件名が並ぶ「相手待ちの砂時計」は畳んで、一覧の行だけを見る
      settings: { "viz.waitingOpen.todo": "false" },
    });
    await openTab(page, "ToDo");
    await page.locator("button", { hasText: "⏳ 返事待ち（2）" }).click();
    const rows = page.getByText(/回答待ち|承認待ち|資料作り/);
    await expect(rows).toHaveText(["A社見積の回答待ち", "部長承認待ち"]);
    await expect(page.getByText("4日目")).toBeVisible();
    await expect(page.getByText("2日目")).toBeVisible();
    // 催促の目安(既定3日目)を過ぎているのはA社の方だけ
    await expect(page.getByText("⏰ 催促の目安")).toHaveCount(1);
  });

  test("案件: 画面で対応状況を変えるとその時点から数え始め、日報・週報にも返事待ちとして載る", async ({ page }) => {
    await seed(page, {
      stores: {
        projects: [project({ id: "p1", title: "B社単価改定" })],
        // 日報・週報の画面は、作業の実績が1件も無いと中身を出さないため1件入れておく
        records: [{ id: "r1", date: jstDate(), category: "営業", name: "見積", seconds: 600, startedAt: 0, endedAt: 1 }],
      },
    });
    await openTab(page, "案件");
    await page.locator("select[title='対応状況']").first().selectOption("客先確認中");
    await expect.poll(async () => (await readOne<{ tagChangedAt?: number }>(page, "projects", "p1"))?.tagChangedAt).toBeGreaterThanOrEqual(jstAt("10:00"));
    await expect(page.getByText("客先確認中 1日目")).toBeVisible();

    await openTab(page, "日報・週報・月報");
    await page.locator("button", { hasText: /^週報$/ }).click();
    await expect(page.getByText("⏳ 返事待ち（1）")).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("button", { hasText: "ダウンロード (.txt)" }).click()]);
    const text = readFileSync((await download.path())!, "utf-8");
    expect(text).toContain("【返事待ち】\n- 客先確認中 1日目 ［案件］B社単価改定");
  });
});

test.describe("延期の記録", () => {
  test("案件の期日を画面で後ろへずらすと延期として数え、要注意リストにも出る", async ({ page }) => {
    await seed(page, { stores: { projects: [project({ id: "p1", title: "C社見積", dueDate: jstDate(2), dueHistory: [{ from: jstDate(-3), to: jstDate(0), at: 1 }] })] } });
    await openTab(page, "案件");
    await page.locator("button", { hasText: /^編集$/ }).first().click();
    await page.locator(".modal-scrim input[type=date]").first().fill(jstDate(7));
    await page.locator(".modal-scrim button", { hasText: /^保存$/ }).click();
    // 前からの延期1回(3日) + 今回(5日)
    await expect(page.getByText("↪ 延期2回・計8日")).toBeVisible();

    await openTab(page, "要注意リスト");
    await expect(page.getByText("延期2回・計8日")).toBeVisible();
    await expect(page.getByText("C社見積")).toBeVisible();
  });

  test("期日はまだ先でも3回以上延期しているToDoは、週次レビューで延期の回数とともに確認できる", async ({ page }) => {
    const h = (from: number, to: number) => ({ from: jstDate(from), to: jstDate(to), at: 1 });
    await seed(page, {
      stores: {
        todoLists: lists,
        todoTasks: [
          { id: "t1", listId: "l1", title: "マニュアル改訂", dueDate: jstDate(3), dueHistory: [h(-6, -4), h(-4, 0), h(0, 3)], important: false, completed: false, order: 0, createdAt: jstAt("09:00", -20) },
        ],
      },
    });
    await openTab(page, "ToDo");
    await page.locator("button", { hasText: /^タスク$/ }).first().click();
    await expect(page.getByText("↪ 延期3回・計9日")).toBeVisible();
    await page.locator("button", { hasText: "📋 週次レビュー" }).first().click();
    await expect(page.getByText("マニュアル改訂")).toHaveCount(2);
    await expect(page.getByText("（延期を重ねています）", { exact: false })).toBeVisible();
    await expect(page.getByText("これまでに延期3回・計9日", { exact: false })).toBeVisible();
  });
});

test("終わった案件を型にして、段階と過去の実績からの目安時間・振り返りを引き継いだ新しい案件を作る", async ({ page }) => {
  const done = project({
    id: "a",
    title: "A社見積",
    completedAt: jstAt("09:00", -1),
    retrospective: "先方の担当が2人いるので両方にCCする",
    stages: [
      { id: "a1", title: "ヒアリング", completed: true },
      { id: "a2", title: "見積作成", completed: true },
    ],
  });
  await seed(page, {
    stores: {
      projects: [done],
      records: [
        { id: "r1", date: jstDate(-2), category: "営業", name: "見積", projectId: "a", stageId: "a1", seconds: 3600, startedAt: 0, endedAt: 1 },
        { id: "r2", date: jstDate(-2), category: "営業", name: "見積", projectId: "a", stageId: "a2", seconds: 7200, startedAt: 0, endedAt: 1 },
      ],
    },
  });
  await openTab(page, "案件");
  await page.locator("button", { hasText: "完了済み（1）" }).click();
  await page.locator("button", { hasText: "📐 型にして作る" }).first().click();
  const dialog = page.locator(".modal-scrim").last();
  await expect(dialog.getByText("目安 01:00:00（1件の平均）")).toBeVisible();
  await expect(dialog.getByText("先方の担当が2人いるので両方にCCする")).toBeVisible();
  await dialog.getByLabel("新しい案件の件名").fill("D社見積");
  await dialog.locator("button", { hasText: "この内容で作る" }).click();

  const created = await page.evaluate(async () => {
    const req = indexedDB.open("koutei-hyo");
    const db: IDBDatabase = await new Promise((res) => (req.onsuccess = () => res(req.result)));
    const rows = await new Promise<unknown[]>((res) => {
      const q = db.transaction("projects").objectStore("projects").getAll();
      q.onsuccess = () => res(q.result);
    });
    db.close();
    return rows.find((p) => (p as { title: string }).title === "D社見積");
  });
  expect(created).toMatchObject({
    category: "営業",
    workName: "見積",
    templateFromId: "a",
    estimatedTotalSeconds: 10800,
    stages: [
      { title: "ヒアリング", completed: false, referenceSeconds: 3600 },
      { title: "見積作成", completed: false, referenceSeconds: 7200 },
    ],
  });
  expect((created as { completedAt?: number }).completedAt).toBeUndefined();
  await expect(page.getByText("目安 02:00:00").first()).toBeVisible();
});

test("案件を完了にしたときの完了レポートで振り返りを残せる", async ({ page }) => {
  await seed(page, { stores: { projects: [project({ id: "p1", title: "E社見積" })] } });
  await openTab(page, "案件");
  await page.locator("button", { hasText: /^完了$/ }).first().click();
  await expect(page.getByText("🎉 案件完了レポート")).toBeVisible();
  await page.getByLabel("案件の振り返り").fill("見積の前に過去の単価表を確認する");
  await expect.poll(async () => (await readOne<{ retrospective?: string }>(page, "projects", "p1"))?.retrospective).toBe("見積の前に過去の単価表を確認する");
});


test("週次レビューでは、件名に加えてリスト名・案件名が出て、何のToDoか分かる", async ({ page }) => {
  await seed(page, {
    stores: {
      todoLists: [{ id: "l1", title: "ゲーム", order: 0, createdAt: 0 }],
      projects: [project({ id: "p1", title: "ゲーム攻略", dueDate: jstDate(30), stages: [{ id: "s1", title: "41~50", completed: false }] })],
      todoTasks: [{ id: "t1", listId: "l1", title: "42~50", projectId: "p1", important: false, completed: false, order: 0, createdAt: jstAt("09:00", -30) }],
    },
  });
  await openTab(page, "ToDo");
  await page.locator("button", { hasText: "📋 週次レビュー" }).first().click();
  const dialog = page.locator(".modal-scrim").last();
  await expect(dialog.getByText("42~50")).toBeVisible();
  await expect(dialog.getByText("📋 ゲーム")).toBeVisible();
  await expect(dialog.getByText("ゲーム攻略")).toBeVisible();
});
