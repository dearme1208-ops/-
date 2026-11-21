import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  completeTodoTask,
  computeDateOrderedPosition,
  computeNextDueDate,
  fillRecurrenceDefaults,
  upsertTodoFromCsv,
} from "./todo";
import { incompletePreviousStageTitles } from "./projectStage";
import { collectFrequentlyPostponed, collectWaitingItems, projectWaitingInfo } from "./waiting";
import type { ProjectItem, RecurrenceRule, TodoTask } from "./types";

function todo(overrides: Partial<TodoTask> = {}): TodoTask {
  return {
    id: overrides.id ?? `t-${Math.random()}`,
    listId: "L",
    title: "タスク",
    important: false,
    completed: false,
    order: 0,
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  await db.todoTasks.clear();
  await db.todoLists.clear();
});

describe("繰り返しの省略項目を補う(fillRecurrenceDefaults)", () => {
  // 2026-11-21 は土曜で、11月の第3土曜
  const BASE = "2026-11-21";

  it("毎月(日付): 日が未設定なら基準日の日付", () => {
    expect(fillRecurrenceDefaults({ type: "monthlyDate", interval: 1 }, BASE)).toEqual({ type: "monthlyDate", interval: 1, day: 21 });
    // 月末(-1)・明示した日付はそのまま
    expect(fillRecurrenceDefaults({ type: "monthlyDate", interval: 2, day: -1 }, BASE).day).toBe(-1);
    expect(fillRecurrenceDefaults({ type: "monthlyDate", interval: 2, day: 5 }, BASE).day).toBe(5);
  });

  it("毎月(曜日): 曜日と第N回を基準日から決める。5回目は最終扱い", () => {
    expect(fillRecurrenceDefaults({ type: "monthlyWeekday", interval: 1 }, BASE)).toEqual({
      type: "monthlyWeekday",
      interval: 1,
      weekday: 6,
      ordinal: 3,
    });
    // 2026-11-30 は第5月曜
    expect(fillRecurrenceDefaults({ type: "monthlyWeekday", interval: 1 }, "2026-11-30")).toMatchObject({ weekday: 1, ordinal: -1 });
    expect(fillRecurrenceDefaults({ type: "monthlyWeekday", interval: 1, weekday: 5, ordinal: 4 }, BASE)).toMatchObject({ weekday: 5, ordinal: 4 });
  });

  it("毎年: 月日を基準日から決め、他の種類から残った項目(day:-1 など)は落とす", () => {
    const stale: RecurrenceRule = { type: "yearly", interval: 1, day: -1, weekdays: [1], weekday: 2, ordinal: 2 };
    expect(fillRecurrenceDefaults(stale, BASE)).toEqual({ type: "yearly", interval: 1, month: 11, day: 21 });
    expect(fillRecurrenceDefaults({ type: "yearly", interval: 1, month: 3, day: 15 }, BASE)).toEqual({ type: "yearly", interval: 1, month: 3, day: 15 });
  });

  it("毎週: 曜日が空なら基準日の曜日。毎日は間隔だけ", () => {
    expect(fillRecurrenceDefaults({ type: "weekly", interval: 1, weekdays: [] }, BASE)).toEqual({ type: "weekly", interval: 1, weekdays: [6] });
    expect(fillRecurrenceDefaults({ type: "weekly", interval: 1, weekdays: [3, 1] }, BASE).weekdays).toEqual([1, 3]);
    expect(fillRecurrenceDefaults({ type: "daily", interval: 0, day: 3 }, BASE)).toEqual({ type: "daily", interval: 1 });
  });

  it("補った後のルールで計算しても、補う前と同じ次回期日になる(表示=保存=計算)", () => {
    const rules: RecurrenceRule[] = [
      { type: "daily", interval: 3 },
      { type: "weekly", interval: 2 },
      { type: "monthlyDate", interval: 1 },
      { type: "monthlyWeekday", interval: 1 },
      { type: "yearly", interval: 1 },
    ];
    for (const r of rules) {
      expect(computeNextDueDate(fillRecurrenceDefaults(r, BASE), BASE)).toBe(computeNextDueDate(r, BASE));
    }
  });

  it("毎年に切り替えた時に残った day:-1 で次回期日が壊れない", () => {
    expect(computeNextDueDate({ type: "yearly", interval: 1, month: 3, day: -1 }, "2026-03-31")).toBe("2027-03-31");
  });

  it("毎月(曜日)で第N回が未設定でも、基準日と同じ回の曜日に進む", () => {
    // 11月の第3土曜 → 12月の第3土曜(12/19)
    expect(computeNextDueDate({ type: "monthlyWeekday", interval: 1 }, BASE)).toBe("2026-12-19");
  });
});

describe("毎週の繰り返し(複数曜日・N週ごと)", () => {
  it("2週ごとの月・水: 同じ週の水曜を飛ばさず、週をまたぐ時だけ1週空ける", () => {
    const rule: RecurrenceRule = { type: "weekly", interval: 2, weekdays: [1, 3] };
    let d = "2026-11-23"; // 月曜
    const seq = [d];
    for (let i = 0; i < 4; i++) {
      d = computeNextDueDate(rule, d);
      seq.push(d);
    }
    expect(seq).toEqual(["2026-11-23", "2026-11-25", "2026-12-07", "2026-12-09", "2026-12-21"]);
  });

  it("曜日が1つだけならN週後の同じ曜日", () => {
    expect(computeNextDueDate({ type: "weekly", interval: 2, weekdays: [1] }, "2026-11-23")).toBe("2026-12-07");
    expect(computeNextDueDate({ type: "weekly", interval: 1, weekdays: [1, 3] }, "2026-11-25")).toBe("2026-11-30");
  });
});

describe("繰り返しタスクの完了(completeTodoTask)", () => {
  const TODAY = "2026-11-21";

  it("期日を過ぎてから完了したら、今日より後の回まで一度に進める", async () => {
    const t = todo({ id: "r1", dueDate: "2026-11-10", recurrence: { type: "daily", interval: 1 } });
    await db.todoTasks.add(t);
    await completeTodoTask(t, TODAY);
    const after = await db.todoTasks.get("r1");
    expect(after?.dueDate).toBe("2026-11-22");
    expect(after?.completed).toBe(false);
  });

  it("毎週の場合も曜日を保ったまま追いつく", async () => {
    // 2026-11-02 は月曜。毎週月曜 → 11/23
    const t = todo({ id: "r2", dueDate: "2026-11-02", recurrence: { type: "weekly", interval: 1, weekdays: [1] } });
    await db.todoTasks.add(t);
    await completeTodoTask(t, TODAY);
    expect((await db.todoTasks.get("r2"))?.dueDate).toBe("2026-11-23");
  });

  it("期日より前に早めに完了した場合は1回分だけ進む", async () => {
    const t = todo({ id: "r3", dueDate: "2026-11-25", recurrence: { type: "daily", interval: 1 } });
    await db.todoTasks.add(t);
    await completeTodoTask(t, TODAY);
    expect((await db.todoTasks.get("r3"))?.dueDate).toBe("2026-11-26");
  });

  it("期日が今日なら次の回(明日)へ", async () => {
    const t = todo({ id: "r4", dueDate: TODAY, recurrence: { type: "daily", interval: 1 } });
    await db.todoTasks.add(t);
    await completeTodoTask(t, TODAY);
    expect((await db.todoTasks.get("r4"))?.dueDate).toBe("2026-11-22");
  });
});

describe("日付順の挿入位置(computeDateOrderedPosition)", () => {
  async function orders() {
    return (await db.todoTasks.orderBy("order").toArray()).map((t) => `${t.id}=${t.order}`);
  }

  it("既存のorderが連番でなくても、重複せず日付順の位置に入る", async () => {
    await db.todoTasks.bulkAdd([
      todo({ id: "A", dueDate: "2026-12-01", order: 2 }),
      todo({ id: "B", dueDate: "2026-12-10", order: 3 }),
    ]);
    const pos = await computeDateOrderedPosition("L", "C", "2026-12-05");
    await db.todoTasks.add(todo({ id: "C", dueDate: "2026-12-05", order: pos }));
    expect(await orders()).toEqual(["A=0", "C=1", "B=2"]);
  });

  it("末尾に入る場合も既存を詰め直して一意にする", async () => {
    await db.todoTasks.bulkAdd([
      todo({ id: "A", dueDate: "2026-12-01", order: 5 }),
      todo({ id: "B", dueDate: "2026-12-02", order: 5 }),
    ]);
    const pos = await computeDateOrderedPosition("L", "C", "2026-12-20");
    expect(pos).toBe(2);
    const all = await db.todoTasks.toArray();
    expect(all.map((t) => t.order).sort()).toEqual([0, 1]);
  });

  it("自分自身とサブタスクは数えず、日付なしのタスクより前に入る", async () => {
    await db.todoTasks.bulkAdd([
      todo({ id: "A", dueDate: "2026-12-01", order: 0 }),
      todo({ id: "N", order: 1 }),
      todo({ id: "S", parentTaskId: "A", order: 0 }),
      todo({ id: "C", order: 7 }),
    ]);
    const pos = await computeDateOrderedPosition("L", "C", "2026-12-05");
    await db.todoTasks.update("C", { order: pos });
    expect((await db.todoTasks.get("A"))?.order).toBe(0);
    expect((await db.todoTasks.get("C"))?.order).toBe(1);
    expect((await db.todoTasks.get("N"))?.order).toBe(2);
    expect((await db.todoTasks.get("S"))?.order).toBe(0);
  });
});

describe("ToDoのCSV再取込(upsertTodoFromCsv)", () => {
  it("既存タスクはCSVに無い項目を残したまま、CSVの列だけ書き換える", async () => {
    await db.todoLists.add({ id: "L", title: "タスク", order: 0, createdAt: 0 });
    await db.todoTasks.add(
      todo({
        id: "x1",
        title: "旧件名",
        tag: "対応中",
        customer: "旧客先",
        order: 4,
        createdAt: 123,
        imageDataUrl: "data:image/png;base64,AAAA",
        mailFileName: "a.msg",
        reminderAt: 999,
        estimateMinutes: 45,
        clientId: "c1",
        archived: true,
        boardX: 10,
        tagChangedAt: 555,
        dueHistory: [],
        myDayDate: "2026-11-21",
        projectId: "p1",
        recurrence: { type: "weekly", interval: 1, weekdays: [1] },
      })
    );
    const res = await upsertTodoFromCsv([
      { id: "x1", listTitle: "タスク", title: "新件名", tag: "対応中", dueDate: "2026-12-01", important: true, completed: false },
    ]);
    expect(res).toEqual({ created: 0, updated: 1, listsCreated: 0 });
    const after = await db.todoTasks.get("x1");
    expect(after).toMatchObject({
      title: "新件名",
      dueDate: "2026-12-01",
      important: true,
      order: 4,
      createdAt: 123,
      imageDataUrl: "data:image/png;base64,AAAA",
      mailFileName: "a.msg",
      reminderAt: 999,
      estimateMinutes: 45,
      clientId: "c1",
      archived: true,
      boardX: 10,
      tagChangedAt: 555,
      myDayDate: "2026-11-21",
      projectId: "p1",
      recurrence: { type: "weekly", interval: 1, weekdays: [1] },
    });
    // CSVで空にした列は従来どおり空になる
    expect(after?.customer).toBeUndefined();
  });

  it("完了済みはCSVがfalseでも戻さず、新しい行は追加する", async () => {
    await db.todoLists.add({ id: "L", title: "タスク", order: 0, createdAt: 0 });
    await db.todoTasks.add(todo({ id: "x1", completed: true, completedAt: 77 }));
    const res = await upsertTodoFromCsv([
      { id: "x1", listTitle: "タスク", title: "a", important: false, completed: false },
      { id: "x2", listTitle: "新リスト", title: "b", important: false, completed: false, recurrence: { type: "daily", interval: 1 } },
    ]);
    expect(res).toEqual({ created: 1, updated: 1, listsCreated: 1 });
    expect(await db.todoTasks.get("x1")).toMatchObject({ completed: true, completedAt: 77 });
    expect(await db.todoTasks.get("x2")).toMatchObject({ title: "b", order: 0, recurrence: { type: "daily", interval: 1 } });
  });
});

describe("件数管理の段階・アーカイブ済み案件の扱い", () => {
  const NOW = new Date("2026-11-21T12:00:00").getTime();
  const DAY = 86_400_000;
  function project(overrides: Partial<ProjectItem> = {}): ProjectItem {
    return { id: "p1", title: "案件", category: "c", workName: "w", dueDate: "2026-12-01", ...overrides } as ProjectItem;
  }
  const countDone = { id: "s1", title: "見積10件", completed: false, targetCount: 10, completedCount: 10, tag: "客先確認中", tagChangedAt: NOW - 9 * DAY };
  const open = { id: "s2", title: "提出", completed: false, tag: "客先確認中", tagChangedAt: NOW - 2 * DAY };

  it("目標件数に達した段階は「待ち」に数えない", () => {
    const w = projectWaitingInfo(project({ stages: [countDone, open] }), ["客先確認中"], 3, NOW);
    expect(w?.stageTitle).toBe("提出");
  });

  it("目標件数に達した段階は「前の段階が未完了」に出さない", () => {
    const p = project({ stages: [countDone, { ...open, id: "s3", title: "未着手" }, open] });
    expect(incompletePreviousStageTitles(p, "s2")).toEqual(["未着手"]);
  });

  it("アーカイブ済みの案件は相手待ち・延期の一覧に出さない", () => {
    const dueHistory = [
      { at: 1, from: "2026-11-01", to: "2026-11-05" },
      { at: 2, from: "2026-11-05", to: "2026-11-10" },
    ];
    const archived = project({ archived: true, tag: "客先確認中", tagChangedAt: NOW - 5 * DAY, dueHistory } as Partial<ProjectItem>);
    const active = project({ id: "p2", tag: "客先確認中", tagChangedAt: NOW - 5 * DAY, dueHistory } as Partial<ProjectItem>);
    expect(collectWaitingItems([], [archived, active], [], ["客先確認中"], 3, NOW).map((i) => i.id)).toEqual(["p2"]);
    expect(collectFrequentlyPostponed([], [archived, active], 2).map((i) => i.id)).toEqual(["p2"]);
  });
});
