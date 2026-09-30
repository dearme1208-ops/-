import { describe, expect, it } from "vitest";
import {
  buildProjectFromTemplate,
  collectRetrospectives,
  plannedDurationDays,
  projectReferenceTime,
  similarCompletedProjects,
  stageReferenceTimes,
} from "@/lib/projectTemplate";
import type { ProjectItem, WorkRecord } from "@/lib/types";

const H = 3600;
const project = (p: Partial<ProjectItem>): ProjectItem => ({
  id: "p",
  title: "案件",
  category: "営業",
  workName: "見積",
  dueDate: "2026-10-10",
  createdAt: new Date("2026-10-01T09:00:00").getTime(),
  ...p,
});
const rec = (projectId: string, seconds: number, stageId?: string, extra: Partial<WorkRecord> = {}): WorkRecord =>
  ({ id: `${projectId}-${stageId}-${seconds}`, date: "2026-10-02", category: "営業", name: "見積", seconds, startedAt: 0, endedAt: 0, projectId, stageId, ...extra }) as WorkRecord;

const a = project({
  id: "a",
  title: "A社見積",
  completedAt: 10,
  retrospective: "先方の担当が2人いるので両方にCCする",
  stages: [
    { id: "a1", title: "ヒアリング", completed: true },
    { id: "a2", title: "見積作成", completed: true, targetCount: 5, completedCount: 5 },
  ],
});
const b = project({
  id: "b",
  title: "B社見積",
  completedAt: 20,
  stages: [
    { id: "b1", title: "ヒアリング", completed: true },
    { id: "b2", title: "見積作成", completed: true },
  ],
});
const others = [
  project({ id: "c", workName: "単価改定", completedAt: 30 }),
  project({ id: "d", title: "取り込みで消えた", completedAt: 40, autoCompletedByImport: true }),
  project({ id: "e", title: "未完了" }),
];
const records = [
  rec("a", 2 * H, "a1"),
  rec("a", 4 * H, "a2"),
  rec("b", 1 * H, "b1"),
  rec("b", 6 * H, "b2"),
  rec("b", 1 * H, "b2", { excludedFromStats: true }),
  rec("d", 99 * H),
];

describe("終わった案件を型にする", () => {
  it("同じ種類(業務区分・詳細作業名)の、実際に完了した案件だけを参考にする", () => {
    expect(similarCompletedProjects(a, [a, b, ...others]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("段階ごと・案件全体の参考時間は、同じ種類の案件の実績の平均(段階は名前で対応させる)", () => {
    const similar = [a, b];
    const stages = stageReferenceTimes(similar, records);
    expect(stages.get("ヒアリング")).toEqual({ avgSeconds: 1.5 * H, samples: 2 });
    expect(stages.get("見積作成")).toEqual({ avgSeconds: 5 * H, samples: 2 });
    expect(projectReferenceTime(similar, records)).toEqual({ avgSeconds: 6.5 * H, samples: 2 });
    expect(projectReferenceTime([others[0]], records)).toBeNull();
  });

  it("新しい案件には種類と段階の構成・参考時間だけを引き継ぎ、進捗や期日は引き継がない", () => {
    let n = 0;
    const similar = [a, b];
    const built = buildProjectFromTemplate(a, {
      title: "C社見積",
      dueDate: "2026-11-20",
      now: 123,
      newId: () => `new${++n}`,
      stageRefs: stageReferenceTimes(similar, records),
      totalRef: projectReferenceTime(similar, records),
    });
    expect(built).toMatchObject({
      title: "C社見積",
      category: "営業",
      workName: "見積",
      dueDate: "2026-11-20",
      createdAt: 123,
      estimatedTotalSeconds: 6.5 * H,
      templateFromId: "a",
    });
    expect(built.completedAt).toBeUndefined();
    expect(built.retrospective).toBeUndefined();
    expect(built.stages).toEqual([
      { id: "new1", title: "ヒアリング", completed: false, referenceSeconds: 1.5 * H },
      { id: "new2", title: "見積作成", completed: false, targetCount: 5, completedCount: 0, referenceSeconds: 5 * H },
    ]);
  });

  it("振り返りは同じ種類の案件のものを新しい順に集め、期日の初期値は元の案件の期間から決める", () => {
    expect(collectRetrospectives([b, a]).map((r) => r.text)).toEqual(["先方の担当が2人いるので両方にCCする"]);
    expect(plannedDurationDays(a)).toBe(9);
  });
});
