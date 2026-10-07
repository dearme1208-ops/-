import { describe, expect, it } from "vitest";
import { choreIntervals } from "./choreIntervals";
import type { MasterTask, WorkRecord } from "./types";

const m = (id: string): MasterTask => ({ id, category: "家事", name: id, estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0 });
const r = (id: string, date: string): WorkRecord => ({ id: id + date, date, category: "家事", name: id, masterTaskId: id, seconds: 600, startedAt: 0, endedAt: 0, excludedFromStats: false });

describe("そろそろの家事", () => {
  it("いつもの間隔より空いたものほど上に。毎日やるもの・今日やったもの・回数の少ないものは出さない", () => {
    const records = [
      ...["2026-09-10", "2026-09-17", "2026-09-24"].map((d) => r("シーツ交換", d)), // 7日おき → 13日空き
      ...["2026-09-30", "2026-10-02", "2026-10-04"].map((d) => r("風呂掃除", d)), // 2日おき → 3日空き
      ...["2026-10-04", "2026-10-05", "2026-10-06"].map((d) => r("朝食", d)), // 毎日
      ...["2026-09-01", "2026-09-08", "2026-10-07"].map((d) => r("買い物", d)), // 今日やった
      r("窓拭き", "2026-08-01"), r("窓拭き", "2026-09-01"), // 2回だけ
    ];
    const res = choreIntervals(records, ["シーツ交換", "風呂掃除", "朝食", "買い物", "窓拭き"].map(m), "2026-10-07");
    expect(res.map((x) => [x.master.id, x.daysSince, x.usualDays])).toEqual([
      ["シーツ交換", 13, 7],
      ["風呂掃除", 3, 2],
    ]);
  });

  it("案件の作業・1回きりのToDoの作業は数えない(繰り返しのToDoの作業は数える)", () => {
    const linked = (id: string, date: string, extra: Partial<WorkRecord>) => ({ ...r(id, date), ...extra });
    const records = [
      ...["2026-09-10", "2026-09-17"].map((d) => linked("提案書", d, { projectId: "p1" })),
      linked("提案書", "2026-09-24", {}), // 案件の印のない実績が混ざっていても出さない
      linked("提案書", "2026-09-03", {}),
      linked("提案書", "2026-08-27", {}),
      ...["2026-09-10", "2026-09-17", "2026-09-24"].map((d) => linked("書類整理", d, { todoTaskId: "once" })),
      ...["2026-09-10", "2026-09-17", "2026-09-24"].map((d) => linked("ゴミ出し", d, { todoTaskId: "weekly" })),
    ];
    const res = choreIntervals(records, ["提案書", "書類整理", "ゴミ出し"].map(m), "2026-10-07", new Set(["weekly"]));
    expect(res.map((x) => x.master.id)).toEqual(["ゴミ出し"]);
  });
});
