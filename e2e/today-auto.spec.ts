import { expect, test } from "@playwright/test";
import { MASTER, MIN, clickButton, clickInCard, dailyTask, jstAt, jstDate, openTaskTab, readAll, readOne, seed } from "./helpers";

// 本日の作業タブで「時間の経過」をきっかけに自動で動く処理(未計測の仮計測・放置検知・
// 予定時刻の自動開始・休憩の強制停止・トラブル割り込みからの自動再開・位置情報の到着検知)
// を、ブラウザの時計を進めて確認する。分割整理で最も壊れやすい部分なので重点的に固定する

type Daily = {
  id: string;
  status: string;
  category: string;
  name: string;
  isProvisional?: boolean;
  isTrouble?: boolean;
  segments: { start: number; end?: number }[];
  startedAt?: number;
  endedAt?: number;
};
type Rec = { seconds: number; endedAt: number; category: string; name: string };

const near = (actual: number | undefined, expected: number, tolMs = 5000) =>
  expect(Math.abs((actual ?? NaN) - expected)).toBeLessThanOrEqual(tolMs);

const doneAt = (id: string, from: string, to: string) =>
  dailyTask({
    id,
    date: jstDate(),
    status: "done",
    segments: [{ start: jstAt(from), end: jstAt(to) }],
    accumulatedMs: jstAt(to) - jstAt(from),
    startedAt: jstAt(from),
    endedAt: jstAt(to),
    stoppedAt: jstAt(to),
  });

test.describe("未計測の仮計測", () => {
  test("何も計測していない時間がしきい値を超えると、直前に止めた時刻からの仮計測が始まり、作業に割り当てられる", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      settings: { "today.provisionalEnabled": "true", "today.untrackedThresholdMinutes": "5" },
      stores: { masterTasks: [MASTER], dailyTasks: [doneAt("d1", "09:00", "09:58")] },
    });
    await page.clock.fastForward("05:00");
    await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)?.status).toBe("running");
    const prov = (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)!;
    expect(prov.segments[0].start).toBe(jstAt("09:58"));

    await openTaskTab(page, "実行中");
    await clickButton(page, /^自由入力$/);
    await page.getByPlaceholder("業務区分（大項目）").fill("総務");
    await page.getByPlaceholder("詳細作業名").fill("電話対応");
    await clickButton(page, "この作業に割り当てる");
    const assigned = (await readOne<Daily>(page, "dailyTasks", prov.id))!;
    expect(assigned).toMatchObject({ category: "総務", name: "電話対応", status: "running" });
    expect(assigned.isProvisional).toBeFalsy();
    expect(assigned.segments[0].start).toBe(jstAt("09:58"));
  });

  test("仮計測を「割り当てずに終了」すると、未分類の実績として残る", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      settings: { "today.provisionalEnabled": "true", "today.taskViewTab": "running" },
      stores: {
        dailyTasks: [
          dailyTask({ id: "p1", date: jstDate(), category: "未分類", name: "仮計測中", masterTaskId: undefined, status: "running", isProvisional: true, segments: [{ start: jstAt("09:40") }], startedAt: jstAt("09:40") }),
        ],
      },
    });
    await clickButton(page, "割り当てずに終了");
    const [rec] = await readAll<Rec>(page, "records");
    expect(rec).toMatchObject({ category: "未分類", name: "仮計測中" });
    near(rec.seconds * 1000, 20 * MIN);
  });

  test("操作のない状態がしきい値を超えると、仮計測は最後に操作した時刻で打ち切られる", async ({ page }) => {
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      // しきい値の下限は0.5時間
      settings: { "today.provisionalEnabled": "true", "today.provisionalIdleThresholdHours": "0.5" },
      stores: {
        dailyTasks: [
          dailyTask({ id: "p1", date: jstDate(), category: "未分類", name: "仮計測中", masterTaskId: undefined, status: "running", isProvisional: true, segments: [{ start: jstAt("09:50") }], startedAt: jstAt("09:50") }),
        ],
      },
    });
    const lastActivity = await page.evaluate(() => Date.now());
    await page.clock.fastForward("40:00");
    await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "p1"))?.status).toBe("done");
    const d = (await readOne<Daily>(page, "dailyTasks", "p1"))!;
    near(d.endedAt, lastActivity, 5000);
  });
});

test("予定時刻になった作業は自動で開始され、計測中の作業があれば確認が出る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "s1", date: jstDate(), name: "定例会議", scheduledTime: "10:05" }),
        dailyTask({ id: "s2", date: jstDate(), order: 1, name: "朝会", scheduledTime: "10:10" }),
      ],
    },
  });
  await page.clock.fastForward("06:00");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "s1"))?.status).toBe("running");

  // 10:10の予定は、10:05の作業が計測中なので割り込まずに確認する
  await page.clock.fastForward("05:00");
  await expect(page.getByText("予定の時刻になりました").first()).toBeVisible();
  await clickButton(page, "一時停止して開始する");
  expect((await readOne<Daily>(page, "dailyTasks", "s1"))?.status).toBe("paused");
  expect((await readOne<Daily>(page, "dailyTasks", "s2"))?.status).toBe("running");
});

test("強制ストップ付きの休憩時間になると計測中の作業が一時停止し、チェックリストが出る", async ({ page }) => {
  await page.clock.install({ time: jstAt("11:58") });
  await seed(page, {
    settings: {
      "today.provisionalBreakRanges": JSON.stringify([{ start: "12:00", end: "13:00", forceStop: true, checklist: ["目薬をさす"] }]),
    },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "running", segments: [{ start: jstAt("11:00") }], startedAt: jstAt("11:00") })],
    },
  });
  await page.clock.fastForward("03:00");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "d1"))?.status).toBe("paused");
  await expect(page.getByText("目薬をさす").first()).toBeVisible();
});

test("トラブル発生で計測中の作業が中断され、トラブル対応を終えると自動で再開する", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "today.taskViewTab": "running" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") })],
    },
  });
  await clickButton(page, "⚡ トラブル発生");
  expect((await readOne<Daily>(page, "dailyTasks", "d1"))?.status).toBe("paused");
  const trouble = (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isTrouble)!;
  expect(trouble.status).toBe("running");

  await page.clock.fastForward("10:00");
  await openTaskTab(page, "実行中");
  await clickInCard(page, "トラブル ", "終了");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "d1"))?.status).toBe("running");
  expect((await readOne<Daily>(page, "dailyTasks", trouble.id))?.status).toBe("done");
});

test.describe("位置情報の到着検知", () => {
  const place = { id: "g1", label: "A社", lat: 35.0, lon: 139.0, radiusMeters: 100, category: "客先", name: "A社訪問", createdAt: 0 };

  test("登録地点に着くと、その地点の作業が自動で開始される", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 35.1, longitude: 139.1 });
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, { settings: { "today.geoArrivalEnabled": "true" }, stores: { geoPlaces: [place] } });
    // 位置の変化を監視し始める前に移動してしまうと検知できないため、到着を確認できるまで
    // 「離れる→着く」を繰り返す(実機でもGPSの更新のたびに同じ判定が行われる)
    await expect
      .poll(
        async () => {
          await context.setGeolocation({ latitude: 35.1, longitude: 139.1 });
          await page.waitForTimeout(200);
          await context.setGeolocation({ latitude: 35.0, longitude: 139.0 });
          await page.waitForTimeout(300);
          return (await readAll<Daily>(page, "dailyTasks")).find((t) => t.name === "A社訪問")?.status;
        },
        { timeout: 15_000 }
      )
      .toBe("running");
  });
});
