import { describe, expect, it } from "vitest";
import { buildCare, buildGrove, groveStage, groveStreak } from "@/lib/forestLife";
import type { MasterTask, WorkRecord } from "@/lib/types";

const T = "2026-10-03";
const rec = (id: string, date: string, sec: number, masterTaskId = "m1"): WorkRecord => ({
  id, date, category: "家事", name: "風呂掃除", masterTaskId, seconds: sec, startedAt: 0, endedAt: 0, excludedFromStats: false,
});
const master = (id: string, name: string): MasterTask => ({
  id, category: "家事", name, estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0,
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

describe("暮らしの手入れ", () => {
  it("いつもの間隔と前回からの日数を比べ、伸びているものから並べる", () => {
    const records = [
      rec("1", "2026-09-10", 600), rec("2", "2026-09-14", 600), rec("3", "2026-09-18", 600), rec("4", "2026-09-22", 600),
      rec("5", "2026-09-30", 600, "m2"), rec("6", "2026-10-01", 600, "m2"), rec("7", "2026-10-02", 600, "m2"),
      rec("8", "2026-10-01", 600, "m3"), rec("9", "2026-10-02", 600, "m3"),
    ];
    const items = buildCare(records, [master("m1", "風呂掃除"), master("m2", "洗濯"), master("m3", "料理")], T);
    expect(items.map((i) => [i.name, i.usualDays, i.sinceDays, i.state])).toEqual([
      ["風呂掃除", 4, 11, "overgrown"],
      ["洗濯", 1, 1, "due"],
    ]);
  });

  it("外したもの・森から隠した作業は出さない", () => {
    const records = ["2026-09-01", "2026-09-05", "2026-09-09"].map((d, i) => rec(String(i), d, 600));
    expect(buildCare(records, [master("m1", "風呂掃除")], T, ["m1"])).toEqual([]);
    expect(buildCare(records, [{ ...master("m1", "風呂掃除"), excludedFromHome: true }], T)).toEqual([]);
  });
});
