import { describe, expect, it } from "vitest";
import { recentStampNotes, stampSpans } from "@/lib/quickStamp";
import type { QuickStamp } from "@/lib/types";

const s = (id: string, at: number, note?: string): QuickStamp => ({ id, date: "2026-10-03", at, note });

describe("打刻", () => {
  it("打刻を時刻順に並べ、次の打刻までを1区間にする(最後は終わりなし)", () => {
    const spans = stampSpans([s("b", 200), s("a", 100), s("c", 300)]);
    expect(spans.map((x) => [x.stamp.id, x.nextAt])).toEqual([
      ["a", 200],
      ["b", 300],
      ["c", undefined],
    ]);
  });

  it("打刻の後で計測を始めていれば、そこで区間を終える", () => {
    const seg = (start: number) => ({ start, end: start + 10 });
    const spans = stampSpans([s("a", 100), s("b", 300)], [seg(150), seg(250), seg(400)], 1000);
    expect(spans.map((x) => [x.stamp.id, x.nextAt, !!x.endedByMeasure])).toEqual([
      ["a", 150, true],
      ["b", 400, true],
    ]);
    expect(stampSpans([s("a", 100), s("b", 300)], [seg(350)], 1000)[0]).toMatchObject({ nextAt: 300 });
  });

  it("直前の作業が終わってから打刻するまでの空白は、その打刻の区間に含める", () => {
    const M = 60_000;
    // 13:30〜13:54 に計測、14:14 に打刻 → 区間は 13:54 から
    const t = (h: number, m: number) => (h * 60 + m) * M;
    const spans = stampSpans([s("a", t(14, 14))], [{ start: t(13, 30), end: t(13, 54) }], t(14, 20));
    expect(spans[0]).toMatchObject({ fromAt: t(13, 54), startedFromMeasure: true });
    // 間に別の打刻があれば、さかのぼらない
    const two = stampSpans([s("x", t(14, 0)), s("a", t(14, 14))], [{ start: t(13, 30), end: t(13, 54) }], t(14, 20));
    expect(two[1]).toMatchObject({ fromAt: t(14, 14) });
    expect(two[0]).toMatchObject({ fromAt: t(13, 54) });
    // 3時間より前に終わった作業まではさかのぼらない
    expect(stampSpans([s("a", t(18, 0))], [{ start: t(13, 30), end: t(13, 54) }], t(18, 5))[0].fromAt).toBe(t(18, 0));
    // 打刻した時に計測中なら、さかのぼらない
    expect(stampSpans([s("a", t(14, 14))], [{ start: t(13, 30) }], t(14, 20))[0].fromAt).toBe(t(14, 14));
  });

  it("一言の候補は新しい順で重複なし、空の一言は除く", () => {
    expect(recentStampNotes([s("1", 1, "資料"), s("2", 2, "昼"), s("3", 3, "資料"), s("4", 4, " "), s("5", 5)])).toEqual(["資料", "昼"]);
  });
});
