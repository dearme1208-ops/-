import { describe, expect, it } from "vitest";
import { buildBurnup, buildProgressRows, sortProgressRows, summarizeProgress } from "@/lib/progressOverview";
import type { ProjectItem, TodoTask } from "@/lib/types";

const TODAY = "2026-10-10";
const at = (d: string) => new Date(`${d}T12:00:00`).getTime();

const todo = (t: Partial<TodoTask> & { id: string }): TodoTask =>
  ({ listId: "l", title: t.id, important: false, completed: false, order: 0, createdAt: at("2026-10-01"), ...t }) as TodoTask;
const project = (p: Partial<ProjectItem> & { id: string }): ProjectItem =>
  ({ title: p.id, category: "c", workName: "w", dueDate: "2026-10-20", createdAt: at("2026-09-30"), ...p }) as ProjectItem;

function rows(todos: TodoTask[], projects: ProjectItem[] = []) {
  const subtasksByParent = new Map<string, TodoTask[]>();
  for (const t of todos) if (t.parentTaskId) subtasksByParent.set(t.parentTaskId, [...(subtasksByParent.get(t.parentTaskId) ?? []), t]);
  return buildProgressRows({ todos: todos.filter((t) => !t.parentTaskId), subtasksByParent, projects, today: TODAY });
}

describe("ToDo・案件の進捗の判定", () => {
  it("期日までの時間の経過に対して段階の完了が大きく遅れていれば「遅れ気味」、追いついていれば「順調」", () => {
    // 9/30登録・10/20期日で今日は10/10 → 時間は半分経過
    const stage = (id: string, done: boolean) => ({ id, title: id, completed: done, completedAt: done ? at("2026-10-09") : undefined });
    const [behind, ok] = rows([], [
      project({ id: "遅い", stages: [stage("a", false), stage("b", false), stage("c", false), stage("d", false)] }),
      project({ id: "順調", stages: [stage("a", true), stage("b", true), stage("c", false), stage("d", false)] }),
    ]);
    expect(behind.elapsed).toBeCloseTo(0.5);
    expect(behind.status).toBe("behind");
    expect(ok.status).toBe("onTrack");
    expect(ok.done).toBe(2);
    expect(ok.next).toBe("c");
    expect(ok.activity[12]).toBe(2); // 昨日2件片付いた
  });

  it("期日切れ・長く動きのないもの・期日なしを見分ける。サブタスクの無いToDoはペースでは判定しない", () => {
    const r = rows([
      todo({ id: "切れ", dueDate: "2026-10-09" }),
      todo({ id: "止まり", createdAt: at("2026-09-01") }),
      todo({ id: "単発", dueDate: "2026-10-11" }),
      todo({ id: "親", dueDate: "2026-10-12" }),
      todo({ id: "子1", parentTaskId: "親", completed: true, completedAt: at("2026-10-10") }),
      todo({ id: "子2", parentTaskId: "親" }),
    ]);
    const byId = new Map(r.map((x) => [x.id, x]));
    expect(byId.get("切れ")!.status).toBe("overdue");
    expect(byId.get("止まり")!.status).toBe("stalled");
    expect(byId.get("止まり")!.idleDays).toBe(39);
    expect(byId.get("単発")!.status).toBe("onTrack");
    // 10/1登録・10/12期日で時間は8割経過、サブタスクは半分 → 遅れ気味
    expect(byId.get("親")!.progress).toBe(0.5);
    expect(byId.get("親")!.status).toBe("behind");
    expect(byId.get("親")!.idleDays).toBe(0);
    expect(sortProgressRows(r, "risk").map((x) => x.id)).toEqual(["切れ", "親", "止まり", "単発"]);
  });

  it("全体のまとめは状態ごとの件数と、この7日・前の7日に片付いた数", () => {
    const all = [
      todo({ id: "済1", completed: true, completedAt: at("2026-10-10") }),
      todo({ id: "済2", completed: true, completedAt: at("2026-10-01") }),
      todo({ id: "残り", dueDate: "2026-10-01" }),
    ];
    const r = rows(all.filter((t) => !t.completed));
    const s = summarizeProgress({ rows: r, allTodos: all, allProjects: [], today: TODAY });
    expect(s.counts.overdue).toBe(1);
    expect(s.thisWeek).toBe(1);
    expect(s.lastWeek).toBe(1);
    expect(s.daily[13]).toBe(1);
  });
});

describe("見込み・相手待ち・累計の線", () => {
  const stage = (id: string, doneOn?: string) => ({ id, title: id, completed: !!doneOn, completedAt: doneOn ? at(doneOn) : undefined });

  it("これまでのペースから完了見込み日を出し、期日を過ぎる見込みなら時間の割合では遅れていなくても「遅れ気味」", () => {
    // 9/28登録・期日10/30・今日10/10(時間は約4割経過)。13日で1段階 → 残り4段階に約52日
    const [r] = rows([], [
      project({ id: "p", createdAt: at("2026-09-28"), dueDate: "2026-10-30", stages: [stage("a", "2026-10-01"), stage("b"), stage("c"), stage("d"), stage("e")] }),
    ]);
    expect(r.elapsed! - r.progress).toBeLessThan(0.2);
    expect(r.forecastDate! > "2026-10-30").toBe(true);
    expect(r.status).toBe("behind");
    expect(r.pacePerWeek).toBeCloseTo((1 / 13) * 7);
    // 残り4段階を21日(今日を含む)で → 週あたり約1.3件
    expect(r.neededPerWeek).toBeCloseTo((4 / 21) * 7);
  });

  it("相手待ちの対応状況なら、動きが無くても「停滞」ではなく「相手待ち」", () => {
    const old = todo({ id: "待ち", createdAt: at("2026-09-01"), tag: "客先確認中" });
    const r = buildProgressRows({
      todos: [old],
      subtasksByParent: new Map(),
      projects: [],
      today: TODAY,
      waiting: { todo: (t) => (t.tag === "客先確認中" ? { tag: "客先確認中", days: 5, overdue: true } : null), project: () => null },
    });
    expect(r[0].status).toBe("waiting");
    expect(r[0].waiting).toEqual({ tag: "客先確認中", days: 5, nudge: true });
  });

  it("累計の線は登録日から期日まで、片付いた日に1つずつ増え、理想の線は期日で全件に届く", () => {
    const [r] = rows([], [
      project({ id: "p", createdAt: at("2026-10-06"), dueDate: "2026-10-12", stages: [stage("a", "2026-10-07"), stage("b", "2026-10-09"), stage("c")] }),
    ]);
    const b = buildBurnup(r, TODAY);
    expect(b[0].date).toBe("2026-10-06");
    expect(b.at(-1)!.date >= "2026-10-12").toBe(true);
    expect(b.find((p) => p.date === "2026-10-08")!.done).toBe(1);
    expect(b.find((p) => p.date === "2026-10-10")!.done).toBe(2);
    expect(b.find((p) => p.date === "2026-10-11")!.done).toBeUndefined();
    expect(b.find((p) => p.date === "2026-10-12")!.ideal).toBe(3);
  });
});
