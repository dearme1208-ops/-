import { describe, expect, it } from "vitest";
import { buildTimeboxRequest, timeboxPrompt } from "@/lib/aiPrompts";
import type { DailyTask, MasterTask, ProjectItem, WorkRecord } from "@/lib/types";

const D = "2026-10-03";
const daily = (id: string, o: Partial<DailyTask> = {}): DailyTask =>
  ({ id, date: D, order: 0, category: "営業", name: id, estimatedSeconds: 0, status: "pending", segments: [], accumulatedMs: 0, isSpontaneous: true, ...o }) as DailyTask;

describe("時間割の相談データと依頼文", () => {
  it("作業ごとに過去の所要時間・期日・進み具合を付け、時刻だけの予定は動かせない予定として渡す", () => {
    const master: MasterTask = { id: "m1", category: "営業", name: "見積作成", estimatedSeconds: 45 * 60, isFavorite: false, sampleCount: 3, createdAt: 0, updatedAt: 0 } as MasterTask;
    const project: ProjectItem = {
      id: "p1",
      title: "A社見積",
      category: "営業",
      workName: "見積",
      dueDate: "2026-10-05",
      createdAt: new Date("2026-09-01T09:00:00").getTime(),
      stages: [
        { id: "s1", title: "見積作成", completed: false, dueDate: "2026-10-04" },
        { id: "s2", title: "提出", completed: false },
      ],
    };
    const req = buildTimeboxRequest({
      date: D,
      now: new Date(`${D}T08:40:00`),
      dailyTasks: [
        daily("a", { name: "見積作成", projectId: "p1", stageId: "s1", masterTaskId: "m1", order: 0, accumulatedMs: 10 * 60000 }),
        daily("b", { name: "メール返信", order: 1, estimatedSeconds: 20 * 60 }),
        daily("cal", { name: "定例会議", scheduledTime: "13:00", order: 2 }),
        daily("done", { status: "done", order: 3 }),
        daily("明日", { date: "2026-10-04" }),
      ],
      masterTasks: [master],
      records: [] as WorkRecord[],
      projects: [project],
      todoTasks: [],
      breaks: [{ start: "12:00", end: "13:00" }],
      workStart: "09:00",
      workEnd: "18:00",
      gapMinutes: 5,
    });
    expect(req.nowTime).toBe("08:40");
    expect(req.fixedEvents).toEqual([{ label: "定例会議", start: "13:00" }]);
    expect(req.tasks.map((t) => t.taskId)).toEqual(["a", "b"]);
    expect(req.tasks[0]).toMatchObject({ label: "A社見積 › 見積作成", typicalMinutes: 45, spentMinutes: 10, dueDate: "2026-10-04", progressStatus: "遅れ気味" });
    expect(req.tasks[1]).toMatchObject({ plannedMinutes: 20, status: "未着手" });

    const prompt = timeboxPrompt(req);
    expect(prompt).toContain('"op": "planTimebox"');
    expect(prompt).toContain("今は 08:40 です");
    expect(prompt).toContain('"taskId": "a"');
  });
});
