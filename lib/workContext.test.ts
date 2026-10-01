import { describe, expect, it } from "vitest";
import { buildWorkContextSources, dailyTaskLinksOf, withWorkContextNames, workContextOf, workNameWithContext } from "@/lib/workContext";

const src = buildWorkContextSources(
  [
    { id: "p1", title: "新機能開発" },
    { id: "p2", title: "A社見積" },
    { id: "p3", title: "B社見積" },
    { id: "p4", title: "C社見積" },
  ],
  [
    { id: "parent", title: "D社対応", parentTaskId: undefined },
    { id: "child", title: "確認", parentTaskId: "parent" },
    { id: "single", title: "請求書", parentTaskId: undefined },
  ]
);

describe("作業名に、どの案件の/どのToDoの作業かを添える", () => {
  it("段階・案件から追加した作業には案件名、サブタスクから追加した作業には親タスク名を添える", () => {
    expect(workNameWithContext({ name: "設計", projectId: "p1" }, src)).toBe("新機能開発 › 設計");
    expect(workNameWithContext({ name: "確認", todoTaskId: "child" }, src)).toBe("D社対応 › 確認");
  });

  it("単独のToDo・紐付けのない作業・名前に既に入っている場合は添えない", () => {
    expect(workContextOf({ name: "請求書", todoTaskId: "single" }, src)).toBeUndefined();
    expect(workContextOf({ name: "メール対応" }, src)).toBeUndefined();
    expect(workContextOf({ name: "新機能開発の設計", projectId: "p1" }, src)).toBeUndefined();
    // 案件が削除されている
    expect(workContextOf({ name: "設計", projectId: "deleted" }, src)).toBeUndefined();
  });

  it("集計行には、まとめた実績の案件・親タスクを添え、3件以上は「ほかN件」にする", () => {
    const rec = (masterTaskId: string, extra: { projectId?: string; todoTaskId?: string } = {}) => ({ masterTaskId, category: "営業", name: "", isTrouble: false, ...extra });
    const rows = [
      { key: "m1", name: "見積作成" },
      { key: "m2", name: "確認" },
      { key: "m3", name: "メール対応" },
    ];
    const out = withWorkContextNames(
      rows,
      [rec("m1", { projectId: "p2" }), rec("m1", { projectId: "p3" }), rec("m1", { projectId: "p4" }), rec("m2", { todoTaskId: "child" }), rec("m3")],
      src
    );
    expect(out.map((r) => r.name)).toEqual(["A社見積・B社見積 ほか1件 › 見積作成", "D社対応 › 確認", "メール対応"]);
  });
});

describe("もう一度開始するときに引き継ぐ紐付け", () => {
  it("案件・段階・ToDo・手段・追加の案件タグだけを取り出し、空の項目は含めない", () => {
    expect(
      dailyTaskLinksOf({ projectId: "p1", stageId: "s1", todoTaskId: undefined, method: "Excel", secondaryProjectIds: ["p2"] })
    ).toEqual({ projectId: "p1", stageId: "s1", method: "Excel", secondaryProjectIds: ["p2"] });
    expect(dailyTaskLinksOf({ secondaryProjectIds: [] })).toEqual({});
  });
});
