import { expect, test, type Page } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, seed } from "./helpers";

// 森モードの「タブを分類ごとにまとめる」(上段=分類、下段=その分類の中のタブ)。
// 並べ方だけを変える機能なので、どのタブにも行けること・ほかの画面からの移動・
// 茂みへ隠す・件数バッジ・スマホ幅・OFFで元に戻ること、を確かめる

const FOREST = { "theme.visualMode": "home", "ui.groupTabs": "true" };
const groupRow = (page: Page) => page.locator(".tab-nav-groups .tab-chip");
const subRow = (page: Page) => page.locator(".tab-nav-sub .tab-chip");
const labels = (loc: ReturnType<Page["locator"]>) => loc.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
const activeGroup = (page: Page) => page.locator(".tab-nav-groups .tab-chip[data-active='true']");
const activeSub = (page: Page) => page.locator(".tab-nav-sub .tab-chip[data-active='true']");

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("上段には分類だけが並び、「今日」では下段を出さない", async ({ page }) => {
  await seed(page, { settings: FOREST });
  expect(await labels(groupRow(page))).toEqual(["🌱 今日", "📋 計画", "📊 振り返り", "🗂 記録・マスタ", "⚙ 設定"]);
  await expect(activeGroup(page)).toHaveText("🌱 今日");
  await expect(subRow(page)).toHaveCount(0);
  // 本日の作業の画面が出ている
  await expect(page.getByText(`${jstDate()} の作業リスト`)).toBeVisible();
});

test("分類を選ぶとその中のタブが下段に並び、戻ってくると前に見ていたタブが開く", async ({ page }) => {
  await seed(page, { settings: FOREST });
  await groupRow(page).filter({ hasText: "振り返り" }).click();
  expect(await labels(subRow(page))).toEqual([
    "日報・週報・月報",
    "集計・ランキング",
    "要注意リスト",
    "残業分析",
    "ガントチャート",
    "グラフ",
    "ヒートマップ",
    "年表",
    "観測所",
  ]);
  await expect(activeSub(page)).toHaveText("日報・週報・月報");
  await subRow(page).filter({ hasText: "残業分析" }).click();
  await expect(page.getByRole("heading", { name: "残業分析" })).toBeVisible();

  await groupRow(page).filter({ hasText: "計画" }).click();
  expect(await labels(subRow(page))).toEqual(["ToDo", "案件", "マンダラチャート", "メモ", "統合ボード", "曜日別テンプレート"]);
  await groupRow(page).filter({ hasText: "振り返り" }).click();
  await expect(activeSub(page)).toHaveText("残業分析");
});

test("ほかの画面からタブを移ると、移った先の分類が選ばれる(作業カードの元Todo → ToDoタブ)", async ({ page }) => {
  await seed(page, {
    settings: { ...FOREST, "today.taskViewTab": "pending" },
    stores: {
      masterTasks: [MASTER],
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t1", listId: "l1", title: "請求書送付", important: false, completed: false, order: 0, createdAt: 0 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), todoTaskId: "t1" })],
    },
  });
  await page.getByRole("button", { name: "請求書送付" }).first().click();
  await expect(activeGroup(page)).toHaveText("📋 計画");
  await expect(activeSub(page)).toHaveText("ToDo");
});

test("茂みへ隠したタブは下段に出ず、中が全部隠れた分類は上段からも消える", async ({ page }) => {
  const plan = ["todo", "projects", "mandala", "memo", "board", "template"];
  await seed(page, { settings: { ...FOREST, "home.hiddenTabKeys": JSON.stringify([...plan, "charts"]) } });
  expect(await labels(groupRow(page))).toEqual(["🌱 今日", "📊 振り返り", "🗂 記録・マスタ", "⚙ 設定"]);
  await groupRow(page).filter({ hasText: "振り返り" }).click();
  expect(await labels(subRow(page))).not.toContain("グラフ");
});

test("統合ボードの期限の件数バッジは、分類「計画」にも出る", async ({ page }) => {
  await seed(page, {
    settings: FOREST,
    stores: {
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t1", listId: "l1", title: "見積", important: false, completed: false, order: 0, createdAt: 0, dueDate: jstDate(), boardX: 10, boardY: 10 }],
    },
  });
  await expect(groupRow(page).filter({ hasText: "計画" }).locator(".tab-chip-badge")).toHaveText("1");
});

test("「茂みへ隠す」のスイッチをOFFにすると、従来の1列のタブに戻る", async ({ page }) => {
  await seed(page, { settings: FOREST });
  await groupRow(page).filter({ hasText: "記録・マスタ" }).click();
  // 演出の文言をOFFにしているテストでは「茂みへ隠す」タブは元の名前で出る
  await subRow(page).filter({ hasText: "家庭モード管理" }).click();
  await page.getByLabel("タブを分類ごとにまとめる").click();
  await expect(page.locator("[data-grouped-tabs]")).toHaveCount(0);
  await expect(page.locator(".tab-chip")).toHaveCount(21);
  // 開いていた画面はそのまま
  await expect(page.locator(".tab-chip[data-active='true']")).toHaveText("家庭モード管理");
});

test("ほかのモードでもタブが多ければ2段にまとまり、タブの少ないモード(禅)は1列のまま", async ({ page }) => {
  await seed(page, { settings: { "theme.visualMode": "off", "ui.groupTabs": "true" } });
  expect(await labels(groupRow(page))).toEqual(["🌱 今日", "📋 計画", "📊 振り返り", "🗂 記録・マスタ", "⚙ 設定"]);
  await groupRow(page).filter({ hasText: "振り返り" }).click();
  await subRow(page).filter({ hasText: "日報・週報・月報" }).click();
  await expect(page.locator("button", { hasText: /^週報$/ })).toBeVisible();

  await seed(page, { settings: { "theme.visualMode": "zen", "ui.groupTabs": "true" } });
  await expect(page.locator("[data-grouped-tabs]")).toHaveCount(0);
  await expect(page.locator(".tab-chip")).toHaveCount(3);

  // 設定でOFFにすると1列に戻る
  await seed(page, { settings: { "theme.visualMode": "off", "ui.groupTabs": "false" } });
  await expect(page.locator("[data-grouped-tabs]")).toHaveCount(0);
  await expect(page.locator(".tab-chip")).toHaveCount(20);
});

test("スマホ幅でも、画面全体が横にはみ出さない", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await seed(page, { settings: FOREST });
  for (const g of ["振り返り", "計画", "今日"]) {
    await groupRow(page).filter({ hasText: g }).click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, g).toBeLessThanOrEqual(0);
  }
});
