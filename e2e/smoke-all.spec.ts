import { expect, test, type Page } from "@playwright/test";
import { MASTER, dailyTask, jstAt, jstDate, seed } from "./helpers";

// 全ての見た目モード × 全てのタブを実データ入りで開き、画面が落ちたりエラーが出たりしないかを
// 総当たりで確かめる。個々の操作の正しさは他のテストで見るので、ここでは「開けること」だけを見る

const MODES = [
  "off",
  "lobotomy",
  "va11halla",
  "persona5",
  "natsuyasumi",
  "claude",
  "zen",
  "terminal",
  "adventurer",
  "hub",
  "library",
  "powerpro",
  "hayarigami",
  "mountain",
  "origin",
  "home",
];

function sampleData() {
  const d = jstDate();
  const records = [];
  for (let i = 0; i < 40; i++) {
    const date = jstDate(-i);
    records.push({
      id: `r${i}`,
      date,
      category: i % 3 === 0 ? "開発" : "業務",
      name: i % 2 ? "資料作成" : "会議",
      masterTaskId: "m1",
      seconds: 1800 + i * 60,
      startedAt: jstAt("09:00", -i),
      endedAt: jstAt("09:30", -i),
      projectId: i % 4 === 0 ? "p1" : undefined,
      stageId: i % 4 === 0 ? "s1" : undefined,
      method: i % 5 === 0 ? "電話" : undefined,
    });
  }
  return {
    masterTasks: [MASTER, { ...MASTER, id: "m2", name: "会議", isFavorite: true }],
    records,
    dailyTasks: [
      dailyTask({ id: "d1", date: d, status: "running", segments: [{ start: jstAt("09:30") }], startedAt: jstAt("09:30"), projectId: "p1", stageId: "s1" }),
      dailyTask({ id: "d2", date: d, order: 1, name: "会議", masterTaskId: "m2", status: "paused", segments: [{ start: jstAt("09:00"), end: jstAt("09:20") }], accumulatedMs: 20 * 60000, stoppedAt: jstAt("09:20") }),
      dailyTask({ id: "d3", date: d, order: 2, status: "done", segments: [{ start: jstAt("08:30"), end: jstAt("09:00") }], accumulatedMs: 30 * 60000, startedAt: jstAt("08:30"), endedAt: jstAt("09:00"), stoppedAt: jstAt("09:00") }),
      dailyTask({ id: "d4", date: d, order: 3, name: "日報", scheduledTime: "17:00", todoTaskId: "t1" }),
    ],
    projects: [
      { id: "p1", title: "新機能開発", category: "開発", workName: "実装", dueDate: jstDate(3), createdAt: 0, stages: [{ id: "s1", title: "設計", completed: false }, { id: "s2", title: "実装", completed: false }] },
      { id: "p2", title: "期限切れ案件", category: "業務", workName: "調整", dueDate: jstDate(-2), createdAt: 0 },
    ],
    todoLists: [{ id: "l1", title: "タスク", order: 0, createdAt: 0 }],
    todoTasks: [
      { id: "t1", listId: "l1", title: "請求書送付", important: true, completed: false, order: 0, createdAt: 0, dueDate: jstDate(-1) },
      { id: "t2", listId: "l1", title: "見積回答", important: false, completed: true, order: 1, createdAt: 0, completedAt: jstAt("08:00") },
    ],
    conditionLogs: [{ id: "c1", date: d, time: "09:00", loggedAt: jstAt("09:00"), level: "4" }],
    memoBoards: [{ id: "b1", title: "メモ", order: 0, createdAt: 0 }],
    memoNotes: [{ id: "n1", boardId: "b1", x: 10, y: 10, width: 200, height: 150, color: "yellow", text: "付箋テキスト", order: 0 }],
    templateItems: [{ id: "tp1", weekday: 1, order: 0, category: "定例", name: "朝会", estimatedSeconds: 900 }],
  };
}

async function tabLabels(page: Page): Promise<string[]> {
  return page.locator(".tab-chip").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
}

for (const mode of MODES) {
  test(`見た目モード「${mode}」で全タブを開いてもエラーが出ない`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      // 外部通信(天気・フォント等)の失敗はテスト環境の都合なので除く
      if (/Failed to load resource|net::ERR|fonts\.g/.test(t)) return;
      errors.push(`console: ${t}`);
    });
    await page.clock.install({ time: jstAt("10:00") });
    await seed(page, {
      settings: { "theme.visualMode": mode, "powerpro.mainMenu": "false" },
      stores: sampleData(),
    });
    if (errors.length) errors.push("  ↑ 最初の表示");
    const open = async (locator: import("@playwright/test").Locator, label: string) => {
      const before = errors.length;
      await locator.click();
      await page.waitForTimeout(400);
      // 画面全体が落ちると(Next.jsのエラー画面)タブ列が消える
      await expect(page.locator(".tab-chip").first(), `タブ「${label}」を開いたら画面が落ちた`).toBeVisible();
      if (errors.length > before) errors.push(`  ↑ タブ「${label}」`);
    };
    if ((await page.locator("[data-grouped-tabs]").count()) > 0) {
      // タブを分類ごとの2段にまとめている場合(森モード): 分類を順に開き、その中のタブを全部開く
      const groups = page.locator(".tab-nav-groups .tab-chip");
      const groupLabels = await groups.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
      expect(groupLabels.length).toBeGreaterThan(0);
      let opened = 0;
      for (let g = 0; g < groupLabels.length; g++) {
        await open(groups.nth(g), groupLabels[g]);
        const subs = page.locator(".tab-nav-sub .tab-chip");
        const subLabels = await subs.evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
        opened += Math.max(1, subLabels.length);
        for (let i = 0; i < subLabels.length; i++) await open(subs.nth(i), `${groupLabels[g]} › ${subLabels[i]}`);
      }
      // 1列表示のときと同じ数のタブを、2段表示でも取りこぼさず開けていること
      expect(opened).toBe(21);
    } else {
      const labels = await tabLabels(page);
      expect(labels.length).toBeGreaterThan(0);
      for (let i = 0; i < labels.length; i++) await open(page.locator(".tab-chip").nth(i), labels[i]);
    }
    expect(errors).toEqual([]);
  });
}
