import type { ProgressSnapshot, SnapshotSubtask } from "./progressSync";

// 「今アプリに登録してある案件・ToDo」を、頼みごとや仕様書を付けずに、人もAIもそのまま読める
// 一覧(Markdown)にする。アプリでの管理はそのままに、AIとの会話で整理・相談する材料として渡すためのもの。
// 対象は未完了(アーカイブ済みを除く)の案件とToDo(進捗のやり取りと同じスナップショット)

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);
}

/** 期日に「今日」「あと3日」「2日超過」を添える */
function due(date: string | undefined, today: string): string | undefined {
  if (!date) return undefined;
  const d = daysBetween(today, date);
  const rel = d === 0 ? "今日" : d > 0 ? `あと${d}日` : `${-d}日超過`;
  return `期日 ${date}（${rel}）`;
}

const md = (s: string) => s.replace(/\r?\n/g, " ").trim();
const joinMeta = (parts: (string | undefined | false)[]) => parts.filter(Boolean).join("・");

function subtaskLine(s: SnapshotSubtask, today: string): string {
  const meta = joinMeta([s.completed ? (s.completedDate ? `完了 ${s.completedDate}` : "完了") : due(s.dueDate, today), !s.completed && s.tag]);
  return `  - [${s.completed ? "x" : " "}] ${md(s.title)}${meta ? `（${meta}）` : ""}`;
}

export function snapshotToPlainList(snap: ProgressSnapshot): string {
  const today = snap.today;
  const lines: string[] = [`# 案件・ToDoの一覧（${today} 時点・未完了のもの）`, ""];
  const projectTitle = new Map(snap.projects.map((p) => [p.id, p.title]));

  lines.push(`## 案件（${snap.projects.length}件）`, "");
  if (snap.projects.length === 0) lines.push("なし", "");
  const projects = [...snap.projects].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  for (const p of projects) {
    lines.push(`### ${md(p.title)}`);
    const meta = [
      p.groupName && `- グループ: ${md(p.groupName)}`,
      (p.category || p.workName) && `- 区分・作業: ${[p.category, p.workName].filter(Boolean).join(" / ")}`,
      `- ${due(p.dueDate, today) ?? "期日なし"}`,
      p.tag && `- 対応状況: ${p.tag}`,
      `- 登録日: ${p.createdDate}`,
    ].filter(Boolean) as string[];
    lines.push(...meta);
    if (p.stages.length > 0) {
      const done = p.stages.filter((s) => s.completed).length;
      lines.push(`- 段階（${done}/${p.stages.length} 完了）`);
      for (const s of p.stages) {
        const count = s.targetCount ? `${s.completedCount ?? 0}/${s.targetCount}件` : undefined;
        const m = joinMeta([s.completed ? (s.completedDate ? `完了 ${s.completedDate}` : "完了") : due(s.dueDate, today), !s.completed && s.tag, count]);
        lines.push(`  - [${s.completed ? "x" : " "}] ${md(s.title)}${m ? `（${m}）` : ""}`);
      }
    }
    const related = snap.todos.filter((t) => t.projectId === p.id);
    if (related.length > 0) lines.push(`- 関連するToDo: ${related.map((t) => md(t.title)).join("、")}`);
    lines.push("");
  }

  lines.push(`## ToDo（${snap.todos.length}件）`, "");
  if (snap.todos.length === 0) lines.push("なし", "");
  const lists = [...new Set(snap.todos.map((t) => t.list))];
  for (const list of lists) {
    lines.push(`### ${list || "（リストなし）"}`);
    for (const t of snap.todos.filter((x) => x.list === list)) {
      const meta = joinMeta([
        t.important && "★重要",
        due(t.dueDate, today),
        t.startDate && t.startDate > today && `${t.startDate}から`,
        t.tag,
        t.recurring && "繰り返し",
        t.projectId && projectTitle.has(t.projectId) && `案件「${md(projectTitle.get(t.projectId)!)}」`,
      ]);
      lines.push(`- [ ] ${md(t.title)}${meta ? `（${meta}）` : ""}`);
      if (t.action) lines.push(`  - 次の一手: ${md(t.action)}`);
      if (t.notes) lines.push(`  - メモ: ${md(t.notes)}`);
      for (const s of t.subtasks) lines.push(subtaskLine(s, today));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

