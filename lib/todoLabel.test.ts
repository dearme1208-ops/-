import { describe, expect, it } from "vitest";
import { todoLabel, todoParentTitle } from "@/lib/todoLabel";

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
