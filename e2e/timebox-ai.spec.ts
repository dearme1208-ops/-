import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readOne, seed } from "./helpers";

// 時間割をClaudeに組んでもらう: 依頼文(作業・所要時間・期日・休憩帯)をコピーし、返ってきた時間割を確認して反映する

type Daily = { scheduledTime?: string; timeboxEnd?: string; order: number };

test("時間割の画面から依頼文をコピーし、Claudeの答えを貼ると時間割が入って、帯に出る", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.clock.install({ time: jstAt("08:30") });
  await seed(page, {
    settings: { "today.provisionalBreakRanges": JSON.stringify([{ start: "12:00", end: "13:00" }]) },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [
        dailyTask({ id: "a", date: jstDate(), order: 0, name: "資料作成" }),
        dailyTask({ id: "b", date: jstDate(), order: 1, name: "メール返信", estimatedSeconds: 1200, hasPlan: true }),
        dailyTask({ id: "cal", date: jstDate(), order: 2, name: "定例会議", scheduledTime: "13:00" }),
      ],
    },
  });
  await page.getByRole("button", { name: /^(⏱ 時間割|時間割を作る)$/ }).click();
  await page.getByRole("button", { name: /^今日/ }).click();
  await page.getByText("🤖 Claudeに組んでもらう").click();
  await page.getByRole("button", { name: /依頼文をコピー/ }).click();
  await expect(page.getByText("コピーしました。")).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("時間割(タイムボックス)を組むアシスタント");
  expect(prompt).toContain('"taskId": "a"');
  expect(prompt).toContain('"plannedMinutes": 20');
  expect(prompt).toContain('"label": "定例会議"');
  expect(prompt).toContain('"start": "12:00"');

  const reply = [
    "- 午前の早いうちに資料作成、メールは後ろにまとめます。",
    "```json",
    JSON.stringify({
      format: "koutei-progress-update",
      version: 1,
      operations: [
        {
          op: "planTimebox",
          date: jstDate(),
          slots: [
            { taskId: "a", start: "09:00", end: "09:45" },
            { taskId: "b", start: "11:30", end: "11:50" },
          ],
        },
      ],
    }),
    "```",
  ].join("\n");
  const ai = page.getByTestId("timebox-ai");
  await ai.getByLabel("進捗の更新").fill(reply);
  await ai.getByRole("button", { name: "内容を確認" }).click();
  await expect(ai.getByTestId("sync-op-ok")).toContainText("09:00〜09:45 業務 / 資料作成");
  await ai.getByRole("button", { name: "1件を反映する" }).click();
  await expect.poll(async () => (await readOne<Daily>(page, "dailyTasks", "a"))?.timeboxEnd).toBe("09:45");
  expect(await readOne<Daily>(page, "dailyTasks", "b")).toMatchObject({ scheduledTime: "11:30", timeboxEnd: "11:50" });
  // 時刻だけのカレンダー予定には触れない
  expect(await readOne<Daily>(page, "dailyTasks", "cal")).toMatchObject({ scheduledTime: "13:00" });

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("timebox-band")).toContainText("次の枠 09:00");
});
