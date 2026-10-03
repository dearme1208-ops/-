import { segmentsAccumulatedMs } from "./tasks";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";
import type { DailyTask, MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// 各演出モードに足した機能の計算(登山・パワプロ・流行り神・ロボトミー・なつやすみ・図書館)。
// どれも実データからの純粋な関数で、見た目はそれぞれのモードの画面が受け持つ

// ---- 登山: 登山計画と「引き返す」判断 ----

export interface MountainPlan {
  /** まだ残っている予定の時間(コースタイムの残り) */
  remainingMs: number;
  /** 日没(終業)までの時間 */
  daylightMs: number;
  /** 日没までに下りられない場合に、明日へ回すと収まる未着手の作業(後ろの予定から) */
  turnBack: DailyTask[];
}

export function mountainPlan(tasks: DailyTask[], now: number, sunsetMs: number): MountainPlan {
  const active = tasks.filter((t) => !t.isProvisional && t.status !== "done").sort((a, b) => a.order - b.order);
  const remainOf = (t: DailyTask) => Math.max(0, t.estimatedSeconds * 1000 - segmentsAccumulatedMs(t, now));
  let remainingMs = active.reduce((s, t) => s + remainOf(t), 0);
  const daylightMs = Math.max(0, sunsetMs - now);
  const total = remainingMs;
  const turnBack: DailyTask[] = [];
  for (const t of [...active].reverse()) {
    if (remainingMs <= daylightMs) break;
    if (t.status !== "pending") continue;
    turnBack.push(t);
    remainingMs -= remainOf(t);
  }
  return { remainingMs: total, daylightMs, turnBack };
}

export interface TrailSegment {
  start: number;
  end: number;
  label: string;
}

/** 活動日記: 今日の作業の計測区間を時刻順に */
export function activityTrail(tasks: DailyTask[], now: number): TrailSegment[] {
  return tasks
    .filter((t) => !t.isProvisional)
    .flatMap((t) => t.segments.map((s) => ({ start: s.start, end: s.end ?? now, label: `${t.category} / ${t.name}` })))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
}

// ---- パワプロ: ケガ(働きすぎ)と試合(期日)の戦績 ----

export interface Injury {
  level: 0 | 1 | 2;
  /** 基準を超えて作業した日が何日続いているか */
  streak: number;
  todayHours: number;
}

/** 1日に limitHours 以上の作業が続いた日数で、ケガの危険を3段階に */
export function injuryRisk(records: WorkRecord[], today: string, limitHours = 9): Injury {
  const byDay = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.seconds / 3600);
  }
  const todayHours = byDay.get(today) ?? 0;
  let day = todayHours >= limitHours ? today : shiftDateStr(today, -1);
  let streak = 0;
  while ((byDay.get(day) ?? 0) >= limitHours) {
    streak++;
    day = shiftDateStr(day, -1);
  }
  return { level: streak >= 3 ? 2 : streak >= 2 ? 1 : 0, streak, todayHours };
}

export interface Season {
  wins: number;
  losses: number;
  /** 今日が期日の、まだ終わっていない仕事(本日の試合) */
  todaysGames: string[];
}

/** 直近 days 日に期日が来た案件・ToDoを試合に見立て、期日までに終えたら勝ち */
export function seasonRecord(projects: ProjectItem[], todos: TodoTask[], today: string, days = 30): Season {
  const from = shiftDateStr(today, -days);
  let wins = 0;
  let losses = 0;
  const todaysGames: string[] = [];
  const items = [
    ...projects.map((p) => ({ title: p.title, due: p.dueDate, doneAt: p.completedAt })),
    ...todos.filter((t) => !t.parentTaskId).map((t) => ({ title: t.title, due: t.dueDate, doneAt: t.completed ? t.completedAt ?? 0 : undefined })),
  ];
  for (const it of items) {
    if (!it.due || it.due < from || it.due > today) continue;
    if (it.doneAt !== undefined) {
      if (todayStr(new Date(it.doneAt)) <= it.due) wins++;
      else losses++;
    } else if (it.due < today) losses++;
    else todaysGames.push(it.title);
  }
  return { wins, losses, todaysGames };
}

// ---- 流行り神: 推理ロジック(想定を超えた原因) ----

export const CAUSES = ["割り込み", "情報不足", "打ち合わせ", "段取り違い", "想定外の不具合", "体調"] as const;

export interface Overrun {
  record: WorkRecord;
  overMin: number;
}

/** 直近 days 日で、作業マスタの想定より2割以上長くかかった実績 */
export function findOverruns(records: WorkRecord[], masters: MasterTask[], today: string, days = 14): Overrun[] {
  const est = new Map(masters.map((m) => [m.id, m.estimatedSeconds]));
  const from = shiftDateStr(today, -days);
  return records
    .filter((r) => r.date >= from && r.date <= today && !r.excludedFromStats && r.masterTaskId)
    .map((r) => ({ record: r, e: est.get(r.masterTaskId!) ?? 0 }))
    .filter(({ record, e }) => e > 0 && record.seconds > e * 1.2)
    .map(({ record, e }) => ({ record, overMin: Math.round((record.seconds - e) / 60) }))
    .sort((a, b) => b.record.startedAt - a.record.startedAt);
}

export interface CauseLink {
  cause: string;
  count: number;
  works: { label: string; count: number }[];
}

/** 原因ごとに、どの作業で何回起きたか(相関図のもと) */
export function causeLinks(causes: Record<string, string>, records: WorkRecord[]): CauseLink[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const map = new Map<string, Map<string, number>>();
  for (const [rid, cause] of Object.entries(causes)) {
    const r = byId.get(rid);
    if (!r) continue;
    const works = map.get(cause) ?? new Map<string, number>();
    const label = `${r.category} / ${r.name}`;
    works.set(label, (works.get(label) ?? 0) + 1);
    map.set(cause, works);
  }
  return [...map.entries()]
    .map(([cause, works]) => ({
      cause,
      count: [...works.values()].reduce((a, b) => a + b, 0),
      works: [...works.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count);
}

// ---- ロボトミー・冒険者: 期限を過ぎたToDo ----

export interface OverdueTodo {
  todo: TodoTask;
  daysOver: number;
}

export function overdueTodos(todos: TodoTask[], today: string): OverdueTodo[] {
  return todos
    .filter((t) => !t.completed && !t.parentTaskId && t.dueDate && t.dueDate < today)
    .map((t) => ({ todo: t, daysOver: daysBetweenDateStrs(t.dueDate!, today) }))
    .sort((a, b) => b.daysOver - a.daysOver);
}

// ---- なつやすみ: 月末までの宿題と、絵日記のアルバム ----

export interface Homework {
  monthEnd: string;
  daysLeft: number;
  open: TodoTask[];
  done: TodoTask[];
}

export function monthHomework(todos: TodoTask[], today: string): Homework {
  const [y, m] = today.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const inMonth = todos.filter((t) => !t.parentTaskId && t.dueDate && t.dueDate >= monthStart && t.dueDate <= monthEnd);
  return {
    monthEnd,
    daysLeft: daysBetweenDateStrs(today, monthEnd),
    open: inMonth.filter((t) => !t.completed).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)),
    done: inMonth.filter((t) => t.completed),
  };
}

export interface DiaryDay {
  date: string;
  hours: number;
  /** その日いちばん時間を使った作業 */
  top?: string;
}

export function diaryAlbum(records: WorkRecord[], today: string, days = 30): DiaryDay[] {
  const from = shiftDateStr(today, -(days - 1));
  const byDay = new Map<string, Map<string, number>>();
  for (const r of records) {
    if (r.excludedFromStats || r.date < from || r.date > today) continue;
    const m = byDay.get(r.date) ?? new Map<string, number>();
    m.set(r.name, (m.get(r.name) ?? 0) + r.seconds);
    byDay.set(r.date, m);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDateStr(from, i);
    const m = byDay.get(date);
    if (!m) return { date, hours: 0 };
    const [top] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { date, hours: [...m.values()].reduce((a, b) => a + b, 0) / 3600, top: top[0] };
  });
}

// ---- 図書館: 1年の蔵書票 ----

export interface YearCard {
  months: { ym: string; hours: number }[];
  /** この1年で手に取った本(作業)の種類 */
  titles: number;
  totalHours: number;
}

export function yearCard(records: WorkRecord[], today: string): YearCard {
  const [y, m] = today.split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(y, m - 1 - (11 - i), 1);
    return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, hours: 0 };
  });
  const idx = new Map(months.map((x, i) => [x.ym, i]));
  const titles = new Set<string>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const i = idx.get(r.date.slice(0, 7));
    if (i === undefined) continue;
    months[i].hours += r.seconds / 3600;
    titles.add(r.masterTaskId ?? `${r.category}/${r.name}`);
  }
  return { months, titles: titles.size, totalHours: months.reduce((a, b) => a + b.hours, 0) };
}
