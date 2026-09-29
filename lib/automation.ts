import { computeEffectiveElapsedMs, isWithinBreak } from "@/lib/breaks";
import { CONDITION_LEVELS } from "@/lib/condition";
import { haversineDistanceMeters } from "@/lib/geo";
import { formatHms, parseHourStr } from "@/lib/time";
import type { BreakRange, ConditionLog, DailyTask, GeoPlace, WorkRecord } from "@/lib/types";

// 本日の作業タブで「時間の経過」をきっかけに自動で動く処理(仮計測・放置検知・予定の自動開始・
// 位置情報・定時通知)の判定部分。画面やDBに触れない純粋な関数にしておき、単体テストで固定する

// 「HH:MM」で指定した時刻を、nowの時点で過ぎているか(日付は見ない)
export function isPastTimeOfDay(now: number, hhmm: string, fallbackHour: number): boolean {
  const target = parseHourStr(hhmm, fallbackHour);
  const d = new Date(now);
  return d.getHours() + d.getMinutes() / 60 >= target;
}

// 誰も計測していない状態がしきい値を超えていれば、仮計測を始める時刻(直近の停止時刻から
// 休憩を除いた起点)を返す。始めるべきでなければnull。
// 休憩中は開始しない。経過の判定は休憩を差し引いた正味の時間で行う
export function findProvisionalStart(p: {
  tasks: DailyTask[];
  lastStopTime: number | null;
  effectiveLastStopTime: number | null;
  now: number;
  date: string;
  breakRanges: BreakRange[];
  thresholdMinutes: number;
}): number | null {
  if (p.tasks.some((t) => t.isProvisional)) return null;
  if (p.tasks.some((t) => t.status === "running")) return null;
  if (p.lastStopTime === null || p.effectiveLastStopTime === null) return null;
  if (isWithinBreak(p.now, p.date, p.breakRanges)) return null;
  const realElapsedMs = computeEffectiveElapsedMs(p.lastStopTime, p.now, p.date, p.breakRanges);
  if (realElapsedMs < p.thresholdMinutes * 60000) return null;
  return p.effectiveLastStopTime;
}

// 放置検知・移動の停止検知の共通部分: 最後の動き(操作・位置の変化)からthresholdMs以上
// 経っていれば、計測を打ち切る時刻を返す。打ち切り時刻は最後の動きの時刻だが、
// 計測の開始より前にはしない
export function inactivityCutoff(task: DailyTask, lastEventAt: number, now: number, thresholdMs: number): number | null {
  if (now - lastEventAt < thresholdMs) return null;
  return Math.max(lastEventAt, task.segments[0]?.start ?? lastEventAt);
}

// 予定の時刻(scheduledTime)を過ぎた、自動開始すべき未着手の作業
export function findDueScheduledTasks(tasks: DailyTask[], date: string, now: number): DailyTask[] {
  return tasks.filter((task) => {
    if (task.status !== "pending" || !task.scheduledTime || task.autoStartNotified || task.autoStartDisabled) return false;
    const [h, m] = task.scheduledTime.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
    const scheduledMs = new Date(date + "T00:00:00").getTime() + (h * 60 + m) * 60000;
    return now >= scheduledMs;
  });
}

// 登録地点の圏内判定を現在地で更新し、新たに圏内に入った地点のIDを返す(insideを書き換える)。
// 退出は半径の1.5倍を超えてから(境界付近のGPS誤差で出入りを繰り返さないためのヒステリシス)
export function updateGeoArrivals(inside: Set<string>, places: GeoPlace[], lat: number, lon: number): string[] {
  const arrived: string[] = [];
  for (const place of places) {
    const dist = haversineDistanceMeters(place.lat, place.lon, lat, lon);
    if (dist <= place.radiusMeters) {
      if (!inside.has(place.id)) {
        inside.add(place.id);
        arrived.push(place.id);
      }
    } else if (dist > place.radiusMeters * 1.5) {
      inside.delete(place.id);
    }
  }
  return arrived;
}

// 1日の終わりの通知本文: その日の合計時間と、最後に記録した体調
export function buildDailySummaryBody(records: WorkRecord[], date: string, conditionLogs: ConditionLog[]): string {
  const totalSeconds = records.filter((r) => r.date === date && !r.excludedFromStats).reduce((s, r) => s + r.seconds, 0);
  const conditionPart =
    conditionLogs.length > 0
      ? `・体調 ${CONDITION_LEVELS.find((c) => c.level === conditionLogs[conditionLogs.length - 1].level)?.emoji ?? ""}`
      : "";
  return `合計 ${formatHms(totalSeconds)}${conditionPart}`;
}

// 月初の通知: 前月の合計時間と最多区分。前月の実績が無ければnull
export function buildMonthlySummary(
  records: WorkRecord[],
  currentMonth: string
): { title: string; body: string } | null {
  const [y, m] = currentMonth.split("-").map(Number);
  const prevMonthDate = new Date(y, m - 2, 1);
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const prevRecords = records.filter((r) => r.date.startsWith(prevMonth) && !r.excludedFromStats);
  if (prevRecords.length === 0) return null;
  const totalSeconds = prevRecords.reduce((s, r) => s + r.seconds, 0);
  const byCategory = new Map<string, number>();
  for (const r of prevRecords) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.seconds);
  let topCategory = "";
  let topCategorySeconds = 0;
  for (const [cat, sec] of byCategory) {
    if (sec > topCategorySeconds) {
      topCategory = cat;
      topCategorySeconds = sec;
    }
  }
  return {
    title: `${prevMonth}のサマリー`,
    body: `合計 ${formatHms(totalSeconds)}${topCategory ? `・最多区分「${topCategory}」${formatHms(topCategorySeconds)}` : ""}`,
  };
}

export interface DueSummary {
  todoOverdue: number;
  todoDueToday: number;
  projectOverdue: number;
  projectDueToday: number;
}

// 朝の通知本文: 本日の予定件数と、ToDo・案件の期限状況(該当があるものだけ)
export function buildMorningDigestBody(pendingCount: number, due: DueSummary): string {
  const parts = [`本日の予定 ${pendingCount}件`];
  if (due.todoOverdue > 0 || due.todoDueToday > 0) {
    parts.push(`ToDo 期限切れ${due.todoOverdue}件・本日期限${due.todoDueToday}件`);
  }
  if (due.projectOverdue > 0 || due.projectDueToday > 0) {
    parts.push(`案件 期限切れ${due.projectOverdue}件・本日期限${due.projectDueToday}件`);
  }
  return parts.join(" / ");
}
