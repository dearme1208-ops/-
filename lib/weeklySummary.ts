import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";
import { shiftDateStr } from "./time";

// 「今週のまとめ」: 週の終わり(金〜日)に今週を、月曜に先週を1枚で振り返る材料。
// かかった時間の多い作業・予定より長引いた作業・終えたToDo/案件・来週が期日のものを並べる

export interface WeeklySummary {
  weekStart: string; // 月曜
  weekEnd: string; // 日曜
  label: "今週" | "先週";
  totalSeconds: number;
  topWorks: { label: string; seconds: number }[];
  overruns: { label: string; overSeconds: number }[];
  doneTodos: string[];
  doneProjects: string[];
  upcoming: { title: string; dueDate: string; kind: "todo" | "project" }[];
}

const dateOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** その日を含む週の月曜 */
export function mondayOf(date: string): string {
  const day = new Date(`${date}T00:00:00`).getDay();
  return shiftDateStr(date, -((day + 6) % 7));
}

/** 出す週。金・土・日は今週、月曜は先週、それ以外の日は出さない */
export function summaryWeek(today: string): { weekStart: string; label: "今週" | "先週" } | null {
  const day = new Date(`${today}T00:00:00`).getDay();
  if (day === 5 || day === 6 || day === 0) return { weekStart: mondayOf(today), label: "今週" };
  if (day === 1) return { weekStart: shiftDateStr(mondayOf(today), -7), label: "先週" };
  return null;
}

export function buildWeeklySummary(
  weekStart: string,
  label: "今週" | "先週",
  data: { records: WorkRecord[]; dailyTasks: DailyTask[]; todos: TodoTask[]; projects: ProjectItem[] }
): WeeklySummary {
  const weekEnd = shiftDateStr(weekStart, 6);
  const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
  const recs = data.records.filter((r) => inWeek(r.date) && !r.excludedFromStats);
  const byWork = new Map<string, number>();
  for (const r of recs) byWork.set(`${r.category} / ${r.name}`, (byWork.get(`${r.category} / ${r.name}`) ?? 0) + r.seconds);
  const topWorks = [...byWork.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, seconds]) => ({ label, seconds }));

  // 予定(見積もり)を2割以上こえて終えた作業
  const overByWork = new Map<string, number>();
  for (const t of data.dailyTasks) {
    if (!inWeek(t.date) || t.status !== "done" || t.isProvisional || !t.estimatedSeconds) continue;
    const over = Math.round(t.accumulatedMs / 1000) - t.estimatedSeconds;
    if (over > t.estimatedSeconds * 0.2) overByWork.set(t.name, (overByWork.get(t.name) ?? 0) + over);
  }
  const overruns = [...overByWork.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, overSeconds]) => ({ label, overSeconds }));

  const doneTodos = data.todos
    .filter((t) => t.completed && !t.parentTaskId && t.completedAt && inWeek(dateOf(t.completedAt)))
    .map((t) => t.title);
  const doneProjects = data.projects.filter((p) => p.completedAt && inWeek(dateOf(p.completedAt))).map((p) => p.title);

  const nextStart = shiftDateStr(weekEnd, 1);
  const nextEnd = shiftDateStr(weekEnd, 7);
  const upcoming = [
    ...data.todos
      .filter((t) => !t.completed && !t.archived && !t.parentTaskId && t.dueDate && t.dueDate >= nextStart && t.dueDate <= nextEnd)
      .map((t) => ({ title: t.title, dueDate: t.dueDate!, kind: "todo" as const })),
    ...data.projects
      .filter((p) => !p.completedAt && !p.archived && p.dueDate >= nextStart && p.dueDate <= nextEnd)
      .map((p) => ({ title: p.title, dueDate: p.dueDate, kind: "project" as const })),
  ]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  return {
    weekStart,
    weekEnd,
    label,
    totalSeconds: recs.reduce((s, r) => s + r.seconds, 0),
    topWorks,
    overruns,
    doneTodos,
    doneProjects,
    upcoming,
  };
}
