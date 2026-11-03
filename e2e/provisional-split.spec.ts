import { expect, test, type Page } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, seed } from "./helpers";

// 仮計測を「◯時◯分までは〇〇、そこからは△△」と途中で区切って割り当てる操作と、
// 完了した作業へ「記録して終える」割り当てを固定する

type Daily = { id: string; name: string; status: string; isProvisional?: boolean; segments: { start: number; end?: number }[]; accumulatedMs: number };
type Rec = { name: string; seconds: number };

const M2 = { ...MASTER, id: "m2", name: "電話対応", category: "総務" };
const prov = () =>
  dailyTask({ id: "p", date: jstDate(), order: 9, category: "未分類", name: "仮計測中", masterTaskId: undefined, status: "running", isProvisional: true, segments: [{ start: jstAt("09:00") }], startedAt: jstAt("09:00") });
const pending = (id: string, name: string, masterTaskId: string, category: string, order: number) => dailyTask({ id, date: jstDate(), order, name, category, masterTaskId });
const doneTask = (id: string, name: string, masterTaskId: string, category: string, from: string, to: string) =>
  dailyTask({ id, date: jstDate(), order: 5, name, category, masterTaskId, status: "done", segments: [{ start: jstAt(from), end: jstAt(to) }], accumulatedMs: jstAt(to) - jstAt(from), startedAt: jstAt(from), endedAt: jstAt(to) });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: jstAt("10:00") });
});

async function openSplit(page: Page, hm: string) {
  await page.getByRole("button", { name: "✂ 途中で区切る" }).click();
  const panel = page.getByTestId("provisional-split");
  await panel.getByLabel("区切る時刻").fill(hm);
  return panel;
}

test("9:30で区切り、前半は一時停止中の作業に足し、後半は別の作業として計測を続ける", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER, M2], dailyTasks: [prov(), pending("a", "資料作成", "m1", "業務", 0), pending("b", "電話対応", "m2", "総務", 1)] } });
  const panel = await openSplit(page, "09:30");
  await panel.getByTestId("split-first").getByRole("button", { name: /資料作成/ }).click();
  await panel.getByTestId("split-second").getByRole("button", { name: /電話対応/ }).click();
  await panel.getByRole("button", { name: "09:30で区切って割り当てる" }).click();

  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.id === "b")?.status).toBe("running");
  const all = await readAll<Daily>(page, "dailyTasks");
  expect(all.find((t) => t.isProvisional)).toBeUndefined();
  const a = all.find((t) => t.id === "a")!;
  expect(a.status).toBe("paused");
  expect(a.segments).toEqual([{ start: jstAt("09:00"), end: jstAt("09:30") }]);
  expect(a.accumulatedMs).toBe(30 * 60_000);
  expect(all.find((t) => t.id === "b")!.segments).toEqual([{ start: jstAt("09:30") }]);
  expect(all.filter((t) => t.status === "running")).toHaveLength(1);
});

test("前半は完了した作業の時間として記録し、後半は今で終えてマスタの作業として記録する", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER, M2],
      dailyTasks: [prov(), doneTask("d", "資料作成", "m1", "業務", "08:00", "08:30")],
      records: [{ id: "r", date: jstDate(), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 1800, startedAt: jstAt("08:00"), endedAt: jstAt("08:30"), excludedFromStats: false }],
    },
  });
  const panel = await openSplit(page, "09:20");
  await panel.getByTestId("split-first").getByRole("button", { name: /資料作成/ }).click();
  await panel.getByRole("button", { name: "今で終えて記録する" }).click();
  await panel.getByTestId("split-second").getByRole("button", { name: "▼ マスタから探す" }).click();
  await panel.getByTestId("split-second").getByText("電話対応").first().click();
  await panel.getByRole("button", { name: "09:20で区切って割り当てる" }).click();

  // 時計は動き続けるので、操作にかかった数秒の誤差は許す
  await expect.poll(async () => (await readAll<Rec>(page, "records")).find((r) => r.name === "電話対応")?.seconds ?? 0).toBeGreaterThanOrEqual(40 * 60);
  expect((await readAll<Rec>(page, "records")).find((r) => r.name === "電話対応")!.seconds).toBeLessThan(40 * 60 + 15);
  const recs = await readAll<Rec>(page, "records");
  // 完了済みの資料作成の実績に、前半の20分が足される
  expect(recs.find((r) => r.name === "資料作成")!.seconds).toBe(1800 + 20 * 60);
  const all = await readAll<Daily>(page, "dailyTasks");
  expect(all.some((t) => t.isProvisional || t.status === "running")).toBe(false);
});

test("前半だけ割り当て、後半は未割り当ての仮計測のまま続ける", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [prov(), pending("a", "資料作成", "m1", "業務", 0)] } });
  const panel = await openSplit(page, "09:45");
  await panel.getByTestId("split-first").getByRole("button", { name: /資料作成/ }).click();
  await panel.getByRole("button", { name: "未割り当てのまま続ける" }).click();
  await panel.getByRole("button", { name: "09:45で区切って割り当てる" }).click();

  await expect.poll(async () => (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)?.segments).toEqual([{ start: jstAt("09:45") }]);
  expect((await readAll<Daily>(page, "dailyTasks")).find((t) => t.id === "a")!.accumulatedMs).toBe(45 * 60_000);
});

test("区切る時刻が仮計測の始まりより前・今より後なら、割り当てられない", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [prov(), pending("a", "資料作成", "m1", "業務", 0)] } });
  const panel = await openSplit(page, "08:30");
  await expect(panel).toContainText("09:00より後、今(10:00)より前の時刻にしてください");
  await panel.getByTestId("split-first").getByRole("button", { name: /資料作成/ }).click();
  await panel.getByRole("button", { name: "未割り当てのまま続ける" }).click();
  await expect(panel.getByRole("button", { name: /で区切って割り当てる/ })).toBeDisabled();
});

test("「完了した作業から」: 完了した作業を選び「記録して終える」と、その作業の時間に足して計測をやめる", async ({ page }) => {
  await seed(page, {
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [prov(), doneTask("d", "資料作成", "m1", "業務", "08:00", "08:30")],
      records: [{ id: "r", date: jstDate(), category: "業務", name: "資料作成", masterTaskId: "m1", seconds: 1800, startedAt: jstAt("08:00"), endedAt: jstAt("08:30"), excludedFromStats: false }],
    },
  });
  await page.getByRole("button", { name: "✅ 完了した作業から" }).click();
  await page.getByTestId("provisional-done-list").getByRole("button", { name: "記録して終える" }).click();
  await expect.poll(async () => (await readAll<Rec>(page, "records")).find((r) => r.name === "資料作成")?.seconds ?? 0).toBeGreaterThanOrEqual(1800 + 3600);
  expect((await readAll<Rec>(page, "records")).find((r) => r.name === "資料作成")!.seconds).toBeLessThan(1800 + 3600 + 15);
  const all = await readAll<Daily>(page, "dailyTasks");
  expect(all.some((t) => t.isProvisional || t.status === "running")).toBe(false);
});
