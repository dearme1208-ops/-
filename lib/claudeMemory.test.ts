import { describe, expect, it } from "vitest";
import { buildHandoff, deriveMemories, parseForgotten, parseNotes } from "@/lib/claudeMemory";
import type { TodoTask, WorkRecord } from "@/lib/types";

const T = "2026-10-03";
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00`).getTime();
const day = (off: number) => {
  const d = new Date(2026, 9, 3 + off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const rec = (i: number, date: string, hm: string, sec: number, name = "会議"): WorkRecord => ({
  id: "r" + i, date, category: "業務", name, masterTaskId: name, seconds: sec, startedAt: at(date, hm), endedAt: at(date, hm) + sec * 1000, excludedFromStats: false,
});

describe("Claudeの記憶", () => {
  it("記録が少なければ何も言わない", () => {
    expect(deriveMemories([rec(1, T, "09:00", 1800)], [], T)).toEqual([]);
  });

  it("取りかかる時間帯・いつもの所要時間・1日の量を読み取る", () => {
    const records = Array.from({ length: 12 }, (_, i) => rec(i, day(-i), "09:30", 1800 + (i % 3 === 0 ? 600 : 0)));
    const ms = deriveMemories(records, [], T);
    const texts = ms.map((m) => m.text);
    expect(texts).toContain("午前（9〜12時）に取りかかる作業がいちばん多い");
    expect(texts).toContain("「業務 / 会議」は、たいてい30分ほどかかる");
    expect(texts.some((t) => t.startsWith("記録のある日は、1日におよそ"))).toBe(true);
  });

  it("期限を過ぎてから終わりやすい分類", () => {
    const todo = (i: number, late: boolean): TodoTask => ({
      id: "t" + i, listId: "l", title: "t", category: "経理", important: false, completed: true, order: 0, createdAt: 0,
      dueDate: "2026-09-10", completedAt: at(late ? "2026-09-12" : "2026-09-09", "10:00"),
    });
    const ms = deriveMemories([], [todo(1, true), todo(2, true), todo(3, false), todo(4, true)], T);
    expect(ms).toEqual([{ id: "late:経理", text: "@経理 の仕事は、期限を過ぎてから終わることが多い", basis: "期限付き4件のうち3件" }]);
  });

  it("引き継ぎ文に、覚えていること・書き残したこと・今の状況が入る", () => {
    const text = buildHandoff({
      today: T,
      memories: [{ id: "a", text: "午前に集中", basis: "10件" }],
      notes: [{ id: "n", text: "午後は電話が多い", createdAt: 0 }],
      running: null,
      todos: [{ id: "t", listId: "l", title: "見積書", important: false, completed: false, order: 0, createdAt: 0, dueDate: "2026-10-02" }],
      projects: [],
    });
    expect(text).toContain("- 午前に集中（10件）");
    expect(text).toContain("- 午後は電話が多い");
    expect(text).toContain("- タスク: 見積書（期限 2026-10-02・期限切れ）");
  });

  it("壊れた設定値は空として扱う", () => {
    expect(parseNotes("x")).toEqual([]);
    expect(parseForgotten("[1,\"a\"]")).toEqual(["a"]);
  });
});
