import { expect, test } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, readAll, seed } from "./helpers";

// 不具合の再現: PCを開いたまま放置すると、「未計測の自動計測」が直前の停止時刻から仮計測を始め、
// 「放置検知」がそれを最後の操作時刻(=仮計測の始まり)で打ち切って長さ0の完了にし、
// また仮計測が始まる…を繰り返し、「仮計測中 15:10〜15:10 00:00:00」の完了が何百件もできていた

type Daily = { name: string; status: string; isProvisional?: boolean; accumulatedMs: number };
type Rec = { name: string; seconds: number };

test("放置しても、長さ0の「仮計測中」の完了が繰り返し作られない", async ({ page }) => {
  await page.clock.install({ time: jstAt("15:10") });
  await seed(page, {
    settings: { "today.provisionalEnabled": "true", "today.untrackedThresholdMinutes": "5", "today.provisionalIdleThresholdHours": "0.5" },
    stores: {
      masterTasks: [MASTER],
      dailyTasks: [dailyTask({ id: "a", date: jstDate(), status: "done", segments: [{ start: jstAt("14:40"), end: jstAt("15:10") }], accumulatedMs: 30 * 60_000, startedAt: jstAt("14:40"), endedAt: jstAt("15:10"), stoppedAt: jstAt("15:10") })],
    },
  });
  // 操作しないまま1時間半たつ
  for (let i = 0; i < 9; i++) {
    await page.clock.fastForward("10:00");
    await page.waitForTimeout(300);
  }
  const all = await readAll<Daily>(page, "dailyTasks");
  const zeroDone = all.filter((t) => t.name === "仮計測中" && t.status === "done" && t.accumulatedMs === 0);
  expect(zeroDone).toHaveLength(0);
  expect((await readAll<Rec>(page, "records")).filter((r) => r.name === "仮計測中" && r.seconds === 0)).toHaveLength(0);
});

test("前の不具合で残った長さ0の「仮計測中」の完了は、開いた時に片付ける(長さのある仮計測の完了は残す)", async ({ page }) => {
  await page.clock.install({ time: jstAt("22:28") });
  const zero = (id: string) =>
    dailyTask({ id, date: jstDate(), status: "done", category: "未分類", name: "仮計測中", masterTaskId: "mp", segments: [{ start: jstAt("15:10"), end: jstAt("15:10") }], accumulatedMs: 0, startedAt: jstAt("15:10"), endedAt: jstAt("15:10") });
  await seed(page, {
    stores: {
      masterTasks: [MASTER, { ...MASTER, id: "mp", category: "未分類", name: "仮計測中" }],
      dailyTasks: [
        zero("z1"),
        zero("z2"),
        zero("z3"),
        dailyTask({ id: "real", date: jstDate(), status: "done", category: "未分類", name: "仮計測中", masterTaskId: "mp", segments: [{ start: jstAt("12:00"), end: jstAt("12:20") }], accumulatedMs: 20 * 60_000, startedAt: jstAt("12:00"), endedAt: jstAt("12:20") }),
      ],
      records: [
        { id: "r0", date: jstDate(-1), category: "未分類", name: "仮計測中", masterTaskId: "mp", seconds: 0, startedAt: jstAt("15:10", -1), endedAt: jstAt("15:10", -1), excludedFromStats: false },
        { id: "r1", date: jstDate(), category: "未分類", name: "仮計測中", masterTaskId: "mp", seconds: 1200, startedAt: jstAt("12:00"), endedAt: jstAt("15:10"), excludedFromStats: false },
      ],
    },
  });
  await expect.poll(async () => (await readAll<{ id: string }>(page, "dailyTasks")).map((t) => t.id)).toEqual(["real"]);
  expect((await readAll<{ id: string }>(page, "records")).map((r) => r.id)).toEqual(["r1"]);
});
