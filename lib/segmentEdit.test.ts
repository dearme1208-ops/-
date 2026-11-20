import { describe, expect, it } from "vitest";
import { closedMs, retimeSegments } from "./segmentEdit";

const t = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return (h * 60 + m) * 60_000;
};
const two = [{ start: t("10:10"), end: t("12:00") }, { start: t("12:40"), end: t("12:50") }];

describe("retimeSegments", () => {
  it("開始を後ろの区間の中へ動かすと、前の区間を落とす(画面の例: 10:10〜12:00 と 12:40〜12:50 → 12:40〜12:50)", () => {
    expect(retimeSegments(two, t("12:40"), t("12:50"))).toEqual([{ start: t("12:40"), end: t("12:50") }]);
  });
  it("開始が一時停止中の時刻なら、次の区間の頭をその時刻にする", () => {
    expect(retimeSegments(two, t("12:20"))).toEqual([{ start: t("12:20"), end: t("12:50") }]);
  });
  it("開始が区間の中なら、その区間を切る", () => {
    expect(retimeSegments(two, t("11:00"))).toEqual([{ start: t("11:00"), end: t("12:00") }, { start: t("12:40"), end: t("12:50") }]);
  });
  it("終了を早めると後ろの区間を落とし、開始を早める・終了を遅らせると端を延ばす", () => {
    expect(retimeSegments(two, undefined, t("11:30"))).toEqual([{ start: t("10:10"), end: t("11:30") }]);
    expect(retimeSegments(two, t("09:00"), t("13:00"))).toEqual([{ start: t("09:00"), end: t("12:00") }, { start: t("12:40"), end: t("13:00") }]);
  });
  it("開始が終了以降なら null", () => {
    expect(retimeSegments(two, t("12:50"), t("12:50"))).toBeNull();
    expect(retimeSegments(two, t("13:00"))).toBeNull();
  });
  it("計測中の区間は閉じずに残し、合計は閉じた区間だけ数える", () => {
    const running = [{ start: t("10:00"), end: t("10:30") }, { start: t("11:00") }];
    expect(retimeSegments(running, t("10:45"))).toEqual([{ start: t("10:45") }]);
    expect(closedMs(two)).toBe(t("01:50") + t("00:10"));
  });
});
