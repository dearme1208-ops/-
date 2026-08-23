import type { ProjectItem, WorkRecord } from "./types";
import { recordBelongsToProject } from "./projects";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";

export type ProjectForecastStatus = "done" | "overdue" | "no-recent-pace" | "on-track" | "at-risk";

export interface ProjectForecast {
  spentSeconds: number;
  remainingSeconds: number;
  daysRemaining: number; // 期日までの日数(超過している場合は負)
  recentPaceSecondsPerDay: number; // 直近PACE_WINDOW_DAYS日の1日あたり平均投入時間
  projectedDaysNeeded: number | null; // 直近ペースのまま進んだ場合、残りをこなすのに要する日数
  requiredPaceSecondsPerDay: number | null; // 期日に間に合わせるために今後必要な1日あたりの時間
  status: ProjectForecastStatus;
}

const PACE_WINDOW_DAYS = 14;

// 案件に「見積もり総所要時間」が設定されている場合、これまでの実績消化ペース(直近14日平均)から
// 残りの所要時間を今後何日で消化できるかを見積もり、期日に間に合いそうかを判定する。
// 見積もりが未設定の案件はforecast対象外(既存のpaceWarningなど簡易指標で代替する)
export function computeProjectForecast(
  project: ProjectItem,
  records: WorkRecord[],
  today: string = todayStr()
): ProjectForecast | null {
  if (!project.estimatedTotalSeconds || project.estimatedTotalSeconds <= 0) return null;

  const relevant = records.filter((r) => !r.excludedFromStats && recordBelongsToProject(r, project.id));
  const spentSeconds = relevant.reduce((sum, r) => sum + r.seconds, 0);
  const remainingSeconds = Math.max(0, project.estimatedTotalSeconds - spentSeconds);
  const daysRemaining = daysBetweenDateStrs(today, project.dueDate);

  if (remainingSeconds <= 0) {
    return {
      spentSeconds,
      remainingSeconds: 0,
      daysRemaining,
      recentPaceSecondsPerDay: 0,
      projectedDaysNeeded: 0,
      requiredPaceSecondsPerDay: null,
      status: "done",
    };
  }

  const windowStartDate = shiftDateStr(today, -(PACE_WINDOW_DAYS - 1));
  const recentSeconds = relevant
    .filter((r) => r.date >= windowStartDate && r.date <= today)
    .reduce((sum, r) => sum + r.seconds, 0);
  const recentPaceSecondsPerDay = recentSeconds / PACE_WINDOW_DAYS;
  const requiredPaceSecondsPerDay = daysRemaining > 0 ? remainingSeconds / daysRemaining : null;
  const projectedDaysNeeded = recentPaceSecondsPerDay > 0 ? remainingSeconds / recentPaceSecondsPerDay : null;

  let status: ProjectForecastStatus;
  if (daysRemaining < 0) {
    status = "overdue";
  } else if (recentPaceSecondsPerDay <= 0) {
    status = "no-recent-pace";
  } else if (projectedDaysNeeded !== null && projectedDaysNeeded <= daysRemaining) {
    status = "on-track";
  } else {
    status = "at-risk";
  }

  return { spentSeconds, remainingSeconds, daysRemaining, recentPaceSecondsPerDay, projectedDaysNeeded, requiredPaceSecondsPerDay, status };
}
