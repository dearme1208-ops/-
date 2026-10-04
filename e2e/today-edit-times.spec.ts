import { expect, test, type Page } from "@playwright/test";
import { MASTER, MIN, clickButton, dailyTask, jstAt, jstDate, readAll, readOne, seed } from "./helpers";

// 完了した作業の開始・終了時刻を後から直したときに、実績(集計・残業分析などの元データ)の
// 時間と開始・終了時刻が正しく追従するかを確かめる

type Rec = { id: string; seconds: number; startedAt: number; endedAt: number };
type Daily = { id: string; accumulatedMs: number; startedAt: number; endedAt: number };

const done = (id: string, from: string, to: string, order = 0) =>
  dailyTask({
    id,
    date: jstDate(),
    order,
    status: "done",
    segments: [{ start: jstAt(from), end: jstAt(to) }],
    accumulatedMs: jstAt(to) - jstAt(from),
    recordedMs: jstAt(to) - jstAt(from),
    recordedSegmentCount: 1,
    startedAt: jstAt(from),
    endedAt: jstAt(to),
    stoppedAt: jstAt(to),
  });
const record = (from: string, to: string, seconds: number) => ({
  id: "r1",
  date: jstDate(),
  category: "業務",
  name: "資料作成",
  masterTaskId: "m1",
  seconds,
  startedAt: jstAt(from),
  endedAt: jstAt(to),
  excludedFromStats: false,
});

// n番目(完了した順)の作業の編集を開いて、開始・終了時刻を入れ直す
async function editTimes(page: Page, nth: number, start?: string, end?: string) {
  await page.locator("button[aria-label='編集']:not([title])").nth(nth).click();
  const times = page.locator(".modal-scrim input[type=time]");
  if (start) await times.nth(0).fill(start);
  if (end) await times.nth(1).fill(end);
  await clickButton(page, /^保存$/);
  await page.waitForTimeout(300);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("20:00") });
});

test("終了時刻を早めると、実績の時間と終了時刻が変わる(定時以降の分も減る)", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: { masterTasks: [MASTER], dailyTasks: [done("d1", "17:00", "18:30")], records: [record("17:00", "18:30", 90 * 60)] },
  });
  await editTimes(page, 0, undefined, "18:00");
  const d = (await readOne<Daily>(page, "dailyTasks", "d1"))!;
  expect(d.accumulatedMs).toBe(60 * MIN);
  expect(d.endedAt).toBe(jstAt("18:00"));
  const r = (await readOne<Rec>(page, "records", "r1"))!;
  expect(r.seconds).toBe(60 * 60);
  expect(r.endedAt).toBe(jstAt("18:00"));
  expect(r.startedAt).toBe(jstAt("17:00"));
});

test("開始時刻を早めると、実績の時間と開始時刻が変わる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: { masterTasks: [MASTER], dailyTasks: [done("d1", "09:00", "09:30")], records: [record("09:00", "09:30", 30 * 60)] },
  });
  await editTimes(page, 0, "08:30");
  const r = (await readOne<Rec>(page, "records", "r1"))!;
  expect(r.seconds).toBe(60 * 60);
  expect(r.startedAt).toBe(jstAt("08:30"));
  expect(r.endedAt).toBe(jstAt("09:30"));
});

test("同じ作業を2回完了して1件に合算された実績は、片方の時刻を直すとその分だけ変わる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [done("d1", "09:00", "09:30"), done("d2", "10:00", "10:30", 1)],
      records: [record("09:00", "10:30", 60 * 60)],
    },
  });
  // 後の回の終了を早める → 合計が15分減り、実績の終了は後の回の新しい終了時刻
  await editTimes(page, 1, undefined, "10:15");
  let r = (await readOne<Rec>(page, "records", "r1"))!;
  expect(r.seconds).toBe(45 * 60);
  expect(r.endedAt).toBe(jstAt("10:15"));
  expect(r.startedAt).toBe(jstAt("09:00"));

  // 先の回の開始を遅らせる → 合計がさらに10分減り、実績の開始も遅くなる
  await editTimes(page, 0, "09:10");
  r = (await readOne<Rec>(page, "records", "r1"))!;
  expect(r.seconds).toBe(35 * 60);
  expect(r.startedAt).toBe(jstAt("09:10"));
  expect(r.endedAt).toBe(jstAt("10:15"));
});

test("作業名と時刻を同時に直すと、新しい作業名の実績が新しい時刻で作られる", async ({ page }) => {
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: { masterTasks: [MASTER], dailyTasks: [done("d1", "17:00", "18:30")], records: [record("17:00", "18:30", 90 * 60)] },
  });
  await page.locator("button[aria-label='編集']:not([title])").first().click();
  await page.locator(".modal-scrim").getByPlaceholder("詳細作業名").fill("会議");
  const times = page.locator(".modal-scrim input[type=time]");
  await times.nth(0).fill("16:30");
  await times.nth(1).fill("18:00");
  await clickButton(page, /^保存$/);
  await page.waitForTimeout(300);
  const recs = await readAll<Rec & { name: string }>(page, "records");
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ name: "会議", seconds: 90 * 60, startedAt: jstAt("16:30"), endedAt: jstAt("18:00") });
});

test("「時間を加算」した作業の終了時刻を延ばすと、加算した分を残したまま延ばした分だけ増える", async ({ page }) => {
  // 17:00〜17:30 の計測 + 加算10分 = 40分で完了した作業
  const d1 = { ...done("d1", "17:00", "17:30"), accumulatedMs: 40 * MIN, recordedMs: 40 * MIN };
  await seed(page, {
    settings: { "today.taskViewTab": "done" },
    stores: { masterTasks: [MASTER], dailyTasks: [d1], records: [record("17:00", "17:30", 40 * 60)] },
  });
  await editTimes(page, 0, undefined, "17:35");
  expect((await readOne<Daily>(page, "dailyTasks", "d1"))!.accumulatedMs).toBe(45 * MIN);
  expect((await readOne<Rec>(page, "records", "r1"))!.seconds).toBe(45 * 60);
});
