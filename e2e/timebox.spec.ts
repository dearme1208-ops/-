import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// タイムボックス(時間割): 作業ごとに時間の枠を決め、枠の始まりで自動開始、
// 終わりで「時間です」と知らせて止める(延長・続行も選べる)

type Daily = { id: string; name: string; status: string; scheduledTime?: string; timeboxEnd?: string; segments: { start: number; end?: number }[] };

const three = () => [
  dailyTask({ id: "a", date: jstDate(), order: 0, name: "資料作成" }),
  dailyTask({ id: "b", date: jstDate(), order: 1, name: "メール返信" }),
  dailyTask({ id: "c", date: jstDate(), order: 2, name: "企画整理" }),
];

test("時間割を作ると、枠の始まりで自動的に始まり、終わりで「時間です」と出て止められる", async ({ page }) => {
  await page.clock.install({ time: jstAt("08:50") });
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: three() } });

  await page.getByRole("button", { name: /^(⏱ 時間割|時間割を作る)$/ }).click();
  await page.getByRole("button", { name: /^今日/ }).click();
  await page.getByLabel("始める時刻").fill("09:00");
  await page.getByLabel("「メール返信」の枠の長さ").selectOption("20");
  const items = page.getByTestId("timebox-item");
  await expect(items.nth(0)).toContainText("09:00〜09:25");
  await expect(items.nth(1)).toContainText("09:30〜09:50");
  await expect(items.nth(2)).toContainText("09:55〜10:20");
  await page.getByRole("button", { name: "この時間割で決める" }).click();

  const band = page.getByTestId("timebox-band");
  await expect(band).toContainText("次の枠 09:00");
  expect(await readOne<Daily>(page, "dailyTasks", "b")).toMatchObject({ scheduledTime: "09:30", timeboxEnd: "09:50" });

  // 9:00 → 資料作成が自動で始まり、帯に残り時間が出る
  await page.clock.fastForward("10:30");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))!.status).toBe("running");
  await expect(band).toContainText("今はこれだけ");
  await expect(band).toContainText("資料作成");

  // 9:25 → 時間です
  await page.clock.fastForward("25:00");
  await expect(page.getByText("「資料作成」の枠（09:00〜09:25）が終わりました。")).toBeVisible();
  await page.getByRole("button", { name: "止める（一時停止）" }).click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))!.status).toBe("paused");
});

test("5分延長すると、その枠と後ろのまだ始まっていない枠が5分ずれ、計測は続く", async ({ page }) => {
  await page.clock.install({ time: jstAt("09:20") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date: jstDate(), name: "資料作成", scheduledTime: "09:00", timeboxEnd: "09:25", autoStartNotified: true, status: "running", segments: [{ start: jstAt("09:00") }], startedAt: jstAt("09:00") }),
        dailyTask({ id: "b", date: jstDate(), order: 1, name: "メール返信", scheduledTime: "09:30", timeboxEnd: "09:50" }),
      ],
    },
  });
  await page.clock.fastForward("05:30");
  await page.getByRole("button", { name: /5分だけ延長/ }).click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))!.timeboxEnd).toBe("09:30");
  expect(await readOne<Daily>(page, "dailyTasks", "b")).toMatchObject({ scheduledTime: "09:35", timeboxEnd: "09:55" });
  expect((await readOne<Daily>(page, "dailyTasks", "a"))!.status).toBe("running");

});

test("設定で「確認せずに止める」をONにすると、枠の終わりでその場で止まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("09:20") });
  await seed(page, {
    settings: { "today.timeboxAutoStop": "true" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date: jstDate(), name: "資料作成", scheduledTime: "09:00", timeboxEnd: "09:25", autoStartNotified: true, status: "running", segments: [{ start: jstAt("09:00") }], startedAt: jstAt("09:00") }),
      ],
    },
  });
  await page.clock.fastForward("05:30");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))!.status).toBe("paused");
  await expect(page.getByText("が終わりました。")).toHaveCount(0);
});

test("全部の枠が終わると、時間どおりに始めた・止めた枠の数が出る。明日の時間割も作れる", async ({ page }) => {
  await page.clock.install({ time: jstAt("11:00") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date: jstDate(), name: "資料作成", scheduledTime: "09:00", timeboxEnd: "09:25", timeboxEndHandled: true, autoStartNotified: true, status: "paused", segments: [{ start: jstAt("09:00"), end: jstAt("09:25") }] }),
        dailyTask({ id: "b", date: jstDate(), order: 1, name: "メール返信", scheduledTime: "09:30", timeboxEnd: "09:50", timeboxEndHandled: true, autoStartNotified: true, status: "done", segments: [{ start: jstAt("09:40"), end: jstAt("10:10") }] }),
        dailyTask({ id: "t1", date: jstDate(1), name: "明日の資料" }),
      ],
    },
  });
  await expect(page.getByTestId("timebox-review")).toContainText("時間どおりに始めた枠 1/2");
  await expect(page.getByTestId("timebox-review")).toContainText("止めた枠 1/2");

  await page.getByRole("button", { name: /^(⏱ 時間割|時間割を作る)$/ }).click();
  await page.getByRole("button", { name: /^明日/ }).click();
  await expect(page.getByTestId("timebox-item")).toHaveCount(1);
  await page.getByLabel("始める時刻").fill("09:00");
  await page.getByRole("button", { name: "この時間割で決める" }).click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "t1"))?.timeboxEnd).toBe("09:25");
  // 明日の枠は今日の画面では動かない
  expect((await readAll<Daily>(page, "dailyTasks")).find((t) => t.id === "t1")!.status).toBe("pending");
});

test("途中まで進めて一時停止した作業も、時間割の枠の始まりで続きから再開する", async ({ page }) => {
  await page.clock.install({ time: jstAt("09:58") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({
          id: "a",
          date: jstDate(),
          name: "資料作成",
          status: "paused",
          scheduledTime: "10:00",
          timeboxEnd: "10:25",
          segments: [{ start: jstAt("09:00"), end: jstAt("09:20") }],
          accumulatedMs: 20 * 60000,
          startedAt: jstAt("09:00"),
        }),
      ],
    },
  });
  await page.clock.fastForward("02:30");
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))!.status).toBe("running");
  const t = (await readOne<Daily>(page, "dailyTasks", "a"))!;
  expect(t.segments.length).toBe(2);
  expect(t.segments[0]).toEqual({ start: jstAt("09:00"), end: jstAt("09:20") });
});
