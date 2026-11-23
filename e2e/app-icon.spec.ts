import { expect, test, type Page } from "@playwright/test";
import { seed } from "./helpers";

// 設定でアプリのアイコンを選ぶと、<head>のマニフェスト・アイコンが差し替わり、開き直しても残る
const openTab = (page: Page, name: string) => page.locator(".tab-chip", { hasText: name }).first().click();

test("設定: アプリのアイコンを昼の森にすると、マニフェストとアイコンが切り替わる", async ({ page }) => {
  await seed(page);
  await openTab(page, "設定");
  const group = page.getByRole("radiogroup", { name: "アプリのアイコン" });
  await expect(group.getByRole("radio")).toHaveCount(4);
  await expect(group.getByRole("radio", { name: "森の大樹" })).toHaveAttribute("aria-checked", "true");

  await group.getByRole("radio", { name: "昼の森" }).click();
  await expect(group.getByRole("radio", { name: "昼の森" })).toHaveAttribute("aria-checked", "true");
  await expect(group.getByRole("radio", { name: "森の大樹" })).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest-day\.json$/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/icons\/day\//);
  const iconHrefs = await page.locator('link[rel="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(iconHrefs.length).toBeGreaterThan(0);
  for (const h of iconHrefs) expect(h).toContain("/icons/day/");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest-day\.json$/);
  await openTab(page, "設定");
  await expect(
    page.getByRole("radiogroup", { name: "アプリのアイコン" }).getByRole("radio", { name: "昼の森" })
  ).toHaveAttribute("aria-checked", "true");
});
