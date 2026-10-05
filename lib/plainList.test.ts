import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./progressSync";
import { snapshotToPlainList } from "./plainList";
import type { ProjectItem, TodoList, TodoTask } from "./types";

describe("案件・ToDoをそのまま渡す一覧", () => {
  it("未完了の案件(段階つき)とToDo(サブタスク・メモつき)を、期日の残り日数と一緒に並べる", () => {
    const now = new Date("2026-10-05T10:00:00").getTime();
    const projects = [
      { id: "p1", title: "A社の見積", category: "営業", workName: "見積", dueDate: "2026-10-08", createdAt: now, stages: [
        { id: "s1", title: "ヒアリング", completed: true, completedAt: now },
        { id: "s2", title: "見積書作成", completed: false, dueDate: "2026-10-07" },
      ] },
      { id: "p2", title: "終わった案件", completedAt: now, createdAt: now },
    ] as unknown as ProjectItem[];
    const todoLists = [{ id: "l", title: "仕事", order: 0, createdAt: 0 }] as TodoList[];
    const todoTasks = [
      { id: "t1", listId: "l", title: "請求書の確認", completed: false, important: true, order: 0, createdAt: 0, dueDate: "2026-10-03", notes: "経理に\\n確認", projectId: "p1" },
      { id: "t1a", listId: "l", parentTaskId: "t1", title: "金額を見る", completed: false, important: false, order: 0, createdAt: 0 },
      { id: "t2", listId: "l", title: "済んだこと", completed: true, important: false, order: 1, createdAt: 0 },
    ] as unknown as TodoTask[];
    const text = snapshotToPlainList(buildSnapshot({ projects, todoTasks, todoLists, tagOptions: [], now }));
    expect(text).toContain("# 案件・ToDoの一覧（2026-10-05 時点・未完了のもの）");
    expect(text).toContain("## 案件（1件）");
    expect(text).toContain("### A社の見積");
    expect(text).toContain("- 期日 2026-10-08（あと3日）");
    expect(text).toContain("- 段階（1/2 完了）");
    expect(text).toContain("  - [ ] 見積書作成（期日 2026-10-07（あと2日）");
    expect(text).toContain("- 関連するToDo: 請求書の確認");
    expect(text).toContain("### 仕事");
    expect(text).toMatch(/- \[ \] 請求書の確認（★重要・期日 2026-10-03（2日超過）.*案件「A社の見積」）/);
    expect(text).toContain("  - [ ] 金額を見る");
    expect(text).not.toContain("終わった案件");
    expect(text).not.toContain("済んだこと");
  });
});
