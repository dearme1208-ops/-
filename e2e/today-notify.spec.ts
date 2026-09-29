import { expect, test, type Page } from "@playwright/test";
import { dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 本日の作業タブを開いている間に送る通知(朝・1日の終わり・月初)と、位置情報の移動検知を固定する。
// ブラウザの通知はテストでは見えないため、Notificationを差し替えて送られた内容を記録する

type Note = { title: string; body: string; tag?: string };

async function recordNotifications(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __notes: Note[] };
    w.__notes = [];
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title: string, opts?: { body?: string; tag?: string }) {
        w.__notes.push({ title, body: opts?.body ?? "", tag: opts?.tag });
      }
    }
    (window as unknown as { Notification: unknown }).Notification = FakeNotification;
  });
}
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: Note[] }).__notes);

function prevMonth(): string {
  const [y, m] = jstDate().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

test.beforeEach(async ({ page }) => {
  await recordNotifications(page);
});

test("朝の通知: 指定時刻を過ぎると本日の予定件数と期限状況を1日1回だけ通知する", async ({ page }) => {
  await page.clock.install({ time: jstAt("08:30") });
  await seed(page, {
    settings: { "notify.morningDigestEnabled": "true", "notify.morningDigestTime": "08:00" },
    stores: {
      dailyTasks: [dailyTask({ id: "d1", date: jstDate() })],
      todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
      todoTasks: [{ id: "t1", listId: "l1", title: "請求書", important: false, completed: false, order: 0, createdAt: 0, dueDate: jstDate(-1) }],
    },
  });
  // 作業・ToDoを読み終わる前に数えて「0件」と通知しないこと
  await expect.poll(async () => (await notes(page)).filter((n) => n.tag === "morning-digest")).toEqual([
    { title: "おはようございます", body: "本日の予定 1件 / ToDo 期限切れ1件・本日期限0件", tag: "morning-digest" },
  ]);
  await expect.poll(async () => (await readOne<{ value: string }>(page, "settings", "notify.morningDigestNotifiedDate"))?.value).toBe(jstDate());
  // 開き直しても、「通知済み」の設定を読み終わる前に送り直さないこと
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await page.waitForTimeout(1200);
    expect((await notes(page)).filter((n) => n.tag === "morning-digest")).toHaveLength(0);
  }
});

test("朝の通知: 指定時刻より前は通知しない", async ({ page }) => {
  await page.clock.install({ time: jstAt("07:30") });
  await seed(page, { settings: { "notify.morningDigestEnabled": "true", "notify.morningDigestTime": "08:00" } });
  await page.waitForTimeout(1000);
  expect((await notes(page)).filter((n) => n.tag === "morning-digest")).toHaveLength(0);
});

test("1日の終わりの通知: 指定時刻を過ぎると本日の合計と体調を通知する", async ({ page }) => {
  await page.clock.install({ time: jstAt("18:05") });
  await seed(page, {
    settings: { "notify.dailySummaryEnabled": "true", "notify.dailySummaryTime": "18:00" },
    stores: {
      records: [{ id: "r1", date: jstDate(), category: "業務", name: "資料作成", seconds: 5400, startedAt: 0, endedAt: 1 }],
      conditionLogs: [{ id: "c1", date: jstDate(), time: "09:00", loggedAt: jstAt("09:00"), level: "4" }],
    },
  });
  // 体調記録を読み終わる前に送って、体調が抜けないこと
  await expect.poll(async () => (await notes(page)).filter((n) => n.tag === "daily-summary").map((n) => n.body)).toEqual([
    "合計 01:30:00・体調 🙂",
  ]);
  await expect.poll(async () => (await readOne<{ value: string }>(page, "settings", "notify.dailySummaryNotifiedDate"))?.value).toBe(jstDate());
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await page.waitForTimeout(1200);
    expect((await notes(page)).filter((n) => n.tag === "daily-summary")).toHaveLength(0);
  }
});

test("月初の通知: 前月の合計と最多区分を通知する", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  const pm = prevMonth();
  await seed(page, {
    settings: { "notify.monthlySummaryEnabled": "true" },
    stores: {
      records: [
        { id: "r1", date: `${pm}-10`, category: "開発", seconds: 7200, startedAt: 0, endedAt: 1 },
        { id: "r2", date: `${pm}-11`, category: "総務", seconds: 3600, startedAt: 0, endedAt: 1 },
      ],
    },
  });
  await expect.poll(async () => (await notes(page)).find((n) => n.tag === "monthly-summary")).toMatchObject({
    title: `${pm}のサマリー`,
    body: "合計 03:00:00・最多区分「開発」02:00:00",
  });
});

test("移動検知: しきい値以上動くと「移動」の仮計測が始まり、止まると最後に動いた時刻で打ち切る", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 35.0, longitude: 139.0 });
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { settings: { "today.geoTrackingEnabled": "true", "today.geoStillMinutes": "10" } });
  // 位置の監視が始まる前に動くと検知できないため、検知できるまで往復させる(約1.1km)
  let lat = 35.0;
  await expect
    .poll(
      async () => {
        lat = lat === 35.0 ? 35.01 : 35.0;
        await context.setGeolocation({ latitude: lat, longitude: 139.0 });
        await page.waitForTimeout(400);
        return (await readAll<{ name: string; status: string; isProvisional?: boolean }>(page, "dailyTasks")).find(
          (t) => t.isProvisional && t.name === "移動"
        )?.status;
      },
      { timeout: 15_000 }
    )
    .toBe("running");
  await expect.poll(async () => (await notes(page)).some((n) => n.tag === "geo-tracking-start")).toBe(true);

  await page.clock.fastForward("11:00");
  await expect
    .poll(async () => (await readAll<{ name: string; status: string }>(page, "dailyTasks")).find((t) => t.name === "移動")?.status)
    .toBe("done");
  await expect.poll(async () => (await notes(page)).some((n) => n.tag === "geo-tracking-stop")).toBe(true);
});
