import { describe, expect, it } from "vitest";
import { closedMs, retimeSegments, resolveEditedTimes } from "./segmentEdit";

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

describe("resolveEditedTimes(日をまたぐ作業の時刻の編集)", () => {
  const D = new Date("2026-09-29T00:00:00").getTime();
  const H = 3600_000;
  const M = 60_000;
  const DAY = 24 * H;

  it("23:30〜翌0:20 の終了だけを 0:30 に直すと、終了は翌日の0:30になる(開始は動かさない)", () => {
    const original = { start: D + 23 * H + 30 * M, end: D + DAY + 20 * M };
    expect(resolveEditedTimes(original, original.start, D + 30 * M, false, true)).toEqual({
      start: original.start,
      end: D + DAY + 30 * M,
    });
  });

  it("23:30〜翌0:20 の開始・終了を両方直しても、作業が1日前へずれない", () => {
    const original = { start: D + 23 * H + 30 * M, end: D + DAY + 20 * M };
    expect(resolveEditedTimes(original, D + 23 * H + 40 * M, D + 30 * M, true, true)).toEqual({
      start: D + 23 * H + 40 * M,
      end: D + DAY + 30 * M,
    });
  });

  it("終了より遅い開始だけを入れた時は、前日から始まっていたものとする(従来どおり)", () => {
    const original = { start: D + 5 * M, end: D + 12 * M };
    expect(resolveEditedTimes(original, D + 20 * H + 40 * M, original.end, true, false)).toEqual({
      start: D - DAY + 20 * H + 40 * M,
      end: original.end,
    });
  });

  it("同じ日の中の編集はそのまま", () => {
    const original = { start: D + 17 * H, end: D + 18 * H + 30 * M };
    expect(resolveEditedTimes(original, original.start, D + 18 * H, false, true)).toEqual({ start: original.start, end: D + 18 * H });
    expect(resolveEditedTimes(original, D + 16 * H, D + 18 * H, true, true)).toEqual({ start: D + 16 * H, end: D + 18 * H });
  });

  it("時刻が空(NaN)なら null", () => {
    const original = { start: D + 9 * H, end: D + 10 * H };
    expect(resolveEditedTimes(original, NaN, original.end, true, false)).toBeNull();
  });
});
