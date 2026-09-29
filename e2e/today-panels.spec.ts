import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, seed } from "./helpers";

// 本日の作業タブ上部の見出し・操作ボタン・パネル類の表示を固定する

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

test("簡易表示ではアイコンだけのボタンになり、押すと同じ操作ができる", async ({ page }) => {
  await seed(page, { settings: { "today.simpleButtons": "true" } });
  for (const label of ["トラブル発生", "突発作業を追加", "今日の段取りを提案", "明日の下書きを作る", "終業の振り返り"]) {
    await expect(page.locator(`button[aria-label='${label}']`)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "+ 突発作業を追加" })).toHaveCount(0);
  await page.locator("button[aria-label='突発作業を追加']").click();
  await expect(page.getByText("突発作業を追加").first()).toBeVisible();
});

test("通常表示では文言付きのボタンが並び、見出しに連続日数が出る", async ({ page }) => {
  await seed(page, {
    stores: {
      records: [
        { id: "r1", date: jstDate(-1), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 600, startedAt: 0, endedAt: 1, excludedFromStats: false },
        { id: "r2", date: jstDate(), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 600, startedAt: 0, endedAt: 1, excludedFromStats: false },
      ],
    },
  });
  for (const text of ["⚡ トラブル発生", "+ 突発作業を追加", "🧭 今日の段取り", "🗓 明日の下書き", "🌙 終業の振り返り", "🖼 今日の一枚"]) {
    await expect(page.getByRole("button", { name: text })).toBeVisible();
  }
  await expect(page.getByText(`${jstDate()} の作業リスト`)).toBeVisible();
  await expect(page.getByText("🔥 連続2日")).toBeVisible();
});

test("自動配分をライブにすると、終業までの残りと予測合計が出る", async ({ page }) => {
  await seed(page, {
    settings: { "today.autoAllocateMode": "live" },
    stores: {
      masterTasks: [{ ...MASTER, estimatedSeconds: 3600 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), estimatedSeconds: 3600, hasPlan: true })],
    },
  });
  await expect(page.getByText("自動配分")).toBeVisible();
  // 時計は10:00から進み続けるため、残りは「8時間弱」になる
  await expect(page.getByText(/18:00までの残り 0[78]:\d\d:\d\d \/ 未完了作業の予測合計 \d\d:\d\d:\d\d/)).toBeVisible();
  await expect(page.getByText("業務時間内に収まる見込みです（圧縮なし）")).toBeVisible();
  await page.getByRole("button", { name: "手動" }).click();
  await expect(page.getByText("「配分を計算」を押すと")).toBeVisible();
});

test("地点到着検知をONにすると、状態の帯が出る", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.1, longitude: 139.1 });
  await seed(page, {
    settings: { "today.geoArrivalEnabled": "true" },
    stores: { geoPlaces: [{ id: "g1", label: "A社", lat: 35, lon: 139, radiusMeters: 100, category: "客先", name: "訪問", createdAt: 0 }] },
  });
  await expect(page.getByText("📍 地点到着検知中（登録地点1件。到着すると紐づく作業を自動開始）")).toBeVisible();
});
