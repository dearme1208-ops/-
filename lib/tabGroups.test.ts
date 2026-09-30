import { describe, expect, it } from "vitest";
import { PLAIN_TAB_LABELS, type TabKey } from "@/lib/theme";
import { TAB_GROUPS, activeGroupKey, buildVisibleTabGroups, groupOfTab } from "@/lib/tabGroups";

const ALL = Object.keys(PLAIN_TAB_LABELS) as TabKey[];
const tab = (key: string, badge?: number) => ({ key, label: key, badge });

describe("タブの分類", () => {
  it("既存のタブはすべて、ちょうど1つの分類に属している(取りこぼし・重複がない)", () => {
    for (const key of ALL) {
      expect(TAB_GROUPS.filter((g) => (g.tabs as string[]).includes(key)), key).toHaveLength(1);
    }
    const defined = TAB_GROUPS.flatMap((g) => g.tabs);
    expect(new Set(defined).size).toBe(defined.length);
    expect(defined.every((k) => ALL.includes(k))).toBe(true);
  });

  it("隠したタブは下段に出さず、全部隠れた分類は上段からも消える", () => {
    const visible = ALL.filter((k) => !["records", "master", "homeMaster", "charts"].includes(k)).map((k) => tab(k));
    const groups = buildVisibleTabGroups(visible);
    expect(groups.map((g) => g.key)).toEqual(["today", "plan", "review", "settings"]);
    expect(groups.find((g) => g.key === "review")!.tabs.map((t) => t.key)).not.toContain("charts");
  });

  it("分類の中は定義順に並び、中のタブの件数バッジは分類に合計して出る", () => {
    const groups = buildVisibleTabGroups([tab("memo"), tab("board", 3), tab("todo"), tab("today")]);
    const plan = groups.find((g) => g.key === "plan")!;
    expect(plan.tabs.map((t) => t.key)).toEqual(["todo", "memo", "board"]);
    expect(plan.badge).toBe(3);
  });

  it("どの分類にも無いタブは「その他」にまとめて取りこぼさない", () => {
    const groups = buildVisibleTabGroups([tab("today"), tab("futureTab")]);
    expect(groups.at(-1)).toMatchObject({ key: "others", tabs: [{ key: "futureTab" }] });
    expect(groupOfTab("futureTab")).toBeNull();
  });

  it("開いているタブから、その分類が決まる", () => {
    const groups = buildVisibleTabGroups(ALL.map((k) => tab(k)));
    expect(activeGroupKey(groups, "todo")).toBe("plan");
    expect(activeGroupKey(groups, "overtime")).toBe("review");
    expect(activeGroupKey(groups, "settings")).toBe("settings");
  });
});
