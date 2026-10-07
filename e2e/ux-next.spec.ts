import { expect, test } from "@playwright/test";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 使いやすさの提案(次はこれ・少し前に終わってた・下の帯で操作・削除の元に戻す・いつもの作業・
// 今日の抜けを埋める・そろそろの家事・使っていない表示を畳む)を固定する

type Daily = { id: string; status: string; name: string; segments: { start: number; end?: number }[]; endedAt?: number; isProvisional?: boolean };
const M2 = { ...MASTER, id: "m2", name: "電話対応", category: "総務" };
const running = (start = "09:30") => dailyTask({ id: "a", date: jstDate(), name: "資料作成", status: "running", segments: [{ start: jstAt(start) }], startedAt: jstAt(start) });

test("完了のお知らせの「▶ 次：」から、次の作業をそのまま始められる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, {
    settings: { "today.taskViewTab": "running" },
    stores: { masterTasks: [MASTER, M2], dailyTasks: [running(), dailyTask({ id: "b", date: jstDate(), order: 1, name: "電話対応", masterTaskId: "m2" })] },
  });
  await page.getByRole("button", { name: "終了", exact: true }).first().click();
  const next = page.getByTestId("completion-next");
  await expect(next).toContainText("次：電話対応");
  await next.click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "b"))?.status).toBe("running");
});

test("「⏪ 少し前に終わってた」→「10分前」で、10分前の時刻で終わる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  await seed(page, { settings: { "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
  await clickButton(page, "⏪ 少し前に終わってた");
  await page.getByTestId("finish-earlier").getByRole("button", { name: /^10分前/ }).click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("done");
  const a = (await readOne<Daily>(page, "dailyTasks", "a"))!;
  expect(Math.abs(a.endedAt! - jstAt("09:50"))).toBeLessThan(5_000);
});

test("画面下の計測中の帯から、その場で一時停止できる", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: jstAt("10:00") });
  const more = Array.from({ length: 10 }, (_, i) => dailyTask({ id: "p" + i, date: jstDate(), order: i + 1, name: `作業${i}` }));
  await seed(page, { settings: { "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [running(), ...more] } });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const strip = page.getByTestId("running-strip");
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "一時停止" }).click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))?.status).toBe("paused");
});

test("作業の削除は確認なしで消え、「元に戻す」で戻る", async ({ page }) => {
  await seed(page, { settings: { "today.taskViewTab": "pending" }, stores: { masterTasks: [MASTER], dailyTasks: [dailyTask({ id: "d1", date: jstDate() })] } });
  await page.locator("button[aria-label='削除']").first().click();
  await expect.poll(async () => (await readAll(page, "dailyTasks")).length).toBe(0);
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect.poll(async () => (await readAll(page, "dailyTasks")).length).toBe(1);
});

test("作業の追加画面の一番上に、今の時間帯によくやる作業が出て、押すとすぐ始まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  const recs = [-1, -2, -8].map((d, i) => ({
    id: "r" + i, date: jstDate(d), category: "総務", name: "電話対応", masterTaskId: "m2", seconds: 600,
    startedAt: jstAt("10:10", d), endedAt: jstAt("10:20", d), excludedFromStats: false,
  }));
  // 平日/休日をそろえるため、今日と同じ曜日の区別の日だけを数える(-1, -2 が休日をまたぐ場合に備え -7 も足す)
  recs.push({ ...recs[0], id: "r9", date: jstDate(-7), startedAt: jstAt("10:00", -7), endedAt: jstAt("10:10", -7) });
  recs.push({ ...recs[0], id: "r10", date: jstDate(-14), startedAt: jstAt("10:00", -14), endedAt: jstAt("10:10", -14) });
  await seed(page, { stores: { masterTasks: [MASTER, M2], records: recs } });
  await page.getByRole("button", { name: "+ 突発作業を追加" }).click();
  const usual = page.getByTestId("usual-tasks");
  await expect(usual).toContainText("電話対応");
  await usual.getByRole("button", { name: /電話対応/ }).click();
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.name === "電話対応")?.status).toBe("running");
});

test("今日の抜けを埋める: リングの点線(記録のない時間)を押して作業を選ぶと、その時間を計った作業として完了に並ぶ", async ({ page }) => {
  await page.clock.install({ time: jstAt("12:00") });
  const done = (id: string, from: string, to: string, order: number) =>
    dailyTask({ id, date: jstDate(), order, status: "done", segments: [{ start: jstAt(from), end: jstAt(to) }], accumulatedMs: jstAt(to) - jstAt(from), startedAt: jstAt(from), endedAt: jstAt(to) });
  await seed(page, { stores: { masterTasks: [MASTER, M2], dailyTasks: [done("a", "09:00", "10:00", 0), done("b", "10:30", "11:00", 1)] } });
  // 上の近道からリングへ移る
  await page.getByRole("button", { name: /抜けを埋める（1）/ }).click();
  const ring = page.getByTestId("day-ring");
  await expect(ring).toBeInViewport();
  await ring.getByRole("button", { name: "記録のない時間 10:00〜10:30" }).click();
  const gap = ring.getByTestId("day-gap");
  await expect(gap).toContainText("10:00〜10:30");
  await gap.getByText("電話対応").first().click();
  await gap.getByRole("button", { name: /この30分を「電話対応」として記録/ }).click();
  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.name === "電話対応")?.status).toBe("done");
  const t = (await readAll<Daily>(page, "dailyTasks")).find((t) => t.name === "電話対応")!;
  expect(t.segments[0]).toEqual({ start: jstAt("10:00"), end: jstAt("10:30") });
  await expect(ring.getByText("埋める所はありません")).toBeVisible();
  await expect(ring.getByTestId("ring-gap")).toHaveCount(0);
  // 抜けがなくなれば近道のボタンも消える
  await expect(page.getByRole("button", { name: /抜けを埋める/ })).toHaveCount(0);
});

test("今日の抜けを埋める: 「記録しない」にした時間はリングの点線からも消える", async ({ page }) => {
  await page.clock.install({ time: jstAt("12:00") });
  const done = (id: string, from: string, to: string, order: number) =>
    dailyTask({ id, date: jstDate(), order, status: "done", segments: [{ start: jstAt(from), end: jstAt(to) }], accumulatedMs: jstAt(to) - jstAt(from), startedAt: jstAt(from), endedAt: jstAt(to) });
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [done("a", "09:00", "10:00", 0), done("b", "10:30", "11:00", 1)] } });
  const ring = page.getByTestId("day-ring");
  await expect(ring.getByTestId("ring-gap")).toHaveCount(1);
  await ring.getByTestId("day-gap").getByRole("button", { name: "記録しない" }).click();
  await expect(ring.getByTestId("ring-gap")).toHaveCount(0);
  await expect(ring.getByText("埋める所はありません")).toBeVisible();
});

test("森モード: いつもの間隔より空いてきた家事が「そろそろの家事」に出る", async ({ page }) => {
  const sheets = { ...MASTER, id: "s", category: "家事", name: "シーツ交換" };
  const recs = [-24, -17, -10].map((d, i) => ({
    id: "r" + i, date: jstDate(d), category: "家事", name: "シーツ交換", masterTaskId: "s", seconds: 900,
    startedAt: jstAt("09:00", d), endedAt: jstAt("09:15", d), excludedFromStats: false,
  }));
  await seed(page, { settings: { "theme.visualMode": "home" }, stores: { masterTasks: [sheets], records: recs } });
  const panel = page.getByTestId("chore-panel");
  await expect(panel).toContainText("シーツ交換");
  await expect(panel).toContainText("前回から10日");
  await expect(panel).toContainText("いつもは7日おき");
  // 空き具合は落ち葉の量でも見せる(10日 / 7日 ≒ 143%)
  await expect(panel.getByRole("img", { name: "空き具合 143%" })).toBeVisible();
});

test("30日以上触っていない表示は「しばらく使っていない表示」に畳まれ、押すと戻る", async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
  const old = jstAt("10:00", -40);
  await seed(page, {
    settings: { "ui.panelUsage": JSON.stringify({ status: { first: old } }), "today.showStatusPanel": "true" },
    stores: { masterTasks: [MASTER], dailyTasks: [running()] },
  });
  const folded = page.getByTestId("folded-panels");
  await expect(folded).toContainText("しばらく使っていない表示（1）");
  await expect(page.locator("[data-panel-id='status']")).toHaveCount(0);
  await folded.locator("summary").click();
  await folded.getByRole("button", { name: "本日の作業状況を戻す" }).click();
  await expect(page.locator("[data-panel-id='status']")).toBeVisible();
});
