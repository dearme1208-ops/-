import { describe, expect, it } from "vitest";
import { extendTimebox, findEndedTimeboxes, layoutTimeboxes, reviewTimeboxes, timeboxesOf, timeboxNow } from "@/lib/timebox";
import type { DailyTask } from "@/lib/types";

const D = "2026-10-02";
const t = (hm: string) => new Date(`${D}T${hm}:00`).getTime();
const task = (o: Partial<DailyTask> & { id: string }): DailyTask =>
  ({ date: D, order: 0, category: "業務", name: o.id, estimatedSeconds: 0, status: "pending", segments: [], accumulatedMs: 0, isSpontaneous: true, ...o }) as DailyTask;

describe("タイムボックス", () => {
  it("開始時刻から順に枠を割り当て、間に小休止を挟み、昼休みにかかる枠は後ろへ送る", () => {
    const slots = layoutTimeboxes(
      [
        { id: "資料作成", minutes: 25 },
        { id: "メール返信", minutes: 20 },
        { id: "企画整理", minutes: 25 },
        { id: "会議準備", minutes: 60 },
      ],
      "09:00",
      5,
      [{ start: "11:00", end: "12:00" }]
    );
    expect(slots.map((s) => `${s.start}-${s.end}`)).toEqual(["09:00-09:25", "09:30-09:50", "09:55-10:20", "12:00-13:00"]);
  });

  it("今の枠・次の枠と、終わりを過ぎても計測中のままの作業を見つける", () => {
    const tasks = [
      task({ id: "a", scheduledTime: "09:00", timeboxEnd: "09:25", status: "running", segments: [{ start: t("09:00") }] }),
      task({ id: "b", scheduledTime: "09:30", timeboxEnd: "09:50" }),
      task({ id: "時刻だけ", scheduledTime: "08:00" }),
    ];
    const boxes = timeboxesOf(tasks, D);
    expect(boxes.map((b) => b.task.id)).toEqual(["a", "b"]);
    expect(timeboxNow(boxes, t("09:10")).current?.task.id).toBe("a");
    expect(timeboxNow(boxes, t("09:27")).current).toBeUndefined();
    expect(timeboxNow(boxes, t("09:27")).next?.task.id).toBe("b");
    expect(findEndedTimeboxes(tasks, D, t("09:24")).length).toBe(0);
    expect(findEndedTimeboxes(tasks, D, t("09:25")).map((x) => x.id)).toEqual(["a"]);
  });

  it("延長すると、後ろのまだ始まっていない枠も同じだけずれる", () => {
    const tasks = [
      task({ id: "a", scheduledTime: "09:00", timeboxEnd: "09:25", status: "running", timeboxEndHandled: true }),
      task({ id: "b", scheduledTime: "09:30", timeboxEnd: "09:50" }),
      task({ id: "前", scheduledTime: "08:00", timeboxEnd: "08:30" }),
    ];
    expect(extendTimebox(tasks, "a", 5)).toEqual([
      { id: "a", changes: { timeboxEnd: "09:30", timeboxEndHandled: false } },
      { id: "b", changes: { scheduledTime: "09:35", timeboxEnd: "09:55" } },
    ]);
  });

  it("時間どおりに始めた・止めたかを振り返る", () => {
    const boxes = timeboxesOf(
      [
        task({ id: "守れた", scheduledTime: "09:00", timeboxEnd: "09:25", status: "paused", segments: [{ start: t("09:01"), end: t("09:26") }] }),
        task({ id: "延びた", scheduledTime: "09:30", timeboxEnd: "09:50", status: "done", segments: [{ start: t("09:40"), end: t("10:10") }] }),
        task({ id: "未着手", scheduledTime: "10:00", timeboxEnd: "10:25" }),
      ],
      D
    );
    const r = reviewTimeboxes(boxes, t("11:00"));
    expect(r.map((x) => [x.startedOnTime, x.stoppedOnTime])).toEqual([
      [true, true],
      [false, false],
      [false, undefined],
    ]);
    expect(r[1].workedMs).toBe(10 * 60000);
  });
});
