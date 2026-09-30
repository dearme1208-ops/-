import { expect, test } from "@playwright/test";
import { MASTER, clickButton, dailyTask, jstAt, jstDate, readAll, seed } from "./helpers";

// 止め忘れた作業を「時刻を指定して終了」したとき、指定した終了時刻から今までの間が
// 「未計測」とみなされて長時間の仮計測が始まってしまわないか

type Daily = { id: string; status: string; isProvisional?: boolean; segments: { start: number }[] };

test("時刻を指定して終了しても、指定した時刻から今までの長い仮計測は始まらない", async ({ page }) => {
  await page.clock.install({ time: jstAt("12:00") });
  await seed(page, {
    settings: { "today.provisionalEnabled": "true", "today.untrackedThresholdMinutes": "5", "today.taskViewTab": "running" },
    stores: {
      masterTasks: [{ ...MASTER, estimatedSeconds: 6 * 3600 }],
      dailyTasks: [dailyTask({ id: "d1", date: jstDate(), estimatedSeconds: 6 * 3600, status: "running", segments: [{ start: jstAt("09:00") }], startedAt: jstAt("09:00") })],
    },
  });
  await clickButton(page, "時刻を指定して終了");
  await page.locator(".modal-scrim input[type=time]").first().fill("10:00");
  await clickButton(page, "この時刻で終了");
  await page.waitForTimeout(1500);
  // 終了操作の直後: 10:00〜12:00を未計測とみなした仮計測は始まらない
  expect((await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)).toBeUndefined();

  // 未計測の判定自体は生きている: 終了操作(12:00)からしきい値(5分)を超えたら、12:00起点で始まる
  await page.clock.fastForward("05:30");
  await expect.poll(async () => !!(await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)).toBe(true);
  const start = (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)!.segments[0].start;
  // 終了操作をした時刻(12:00過ぎ、テストの操作分だけ数秒進む)
  expect(start - jstAt("12:00")).toBeGreaterThanOrEqual(0);
  expect(start - jstAt("12:00")).toBeLessThan(60_000);
});
