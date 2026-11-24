import { describe, expect, it } from "vitest";
import { computeProjectStageBreakdown } from "./linkedAggregate";
import type { ProjectItem, WorkRecord } from "./types";

const rec = (seconds: number, extra: Partial<WorkRecord>): WorkRecord =>
  ({ id: String(seconds), date: "2026-11-01", category: "c", name: "n", seconds, startedAt: 0, endedAt: 0, excludedFromStats: false, ...extra }) as WorkRecord;

describe("案件の段階別の内訳", () => {
  it("消した段階に付いていた実績は「削除済みの段階」、段階の無い実績は「段階未設定」に分ける", () => {
    const project: ProjectItem = {
      id: "p1",
      title: "案件",
      category: "c",
      workName: "w",
      dueDate: "2026-12-01",
      createdAt: 0,
      stages: [{ id: "s1", title: "設計", completed: false }],
    };
    const rows = computeProjectStageBreakdown(
      [rec(300, { projectId: "p1", stageId: "s1" }), rec(200, { projectId: "p1", stageId: "gone" }), rec(100, { projectId: "p1" })],
      project
    );
    expect(rows.map((r) => [r.title, r.totalSeconds])).toEqual([
      ["設計", 300],
      ["（削除済みの段階）", 200],
      ["（段階未設定）", 100],
    ]);
  });
});
