import { expect, test, type Page } from "@playwright/test";
import { MASTER, dailyTask, jstDate, jstAt, seed } from "./helpers";

// 計測中の作業の通知(components/RunningNotifier.tsx)。アプリを閉じている間だけ出し、
// 計測を終えた・止めたら、どの経路でも通知が残らないことを確かめる。
// テスト用のブラウザは通知を実際には出さないので、Service Workerの通知の出し入れを
// 「出すのに少し時間がかかる」偽物に差し替えて、出す途中に消す合図が来る場合まで再現する

type Note = { title: string; tag?: string };
declare global {
  interface Window {
    __notes: Note[];
  }
}

const fakeRegistration = () => {
  window.__notes = [];
  // テスト用のブラウザでは通知の許可が「拒否」のままになるので、許可済みとして扱う
  Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
  const reg = {
    showNotification: async (title: string, opts: { tag?: string }) => {
      await new Promise((r) => setTimeout(r, 150));
      window.__notes = window.__notes.filter((n) => n.tag !== opts.tag);
      window.__notes.push({ title, tag: opts.tag });
    },
    getNotifications: async ({ tag }: { tag?: string } = {}) =>
      window.__notes
        .filter((n) => !tag || n.tag === tag)
        .map((n) => ({ ...n, close: () => (window.__notes = window.__notes.filter((x) => x !== n)) })),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => reg, register: async () => reg, addEventListener() {}, removeEventListener() {}, ready: Promise.resolve(reg) },
  });
};

const notes = (page: Page) => page.evaluate(() => window.__notes.filter((n) => n.tag === "koutei-running").map((n) => n.title));
const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
const running = () => dailyTask({ id: "a", date: jstDate(), name: "資料作成", status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30") });

test.beforeEach(async ({ page }) => {
  // 実際の時刻だと計測が長くなりすぎて「まだこの作業中ですか?」の確認が出るので、時計を合わせる
  await page.clock.install({ time: jstAt("09:40") });
  await page.addInitScript(fakeRegistration);
});

test("アプリを閉じている間だけ「計測中」の通知を出し、裏に回ったまま終えても消える", async ({ page }) => {
  await seed(page, { settings: { "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
  expect(await notes(page)).toEqual([]);
  await setVisibility(page, "hidden");
  await expect.poll(() => notes(page)).toEqual(["計測中：資料作成"]);
  await page.getByRole("button", { name: "終了", exact: true }).first().click();
  await expect.poll(() => notes(page)).toEqual([]);
  await page.waitForTimeout(500);
  expect(await notes(page)).toEqual([]);
});

test("出している途中で前に戻っても、「計測中」の通知が残らない", async ({ page }) => {
  await seed(page, { stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
  await setVisibility(page, "hidden");
  await setVisibility(page, "visible");
  await page.waitForTimeout(600);
  expect(await notes(page)).toEqual([]);
});

test("一時停止しても通知は消える", async ({ page }) => {
  await seed(page, { settings: { "today.taskViewTab": "running" }, stores: { masterTasks: [MASTER], dailyTasks: [running()] } });
  await setVisibility(page, "hidden");
  await expect.poll(() => notes(page)).toEqual(["計測中：資料作成"]);
  await page.getByRole("button", { name: "一時停止" }).first().click();
  await expect.poll(() => notes(page)).toEqual([]);
});
