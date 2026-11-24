import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { completeProjectStage, mergeEditedStages, toggleProjectStage } from "./projectStage";
import { applyProgressPlan, planProgressUpdate, UPDATE_FORMAT } from "./progressSync";
import type { ProjectItem, ProjectStage } from "./types";

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

const st = (id: string, extra: Partial<ProjectStage> = {}): ProjectStage => ({ id, title: id, completed: false, ...extra });
const base = (stages: ProjectStage[]): ProjectItem => ({
  id: "p1",
  title: "案件",
  category: "c",
  workName: "w",
  dueDate: "2026-12-10",
  createdAt: 1000,
  stages,
});

describe("編集画面の段階を最新の段階へ重ねる(mergeEditedStages)", () => {
  it("開いている間に他で付けた完了を、画面で触っていなければ巻き戻さない", () => {
    const original = [st("a"), st("b")];
    const edited = [st("a", { title: "A改" }), st("b")]; // 画面では件名だけ直した
    const fresh = [st("a", { completed: true, completedAt: 5 }), st("b")]; // 他で a を完了
    expect(mergeEditedStages(original, edited, fresh)).toEqual([st("a", { title: "A改", completed: true, completedAt: 5 }), st("b")]);
  });

  it("画面で変えた項目は勝つ。画面で消した段階は消え、足した段階は足され、他で足された段階は後ろに残る", () => {
    const original = [st("a"), st("b"), st("c")];
    const edited = [st("c"), st("a", { completed: true, completedAt: 9 }), st("new")]; // 並べ替え・a完了・b削除・new追加
    const fresh = [st("a", { tag: "客先確認中" }), st("b"), st("c"), st("other")];
    expect(mergeEditedStages(original, edited, fresh)).toEqual([
      st("c"),
      st("a", { tag: "客先確認中", completed: true, completedAt: 9 }),
      st("new"),
      st("other"),
    ]);
  });

  it("他で消された段階は、画面で直していなければ消えたまま。画面で消した項目(undefined)は消す", () => {
    const original = [st("a", { dueDate: "2026-12-01" }), st("gone")];
    const edited = [st("a"), st("gone")];
    const fresh = [st("a", { dueDate: "2026-12-01", completed: true })];
    const merged = mergeEditedStages(original, edited, fresh);
    expect(merged).toEqual([st("a", { completed: true })]);
    expect("dueDate" in merged[0]).toBe(false);
  });
});

describe("段階の切り替えは最新の段階に当てる", () => {
  it("古い写しから切り替えても、他の段階の新しい完了を消さない", async () => {
    const stale = base([st("a"), st("b")]);
    await db.projects.add(base([st("a", { completed: true, completedAt: 3 }), st("b")]));
    await toggleProjectStage(stale, "b");
    const after = (await db.projects.get("p1"))!.stages!;
    expect(after[0]).toMatchObject({ id: "a", completed: true, completedAt: 3 });
    expect(after[1].completed).toBe(true);
  });

  it("古い写しで「未完了」に見えても、最新が完了なら外す方向に切り替える", async () => {
    await db.projects.add(base([st("a", { completed: true, completedAt: 3 })]));
    const r = await toggleProjectStage(base([st("a")]), "a");
    expect(r?.completed).toBe(false);
    expect((await db.projects.get("p1"))!.stages![0].completed).toBe(false);
  });

  it("最後の段階を済ませると「案件も完了にしますか」を出す印を返す", async () => {
    await db.projects.add(base([st("a", { completed: true }), st("b", { targetCount: 2, completedCount: 1 })]));
    const r = await completeProjectStage("p1", "b");
    expect(r).toEqual({ completed: true, offerProjectCompletion: true });
    const b = (await db.projects.get("p1"))!.stages![1];
    expect(b.completedCount).toBe(2);
    expect(b.completed).toBe(false); // 件数管理の段階は completed を立てない
  });

  it("案件が既に完了なら印を返さない", async () => {
    await db.projects.add({ ...base([st("a")]), completedAt: 1 });
    expect(await completeProjectStage("p1", "a")).toEqual({ completed: true, offerProjectCompletion: false });
  });
});

describe("外部AIの進捗の反映", () => {
  it("計画を作ったあとに他で変えた段階を、反映で巻き戻さない", async () => {
    const p = base([st("a"), st("b")]);
    await db.projects.add(p);
    const plan = planProgressUpdate(
      { format: UPDATE_FORMAT, version: 1, operations: [{ op: "updateStage", projectId: "p1", stageId: "a", completed: true }] },
      { projects: [p], todoTasks: [], todoLists: [], tagOptions: [] },
      Date.now()
    );
    // 計画のあとで b を別の画面から完了にした
    await db.projects.update("p1", { stages: [st("a"), st("b", { completed: true, completedAt: 7 })] });
    await applyProgressPlan(plan);
    const after = (await db.projects.get("p1"))!.stages!;
    expect(after[0].completed).toBe(true);
    expect(after[1]).toMatchObject({ completed: true, completedAt: 7 });
  });
});
