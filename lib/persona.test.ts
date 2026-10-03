import { describe, expect, it } from "vitest";
import { buildBonds, buildStats, pickCallingCard, statOf } from "@/lib/persona";
import type { ProjectItem, TodoTask, WorkRecord } from "@/lib/types";

const T = "2026-10-03";
const rec = (id: string, category: string, name: string, hours: number, extra: Partial<WorkRecord> = {}): WorkRecord => ({
  id, date: T, category, name, seconds: hours * 3600, startedAt: 0, endedAt: 0, excludedFromStats: false, ...extra,
});

describe("ペルソナ風", () => {
  it("予告状は7日以内の期日のうち最も差し迫ったもの(期限切れも含む)", () => {
    const projects = [{ id: "p", title: "新サイト", dueDate: "2026-10-08", createdAt: 0, category: "", workName: "" } as ProjectItem];
    const todos = [
      { id: "t", title: "請求書", dueDate: "2026-10-02", completed: false, important: false, listId: "l", order: 0, createdAt: 0 } as TodoTask,
      { id: "u", title: "遠い", dueDate: "2026-11-01", completed: false, important: false, listId: "l", order: 0, createdAt: 0 } as TodoTask,
    ];
    expect(pickCallingCard(projects, todos, T)).toMatchObject({ title: "請求書", daysLeft: -1 });
    expect(pickCallingCard(projects, [], T)).toMatchObject({ title: "新サイト", daysLeft: 5 });
    expect(pickCallingCard([], [todos[1]], T)).toBeNull();
  });

  it("作業の言葉からパラメータを決める", () => {
    expect(statOf("家事", "風呂掃除")).toBe("kindness");
    expect(statOf("業務", "資料作成")).toBe("knowledge");
    expect(statOf("営業", "電話")).toBe("guts");
  });

  it("直近90日の時間でランクが上がる", () => {
    const stats = buildStats([rec("a", "勉強", "英語", 16), rec("b", "家事", "掃除", 1)], T);
    expect(stats.find((s) => s.key === "knowledge")).toMatchObject({ rank: 3 });
    expect(stats.find((s) => s.key === "kindness")).toMatchObject({ rank: 1 });
  });

  it("絆は取引先ごとの時間から", () => {
    const bonds = buildBonds(
      [rec("a", "業務", "見積", 8, { projectId: "p" }), rec("b", "業務", "x", 1)],
      [],
      [{ id: "p", clientId: "c1" } as ProjectItem],
      [{ id: "c1", name: "A社", order: 0, createdAt: 0 }, { id: "c2", name: "B社", order: 1, createdAt: 0 }]
    );
    expect(bonds).toEqual([{ clientId: "c1", name: "A社", hours: 8, rank: 5 }]);
  });
});
