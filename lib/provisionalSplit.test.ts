import { describe, expect, it } from "vitest";
import { closeSegmentsAt, closedSegmentsMs, defaultSplitAt, splitSegmentsAt } from "./provisionalSplit";

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
