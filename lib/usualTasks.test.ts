import { describe, expect, it } from "vitest";
import { pickUsualMasters } from "./usualTasks";
import type { MasterTask, WorkRecord } from "./types";

const m = (id: string, archived = false): MasterTask => ({ id, category: "家事", name: id, estimatedSeconds: 0, isFavorite: false, sampleCount: 0, createdAt: 0, updatedAt: 0, archived });
const r = (masterTaskId: string, date: string, hm: string): WorkRecord => ({
  id: `${masterTaskId}-${date}-${hm}`, date, category: "家事", name: masterTaskId, masterTaskId, seconds: 600,
  startedAt: new Date(`${date}T${hm}:00`).getTime(), endedAt: new Date(`${date}T${hm}:00`).getTime() + 600_000, excludedFromStats: false,
});

describe("いつもの作業", () => {
  it("今と同じ平日/休日・近い時間帯に2回以上やった作業を、多い順に出す", () => {
    const now = new Date("2026-10-07T07:10:00"); // 水曜の朝
    const records = [
      r("朝食", "2026-10-05", "07:00"), r("朝食", "2026-10-06", "07:05"), r("朝食", "2026-10-02", "07:20"),
      r("洗濯", "2026-10-05", "07:40"), r("洗濯", "2026-10-06", "06:50"),
      r("風呂掃除", "2026-10-05", "20:00"), r("風呂掃除", "2026-10-06", "20:10"), // 時間帯が違う
      r("散歩", "2026-10-04", "07:00"), r("散歩", "2026-10-03", "07:00"), // 休日
      r("ゴミ出し", "2026-10-06", "07:00"), // 1回だけ
      r("古い", "2026-10-05", "07:00"), r("古い", "2026-10-06", "07:00"),
    ];
    const masters = [m("朝食"), m("洗濯"), m("風呂掃除"), m("散歩"), m("ゴミ出し"), m("古い", true)];
    expect(pickUsualMasters(records, masters, now).map((x) => x.id)).toEqual(["朝食", "洗濯"]);
  });
});
