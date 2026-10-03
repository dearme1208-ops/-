import { expect, test, type Page } from "@playwright/test";
import { dailyTask, jstAt, jstDate, readAll, seed } from "./helpers";

// 実際に画面を触って見つけた使いにくさ・崩れの修正を固定する

const PHONE = { width: 390, height: 844 };
const openTab = (page: Page, name: string) => page.locator(".tab-chip", { hasText: name }).first().click();

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test.describe("スマホ幅の表示崩れ", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
  });

  test("案件カードの操作ボタンが縦1列に潰れず、横書きのまま折り返して並ぶ", async ({ page }) => {
    await seed(page, { stores: { projects: [{ id: "p1", title: "G社見積", category: "営業", workName: "見積", dueDate: jstDate(5), createdAt: 0 }] } });
    await openTab(page, "案件");
    for (const label of ["本日の作業に追加", "📐 型にして作る", "ボードに置く", "🗄 アーカイブ"]) {
      const box = await page.locator("button", { hasText: label }).first().boundingBox();
      // 1行分の高さに収まっている(縦に潰れると文字数分の高さになる)
      expect(box!.height, label).toBeLessThan(45);
      expect(box!.width, label).toBeGreaterThan(box!.height);
    }
  });

  test("統合ボード: 整列は横スクロールしなくても見えて押せ、整列と追加のメニューも切り取られずに出る", async ({ page }) => {
    await seed(page);
    await openTab(page, "統合ボード");
    const align = page.getByRole("button", { name: /整列/ });
    await expect(align).toBeInViewport({ ratio: 1 });
    await align.click();
    await expect(page.getByRole("button", { name: "期日順" })).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "期日順" }).click();

    await page.getByRole("button", { name: /＋ 追加/ }).click();
    await expect(page.getByRole("button", { name: "＋ 付箋" })).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "＋ 付箋" }).click();
    await expect.poll(async () => (await readAll(page, "memoNotes")).length).toBe(1);
  });

  test("本日の作業の下部の切り替え(実行中・予定・完了)の文字が途中で改行されない", async ({ page }) => {
    await seed(page);
    for (const label of ["実行中", "予定", "完了"]) {
      const box = await page.locator("button", { hasText: `${label}(` }).last().boundingBox();
      expect(box!.height, label).toBeLessThan(45);
    }
  });

  test("設定タブが画面の横幅からはみ出さない", async ({ page }) => {
    await seed(page);
    await openTab(page, "設定");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test("使い始め(作業マスタが0件)の「突発作業を追加」は、選ぶものが無いマスタ選択ではなく自由入力で開く", async ({ page }) => {
  await seed(page);
  await page.locator("button", { hasText: "+ 突発作業を追加" }).first().click();
  const dialog = page.locator(".modal-scrim").last();
  await expect(dialog.getByPlaceholder("例: 見積書の作成")).toBeVisible();
  // ページを開いた時刻と同じ「◯◯から開始」は出さない(すぐ開始と区別がつかない)
  await expect(dialog.locator("button", { hasText: /\d\d:\d\dから開始/ })).toHaveCount(0);
});

test("前の作業を止めてから時間が経っていれば、「◯◯から開始」を選べる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "pending" },
    stores: {
      dailyTasks: [
        dailyTask({ id: "d0", date: jstDate(), status: "done", segments: [{ start: jstAt("09:00"), end: jstAt("09:30") }], accumulatedMs: 1800000, endedAt: jstAt("09:30"), stoppedAt: jstAt("09:30") }),
        dailyTask({ id: "d1", date: jstDate(), order: 1, name: "会議" }),
      ],
    },
  });
  await expect(page.locator("button", { hasText: "09:30から開始" })).toBeVisible();
});

test("ToDoを追加するとき、サブタスクと一緒に選んだ対応状況が消えずに残る", async ({ page }) => {
  await seed(page, { stores: { todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }] } });
  await openTab(page, "ToDo");
  await page.locator("button", { hasText: "+ タスクを追加" }).first().click();
  const m = page.locator(".modal-scrim").last();
  await m.getByPlaceholder("やることを一言で").fill("H社見積");
  await m.locator("select").first().selectOption("客先確認中");
  const sub = m.getByPlaceholder("手順を1行ずつ（Enterで次の行）");
  await sub.fill("ヒアリング");
  await sub.press("Enter");
  await m.getByPlaceholder("手順を1行ずつ（Enterで次の行）").last().fill("見積作成");
  await m.locator("button", { hasText: /^追加$/ }).click();
  await expect.poll(async () => (await readAll<{ title: string; tag?: string }>(page, "todoTasks")).filter((t) => t.tag === "客先確認中").map((t) => t.title).sort()).toEqual(["H社見積", "ヒアリング", "見積作成"]);
  // 一覧でも親の対応状況として出る(サブタスクの状況から決まる)
  await expect(page.locator("span", { hasText: /^客先確認中/ }).first()).toBeVisible();
});

test("まだ何も記録していない使い始めには、バックアップの催促を出さない", async ({ page }) => {
  await seed(page);
  await expect(page.getByText("バックアップを取っておきませんか")).toHaveCount(0);
  await seed(page, { stores: { records: [{ id: "r1", date: jstDate(), category: "業務", name: "資料作成", seconds: 60, startedAt: 0, endedAt: 1 }] } });
  await expect(page.getByText("バックアップを取っておきませんか")).toBeVisible();
});

test("完了した作業はカードごと薄くならず、完了の印が付き、開始〜終了の時刻を押すと編集が開く", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: {
      dailyTasks: [
        dailyTask({
          id: "d1",
          date: jstDate(),
          name: "資料作成",
          status: "done",
          segments: [{ start: jstAt("09:00"), end: jstAt("09:30") }],
          accumulatedMs: 30 * 60000,
          startedAt: jstAt("09:00"),
          endedAt: jstAt("09:30"),
        }),
      ],
    },
  });
  const card = page.locator("[data-done='true']");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveCSS("opacity", "1");
  await expect(card.getByText("✅ 完了")).toBeVisible();
  // 編集・時刻のボタンも薄くない
  await expect(card.getByRole("button", { name: "編集" })).toHaveCSS("opacity", "1");
  await card.getByRole("button", { name: "09:00〜09:30" }).click();
  await expect(page.locator(".modal-scrim").first()).toBeVisible();
});

test.describe("画面の整理", () => {
  test("本日の作業: 作業リストがお気に入り・作業状況などのパネルより上にあり、そのほかの表示はたためる", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await seed(page, {
      stores: {
        masterTasks: [{ id: "m1", category: "業務", name: "資料作成", estimatedSeconds: 7200, isFavorite: true, sampleCount: 0, createdAt: 0, updatedAt: 0 }],
        dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") })],
        records: [{ id: "r1", date: jstDate(), category: "業務", name: "資料作成", seconds: 60, startedAt: 0, endedAt: 1 }],
      },
    });
    const listTop = (await page.getByText(`${jstDate()} の作業リスト`).boundingBox())!.y;
    // スマホの1画面目に作業リストの見出しが入っている
    expect(listTop).toBeLessThan(PHONE.height);
    for (const text of ["デイリーチャレンジ", "バックアップを取っておきませんか", "自動配分"]) {
      expect((await page.getByText(text).first().boundingBox())!.y, text).toBeGreaterThan(listTop);
    }
    await page.locator("button", { hasText: "そのほかの表示" }).click();
    await expect(page.getByText("デイリーチャレンジ")).toHaveCount(0);
    // たたんだ状態は開き直しても覚えている
    await page.reload();
    await expect(page.locator("button", { hasText: "そのほかの表示" })).toContainText("開く");
    await expect(page.getByText("デイリーチャレンジ")).toHaveCount(0);
  });

  test("ToDo: CSVの取り込み・書き出しは1つのボタンに畳まれていて、押すと出てくる", async ({ page }) => {
    await seed(page, { stores: { todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }] } });
    await openTab(page, "ToDo");
    await expect(page.locator("button", { hasText: "CSVインポート" })).toHaveCount(0);
    await page.locator("button", { hasText: "取り込み・書き出し" }).click();
    await expect(page.locator("button", { hasText: "CSVインポート" })).toBeVisible();
    await expect(page.locator("button", { hasText: "📋 ガイド貼り付けインポート" })).toBeVisible();
  });

  test("設定: 分類を選ぶとその分類の設定だけが並び、検索と組み合わせられる", async ({ page }) => {
    await seed(page);
    await openTab(page, "設定");
    const visibleHeadings = () =>
      page.locator("h3:visible").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    await page.locator("button[aria-pressed]", { hasText: "🔔 通知" }).click();
    expect(await visibleHeadings()).toEqual(["天気変化の通知（降水確率）", "朝の自動ダイジェスト通知", "1日の終わりの自動サマリー通知", "ToDoの期日リマインダー"]);
    await page.getByPlaceholder("🔍 設定を検索（例: 通知、色、残業）").fill("朝");
    expect(await visibleHeadings()).toEqual(["朝の自動ダイジェスト通知"]);
    await page.getByPlaceholder("🔍 設定を検索（例: 通知、色、残業）").fill("");
    await page.locator("button[aria-pressed]", { hasText: "すべて" }).click();
    expect((await visibleHeadings()).length).toBeGreaterThan(30);
  });

  test("案件を登録すると「登録しました」と出て、期日の初期値は1週間後", async ({ page }) => {
    await seed(page);
    await openTab(page, "案件");
    await page.locator("button", { hasText: "案件を登録" }).click();
    await expect(page.locator("input[type=date]").first()).toHaveValue(jstDate(7));
    await page.getByPlaceholder("件名").first().fill("J社見積");
    await page.getByPlaceholder("業務区分（大項目）").first().fill("営業");
    await page.getByPlaceholder("詳細作業名").first().fill("見積");
    await page.locator("button", { hasText: /^追加$/ }).first().click();
    await expect(page.getByText(`案件「J社見積」を登録しました（期日 ${jstDate(7)}）`)).toBeVisible();
  });
});
