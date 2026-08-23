import type { ConditionLog, MasterTask, WorkRecord } from "./types";
import { isoWeekKey } from "./trend";

export interface BurnoutRiskResult {
  hoursChangePct: number; // 直近3週の週平均稼働時間が、その前の3週と比べて何%増えたか
  productivityChangePt: number; // 想定比(想定時間÷実績時間)が何pt下がったか(マイナス=悪化)
  conditionChangeLevel: number; // 体調レベル(1〜5)の平均が何下がったか(マイナス=悪化)
  recentAvgHoursPerWeek: number;
  priorAvgHoursPerWeek: number;
}

const RECENT_WEEKS = 3;
const PRIOR_WEEKS = 3;
const MIN_MATCHED_SAMPLES = 3;
const MIN_CONDITION_SAMPLES = 3;
const HOURS_INCREASE_THRESHOLD_PCT = 15;
const PRODUCTIVITY_DROP_THRESHOLD_PT = 10;
const CONDITION_DROP_THRESHOLD = 0.3;

function weekOfDateStr(dateStr: string): string {
  return isoWeekKey(new Date(dateStr + "T12:00:00"));
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// 稼働時間の増加・想定時間に対する生産性の低下・体調の悪化という3つの傾向が、
// 直近3週間で「同時に」その前の3週間より悪い方向に動いているかを見る。
// どれか1つだけでは判断材料として弱い(残業が多いだけ/たまたま調子が悪いだけ、等)ため、
// 3つ全てが閾値を超えて悪化している場合だけ知らせることで、過剰な警告を避ける
export function computeBurnoutRisk(
  records: WorkRecord[],
  masterTasks: MasterTask[],
  conditionLogs: ConditionLog[],
  now: Date = new Date()
): BurnoutRiskResult | null {
  const weekKeys: string[] = [];
  for (let i = RECENT_WEEKS + PRIOR_WEEKS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weekKeys.push(isoWeekKey(d));
  }
  const recentKeys = new Set(weekKeys.slice(PRIOR_WEEKS));
  const priorKeys = new Set(weekKeys.slice(0, PRIOR_WEEKS));

  const estimatedByKey = new Map<string, number>();
  for (const m of masterTasks) {
    if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }

  let recentSeconds = 0;
  let priorSeconds = 0;
  const recentPcts: number[] = [];
  const priorPcts: number[] = [];
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const wk = weekOfDateStr(r.date);
    const inRecent = recentKeys.has(wk);
    const inPrior = priorKeys.has(wk);
    if (!inRecent && !inPrior) continue;
    if (inRecent) recentSeconds += r.seconds;
    else priorSeconds += r.seconds;

    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (estimatedSeconds && r.seconds > 0) {
      const pct = (estimatedSeconds / r.seconds) * 100;
      if (inRecent) recentPcts.push(pct);
      else priorPcts.push(pct);
    }
  }

  const recentAvgHoursPerWeek = recentSeconds / 3600 / RECENT_WEEKS;
  const priorAvgHoursPerWeek = priorSeconds / 3600 / PRIOR_WEEKS;
  if (recentAvgHoursPerWeek <= 0 || priorAvgHoursPerWeek <= 0) return null;
  const hoursChangePct = ((recentAvgHoursPerWeek - priorAvgHoursPerWeek) / priorAvgHoursPerWeek) * 100;

  if (recentPcts.length < MIN_MATCHED_SAMPLES || priorPcts.length < MIN_MATCHED_SAMPLES) return null;
  const productivityChangePt = avg(recentPcts) - avg(priorPcts);

  const recentLevels: number[] = [];
  const priorLevels: number[] = [];
  for (const log of conditionLogs) {
    const level = Number(log.level);
    if (!Number.isFinite(level)) continue;
    const wk = weekOfDateStr(log.date);
    if (recentKeys.has(wk)) recentLevels.push(level);
    else if (priorKeys.has(wk)) priorLevels.push(level);
  }
  if (recentLevels.length < MIN_CONDITION_SAMPLES || priorLevels.length < MIN_CONDITION_SAMPLES) return null;
  const conditionChangeLevel = avg(recentLevels) - avg(priorLevels);

  const triggered =
    hoursChangePct >= HOURS_INCREASE_THRESHOLD_PCT &&
    productivityChangePt <= -PRODUCTIVITY_DROP_THRESHOLD_PT &&
    conditionChangeLevel <= -CONDITION_DROP_THRESHOLD;
  if (!triggered) return null;

  return {
    hoursChangePct: Math.round(hoursChangePct),
    productivityChangePt: Math.round(productivityChangePt),
    conditionChangeLevel: Math.round(conditionChangeLevel * 10) / 10,
    recentAvgHoursPerWeek,
    priorAvgHoursPerWeek,
  };
}
