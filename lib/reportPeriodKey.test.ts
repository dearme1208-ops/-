import { describe, expect, it } from "vitest";
import { db } from "./db";
import {
  REPORT_KEY_MIGRATED_FLAG,
  REPORT_LEGACY_PREFIX,
  migrateReportPeriodKeysOnce,
  legacyUtcPeriodToLocal,
  legacyUtcSettingKeyToLocal,
  planReportKeyMigration,
  reportPeriodKeys,
} from "./reportPeriodKey";
import { todayStr } from "./time";

// どのタイムゾーンで走らせても成り立つ形で確かめる(TZ=Asia/Tokyo でも確認済み)
const isJst = new Date(2026, 0, 1).getTimezoneOffset() === -540;

describe("reportPeriodKeys", () => {
  it("ローカルのキーは期間の開始日(ローカル日付)", () => {
    const now = new Date(2026, 10, 25, 0, 30); // 水曜 0:30
    expect(reportPeriodKeys("day", now).local).toBe("2026-11-25");
    expect(reportPeriodKeys("week", now).local).toBe("2026-11-23");
    expect(reportPeriodKeys("month", now).local).toBe("2026-11");
    expect(reportPeriodKeys("all", now)).toEqual({ local: "all", legacyUtc: "all" });
  });
  it("旧キーは以前と同じ toISOString から作る", () => {
    const now = new Date(2026, 10, 25, 12, 0);
    const start = new Date(2026, 10, 25);
    expect(reportPeriodKeys("day", now).legacyUtc).toBe(start.toISOString().slice(0, 10));
    if (isJst) {
      expect(reportPeriodKeys("day", now).legacyUtc).toBe("2026-11-24");
      expect(reportPeriodKeys("month", now).legacyUtc).toBe("2026-10");
    }
  });
});

describe("legacyUtcPeriodToLocal", () => {
  it("旧キー→ローカルのキーで同じ期間に戻る(日・週・月、年末年始も)", () => {
    for (let i = 0; i < 400; i += 3) {
      const now = new Date(2025, 11, 1 + i, 13);
      for (const kind of ["day", "week", "month"] as const) {
        const k = reportPeriodKeys(kind, now);
        expect(legacyUtcPeriodToLocal(k.legacyUtc)).toBe(k.local);
      }
    }
  });
  it("形が違えばnull", () => {
    expect(legacyUtcPeriodToLocal("all")).toBeNull();
    expect(legacyUtcSettingKeyToLocal("report.kind")).toBeNull();
    expect(legacyUtcSettingKeyToLocal("report.note.all.all")).toBeNull();
  });
});

describe("planReportKeyMigration", () => {
  it("旧キーの値をローカルのキーへ置き直し、控えを残す", () => {
    const now = new Date(2026, 10, 25, 12);
    const day = reportPeriodKeys("day", now);
    const month = reportPeriodKeys("month", now);
    const rows = [
      { key: `report.note.day.${day.legacyUtc}`, value: "今日のメモ" },
      { key: `report.reflection.month.${month.legacyUtc}`, value: "今月の振り返り" },
      { key: `report.goalCelebrated.day.${day.legacyUtc}`, value: day.legacyUtc },
      { key: "report.kind", value: "week" },
    ];
    const { puts, deletes } = planReportKeyMigration(rows);
    const map = new Map(puts.map((p) => [p.key, p.value]));
    expect(map.get(`report.note.day.${day.local}`)).toBe("今日のメモ");
    expect(map.get(`report.reflection.month.${month.local}`)).toBe("今月の振り返り");
    expect(map.get(`report.goalCelebrated.day.${day.local}`)).toBe(day.local);
    expect(map.get(`${REPORT_LEGACY_PREFIX}report.note.day.${day.legacyUtc}`)).toBe("今日のメモ");
    expect(map.has("report.kind")).toBe(false);
    if (isJst) expect(deletes).toContain(`report.note.day.${day.legacyUtc}`);
  });

  it("連続した日のメモでも、別の日の値を取り違えない(キー名が重なる場合)", () => {
    const rows = [];
    const expected = new Map<string, string>();
    for (let i = 0; i < 5; i++) {
      const now = new Date(2026, 10, 20 + i, 12);
      const k = reportPeriodKeys("day", now);
      rows.push({ key: `report.note.day.${k.legacyUtc}`, value: `メモ${todayStr(now)}` });
      expected.set(`report.note.day.${k.local}`, `メモ${todayStr(now)}`);
    }
    const { puts, deletes } = planReportKeyMigration(rows);
    const after = new Map(rows.map((r) => [r.key, r.value]));
    for (const d of deletes) after.delete(d);
    for (const p of puts) after.set(p.key, p.value);
    for (const [k, v] of expected) expect(after.get(k)).toBe(v);
    // 控え以外に残っている期間キーは、すべて正しいローカルのキー
    for (const k of after.keys()) {
      if (k.startsWith(REPORT_LEGACY_PREFIX)) continue;
      expect(expected.has(k)).toBe(true);
    }
  });
});

describe("migrateReportPeriodKeysOnce", () => {
  it("DBの旧キーをローカルのキーへ移し、控えを残す。移し替え後に書いたローカルのキーには触らない", async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const now = new Date(2026, 10, 25, 12);
    const day = reportPeriodKeys("day", now);
    const week = reportPeriodKeys("week", now);
    await db.settings.bulkPut([
      { key: `report.note.day.${day.legacyUtc}`, value: "旧メモ" },
      { key: `report.reflection.week.${week.legacyUtc}`, value: "旧週の振り返り" },
    ]);
    await migrateReportPeriodKeysOnce();
    expect((await db.settings.get(`report.note.day.${day.local}`))?.value).toBe("旧メモ");
    expect((await db.settings.get(`report.reflection.week.${week.local}`))?.value).toBe("旧週の振り返り");
    expect((await db.settings.get(`${REPORT_LEGACY_PREFIX}report.note.day.${day.legacyUtc}`))?.value).toBe("旧メモ");
    expect((await db.settings.get(REPORT_KEY_MIGRATED_FLAG))?.value).toBe("1");

    await db.settings.put({ key: `report.note.day.${day.local}`, value: "新しいメモ" });
    await migrateReportPeriodKeysOnce();
    expect((await db.settings.get(`report.note.day.${day.local}`))?.value).toBe("新しいメモ");
  });

  it("印ごと消えた(印の無いバックアップを復元した)後は、同じ起動のままでももう一度移し替える", async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const day = reportPeriodKeys("day", new Date(2026, 10, 25, 12));
    await migrateReportPeriodKeysOnce();
    expect((await db.settings.get(REPORT_KEY_MIGRATED_FLAG))?.value).toBe("1");
    // 復元: 設定は丸ごと入れ替わり、印は無くなる
    await db.settings.clear();
    await db.settings.put({ key: `report.note.day.${day.legacyUtc}`, value: "復元したメモ" });
    await migrateReportPeriodKeysOnce();
    expect((await db.settings.get(`report.note.day.${day.local}`))?.value).toBe("復元したメモ");
    expect((await db.settings.get(REPORT_KEY_MIGRATED_FLAG))?.value).toBe("1");
  });
});
