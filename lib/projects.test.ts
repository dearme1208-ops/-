import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { deleteProjectCascade, duplicateProject, setProjectCompleted, stageRecordedSeconds } from "./projects";
import { todayStr } from "./time";
import type { ProjectItem, TodoTask, WbsNode, WorkRecord } from "./types";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const project = (p: Partial<ProjectItem> & { id: string }): ProjectItem => ({
  title: p.id,
  category: "c",
  workName: "w",
  dueDate: "2026-12-10",
  createdAt: new Date("2026-11-01T10:00:00").getTime(),
  ...p,
});
const todo = (id: string, extra: Partial<TodoTask> = {}): TodoTask => ({
  id,
  listId: "l",
  title: id,
  important: false,
  completed: false,
  order: 0,
  createdAt: 0,
  ...extra,
});
const node = (id: string, extra: Partial<WbsNode> = {}): WbsNode => ({
  id,
  projectId: "p1",
  order: 0,
  title: id,
  progress: 50,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe("案件の削除(deleteProjectCascade)", () => {
  it("案件・WBS・ToDoの紐づけ・先行案件の参照をまとめて外し、取り消しですべて戻す", async () => {
    await db.projects.bulkAdd([project({ id: "p1" }), project({ id: "p2", predecessorProjectIds: ["p1"] }), project({ id: "p3", predecessorProjectIds: ["p1", "p2"] })]);
    await db.wbsNodes.bulkAdd([node("n1"), node("n2", { parentId: "n1" }), node("other", { projectId: "p2" })]);
    await db.todoTasks.bulkAdd([todo("t1", { projectId: "p1" }), todo("t2")]);

    const del = await deleteProjectCascade("p1");
    expect(del?.project.id).toBe("p1");
    expect(await db.projects.get("p1")).toBeUndefined();
    expect((await db.wbsNodes.toArray()).map((n) => n.id)).toEqual(["other"]);
    expect((await db.todoTasks.get("t1"))!.projectId).toBeUndefined();
    expect((await db.projects.get("p2"))!.predecessorProjectIds).toBeUndefined();
    expect((await db.projects.get("p3"))!.predecessorProjectIds).toEqual(["p2"]);

    await del!.undo();
    expect(await db.projects.get("p1")).toBeTruthy();
    expect((await db.wbsNodes.where("projectId").equals("p1").toArray()).length).toBe(2);
    expect((await db.todoTasks.get("t1"))!.projectId).toBe("p1");
    expect((await db.projects.get("p2"))!.predecessorProjectIds).toEqual(["p1"]);
    expect((await db.projects.get("p3"))!.predecessorProjectIds).toEqual(["p2", "p1"]);
  });

  it("取り消しは、消したあとに別の案件へ付け直したToDoを上書きしない", async () => {
    await db.projects.bulkAdd([project({ id: "p1" }), project({ id: "p2" })]);
    await db.todoTasks.add(todo("t1", { projectId: "p1" }));
    const del = await deleteProjectCascade("p1");
    await db.todoTasks.update("t1", { projectId: "p2" });
    await del!.undo();
    expect((await db.todoTasks.get("t1"))!.projectId).toBe("p2");
  });

  it("無い案件なら null", async () => {
    expect(await deleteProjectCascade("none")).toBeNull();
  });
});

describe("案件の完了(setProjectCompleted)", () => {
  it("完了にして取り消せる。そのあと別に変わっていれば戻さない", async () => {
    await db.projects.add(project({ id: "p1", autoCompletedByImport: true }));
    const r = await setProjectCompleted("p1", true);
    expect((await db.projects.get("p1"))!.completedAt).toBe(r!.completedAt);
    expect((await db.projects.get("p1"))!.autoCompletedByImport).toBe(false);
    await r!.undo();
    expect((await db.projects.get("p1"))!.completedAt).toBeUndefined();

    const r2 = await setProjectCompleted("p1", true);
    await db.projects.update("p1", { completedAt: 123 });
    await r2!.undo();
    expect((await db.projects.get("p1"))!.completedAt).toBe(123);
  });
});

describe("案件の複製(duplicateProject)", () => {
  it("段階・対応状況・URL・取引先を写し、完了状態は写さない。期日は登録日からの日数を保つ", async () => {
    await db.projects.add(
      project({
        id: "p1",
        title: "元",
        tag: "対応中",
        url: "https://e.x",
        clientId: "c1",
        hourlyRate: 3000,
        completedAt: 5,
        dueDate: "2026-11-11", // 登録日(11/1)から10日後
        stages: [
          { id: "s1", title: "設計", completed: true, completedAt: 3, dueDate: "2026-11-05", tag: "社内確認中", imageDataUrl: "data:x" },
          { id: "s2", title: "見積", completed: false, targetCount: 5, completedCount: 4 },
        ],
      })
    );
    await db.wbsNodes.bulkAdd([node("n1", { startDate: "2026-11-02", endDate: "2026-11-03" }), node("n2", { parentId: "n1", predecessorIds: ["n1"] })]);
    const now = new Date("2026-11-24T09:00:00").getTime();
    const copy = (await duplicateProject("p1", { withWbs: true, now }))!;
    expect(copy.id).not.toBe("p1");
    expect(copy).toMatchObject({ title: "元（複製）", tag: "対応中", url: "https://e.x", clientId: "c1", hourlyRate: 3000, createdAt: now });
    expect(copy.completedAt).toBeUndefined();
    expect(todayStr(new Date(copy.createdAt))).toBe("2026-11-24");
    expect(copy.dueDate).toBe("2026-12-04");
    expect(copy.stages!.map((s) => [s.title, s.completed, s.dueDate, s.completedCount, s.tag])).toEqual([
      ["設計", false, "2026-11-28", undefined, "社内確認中"],
      ["見積", false, undefined, 0, undefined],
    ]);
    expect(copy.stages![0].imageDataUrl).toBeUndefined();
    expect(copy.stages![0].id).not.toBe("s1");
    const nodes = await db.wbsNodes.where("projectId").equals(copy.id).toArray();
    expect(nodes).toHaveLength(2);
    const n1 = nodes.find((n) => n.title === "n1")!;
    const n2 = nodes.find((n) => n.title === "n2")!;
    expect(n1).toMatchObject({ startDate: "2026-11-25", endDate: "2026-11-26", progress: 0 });
    expect(n2.parentId).toBe(n1.id);
    expect(n2.predecessorIds).toEqual([n1.id]);
    // 元のWBSはそのまま
    expect((await db.wbsNodes.where("projectId").equals("p1").toArray()).length).toBe(2);
  });

  it("WBSは指定しなければ写さない", async () => {
    await db.projects.add(project({ id: "p1" }));
    await db.wbsNodes.add(node("n1"));
    const copy = (await duplicateProject("p1"))!;
    expect(await db.wbsNodes.where("projectId").equals(copy.id).count()).toBe(0);
  });
});

describe("段階の実績(stageRecordedSeconds)", () => {
  it("その案件のその段階の実績だけを足す(除外した実績も含む)", () => {
    const r = (seconds: number, extra: Partial<WorkRecord>): WorkRecord =>
      ({ id: String(Math.random()), date: "2026-11-01", category: "c", name: "n", seconds, startedAt: 0, endedAt: 0, excludedFromStats: false, ...extra }) as WorkRecord;
    const records = [
      r(3600, { projectId: "p1", stageId: "s1" }),
      r(1800, { projectId: "p1", stageId: "s1", excludedFromStats: true }),
      r(100, { projectId: "p1", stageId: "s2" }),
      r(100, { projectId: "p2", stageId: "s1" }),
    ];
    expect(stageRecordedSeconds(records, "p1", "s1")).toBe(5400);
  });
});
