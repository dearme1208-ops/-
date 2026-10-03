import { describe, expect, it } from "vitest";
import { buildGrove, groveStage, groveStreak } from "@/lib/forestLife";
import type { WorkRecord } from "@/lib/types";

const T = "2026-10-03";
const rec = (id: string, date: string, sec: number, masterTaskId = "m1"): WorkRecord => ({
  id, date, category: "家事", name: "風呂掃除", masterTaskId, seconds: sec, startedAt: 0, endedAt: 0, excludedFromStats: false,
});

describe("記録で育つ森", () => {
  it("時間で育ち、件数だけ実がなる。記録のない日は木が立たない", () => {
    expect([0, 0.5, 2, 4].map(groveStage)).toEqual(["none", "sprout", "young", "tree"]);
    const g = buildGrove([rec("a", T, 3600 * 4), rec("b", T, 600), rec("c", "2026-10-01", 1200)], T, 7);
    expect(g).toHaveLength(7);
    expect(g[6]).toMatchObject({ date: T, fruits: 2, stage: "tree" });
    expect(g[4]).toMatchObject({ date: "2026-10-01", stage: "sprout" });
    expect(g[5].stage).toBe("none");
  });

  it("続いている日数(今日がまだなら昨日から数える)", () => {
    const g = buildGrove([rec("a", "2026-10-02", 600), rec("b", "2026-10-01", 600), rec("c", "2026-09-29", 600)], T, 7);
    expect(groveStreak(g)).toBe(2);
  });
});
