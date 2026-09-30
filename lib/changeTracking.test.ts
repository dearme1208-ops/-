import { beforeEach, describe, expect, it } from "vitest";
import { daysInStatus, summarizePostpones, waitingInfo } from "@/lib/changeTracking";
import { db } from "@/lib/db";
import { completeTodoTask } from "@/lib/todo";
import type { ProjectItem, TodoTask } from "@/lib/types";

// 「今まさに作った」項目として扱われるよう、作成時刻は現在時刻にする
const CREATED = Date.now();
const todo = (t: Partial<TodoTask> = {}): TodoTask => ({
  id: "t1",
  listId: "l1",
  title: "見積",
  important: false,
  completed: false,
  order: 0,
  createdAt: CREATED,
  ...t,
});
const project = (p: Partial<ProjectItem> = {}): ProjectItem => ({
  id: "p1",
  title: "案件",
  category: "開発",
  workName: "実装",
  dueDate: "2026-10-10",
  createdAt: CREATED,
  ...p,
});

beforeEach(async () => {
  await Promise.all([db.todoTasks.clear(), db.projects.clear()]);
});

describe("DBへの書き込みから、対応状況の変更日時と期日の変更履歴を記録する", () => {
  it("作成時に対応状況があれば作成時刻を、変えたときはその時刻を記録する。変えなければ動かさない", async () => {
    await db.todoTasks.add(todo({ tag: "客先確認中" }));
    expect((await db.todoTasks.get("t1"))!.tagChangedAt).toBe(CREATED);
    await db.todoTasks.update("t1", { title: "見積(改)" });
    expect((await db.todoTasks.get("t1"))!.tagChangedAt).toBe(CREATED);
    const before = Date.now();
    await db.todoTasks.update("t1", { tag: "社内確認中" });
    expect((await db.todoTasks.get("t1"))!.tagChangedAt).toBeGreaterThanOrEqual(before);
  });

  it("期日の変更は、どの書き方(update/put/modify)でも履歴に残る", async () => {
    await db.todoTasks.add(todo({ dueDate: "2026-10-01" }));
    await db.todoTasks.update("t1", { dueDate: "2026-10-03" });
    await db.todoTasks.put({ ...(await db.todoTasks.get("t1"))!, dueDate: "2026-10-05" });
    await db.todoTasks.where("id").equals("t1").modify((t) => {
      t.dueDate = "2026-10-02";
    });
    const h = (await db.todoTasks.get("t1"))!.dueHistory!;
    expect(h.map((x) => [x.from, x.to])).toEqual([
      ["2026-10-01", "2026-10-03"],
      ["2026-10-03", "2026-10-05"],
      ["2026-10-05", "2026-10-02"],
    ]);
    // 後ろへずらしたのは2回・合計4日(前倒しは数えない)
    expect(summarizePostpones(h)).toEqual({ count: 2, totalDays: 4 });
  });

  it("記録用の項目を持たないデータで丸ごと置き換えても(CSV取り込みなど)、記録は消えない", async () => {
    await db.todoTasks.add(todo({ tag: "客先確認中", dueDate: "2026-10-01" }));
    await db.todoTasks.update("t1", { dueDate: "2026-10-03" });
    await db.todoTasks.put(todo({ tag: "客先確認中", dueDate: "2026-10-03", title: "見積(取り込み)" }));
    const t = (await db.todoTasks.get("t1"))!;
    expect(t.tagChangedAt).toBe(CREATED);
    expect(t.dueHistory).toHaveLength(1);
  });

  it("繰り返しToDoを完了して次の回へ進んだ期日の変更は、延期に数えない", async () => {
    await db.todoTasks.add(todo({ dueDate: "2026-10-01", recurrence: { type: "weekly", interval: 1, weekdays: [3] } as TodoTask["recurrence"] }));
    await db.todoTasks.update("t1", { dueDate: "2026-10-02" }); // 1日延期してから完了
    await completeTodoTask((await db.todoTasks.get("t1"))!, "2026-10-02");
    const t = (await db.todoTasks.get("t1"))!;
    expect(t.dueDate).not.toBe("2026-10-02");
    expect(summarizePostpones(t.dueHistory)).toEqual({ count: 0, totalDays: 0 });
  });

  it("案件の段階は、対応状況を変えた段階だけ変更日時が更新される", async () => {
    await db.projects.add(
      project({
        tag: "社内確認中",
        stages: [
          { id: "s1", title: "設計", completed: false, tag: "客先確認中" },
          { id: "s2", title: "実装", completed: false },
        ],
      })
    );
    const created = (await db.projects.get("p1"))!;
    expect(created.tagChangedAt).toBe(CREATED);
    expect(created.stages![0].tagChangedAt).toBe(CREATED);
    const before = Date.now();
    await db.projects.update("p1", {
      stages: [
        { id: "s1", title: "設計", completed: false, tag: "客先確認中" },
        { id: "s2", title: "実装", completed: false, tag: "社内確認中" },
      ],
      dueDate: "2026-10-15",
    });
    const p = (await db.projects.get("p1"))!;
    expect(p.stages![0].tagChangedAt).toBe(CREATED);
    expect(p.stages![1].tagChangedAt).toBeGreaterThanOrEqual(before);
    expect(summarizePostpones(p.dueHistory)).toEqual({ count: 1, totalDays: 5 });
  });
});

describe("相手待ちの日数", () => {
  const day = (d: string, hm = "10:00") => new Date(`${d}T${hm}:00`).getTime();
  it("その状況になった日を1日目として数え、催促の目安の日数に達したら知らせる", () => {
    expect(daysInStatus(day("2026-10-01", "23:50"), day("2026-10-01", "23:59"))).toBe(1);
    expect(daysInStatus(day("2026-10-01", "23:50"), day("2026-10-02", "00:10"))).toBe(2);
    const tags = ["客先確認中"];
    expect(waitingInfo({ tag: "客先確認中", tagChangedAt: day("2026-10-01") }, tags, 3, day("2026-10-02"))).toEqual({ tag: "客先確認中", days: 2, overdue: false });
    expect(waitingInfo({ tag: "客先確認中", tagChangedAt: day("2026-10-01") }, tags, 3, day("2026-10-03"))!.overdue).toBe(true);
    // 相手待ちでない状況・記録が始まる前から付いていた印
    expect(waitingInfo({ tag: "対応中", tagChangedAt: day("2026-10-01") }, tags, 3, day("2026-10-09"))).toBeNull();
    expect(waitingInfo({ tag: "客先確認中" }, tags, 3, day("2026-10-09"))).toEqual({ tag: "客先確認中", days: null, overdue: false });
  });
});

describe("案件の相手待ち", () => {
  it("段階を持つ案件は、案件自体に残っている対応状況ではなく段階の状況で判定する(画面の表示と揃える)", async () => {
    const { projectWaitingInfo } = await import("@/lib/waiting");
    const now = new Date("2026-10-06T10:00:00").getTime();
    const at = (d: string) => new Date(`${d}T09:00:00`).getTime();
    const p = project({
      tag: "客先確認中",
      tagChangedAt: at("2026-10-01"),
      stages: [{ id: "s1", title: "見積作成", completed: false, tag: "社内確認中", tagChangedAt: at("2026-10-04") }],
    });
    expect(projectWaitingInfo(p, ["客先確認中", "社内確認中"], 3, now)).toMatchObject({ tag: "社内確認中", days: 3, stageTitle: "見積作成" });
    expect(projectWaitingInfo({ ...p, stages: [] }, ["客先確認中"], 3, now)).toMatchObject({ tag: "客先確認中", days: 6 });
  });
});
