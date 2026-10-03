import { describe, expect, it } from "vitest";
import {
  buildDailySummaryBody,
  buildMonthlySummary,
  buildMorningDigestBody,
  findDueScheduledTasks,
  findProvisionalStart,
  inactivityCutoff,
  isPastTimeOfDay,
  updateGeoArrivals,
} from "@/lib/automation";
import type { DailyTask, GeoPlace, WorkRecord } from "@/lib/types";

const DATE = "2026-09-29";
const at = (hm: string) => new Date(`${DATE}T${hm}:00`).getTime();
const MIN = 60_000;

function task(t: Partial<DailyTask>): DailyTask {
  return {
    id: "t",
    date: DATE,
    order: 0,
    category: "業務",
    name: "資料作成",
    estimatedSeconds: 0,
    status: "pending",
    segments: [],
    accumulatedMs: 0,
    isSpontaneous: true,
    ...t,
  } as DailyTask;
}

function record(r: Partial<WorkRecord>): WorkRecord {
  return { id: "r", date: DATE, category: "業務", name: "資料作成", seconds: 0, startedAt: 0, endedAt: 0, ...r } as WorkRecord;
}

describe("isPastTimeOfDay", () => {
  it("指定時刻ちょうどから過ぎた扱いになる", () => {
    expect(isPastTimeOfDay(at("17:59"), "18:00", 18)).toBe(false);
    expect(isPastTimeOfDay(at("18:00"), "18:00", 18)).toBe(true);
  });
  it("不正な時刻は既定の時にする", () => {
    expect(isPastTimeOfDay(at("08:30"), "xx", 8)).toBe(true);
    expect(isPastTimeOfDay(at("07:59"), "xx", 8)).toBe(false);
  });
});

describe("findProvisionalStart", () => {
  const base = {
    tasks: [] as DailyTask[],
    lastStopTime: at("09:00"),
    effectiveLastStopTime: at("09:00"),
    date: DATE,
    breakRanges: [],
    thresholdMinutes: 5,
  };

  it("しきい値を超えると直近の停止時刻から始める", () => {
    expect(findProvisionalStart({ ...base, now: at("09:04") })).toBeNull();
    expect(findProvisionalStart({ ...base, now: at("09:05") })).toBe(at("09:00"));
  });

  it("計測中の作業や既存の仮計測があれば始めない", () => {
    const now = at("10:00");
    expect(findProvisionalStart({ ...base, now, tasks: [task({ status: "running" })] })).toBeNull();
    expect(findProvisionalStart({ ...base, now, tasks: [task({ status: "paused", isProvisional: true })] })).toBeNull();
  });

  it("休憩中は始めず、休憩を差し引いた正味の経過で判定する", () => {
    const breakRanges = [{ start: "12:00", end: "13:00" }];
    const p = { ...base, breakRanges, lastStopTime: at("11:58"), effectiveLastStopTime: at("11:58") };
    expect(findProvisionalStart({ ...p, now: at("12:30") })).toBeNull();
    // 休憩前の2分 + 休憩後の2分 = 4分 < 5分
    expect(findProvisionalStart({ ...p, now: at("13:02") })).toBeNull();
    expect(findProvisionalStart({ ...p, now: at("13:03") })).toBe(at("11:58"));
  });
});

describe("inactivityCutoff", () => {
  const t = task({ status: "running", segments: [{ start: at("10:00") }] });
  it("最後の動きからしきい値を超えると、その時刻で打ち切る", () => {
    expect(inactivityCutoff(t, at("10:30"), at("11:29"), 60 * MIN)).toBeNull();
    expect(inactivityCutoff(t, at("10:30"), at("11:30"), 60 * MIN)).toBe(at("10:30"));
  });
  it("最後の動きが計測開始より前なら、計測開始の時刻にする", () => {
    expect(inactivityCutoff(t, at("09:00"), at("11:00"), 60 * MIN)).toBe(at("10:00"));
  });
});

describe("findDueScheduledTasks", () => {
  it("予定時刻を過ぎた未着手の作業だけを返す", () => {
    const tasks = [
      task({ id: "due", scheduledTime: "10:00" }),
      task({ id: "later", scheduledTime: "10:30" }),
      task({ id: "running", scheduledTime: "09:00", status: "running" }),
      task({ id: "notified", scheduledTime: "09:00", autoStartNotified: true }),
      task({ id: "disabled", scheduledTime: "09:00", autoStartDisabled: true }),
      task({ id: "bad", scheduledTime: "xx:yy" }),
      task({ id: "none" }),
    ];
    expect(findDueScheduledTasks(tasks, DATE, at("10:00")).map((t) => t.id)).toEqual(["due"]);
  });

  it("時間割の枠を持つ一時停止中の作業は、枠の中なら再開の対象にする(枠の外・時刻だけの予定は対象外)", () => {
    const tasks = [
      task({ id: "inBox", scheduledTime: "10:00", timeboxEnd: "10:30", status: "paused" }),
      task({ id: "boxOver", scheduledTime: "09:00", timeboxEnd: "09:30", status: "paused" }),
      task({ id: "noBox", scheduledTime: "09:00", status: "paused" }),
    ];
    expect(findDueScheduledTasks(tasks, DATE, at("10:05")).map((t) => t.id)).toEqual(["inBox"]);
  });
});

describe("updateGeoArrivals", () => {
  const place: GeoPlace = { id: "g1", label: "A社", lat: 35, lon: 139, radiusMeters: 100, category: "客先", name: "訪問", createdAt: 0 };
  // 緯度0.001度 ≒ 111m
  it("圏内に入った瞬間だけ到着を返し、1.5倍の外に出るまでは出たことにしない", () => {
    const inside = new Set<string>();
    expect(updateGeoArrivals(inside, [place], 35.01, 139)).toEqual([]);
    expect(updateGeoArrivals(inside, [place], 35.0005, 139)).toEqual(["g1"]);
    expect(updateGeoArrivals(inside, [place], 35.0, 139)).toEqual([]);
    // 約122m: 半径の外だが1.5倍(150m)以内なので、まだ圏内扱い
    expect(updateGeoArrivals(inside, [place], 35.0011, 139)).toEqual([]);
    expect(inside.has("g1")).toBe(true);
    expect(updateGeoArrivals(inside, [place], 35.0005, 139)).toEqual([]);
    // 約222m: 出た扱いになり、次に入った時にまた到着になる
    updateGeoArrivals(inside, [place], 35.002, 139);
    expect(inside.has("g1")).toBe(false);
    expect(updateGeoArrivals(inside, [place], 35.0, 139)).toEqual(["g1"]);
  });
});

describe("通知の本文", () => {
  it("1日の終わり: 対象日の集計対象だけを合計し、最後の体調を添える", () => {
    const records = [
      record({ seconds: 3600 }),
      record({ seconds: 600, excludedFromStats: true }),
      record({ seconds: 900, date: "2026-09-28" }),
    ];
    expect(buildDailySummaryBody(records, DATE, [])).toBe("合計 01:00:00");
    const logs = [
      { id: "c1", date: DATE, time: "09:00", loggedAt: 1, level: "5" },
      { id: "c2", date: DATE, time: "13:00", loggedAt: 2, level: "3" },
    ];
    expect(buildDailySummaryBody(records, DATE, logs)).toBe("合計 01:00:00・体調 😐");
  });

  it("月初: 前月の合計と最多区分。年をまたぐ場合は前年12月を見る", () => {
    const records = [
      record({ date: "2025-12-10", category: "開発", seconds: 7200 }),
      record({ date: "2025-12-11", category: "総務", seconds: 3600 }),
      record({ date: "2026-01-02", category: "総務", seconds: 99999 }),
    ];
    expect(buildMonthlySummary(records, "2026-01")).toEqual({
      title: "2025-12のサマリー",
      body: "合計 03:00:00・最多区分「開発」02:00:00",
    });
    expect(buildMonthlySummary(records, "2026-03")).toBeNull();
  });

  it("朝: 期限の該当があるものだけを並べる", () => {
    const none = { todoOverdue: 0, todoDueToday: 0, projectOverdue: 0, projectDueToday: 0 };
    expect(buildMorningDigestBody(3, none)).toBe("本日の予定 3件");
    expect(buildMorningDigestBody(0, { ...none, todoOverdue: 1, projectDueToday: 2 })).toBe(
      "本日の予定 0件 / ToDo 期限切れ1件・本日期限0件 / 案件 期限切れ0件・本日期限2件"
    );
  });
});
