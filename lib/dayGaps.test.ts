import { describe, expect, it } from "vitest";
import { findDayGaps, findLongSpans } from "./dayGaps";
import type { DailyTask } from "./types";

const D = "2026-10-07";
const at = (hm: string) => new Date(`${D}T${hm}:00`).getTime();
const t = (id: string, segs: [string, string | null][], extra: Partial<DailyTask> = {}): DailyTask => ({
  id, date: D, order: 0, category: "業務", name: id, estimatedSeconds: 0, status: "done", accumulatedMs: 0, isSpontaneous: true,
  segments: segs.map(([s, e]) => ({ start: at(s), end: e ? at(e) : undefined })), ...extra,
});

describe("今日の抜け", () => {
  it("計測と計測の間の10分以上の空きを拾い、休憩時間は差し引く", () => {
    const tasks = [t("a", [["09:00", "10:00"]]), t("b", [["10:05", "11:30"]]), t("c", [["13:30", "15:00"]]), t("d", [["15:40", null]], { status: "running" })];
    const gaps = findDayGaps(tasks, D, [{ start: "12:00", end: "13:00" }], at("16:00"));
    expect(gaps.map((g) => [g.start, g.end])).toEqual([
      [at("11:30"), at("12:00")],
      [at("13:00"), at("13:30")],
      [at("15:00"), at("15:40")],
    ]);
  });

  it("重なった区間はまとめて扱う(抜けにしない)", () => {
    const tasks = [t("a", [["09:00", "10:00"]]), t("b", [["09:30", "10:30"]]), t("c", [["10:35", "11:00"]])];
    expect(findDayGaps(tasks, D, [], at("12:00"))).toEqual([]);
  });

  it("3時間以上続いた計測を拾う(計測中を含む)", () => {
    const tasks = [t("a", [["08:00", "11:30"]]), t("b", [["12:00", null]], { status: "running" }), t("c", [["11:30", "12:00"]])];
    expect(findLongSpans(tasks, at("15:30")).map((l) => [l.taskId, l.running])).toEqual([["a", false], ["b", true]]);
  });
});
