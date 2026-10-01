import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES, settingCategoryOf } from "@/lib/settingsCategories";

// 設定画面のソースから見出しを拾い、どれも分類表のどこか1つに入っていることを確かめる
// (設定を足したときに分類表への追加を忘れると、ここで気づける)
const source = readFileSync(path.resolve(__dirname, "../components/sections/SettingsSection.tsx"), "utf-8");
const headings = [...source.matchAll(/<h3 className="font-display text-sm font-bold text-cream\/80">([^<]+)<\/h3>/g)].map((m) => m[1].trim());

describe("設定の分類", () => {
  it("設定画面のすべての見出しが、ちょうど1つの分類に属している", () => {
    expect(headings.length).toBeGreaterThan(30);
    for (const h of headings) expect(settingCategoryOf(h), h).not.toBeNull();
    const all = SETTINGS_CATEGORIES.flatMap((c) => c.headings);
    expect(new Set(all).size).toBe(all.length);
  });

  it("見出し先頭の絵文字は無視して対応させる", () => {
    expect(settingCategoryOf("🎭 演出テーマ")).toBe("look");
    expect(settingCategoryOf("📆 カレンダーの週表示")).toBe("todo");
    expect(settingCategoryOf("知らない設定")).toBeNull();
  });
});
