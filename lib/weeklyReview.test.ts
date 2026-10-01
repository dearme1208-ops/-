import { describe, expect, it } from "vitest";
import { buildWeeklyReviewQueue } from "@/lib/weeklyReview";
import type { ProjectItem, TodoTask } from "@/lib/types";

const todo = (t: Partial<TodoTask>): TodoTask => ({ id: "t", listId: "l1", title: "", important: false, completed: false, order: 0, createdAt: new Date("2026-08-01").getTime(), ...t }) as TodoTask;

describe("週次レビューの対象", () => {
  it("件名だけでは分からないので、リスト名・案件・案件のグループや残りの段階を添える", () => {
    const projects: ProjectItem[] = [
      { id: "p1", title: "ゲーム攻略", groupName: "趣味", category: "私用", workName: "攻略", dueDate: "2026-09-01", createdAt: 0, stages: [{ id: "s1", title: "1~10", completed: true }, { id: "s2", title: "11~20", completed: false }, { id: "s3", title: "21~30", completed: false }] },
    ];
    const queue = buildWeeklyReviewQueue(
      [todo({ id: "t1", title: "42~50", projectId: "p1" })],
      projects,
      "2026-10-01",
      undefined,
      { lists: [{ id: "l1", title: "ゲーム", order: 0, createdAt: 0 }] }
    );
    expect(queue.find((i) => i.id === "t1")).toMatchObject({ title: "42~50", listTitle: "ゲーム", projectTitle: "ゲーム攻略" });
    expect(queue.find((i) => i.id === "p1")).toMatchObject({ groupName: "趣味", openStages: ["11~20", "21~30"] });
  });
});
