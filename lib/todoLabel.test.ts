import { describe, expect, it } from "vitest";
import { todoLabel, todoParentTitle, withSubtaskParentNames } from "@/lib/todoLabel";

const parent = { id: "p", title: "A社見積", parentTaskId: undefined };
const child = { id: "c", title: "見積作成", parentTaskId: "p" };
const orphan = { id: "o", title: "確認", parentTaskId: "deleted" };
const byId = new Map([parent, child, orphan].map((t) => [t.id, t]));

describe("todoLabel", () => {
  it("サブタスクは「親 › 子」、単独のタスクと親が消えたサブタスクは自身の名前だけ", () => {
    expect(todoLabel(child, byId)).toBe("A社見積 › 見積作成");
    expect(todoLabel(parent, byId)).toBe("A社見積");
    expect(todoLabel(orphan, byId)).toBe("確認");
    expect(todoParentTitle(child, (id) => byId.get(id))).toBe("A社見積");
  });
});

describe("withSubtaskParentNames", () => {
  const rows = [
    { key: "m1", name: "見積作成", totalSeconds: 1 },
    { key: "m2", name: "会議", totalSeconds: 1 },
    { key: "m3", name: "A社見積の確認", totalSeconds: 1 },
  ];
  const rec = (masterTaskId: string, todoTaskId?: string) => ({ masterTaskId, todoTaskId, category: "業務", name: "", isTrouble: false });

  it("サブタスクから追加した作業の行だけ、作業名に親タスク名を添える", () => {
    const out = withSubtaskParentNames(rows, [rec("m1", "c"), rec("m2"), rec("m2", "p")], [parent, child]);
    expect(out.map((r) => r.name)).toEqual(["A社見積 › 見積作成", "会議", "A社見積の確認"]);
  });

  it("作業名に既に親の名前が入っていれば重ねて付けない", () => {
    const sub = { id: "c2", title: "確認", parentTaskId: "p" };
    const out = withSubtaskParentNames(rows, [rec("m3", "c2")], [parent, sub]);
    expect(out[2].name).toBe("A社見積の確認");
  });

  it("1つの行に異なる親のサブタスクが混ざる場合はつなげて出す", () => {
    const p2 = { id: "p2", title: "B社見積", parentTaskId: undefined };
    const c2 = { id: "c2", title: "見積作成", parentTaskId: "p2" };
    const out = withSubtaskParentNames(rows, [rec("m1", "c"), rec("m1", "c2")], [parent, child, p2, c2]);
    expect(out[0].name).toBe("A社見積・B社見積 › 見積作成");
  });
});
