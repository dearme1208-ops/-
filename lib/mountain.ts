import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";
import { isStageDone } from "./projectStage";
import { daysBetweenDateStrs } from "./time";

// ============================================================
// 登山モード: 実データ → 山の言葉への言い換え
// ============================================================
// このファイルには乱数も保存も一切入れない。すべて「今ある記録から毎回組み立て直す
// 純粋関数」にしてあるので、同じ記録からは常に同じ山が出る。
// 対応づけは次のとおり:
//   案件           → 一座の山       (段階＝通過点、進捗率＝現在標高)
//   案件の段階     → 幕営地・山小屋 (完了＝通過済み、期日超過＝ルートの崩落)
//   本日の作業     → 本日の行程     (想定時間＝コースタイム、実績＝実際の行動時間)
//   実績時間       → 行動時間・獲得標高
//   トラブル対応   → 悪天候・落石
//   ToDo           → 装備・荷物     (期日が近いほど重い)
//   所定労働時間   → 日没までの残り時間

// ------------------------------------------------------------
// 標高
// ------------------------------------------------------------
// 案件の「高さ」は勝手に決めず、その案件が持つ段階の数から決める。
// 段階1つ＝標高300m。段階を持たない案件は単独峰(1000m)として扱う
export const METERS_PER_STAGE = 300;
export const SOLO_PEAK_METERS = 1000;

export function summitAltitude(project: ProjectItem): number {
  const n = project.stages?.length ?? 0;
  return n > 0 ? 600 + n * METERS_PER_STAGE : SOLO_PEAK_METERS;
}

export interface Waypoint {
  id: string;
  title: string;
  altitude: number; // この通過点の標高(m)
  passed: boolean; // 通過済み(段階が完了している)か
  collapsed: boolean; // 期日を過ぎたまま未通過＝ルートが崩れている
  dueDate?: string;
  passedAt?: number;
}

export interface MountainRoute {
  projectId: string;
  name: string; // 山名(案件の件名)
  workName: string;
  summit: number; // 山頂の標高
  current: number; // 現在標高(進捗率×山頂)
  progress: number; // 0〜1
  waypoints: Waypoint[];
  daysLeft: number; // 期日までの日数(マイナスは超過)
  overdue: boolean;
  summited: boolean; // 登頂済み(案件が完了)
  collapsedCount: number; // 崩落している通過点の数
  climbedSeconds: number; // この山に費やした実績時間の合計
}

export function buildRoute(
  project: ProjectItem,
  today: string,
  secondsByProject: Map<string, number>
): MountainRoute {
  const stages = project.stages ?? [];
  const summit = summitAltitude(project);
  const base = 600; // 登山口の標高。段階の刻みが見やすくなるよう少し上げてある
  const waypoints: Waypoint[] = stages.map((s, i) => ({
    id: s.id,
    title: s.title,
    altitude: base + (i + 1) * ((summit - base) / stages.length),
    passed: isStageDone(s),
    collapsed: !isStageDone(s) && !!s.dueDate && s.dueDate < today,
    dueDate: s.dueDate,
    passedAt: s.completedAt,
  }));
  const doneCount = waypoints.filter((w) => w.passed).length;
  const progress = project.completedAt ? 1 : stages.length > 0 ? doneCount / stages.length : 0;
  const daysLeft = daysBetweenDateStrs(today, project.dueDate);
  return {
    projectId: project.id,
    name: project.title,
    workName: project.workName,
    summit,
    current: Math.round(base + (summit - base) * progress),
    progress,
    waypoints,
    daysLeft,
    overdue: !project.completedAt && daysLeft < 0,
    summited: !!project.completedAt,
    collapsedCount: waypoints.filter((w) => w.collapsed).length,
    climbedSeconds: secondsByProject.get(project.id) ?? 0,
  };
}

// ------------------------------------------------------------
// 天候
// ------------------------------------------------------------
// 天候は気分ではなく実データから決める。基準は本日の作業の状態:
//   荒天  … トラブル対応が2件以上、または想定の2倍を超えた作業がある
//   悪天  … トラブル対応が1件、または想定超過の作業が半分以上
//   曇り  … 想定超過の作業が1件以上
//   晴れ  … 超過なし
export type Weather = "clear" | "cloudy" | "rain" | "storm";

export interface WeatherState {
  weather: Weather;
  troubleCount: number;
  overrunCount: number;
  worstRatio: number; // 最も想定から離れている作業の 実績÷想定
}

export function elapsedSecondsOf(task: DailyTask, now: number): number {
  const running = task.segments.reduce((sum, seg) => sum + ((seg.end ?? now) - seg.start), 0);
  return Math.max(0, Math.round((running + (task.manualAdjustmentMs ?? 0)) / 1000));
}

export function buildWeather(tasks: DailyTask[], now: number): WeatherState {
  const troubleCount = tasks.filter((t) => t.isTrouble).length;
  let overrunCount = 0;
  let worstRatio = 0;
  for (const t of tasks) {
    if (t.estimatedSeconds <= 0) continue;
    const ratio = elapsedSecondsOf(t, now) / t.estimatedSeconds;
    if (ratio > 1) overrunCount++;
    if (ratio > worstRatio) worstRatio = ratio;
  }
  const measured = tasks.filter((t) => t.estimatedSeconds > 0).length;
  const weather: Weather =
    troubleCount >= 2 || worstRatio > 2
      ? "storm"
      : troubleCount >= 1 || (measured > 0 && overrunCount * 2 >= measured && overrunCount > 0)
        ? "rain"
        : overrunCount > 0
          ? "cloudy"
          : "clear";
  return { weather, troubleCount, overrunCount, worstRatio };
}

// ------------------------------------------------------------
// 本日の行程(1区間＝1作業)
// ------------------------------------------------------------
export interface Leg {
  taskId: string;
  category: string;
  name: string;
  courseTimeSeconds: number; // コースTime = 想定時間
  actualSeconds: number; // 実際の行動時間
  status: DailyTask["status"];
  ratio: number; // 実績÷想定(想定なしは0)
  isTrouble: boolean;
  gainMeters: number; // この区間で稼いだ標高。実働10分＝50m
}

export const METERS_PER_10MIN = 50;

export function buildLegs(tasks: DailyTask[], now: number): Leg[] {
  return tasks.map((t) => {
    const actual = elapsedSecondsOf(t, now);
    return {
      taskId: t.id,
      category: t.category,
      name: t.name,
      courseTimeSeconds: t.estimatedSeconds,
      actualSeconds: actual,
      status: t.status,
      ratio: t.estimatedSeconds > 0 ? actual / t.estimatedSeconds : 0,
      isTrouble: !!t.isTrouble,
      gainMeters: Math.round((actual / 600) * METERS_PER_10MIN),
    };
  });
}

// ------------------------------------------------------------
// 本日の高度計
// ------------------------------------------------------------
export interface Altimeter {
  gainedMeters: number; // 本日の獲得標高(実働から換算)
  plannedMeters: number; // 本日の予定標高(想定時間の合計から換算)
  actualSeconds: number;
  plannedSeconds: number;
  ratio: number; // 予定に対する到達割合
  doneCount: number;
  totalCount: number;
}

export function buildAltimeter(legs: Leg[]): Altimeter {
  const actualSeconds = legs.reduce((s, l) => s + l.actualSeconds, 0);
  const plannedSeconds = legs.reduce((s, l) => s + l.courseTimeSeconds, 0);
  return {
    gainedMeters: Math.round((actualSeconds / 600) * METERS_PER_10MIN),
    plannedMeters: Math.round((plannedSeconds / 600) * METERS_PER_10MIN),
    actualSeconds,
    plannedSeconds,
    ratio: plannedSeconds > 0 ? actualSeconds / plannedSeconds : 0,
    doneCount: legs.filter((l) => l.status === "done").length,
    totalCount: legs.length,
  };
}

// ------------------------------------------------------------
// 日没までの残り(所定労働時間の終わりまで)
// ------------------------------------------------------------
export interface Daylight {
  totalMinutes: number; // 始業〜終業の長さ
  remainingMinutes: number; // 終業までの残り(過ぎていたら0)
  elapsedRatio: number; // 0〜1。1で日没
  afterSunset: boolean;
}

export function buildDaylight(startHm: string, endHm: string, now: Date): Daylight {
  const toMin = (hm: string, fallback: number) => {
    const [h, m] = hm.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : fallback;
  };
  const start = toMin(startHm, 8 * 60 + 30);
  const end = toMin(endHm, 17 * 60 + 30);
  const total = Math.max(1, end - start);
  const cur = now.getHours() * 60 + now.getMinutes();
  const elapsed = Math.min(total, Math.max(0, cur - start));
  return {
    totalMinutes: total,
    remainingMinutes: Math.max(0, end - cur),
    elapsedRatio: elapsed / total,
    afterSunset: cur >= end,
  };
}

// ------------------------------------------------------------
// ザックの荷物(未完了のToDo)
// ------------------------------------------------------------
// 重さは期日までの余裕から決める。期日を過ぎたものほど重い
export interface PackItem {
  todoId: string;
  title: string;
  weightGrams: number;
  daysLeft: number | null;
  overdue: boolean;
  important: boolean;
}

export interface Pack {
  items: PackItem[];
  totalGrams: number;
  overdueCount: number;
}

export function itemWeight(daysLeft: number | null, important: boolean): number {
  const base =
    daysLeft === null ? 300 : daysLeft < 0 ? 1200 + Math.min(1800, -daysLeft * 120) : daysLeft <= 1 ? 900 : daysLeft <= 3 ? 600 : daysLeft <= 7 ? 400 : 250;
  return important ? Math.round(base * 1.4) : base;
}

export function buildPack(todos: TodoTask[], today: string): Pack {
  const open = todos.filter((t) => !t.completed && !t.parentTaskId);
  const items: PackItem[] = open
    .map((t) => {
      const daysLeft = t.dueDate ? daysBetweenDateStrs(today, t.dueDate) : null;
      return {
        todoId: t.id,
        title: t.title,
        weightGrams: itemWeight(daysLeft, !!t.important),
        daysLeft,
        overdue: daysLeft !== null && daysLeft < 0,
        important: !!t.important,
      };
    })
    .sort((a, b) => b.weightGrams - a.weightGrams);
  return {
    items,
    totalGrams: items.reduce((s, i) => s + i.weightGrams, 0),
    overdueCount: items.filter((i) => i.overdue).length,
  };
}

// ------------------------------------------------------------
// 山行記録(過去に登った山＝完了した案件、および記録のある日)
// ------------------------------------------------------------
export interface ClimbLogEntry {
  date: string;
  seconds: number;
  meters: number;
}

export function buildClimbLog(records: WorkRecord[], days: number, today: string): ClimbLogEntry[] {
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  }
  const out: ClimbLogEntry[] = [];
  const cursor = new Date(today + "T00:00:00");
  for (let i = 0; i < days; i++) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    const seconds = byDate.get(key) ?? 0;
    out.unshift({ date: key, seconds, meters: Math.round((seconds / 600) * METERS_PER_10MIN) });
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}

// ------------------------------------------------------------
// 案件ごとの実績秒数
// ------------------------------------------------------------
export function secondsByProject(records: WorkRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    if (r.projectId) map.set(r.projectId, (map.get(r.projectId) ?? 0) + r.seconds);
    for (const id of r.secondaryProjectIds ?? []) map.set(id, (map.get(id) ?? 0) + r.seconds);
  }
  return map;
}

// ------------------------------------------------------------
// 難易度(グレード)
// ------------------------------------------------------------
// 山のグレードは、その案件の段階数(＝行程の長さ)と期日までの余裕から決める。
// 長くて期日が近いほど難しい
export type Grade = "初級" | "中級" | "上級" | "厳冬期";

export function gradeOf(route: MountainRoute): Grade {
  const legs = route.waypoints.length;
  const remain = route.waypoints.filter((w) => !w.passed).length;
  if (route.overdue || route.collapsedCount >= 2) return "厳冬期";
  if (remain >= 4 || (remain >= 2 && route.daysLeft <= 3)) return "上級";
  if (legs >= 3 || route.daysLeft <= 7) return "中級";
  return "初級";
}

// 山の「見た目の険しさ」も実データから。段階が多いほど尾根が複雑、
// 崩落(期日超過の段階)が多いほど岩肌が露出する
export function ruggednessOf(route: MountainRoute): number {
  const base = Math.min(1, route.waypoints.length / 6);
  return Math.min(1, base * 0.7 + Math.min(1, route.collapsedCount / 3) * 0.3);
}
