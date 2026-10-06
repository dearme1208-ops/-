import { expect, test } from "@playwright/test";
import { MASTER, MIN, clickButton, dailyTask, jstAt, jstDate, readAll, seed } from "./helpers";

// 止め忘れた作業を「時刻を指定して終了」すると、指定した終了時刻から今までが未計測として
// 仮計測になる(これは意図どおり)。ただし、その間に別の作業を計測していた場合は、
// その分まで仮計測に含めてはいけない(二重に数えることになり、仮計測が異常に長く見える)

type Daily = { id: string; status: string; isProvisional?: boolean; segments: { start: number; end?: number }[] };

const settings = { "today.provisionalEnabled": "true", "today.untrackedThresholdMinutes": "5", "today.taskViewTab": "running" };
const longMaster = { ...MASTER, estimatedSeconds: 6 * 3600 };
const forgotten = () =>
  dailyTask({ id: "a", date: jstDate(), estimatedSeconds: 6 * 3600, status: "running", segments: [{ start: jstAt("09:00") }], startedAt: jstAt("09:00") });

async function finishForgottenAt(page: import("@playwright/test").Page, hm: string) {
  await clickButton(page, "⏪ 少し前に終わってた");
  await clickButton(page, "🕐 時刻を指定…");
  await page.locator(".modal-scrim input[type=time]").first().fill(hm);
  await clickButton(page, "この時刻で終了");
}
const provisionalStart = async (page: import("@playwright/test").Page) => {
  await expect.poll(async () => !!(await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)).toBe(true);
  return (await readAll<Daily>(page, "dailyTasks")).find((t) => t.isProvisional)!.segments[0].start;
};

test("指定した終了時刻から今までの仮計測が始まる(ほかに計測が無い場合)", async ({ page }) => {
  await page.clock.install({ time: jstAt("12:00") });
  await seed(page, { settings, stores: { masterTasks: [longMaster], dailyTasks: [forgotten()] } });
  await finishForgottenAt(page, "10:00");
  expect(await provisionalStart(page)).toBe(jstAt("10:00"));
});

test("その間に別の作業を計測していた場合、仮計測はその作業が終わった時刻から始まる", async ({ page }) => {
  await page.clock.install({ time: jstAt("12:00") });
  await seed(page, {
    settings,
    stores: {
      masterTasks: [longMaster],
      dailyTasks: [
        forgotten(),
        dailyTask({ id: "b", order: 1, date: jstDate(), name: "会議", status: "done", segments: [{ start: jstAt("10:30"), end: jstAt("11:30") }], accumulatedMs: 60 * MIN, startedAt: jstAt("10:30"), endedAt: jstAt("11:30"), stoppedAt: jstAt("11:30") }),
      ],
    },
  });
  await finishForgottenAt(page, "10:00");
  expect(await provisionalStart(page)).toBe(jstAt("11:30"));
});
