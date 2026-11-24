import { beforeEach, describe, expect, it } from "vitest";
import { cleanupDailySettings, isStaleDailySettingKey } from "@/lib/dailySettingsCleanup";
import { db } from "@/lib/db";

beforeEach(async () => {
  await db.settings.clear();
});

describe("日付ごとの設定の掃除", () => {
  it("7日より前の日付ごとの印だけを古いとみなす", () => {
    expect(isStaleDailySettingKey("today.gapDismissed.2026-11-16", "2026-11-24")).toBe(true);
    expect(isStaleDailySettingKey("today.gapDismissed.2026-11-17", "2026-11-24")).toBe(false);
    expect(isStaleDailySettingKey("today.gapDismissed.2026-11-24", "2026-11-24")).toBe(false);
    // 日記などは対象外、日付でない末尾も対象外
    expect(isStaleDailySettingKey("journal.daily.2020-01-01", "2026-11-24")).toBe(false);
    expect(isStaleDailySettingKey("handoff.dismissed.foo", "2026-11-24")).toBe(false);
  });

  it("古い印を消し、新しい印・ほかの設定は残す", async () => {
    await db.settings.bulkPut([
      { key: "handoff.dismissed.2026-10-01", value: "true" },
      { key: "powerpro.rest.2026-11-01", value: "{}" },
      { key: "hayarigami.rank.2026-11-23", value: "A" },
      { key: "journal.daily.2026-10-01", value: "日記" },
      { key: "theme.mode", value: "forest" },
    ]);
    expect(await cleanupDailySettings("2026-11-24")).toBe(2);
    expect((await db.settings.toCollection().primaryKeys()).sort()).toEqual(["hayarigami.rank.2026-11-23", "journal.daily.2026-10-01", "theme.mode"]);
  });
});
