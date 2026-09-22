import type { ProjectItem, WorkRecord } from "./types";
import { isStageDone } from "./projectStage";
import { daysBetweenDateStrs, shiftDateStr, todayStr } from "./time";
import { percentile, MIN_DISTRIBUTION_SAMPLES } from "./estimation";

// 「案件の段階を本日の作業に反映して、実際にどれだけ完了しているか」を横断的に見る。
//
// このアプリには段階の完了時刻(ProjectStage.completedAt)と、段階に紐づく実績
// (WorkRecord.stageId、本日の作業から段階を完了させた際に付く)が既にあるのに、
// この2つを突き合わせた分析がどこにも無かった。ここではその橋渡しをする。
//
// 「反映された」の定義: その段階に紐づく実績(stageId一致・秒数>0)が1件以上ある。
// 案件タブでチェックだけ入れて実績が一切無い段階(見積もりだけ立てて未着手のもの)は
// 対象から外す ―― 「反映して実際に手を動かした段階」だけを見るための絞り込み

export interface StageProgressRow {
  projectId: string;
  projectTitle: string;
  projectCompleted: boolean;
  stageId: string;
  stageTitle: string;
  completed: boolean;
  completedAt: number | null;
  /** 最初にこの段階へ実績が付いた日(=反映されて着手した日) */
  firstTouchDate: string;
  /** 最後に実績が付いた日 */
  lastTouchDate: string;
  /** 完了済みの段階だけ持つ、着手から完了までの日数 */
  leadTimeDays: number | null;
  /** 未完了の段階だけ持つ、最後に手を付けてからの経過日数 */
  daysSinceLastActivity: number | null;
}

export function buildStageProgressRows(
  projects: ProjectItem[],
  records: WorkRecord[],
  today: string = todayStr()
): StageProgressRow[] {
  const touch = new Map<string, { first: string; last: string }>();
  for (const r of records) {
    if (!r.stageId || r.seconds <= 0) continue;
    const cur = touch.get(r.stageId);
    if (!cur) touch.set(r.stageId, { first: r.date, last: r.date });
    else {
      if (r.date < cur.first) cur.first = r.date;
      if (r.date > cur.last) cur.last = r.date;
    }
  }

  const rows: StageProgressRow[] = [];
  for (const p of projects) {
    for (const s of p.stages ?? []) {
      const t = touch.get(s.id);
      if (!t) continue;
      const completed = isStageDone(s);
      const leadTimeDays =
        completed && s.completedAt != null ? daysBetweenDateStrs(t.first, todayStr(new Date(s.completedAt))) : null;
      const daysSinceLastActivity = completed ? null : daysBetweenDateStrs(t.last, today);
      rows.push({
        projectId: p.id,
        projectTitle: p.title,
        projectCompleted: !!p.completedAt,
        stageId: s.id,
        stageTitle: s.title,
        completed,
        completedAt: s.completedAt ?? null,
        firstTouchDate: t.first,
        lastTouchDate: t.last,
        leadTimeDays,
        daysSinceLastActivity,
      });
    }
  }
  return rows;
}

// --- ① 反映→完了率 -------------------------------------------------------

export interface ProjectConversionRow {
  projectId: string;
  projectTitle: string;
  touchedCount: number;
  completedCount: number;
}

export interface StageConversionSummary {
  touchedCount: number;
  completedCount: number;
  /** 0〜1。反映(着手)した段階のうち実際に完了した割合 */
  rate: number | null;
  /** 完了率が低い(=着手したまま残っている段階が多い)順。1件だけ着手した案件のノイズを
      避けるため、着手2件以上の案件だけを対象にする */
  byProject: ProjectConversionRow[];
}

export function computeStageConversion(rows: StageProgressRow[]): StageConversionSummary {
  const touchedCount = rows.length;
  const completedCount = rows.filter((r) => r.completed).length;

  const byProjectMap = new Map<string, ProjectConversionRow>();
  for (const r of rows) {
    const row = byProjectMap.get(r.projectId) ?? {
      projectId: r.projectId,
      projectTitle: r.projectTitle,
      touchedCount: 0,
      completedCount: 0,
    };
    row.touchedCount++;
    if (r.completed) row.completedCount++;
    byProjectMap.set(r.projectId, row);
  }

  const byProject = [...byProjectMap.values()]
    .filter((r) => r.touchedCount >= 2)
    .sort((a, b) => b.touchedCount - b.completedCount - (a.touchedCount - a.completedCount));

  return {
    touchedCount,
    completedCount,
    rate: touchedCount > 0 ? completedCount / touchedCount : null,
    byProject,
  };
}

// --- ② 段階のリードタイム(P50/P80) ---------------------------------------

export interface StageLeadTimeSummary {
  sampleCount: number;
  p50Days: number | null;
  p80Days: number | null;
  maxDays: number | null;
}

export function computeStageLeadTime(rows: StageProgressRow[]): StageLeadTimeSummary {
  const values = rows
    .map((r) => r.leadTimeDays)
    .filter((v): v is number => v != null && v >= 0)
    .sort((a, b) => a - b);
  if (values.length < MIN_DISTRIBUTION_SAMPLES) {
    return { sampleCount: values.length, p50Days: null, p80Days: null, maxDays: null };
  }
  return {
    sampleCount: values.length,
    p50Days: Math.round(percentile(values, 0.5)),
    p80Days: Math.round(percentile(values, 0.8)),
    maxDays: values[values.length - 1],
  };
}

// --- ③ 放置されている段階 --------------------------------------------------

export interface StalledStageRow extends StageProgressRow {
  daysSinceLastActivity: number;
}

export const FALLBACK_STALLED_THRESHOLD_DAYS = 10;

/**
 * 完了済みの段階が「普段どれくらいの日数で終わっているか」(P50)を基準に、
 * それを超えて音沙汰の無い未完了の段階を「放置されている」とみなす。
 * リードタイムの実測が十分に無いうちは固定のしきい値にフォールバックする
 */
export function computeStalledStages(rows: StageProgressRow[], leadTime: StageLeadTimeSummary): StalledStageRow[] {
  const threshold = leadTime.p50Days ?? FALLBACK_STALLED_THRESHOLD_DAYS;
  return rows
    .filter(
      (r): r is StageProgressRow & { daysSinceLastActivity: number } =>
        !r.completed && !r.projectCompleted && r.daysSinceLastActivity != null && r.daysSinceLastActivity > threshold
    )
    .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity);
}

// --- ④ ゲーミフィケーション用の集計 -----------------------------------------

/** 全案件を通して、段階が完了した日付ごとの件数 */
export function stageCompletionCountByDate(projects: ProjectItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of projects) {
    for (const s of p.stages ?? []) {
      if (!isStageDone(s) || s.completedAt == null) continue;
      const date = todayStr(new Date(s.completedAt));
      map.set(date, (map.get(date) ?? 0) + 1);
    }
  }
  return map;
}

export function countStagesCompletedOn(projects: ProjectItem[], dateStr: string): number {
  return stageCompletionCountByDate(projects).get(dateStr) ?? 0;
}

export interface CompletedStageOn {
  projectTitle: string;
  stageTitle: string;
}

/** 指定した日に完了した段階の一覧(自己ベストの詳細表示用) */
export function stagesCompletedOn(projects: ProjectItem[], dateStr: string): CompletedStageOn[] {
  const out: CompletedStageOn[] = [];
  for (const p of projects) {
    for (const s of p.stages ?? []) {
      if (!isStageDone(s) || s.completedAt == null) continue;
      if (todayStr(new Date(s.completedAt)) === dateStr) out.push({ projectTitle: p.title, stageTitle: s.title });
    }
  }
  return out;
}

// --- ⑤ 段階数ベースのペース予測 --------------------------------------------

export type StagePaceForecastStatus = "done" | "overdue" | "no-recent-pace" | "on-track" | "at-risk";

export interface StagePaceForecast {
  totalStages: number;
  completedStages: number;
  remainingStages: number;
  daysRemaining: number; // 期日までの日数(超過している場合は負)
  recentPacePerDay: number; // 直近PACE_WINDOW_DAYS日の1日あたり平均完了段階数
  projectedDaysNeeded: number | null; // 直近ペースのまま進んだ場合、残りをこなすのに要する日数
  requiredPacePerDay: number | null; // 期日に間に合わせるために今後必要な1日あたりの完了段階数
  status: StagePaceForecastStatus;
}

const STAGE_PACE_WINDOW_DAYS = 14;

// computeProjectForecast(見積もり総所要時間ベース)の、段階数版。パワプロのマイライフ準備の
// 選手リストのように、時間を見積もらず「段階(項目)を1つずつ消化していく」運用の案件では
// 所要時間の実績が無く時間ベースの予測が使えないため、代わりに段階の完了時刻(completedAt)
// から直近の消化ペースを求め、期日に間に合いそうかを判定する。
// 見積もり総所要時間が設定されている案件はcomputeProjectForecastを優先し、こちらは
// それが使えない(段階はあるが見積もりが無い)場合のフォールバックとして使う
export function computeStagePaceForecast(project: ProjectItem, today: string = todayStr()): StagePaceForecast | null {
  const stages = project.stages ?? [];
  if (stages.length === 0) return null;

  const totalStages = stages.length;
  const completedStages = stages.filter((s) => isStageDone(s)).length;
  const remainingStages = totalStages - completedStages;
  const daysRemaining = daysBetweenDateStrs(today, project.dueDate);

  if (remainingStages <= 0) {
    return {
      totalStages,
      completedStages,
      remainingStages: 0,
      daysRemaining,
      recentPacePerDay: 0,
      projectedDaysNeeded: 0,
      requiredPacePerDay: null,
      status: "done",
    };
  }

  const windowStartDate = shiftDateStr(today, -(STAGE_PACE_WINDOW_DAYS - 1));
  const recentCompletedCount = stages.filter((s) => {
    if (!isStageDone(s) || s.completedAt == null) return false;
    const d = todayStr(new Date(s.completedAt));
    return d >= windowStartDate && d <= today;
  }).length;
  const recentPacePerDay = recentCompletedCount / STAGE_PACE_WINDOW_DAYS;
  const requiredPacePerDay = daysRemaining > 0 ? remainingStages / daysRemaining : null;
  const projectedDaysNeeded = recentPacePerDay > 0 ? remainingStages / recentPacePerDay : null;

  let status: StagePaceForecastStatus;
  if (daysRemaining < 0) {
    status = "overdue";
  } else if (recentPacePerDay <= 0) {
    status = "no-recent-pace";
  } else if (projectedDaysNeeded !== null && projectedDaysNeeded <= daysRemaining) {
    status = "on-track";
  } else {
    status = "at-risk";
  }

  return {
    totalStages,
    completedStages,
    remainingStages,
    daysRemaining,
    recentPacePerDay,
    projectedDaysNeeded,
    requiredPacePerDay,
    status,
  };
}
