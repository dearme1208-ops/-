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

  it("一言の候補は新しい順で重複なし、空の一言は除く", () => {
    expect(recentStampNotes([s("1", 1, "資料"), s("2", 2, "昼"), s("3", 3, "資料"), s("4", 4, " "), s("5", 5)])).toEqual(["資料", "昼"]);
  });
});
