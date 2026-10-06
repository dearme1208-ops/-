import { describe, expect, it } from "vitest";
import { buildWeeklySummary, mondayOf, summaryWeek } from "./weeklySummary";
import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";

const rec = (name: string, date: string, seconds: number): WorkRecord => ({ id: name + date, date, category: "業務", name, masterTaskId: "m", seconds, startedAt: 0, endedAt: 0, excludedFromStats: false });

describe("今週のまとめ", () => {
  it("金〜日は今週、月曜は先週、それ以外は出さない", () => {
    expect(mondayOf("2026-10-09")).toBe("2026-10-05");
    expect(summaryWeek("2026-10-09")).toEqual({ weekStart: "2026-10-05", label: "今週" }); // 金
    expect(summaryWeek("2026-10-12")).toEqual({ weekStart: "2026-10-05", label: "先週" }); // 月
    expect(summaryWeek("2026-10-07")).toBeNull(); // 水
  });

  it("時間の多い作業・長引いた作業・終えたもの・来週の期日を集める", () => {
    const at = (d: string) => new Date(`${d}T12:00:00`).getTime();
    const s = buildWeeklySummary("2026-10-05", "今週", {
      records: [rec("資料作成", "2026-10-05", 3600), rec("資料作成", "2026-10-06", 1800), rec("電話", "2026-10-07", 600), rec("先週分", "2026-10-02", 9999)],
      dailyTasks: [
        { id: "d", date: "2026-10-06", order: 0, category: "業務", name: "資料作成", estimatedSeconds: 1800, status: "done", segments: [], accumulatedMs: 3600_000, isSpontaneous: true } as DailyTask,
      ],
      todos: [
        { id: "t1", listId: "l", title: "請求書", completed: true, completedAt: at("2026-10-08"), important: false, order: 0, createdAt: 0 },
        { id: "t2", listId: "l", title: "来週の会議準備", completed: false, important: false, order: 1, createdAt: 0, dueDate: "2026-10-13" },
      ] as TodoTask[],
      projects: [{ id: "p", title: "B社提案", dueDate: "2026-10-15", createdAt: 0 }] as ProjectItem[],
    });
    expect(s.totalSeconds).toBe(6000);
    expect(s.topWorks[0]).toEqual({ label: "業務 / 資料作成", seconds: 5400 });
    expect(s.overruns).toEqual([{ label: "資料作成", overSeconds: 1800 }]);
    expect(s.doneTodos).toEqual(["請求書"]);
    expect(s.upcoming.map((u) => u.title)).toEqual(["来週の会議準備", "B社提案"]);
  });
});
