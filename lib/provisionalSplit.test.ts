import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { finishDailyTask } from "./tasks";
import type { DailyTask } from "./types";
import {
  appendSegmentsKeepingRecorded,
  closeSegmentsAt,
  closedSegmentsMs,
  defaultSplitAt,
  midnightSplitParts,
  provisionalCarry,
  splitOrphanAtMidnight,
  splitSegmentsAt,
  splitDoneDailyTask,
  mergeDoneDailyTasks,
  subtractSegments,
  undoDoneTaskEdit,
} from "./provisionalSplit";

const M = 60_000;

describe("splitSegmentsAt", () => {
  it("計測中の1区間を、前(閉じた区間)と後(計測中のまま)に分ける", () => {
    expect(splitSegmentsAt([{ start: 0 }], 30 * M)).toEqual({ before: [{ start: 0, end: 30 * M }], after: [{ start: 30 * M }] });
  });
  it("休憩で分かれた区間は、またぐものだけ切り、ほかはそのまま前後に振り分ける", () => {
    const segs = [{ start: 0, end: 10 * M }, { start: 20 * M, end: 40 * M }, { start: 50 * M }];
    expect(splitSegmentsAt(segs, 30 * M)).toEqual({
      before: [{ start: 0, end: 10 * M }, { start: 20 * M, end: 30 * M }],
      after: [{ start: 30 * M, end: 40 * M }, { start: 50 * M }],
    });
  });
  it("区切りが休憩中なら、前後どちらにも長さ0の区間を作らない", () => {
    const segs = [{ start: 0, end: 10 * M }, { start: 20 * M }];
    expect(splitSegmentsAt(segs, 15 * M)).toEqual({ before: [{ start: 0, end: 10 * M }], after: [{ start: 20 * M }] });
  });
});

describe("closedSegmentsMs / closeSegmentsAt / defaultSplitAt", () => {
  it("閉じた区間だけ数え、計測中は now で閉じる。区切りの初期値は真ん中を分に丸める", () => {
    expect(closedSegmentsMs([{ start: 0, end: 5 * M }, { start: 6 * M }])).toBe(5 * M);
    expect(closeSegmentsAt([{ start: 0, end: 5 * M }, { start: 6 * M }], 9 * M)).toEqual([{ start: 0, end: 5 * M }, { start: 6 * M, end: 9 * M }]);
    expect(defaultSplitAt(0, 61 * M + 20_000)).toBe(31 * M);
  });
});

describe("appendSegmentsKeepingRecorded", () => {
  it("反映済みの先頭は動かさず、残りだけを時刻順に並べる(計測中は最後)", () => {
    const task = { segments: [{ start: 60 * M, end: 120 * M }, { start: 200 * M }], recordedSegmentCount: 1 };
    expect(appendSegmentsKeepingRecorded(task, [{ start: 0, end: 30 * M }])).toEqual([
      { start: 60 * M, end: 120 * M },
      { start: 0, end: 30 * M },
      { start: 200 * M },
    ]);
  });
  it("反映済みが無ければ全体を時刻順にする", () => {
    expect(appendSegmentsKeepingRecorded({ segments: [{ start: 60 * M, end: 90 * M }] }, [{ start: 0, end: 10 * M }])).toEqual([
      { start: 0, end: 10 * M },
      { start: 60 * M, end: 90 * M },
    ]);
  });
});

describe("provisionalCarry", () => {
  it("閉じた区間と計測中の区間の始まりに分ける", () => {
    expect(provisionalCarry([{ start: 0, end: 10 * M }, { start: 20 * M, end: 20 * M }, { start: 30 * M }])).toEqual({
      closed: [{ start: 0, end: 10 * M }],
      openStart: 30 * M,
    });
    expect(provisionalCarry([{ start: 0, end: 10 * M }]).openStart).toBeNull();
  });
});

const D1 = "2026-09-28";
const D2 = "2026-09-29";
const t1 = (hm: string, d = D1) => new Date(`${d}T${hm}:00`).getTime();
function daily(o: Partial<DailyTask> = {}): DailyTask {
  return { id: "a", date: D2, order: 0, masterTaskId: "m1", category: "業務", name: "資料作成", estimatedSeconds: 0, status: "paused", segments: [], accumulatedMs: 0, isSpontaneous: true, ...o };
}

describe("続きから再開した作業へ過去の時刻の区間を足しても、新しい分を一度だけ数える", () => {
  beforeEach(async () => {
    await Promise.all([db.dailyTasks.clear(), db.records.clear(), db.masterTasks.clear()]);
    await db.masterTasks.put({ id: "m1", category: "業務", name: "資料作成", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
  });
  it("休憩帯(9:00-9:30、反映済みの区間より前)を、10:00-11:00で一度完了し14:00-15:00に続きを計った作業に足す: 実績は60+60+30=150分", async () => {
    await db.dailyTasks.put(daily({ status: "running", segments: [{ start: t1("10:00", D2) }], startedAt: t1("10:00", D2) }));
    await finishDailyTask((await db.dailyTasks.get("a"))!, t1("11:00", D2));
    const done = (await db.dailyTasks.get("a"))!;
    // 続きから
    await db.dailyTasks.update("a", { status: "running", segments: [...done.segments, { start: t1("14:00", D2) }] });
    const running = (await db.dailyTasks.get("a"))!;
    await db.dailyTasks.put({ ...running, status: "paused", segments: running.segments.map((s) => (s.end ? s : { ...s, end: t1("15:00", D2) })), accumulatedMs: running.accumulatedMs + 60 * M });
    const paused = (await db.dailyTasks.get("a"))!;
    // 休憩帯の割り当て(TodaySection.assignBreakTimeToTask と同じ足し方)
    const segments = appendSegmentsKeepingRecorded(paused, [{ start: t1("09:00", D2), end: t1("09:30", D2) }]);
    await db.dailyTasks.update("a", { segments, accumulatedMs: paused.accumulatedMs + 30 * M });
    await finishDailyTask((await db.dailyTasks.get("a"))!);
    const rec = (await db.records.toArray())[0];
    expect(rec.seconds / 60).toBe(150);
    expect((await db.dailyTasks.get("a"))!.accumulatedMs / M).toBe(150);
  });
});

describe("0時で分ける", () => {
  beforeEach(async () => {
    await Promise.all([db.dailyTasks.clear(), db.records.clear(), db.masterTasks.clear()]);
    await db.masterTasks.put({ id: "m1", category: "業務", name: "資料作成", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
  });
  it("区間を、元の日の24:00までと今日の0:00からに分ける", () => {
    const parts = midnightSplitParts({ date: D1, segments: [{ start: t1("22:00") }] }, D2);
    expect(parts.yesterday).toEqual([{ start: t1("22:00"), end: t1("00:00", D2) }]);
    expect(parts.today).toEqual([{ start: t1("00:00", D2) }]);
  });
  it("計測中の作業を分けると、元の日に2時間の実績、今日は0:00から同じ紐付けで計測中になる", async () => {
    await db.dailyTasks.put(daily({ id: "o", date: D1, status: "running", segments: [{ start: t1("22:00") }], startedAt: t1("22:00"), projectId: "p1", todoTaskId: "td" }));
    const newId = await splitOrphanAtMidnight((await db.dailyTasks.get("o"))!, D2);
    const old = (await db.dailyTasks.get("o"))!;
    expect(old.status).toBe("done");
    expect(old.endedAt).toBe(t1("00:00", D2));
    const rec = (await db.records.toArray())[0];
    expect(rec.date).toBe(D1);
    expect(rec.seconds).toBe(2 * 3600);
    const copy = (await db.dailyTasks.get(newId!))!;
    expect(copy.date).toBe(D2);
    expect(copy.status).toBe("running");
    expect(copy.segments).toEqual([{ start: t1("00:00", D2) }]);
    expect(copy.projectId).toBe("p1");
    expect(copy.todoTaskId).toBe("td");
    expect(copy.masterTaskId).toBe("m1");
  });
  it("続きから再開していた作業は、反映済みの分を二重に数えない", async () => {
    await db.dailyTasks.put(daily({ id: "o", date: D1, status: "running", segments: [{ start: t1("20:00") }], startedAt: t1("20:00") }));
    await finishDailyTask((await db.dailyTasks.get("o"))!, t1("21:00"));
    const done = (await db.dailyTasks.get("o"))!;
    await db.dailyTasks.update("o", { status: "running", segments: [...done.segments, { start: t1("23:00") }] });
    await splitOrphanAtMidnight((await db.dailyTasks.get("o"))!, D2);
    const rec = (await db.records.toArray())[0];
    expect(rec.seconds).toBe(2 * 3600);
  });
  it("連打して並行に分けても、今日の分は1件だけ・実績も1回分", async () => {
    await db.dailyTasks.put(daily({ id: "o", date: D1, status: "running", segments: [{ start: t1("22:00") }], startedAt: t1("22:00") }));
    const t = (await db.dailyTasks.get("o"))!;
    const ids = await Promise.all([splitOrphanAtMidnight(t, D2), splitOrphanAtMidnight(t, D2)]);
    expect(ids.filter(Boolean)).toHaveLength(1);
    expect(await db.dailyTasks.where("date").equals(D2).count()).toBe(1);
    const recs = await db.records.toArray();
    expect(recs).toHaveLength(1);
    expect(recs[0].seconds).toBe(2 * 3600);
  });
  it("ほかで先に完了されていた作業は、今日の分を作らない", async () => {
    await db.dailyTasks.put(daily({ id: "o", date: D1, status: "running", segments: [{ start: t1("22:00") }], startedAt: t1("22:00") }));
    const stale = (await db.dailyTasks.get("o"))!;
    await finishDailyTask(stale, t1("23:00"));
    // 古い画面の表示(計測中)のまま押した
    expect(await splitOrphanAtMidnight(stale, D2)).toBeNull();
    expect(await db.dailyTasks.where("date").equals(D2).count()).toBe(0);
  });
});

describe("subtractSegments", () => {
  it("取り除く時間帯で区間を切る", () => {
    expect(subtractSegments([{ start: 0, end: 60 * M }], [{ start: 20 * M, end: 30 * M }])).toEqual([
      { start: 0, end: 20 * M },
      { start: 30 * M, end: 60 * M },
    ]);
    expect(subtractSegments([{ start: 0, end: 10 * M }], [{ start: 0, end: 10 * M }])).toEqual([]);
  });
});

describe("完了した作業を分ける・まとめる", () => {
  const h = (hm: string) => t1(hm, D2);
  beforeEach(async () => {
    await Promise.all([db.dailyTasks.clear(), db.records.clear(), db.masterTasks.clear()]);
    await db.masterTasks.bulkPut([
      { id: "m1", category: "業務", name: "資料作成", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 },
      { id: "m2", category: "業務", name: "電話対応", estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 },
    ]);
  });
  async function doneTask(id: string, from: string, to: string, masterTaskId = "m1", name = "資料作成") {
    await db.dailyTasks.put(daily({ id, masterTaskId, name, status: "running", segments: [{ start: h(from) }], startedAt: h(from) }));
    await finishDailyTask((await db.dailyTasks.get(id))!, h(to));
    return (await db.dailyTasks.get(id))!;
  }

  it("同じ作業のまま分けると、2つの完了になり、実績は変わらない", async () => {
    await doneTask("a", "09:00", "10:00");
    const recBefore = (await db.records.toArray())[0];
    const r = await splitDoneDailyTask("a", h("09:20"));
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const first = (await db.dailyTasks.get("a"))!;
    const second = (await db.dailyTasks.get(r.taskId))!;
    expect(first.segments).toEqual([{ start: h("09:00"), end: h("09:20") }]);
    expect(first.accumulatedMs).toBe(20 * M);
    expect(first.recordedMs).toBe(20 * M);
    expect(first.endedAt).toBe(h("09:20"));
    expect(second.status).toBe("done");
    expect(second.segments).toEqual([{ start: h("09:20"), end: h("10:00") }]);
    expect(second.accumulatedMs).toBe(40 * M);
    expect(second.startedAt).toBe(h("09:20"));
    expect(second.endedAt).toBe(h("10:00"));
    expect(second.masterTaskId).toBe("m1");
    expect(await db.records.toArray()).toEqual([recBefore]);
  });

  it("後半を別の作業にすると、後半の秒数を移した先の実績へ移す", async () => {
    await doneTask("a", "09:00", "10:00");
    const r = await splitDoneDailyTask("a", h("09:20"), { category: "業務", name: "電話対応", masterTaskId: "m2" });
    expect(r.status).toBe("ok");
    const recs = await db.records.toArray();
    const r1 = recs.find((x) => x.masterTaskId === "m1")!;
    const r2 = recs.find((x) => x.masterTaskId === "m2")!;
    expect(r1.seconds).toBe(20 * 60);
    expect(r1.segments).toEqual([{ start: h("09:00"), end: h("09:20") }]);
    expect(r1.endedAt).toBe(h("09:20"));
    expect(r2.seconds).toBe(40 * 60);
    expect(r2.name).toBe("電話対応");
    expect(r2.startedAt).toBe(h("09:20"));
  });

  it("「時間を加算」の分は前半に残す。後半を別の作業にしても合計は保たれる", async () => {
    await db.dailyTasks.put(daily({ id: "a", status: "running", segments: [{ start: h("09:00") }], startedAt: h("09:00"), manualAdjustmentMs: 10 * M }));
    await finishDailyTask((await db.dailyTasks.get("a"))!, h("10:00"));
    const r = await splitDoneDailyTask("a", h("09:30"), { category: "業務", name: "電話対応" });
    expect(r.status).toBe("ok");
    expect((await db.dailyTasks.get("a"))!.accumulatedMs).toBe(40 * M);
    const recs = await db.records.toArray();
    expect(recs.reduce((s, x) => s + x.seconds, 0)).toBe(70 * 60);
    expect(recs.find((x) => x.masterTaskId === "m2")!.seconds).toBe(30 * 60);
  });

  it("範囲の外や休憩中だけの区切りは断る", async () => {
    await doneTask("a", "09:00", "10:00");
    expect((await splitDoneDailyTask("a", h("08:00"))).status).toBe("rejected");
    expect((await splitDoneDailyTask("a", h("10:00"))).status).toBe("rejected");
    expect(await db.dailyTasks.count()).toBe(1);
  });

  it("分けたのを元に戻すと元どおり。その後に変更があれば戻さない", async () => {
    const before = await doneTask("a", "09:00", "10:00");
    const recBefore = await db.records.toArray();
    const r = await splitDoneDailyTask("a", h("09:20"), { category: "業務", name: "電話対応", masterTaskId: "m2" });
    if (r.status !== "ok") throw new Error("split failed");
    expect(await undoDoneTaskEdit(r.undo)).toBe(true);
    expect(await db.dailyTasks.toArray()).toEqual([before]);
    expect(await db.records.toArray()).toEqual(recBefore);

    const r2 = await splitDoneDailyTask("a", h("09:20"));
    if (r2.status !== "ok") throw new Error("split failed");
    await db.dailyTasks.update(r2.taskId, { note: "あとで直した" });
    expect(await undoDoneTaskEdit(r2.undo)).toBe(false);
    expect(await db.dailyTasks.count()).toBe(2);
  });

  it("同じ作業の2つをまとめると、区間をつなげて合計を足し、実績は変えない", async () => {
    await doneTask("a", "09:00", "09:30");
    await doneTask("b", "11:00", "11:20");
    const recBefore = await db.records.toArray();
    expect(recBefore).toHaveLength(1);
    const r = await mergeDoneDailyTasks("a", "b");
    expect(r.status).toBe("ok");
    const merged = (await db.dailyTasks.get("a"))!;
    expect(await db.dailyTasks.get("b")).toBeUndefined();
    expect(merged.segments).toEqual([
      { start: h("09:00"), end: h("09:30") },
      { start: h("11:00"), end: h("11:20") },
    ]);
    expect(merged.accumulatedMs).toBe(50 * M);
    expect(merged.recordedMs).toBe(50 * M);
    expect(merged.recordedSegmentCount).toBe(2);
    expect(merged.startedAt).toBe(h("09:00"));
    expect(merged.endedAt).toBe(h("11:20"));
    expect(await db.records.toArray()).toEqual(recBefore);
  });

  it("別の作業をまとめると、選んだ名前の実績へ秒数を移す。元に戻せる", async () => {
    await doneTask("a", "09:00", "09:30");
    await doneTask("b", "11:00", "11:20", "m2", "電話対応");
    const tasksBefore = await db.dailyTasks.toArray();
    const r = await mergeDoneDailyTasks("a", "b", "other");
    if (r.status !== "ok") throw new Error("merge failed");
    const merged = (await db.dailyTasks.get("a"))!;
    expect(merged.name).toBe("電話対応");
    expect(merged.masterTaskId).toBe("m2");
    const recs = await db.records.toArray();
    expect(recs).toHaveLength(1);
    expect(recs[0].masterTaskId).toBe("m2");
    expect(recs[0].seconds).toBe(50 * 60);
    expect(await undoDoneTaskEdit(r.undo)).toBe(true);
    expect((await db.dailyTasks.toArray()).sort((x, y) => x.id.localeCompare(y.id))).toEqual(tasksBefore.sort((x, y) => x.id.localeCompare(y.id)));
    const back = await db.records.toArray();
    expect(back.find((x) => x.masterTaskId === "m1")!.seconds).toBe(30 * 60);
    expect(back.find((x) => x.masterTaskId === "m2")!.seconds).toBe(20 * 60);
  });

  it("違う日の作業や未完了の作業はまとめない", async () => {
    await doneTask("a", "09:00", "09:30");
    await db.dailyTasks.put(daily({ id: "c", status: "pending" }));
    expect((await mergeDoneDailyTasks("a", "c")).status).toBe("rejected");
    await db.dailyTasks.put({ ...(await db.dailyTasks.get("a"))!, id: "d", date: D1 });
    expect((await mergeDoneDailyTasks("a", "d")).status).toBe("rejected");
  });
});
