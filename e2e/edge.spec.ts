import { expect, test } from "@playwright/test";
import { MASTER, MIN, dailyTask, jstAt, jstDate, openTaskTab, readAll, readOne, seed } from "./helpers";

// 普段の操作では起きにくいが、実際の使い方では起こりうる状況(連打・複数タブ・日付またぎ・
// おかしな設定値)で、記録が壊れたり画面が落ちたりしないかを確かめる

type Daily = { id: string; status: string; name: string; date: string; isProvisional?: boolean; segments: { start: number; end?: number }[]; accumulatedMs: number };
type Rec = { id: string; seconds: number; name: string; date: string };

test.describe("連打", () => {
  test("「終了」を素早く2回押しても、実績は1回分しか記録されない", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      settings: { "today.taskViewTab": "running" },
      stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") })] },
    });
    await page.locator("button", { hasText: /^終了$/ }).first().dblclick();
    await page.waitForTimeout(1500);
    const recs = await readAll<Rec>(page, "records");
    expect(recs).toHaveLength(1);
    expect(Math.abs(recs[0].seconds - 30 * 60)).toBeLessThanOrEqual(5);
  });

  test("「開始」を素早く2回押しても、計測区間は1つだけ", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, { settings: { "today.taskViewTab": "pending" }, stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
    await page.locator("button", { hasText: /^開始$/ }).first().dblclick();
    await page.waitForTimeout(1500);
    const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
    expect(d.status).toBe("running");
    expect(d.segments).toHaveLength(1);
  });

  test("「一時停止」→「再開」を素早く繰り返しても、区間が重ならず時間が増えすぎない", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      settings: { "today.taskViewTab": "running" },
      stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "running", segments: [{ start: jstAt("09:50") }], startedAt: jstAt("09:50") })] },
    });
    for (let i = 0; i < 3; i++) {
      await page.locator("button", { hasText: /^一時停止$/ }).first().dblclick();
      await page.waitForTimeout(300);
      await page.locator("button", { hasText: /^再開$/ }).first().dblclick();
      await page.waitForTimeout(300);
    }
    const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
    const open = d.segments.filter((s) => s.end === undefined);
    expect(open.length).toBeLessThanOrEqual(1);
    for (let i = 1; i < d.segments.length; i++) expect(d.segments[i].start).toBeGreaterThanOrEqual(d.segments[i - 1].end ?? Infinity);
  });
});

test("アプリを2つのタブで開いていても、仮計測は1件しか作られない", async ({ context }) => {
  const page = await context.newPage();
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "today.provisionalEnabled": "true", "today.untrackedThresholdMinutes": "5" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "done", segments: [{ start: jstAt("09:00"), end: jstAt("09:58") }], accumulatedMs: 58 * MIN, endedAt: jstAt("09:58"), stoppedAt: jstAt("09:58") })],
    },
  });
  const page2 = await context.newPage();
  await page2.clock.install({ time: jstAt("10:00") });
  await page2.goto("/");
  await page2.waitForSelector(".tab-chip");
  await Promise.all([page.clock.fastForward("05:00"), page2.clock.fastForward("05:00")]);
  await page.waitForTimeout(2500);
  const provisional = (await readAll<Daily>(page, "dailyTasks")).filter((t) => t.isProvisional);
  expect(provisional).toHaveLength(1);
});

test("日付をまたいで計測中の作業は、翌日になると放置作業の確認が出て、今日の作業として続けられる", async ({ page }) => {
  await page.clock.install({ time: jstAt("23:55") });
  await seed(page, {
    settings: { "today.taskViewTab": "running" },
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "running", segments: [{ start: jstAt("23:30") }], startedAt: jstAt("23:30") })] },
  });
  await page.clock.fastForward("10:00");
  await expect(page.getByText("日をまたいで放置された作業があります")).toBeVisible();
  await page.locator("button", { hasText: "今日の作業として続ける" }).click();
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).filter((t) => t.status === "running").map((t) => t.date)).toEqual([jstDate(1)]);
  await expect(page.getByText("日をまたいで放置された作業があります")).toHaveCount(0);
  await expect(page.locator("button", { hasText: /^終了$/ }).first()).toBeVisible();
});

test("設定値がおかしくても(空・文字・範囲外)、本日の作業画面は落ちない", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: {
      "today.untrackedThresholdMinutes": "abc",
      "today.provisionalEnabled": "true",
      "today.provisionalIdleThresholdHours": "-5",
      "today.standardWorkStart": "",
      "today.standardWorkEnd": "25:99",
      "today.autoAllocateMode": "live",
      "today.provisionalBreakRanges": "{broken json",
      "today.taskViewTab": "unknown",
      "today.geoDistanceThresholdMeters": "0",
      "notify.dailySummaryTime": "",
      "notify.morningDigestEnabled": "true",
      "notify.morningDigestTime": "zz",
    },
    stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate(), estimatedSeconds: 600, hasPlan: true })] },
  });
  await page.clock.fastForward("10:00");
  await page.waitForTimeout(1000);
  await expect(page.locator(".tab-chip").first()).toBeVisible();
  await openTaskTab(page, "予定");
  await expect(page.getByText("資料作成").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("同じ作業を2回完了して実績が1件に合算されたあと、片方だけを削除すると、その分だけ実績が減る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  const date = jstDate();
  await seed(page, {
    settings: { "today.taskViewTab": "running" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "d1", date, status: "done", segments: [{ start: jstAt("09:00"), end: jstAt("09:30") }], accumulatedMs: 30 * MIN, recordedMs: 30 * MIN, recordedSegmentCount: 1, startedAt: jstAt("09:00"), endedAt: jstAt("09:30"), stoppedAt: jstAt("09:30") }),
        dailyTask({ id: "d2", date, order: 1, status: "running", segments: [{ start: jstAt("09:40") }], startedAt: jstAt("09:40") }),
      ],
      records: [{ id: "r1", date, category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 1800, startedAt: jstAt("09:00"), endedAt: jstAt("09:30"), excludedFromStats: false }],
    },
  });
  await page.locator("button", { hasText: /^終了$/ }).first().click();
  await expect.poll(async () => (await readAll<Rec>(page, "records")).map((r) => Math.round(r.seconds / 60))).toEqual([50]);

  await openTaskTab(page, "完了");
  // 完了タブは完了した順に並ぶので、2つ目が今終えたd2
  await page.locator("button", { hasText: /^削除$/ }).nth(1).click();
  await page.waitForTimeout(300);
  await page.locator("button", { hasText: "削除する" }).first().click();
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).map((t) => t.id)).toEqual(["d1"]);
  await expect.poll(async () => (await readAll<Rec>(page, "records")).map((r) => Math.round(r.seconds / 60))).toEqual([30]);
  // 残った実績の時間帯は、消した作業(09:40〜10:00)の区間を除いた 09:00〜09:30 のまま(以前は区間ごと捨てていた)
  const [rec] = await readAll<Rec & { segments?: { start: number; end: number }[]; startedAt: number; endedAt: number }>(page, "records");
  expect(rec.segments).toEqual([{ start: jstAt("09:00"), end: jstAt("09:30") }]);
  expect([rec.startedAt, rec.endedAt]).toEqual([jstAt("09:00"), jstAt("09:30")]);
});
