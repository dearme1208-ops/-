import { expect, test, type Page } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 全モードで、作業の実測が同時に1つだけになることを確かめる。
//  1. どのモード・どの画面(メニュー画面・ほかのタブ)を開いていても、計測中が2つになれば1つに直る
//  2. 各モード独自の画面から別の作業を始めると、計測中だった作業は止まる

type Daily = { id: string; status: string; name: string; segments: { start: number; end?: number }[] };

const MODES = ["off", "lobotomy", "va11halla", "persona5", "natsuyasumi", "claude", "zen", "terminal", "adventurer", "hub", "library", "powerpro", "hayarigami", "mountain", "origin", "home"];
const runningNames = async (page: Page) => (await readAll<Daily>(page, "dailyTasks")).filter((t) => t.status === "running").map((t) => t.name);
const runningA = () => dailyTask({ id: "a", date: jstDate(), order: 0, name: "資料作成", status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") });
const pendingB = () => dailyTask({ id: "b", date: jstDate(), order: 1, name: "電話対応", masterTaskId: "m2", estimatedSeconds: 1800, hasPlan: true });
const M2 = { ...MASTER, id: "m2", name: "電話対応" };

test.describe("どのモードでも、計測中が2つになれば後から始めた方だけが残る", () => {
  for (const m of MODES) {
    for (const menu of [false, true]) {
      test(`${m}${menu ? "(メニュー画面)" : ""}`, async ({ page }) => {
        await page.clock.install({ time: jstAt("10:00") });
        await seed(page, {
          settings: { "theme.visualMode": m, "powerpro.mainMenu": String(menu) },
          stores: {
            masterTasks: [MASTER, M2],
            dailyTasks: [runningA(), { ...pendingB(), status: "running", segments: [{ start: jstAt("09:50") }], startedAt: jstAt("09:50") }],
          },
        });
        await expect.poll(() => runningNames(page)).toEqual(["電話対応"]);
        const a = (await readOne<Daily>(page, "dailyTasks", "a"))!;
        expect(a.status).toBe("paused");
        expect(a.segments[0].end).toBe(jstAt("09:50"));
      });
    }
  }
});

test.describe("各モードの画面から別の作業を始めると、計測中だった作業は止まる", () => {
  const setup = async (page: Page, m: string, extra: Record<string, unknown> = {}) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      settings: { "theme.visualMode": m, "powerpro.mainMenu": "false" },
      stores: {
        masterTasks: [MASTER, { ...M2, isFavorite: true }],
        dailyTasks: [runningA(), pendingB()],
        todoLists: [{ id: "l", title: "今", order: 0, createdAt: 0 }],
        todoTasks: [{ id: "t", listId: "l", title: "見積書を送る", completed: false, important: false, order: 0, createdAt: 0, myDayDate: jstDate() }],
        ...extra,
      },
    });
  };
  const expectSwitched = async (page: Page, name: string) => {
    await expect.poll(() => runningNames(page)).toEqual([name]);
    expect((await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("paused");
  };

  test("Claude: ToDoの「今から取り組む」", async ({ page }) => {
    await setup(page, "claude");
    await page.getByRole("button", { name: /今から取り組む/ }).first().click();
    await expectSwitched(page, "見積書を送る");
  });

  test("流行り神: 「電話対応」を開始", async ({ page }) => {
    await setup(page, "hayarigami");
    await page.getByRole("button", { name: "▶ 作業を選んで開始する" }).click();
    await page.getByRole("button", { name: "▶ よく使う作業（★）から選ぶ" }).click();
    await page.getByRole("button", { name: /★ 電話対応/ }).click();
    await page.getByRole("button", { name: /今すぐ(開始する|始める)/ }).click();
    await expectSwitched(page, "電話対応");
  });

  test("なつやすみ: 「電話対応」をつかまえる", async ({ page }) => {
    await setup(page, "natsuyasumi");
    await page.locator("li, div", { hasText: "電話対応" }).getByRole("button", { name: /つかまえる|開始する/ }).last().click();
    await expectSwitched(page, "電話対応");
  });

  test("図書館: 「電話対応」を借りる", async ({ page }) => {
    await setup(page, "library");
    await page.getByRole("button", { name: /^マスタ/ }).click();
    await page.locator("main").getByText("電話対応").locator("visible=true").first().click();
    await page.getByRole("button", { name: /この本を借りる|この作業を開始する/ }).first().click();
    await expectSwitched(page, "電話対応");
  });

  test("登山: 次の区間「電話対応」を開始", async ({ page }) => {
    await setup(page, "mountain");
    await page.locator("div", { hasText: /^.*電話対応/ }).getByRole("button", { name: /出発|開始|登る|▶/ }).last().click();
    await expectSwitched(page, "電話対応");
  });

  test("パワプロ: 練習「電話対応」を選ぶ", async ({ page }) => {
    await setup(page, "powerpro");
    await page.getByRole("button", { name: /電話対応/ }).first().click();
    await expectSwitched(page, "電話対応");
  });

  test("冒険者: クエスト「電話対応」を受ける", async ({ page }) => {
    await setup(page, "adventurer");
    await page.getByRole("button", { name: "← 地図にもどる" }).click();
    await page.getByRole("button", { name: /電話対応/ }).first().click();
    await expectSwitched(page, "電話対応");
  });

  test("ターミナル: お気に入り「電話対応」を開始", async ({ page }) => {
    await setup(page, "terminal");
    await page.getByRole("button", { name: /電話対応/ }).first().click();
    await expectSwitched(page, "電話対応");
  });

  test("原点(シート): 「電話対応」の行を開始", async ({ page }) => {
    await setup(page, "origin");
    await page.getByRole("button", { name: /電話対応 09:00/ }).click();
    await page.getByRole("button", { name: "この行を開始" }).click();
    await expect.poll(() => runningNames(page)).toEqual(["電話対応"]);
  });

  test("統合ボード: 「電話対応」のカードで開始", async ({ page }) => {
    await setup(page, "off");
    await page.locator(".tab-chip", { hasText: "統合ボード" }).first().click();
    const card = page.locator("div", { hasText: "電話対応" }).filter({ has: page.getByRole("button", { name: "開始", exact: true }) }).last();
    await card.getByRole("button", { name: "開始", exact: true }).click();
    await expectSwitched(page, "電話対応");
  });
});
