import { expect, test } from "@playwright/test";
import { MASTER, seed } from "./helpers";

// 日報・週報の期間の表示が、日本時間で正しい日付になっている(以前は世界標準時で1日前にずれていた)

test("週報の期間は月曜〜日曜を日本時間の日付で出す(深夜でもずれない)", async ({ page }) => {
  // 2026-10-03(土)の午前2時。世界標準時ではまだ10/2
  const at = new Date("2026-10-03T02:00:00+09:00").getTime();
  await page.clock.install({ time: at });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      records: [{ id: "r", date: "2026-10-03", category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 600, startedAt: at - 3600_000, endedAt: at - 3000_000, excludedFromStats: false }],
    },
  });
  await page.locator(".tab-chip", { hasText: "日報" }).first().click();
  await page.getByRole("button", { name: "週報", exact: true }).click();
  await expect(page.getByText("2026-09-28 〜 2026-10-04").first()).toBeVisible();
  await page.getByRole("button", { name: "日報", exact: true }).click();
  await expect(page.getByText("2026-10-03 〜 2026-10-03").first()).toBeVisible();
});
