import type { MasterTask, WorkRecord } from "./types";
import { daysBetweenDateStrs, formatHms, todayStr } from "./time";

export interface PersonalBest {
  id: string;
  icon: string;
  label: string;
  value: number; // 比較用の生値(秒・件・日・pt)
  valueLabel: string; // 表示用に整形した値
  date: string; // 達成日(YYYY-MM-DD)
  detail?: string; // 作業名など補足
}

const MIN_PRODUCTIVITY_SAMPLE_SECONDS = 60; // 極端に短い作業のpctが偶然跳ねるのを防ぐ下限

// 平均との比較ではなく、これまでの実績の中で最も良かった記録(自己ベスト)を4種類算出する。
// 「1日の最高稼働時間」「1日の最多記録件数」は累計ではなく単日の最大値、
// 「最長連続記録日数」は現在進行中のストリークに関わらず過去最長を、
// 「想定比の最高記録」は個々の作業単位での最速記録を見る
export function computePersonalBests(records: WorkRecord[], masterTasks: MasterTask[]): PersonalBest[] {
  const valid = records.filter((r) => !r.excludedFromStats && r.seconds > 0);
  if (valid.length === 0) return [];

  const secondsByDate = new Map<string, number>();
  const countByDate = new Map<string, number>();
  for (const r of valid) {
    secondsByDate.set(r.date, (secondsByDate.get(r.date) ?? 0) + r.seconds);
    countByDate.set(r.date, (countByDate.get(r.date) ?? 0) + 1);
  }

  let bestDayDate = "";
  let bestDaySeconds = 0;
  for (const [date, sec] of secondsByDate) {
    if (sec > bestDaySeconds) {
      bestDaySeconds = sec;
      bestDayDate = date;
    }
  }

  let bestCountDate = "";
  let bestCount = 0;
  for (const [date, c] of countByDate) {
    if (c > bestCount) {
      bestCount = c;
      bestCountDate = date;
    }
  }

  const sortedDates = [...secondsByDate.keys()].sort();
  let bestStreak = 0;
  let bestStreakEnd = "";
  let curStreak = 0;
  let prevDate: string | null = null;
  for (const d of sortedDates) {
    curStreak = prevDate && daysBetweenDateStrs(prevDate, d) === 1 ? curStreak + 1 : 1;
    if (curStreak > bestStreak) {
      bestStreak = curStreak;
      bestStreakEnd = d;
    }
    prevDate = d;
  }

  const estimatedByKey = new Map<string, number>();
  for (const m of masterTasks) {
    if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }
  let bestPct = 0;
  let bestPctDate = "";
  let bestPctDetail = "";
  for (const r of valid) {
    if (r.seconds < MIN_PRODUCTIVITY_SAMPLE_SECONDS) continue;
    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (!estimatedSeconds) continue;
    const pct = (estimatedSeconds / r.seconds) * 100;
    if (pct > bestPct) {
      bestPct = pct;
      bestPctDate = r.date;
      bestPctDetail = `${r.category} / ${r.name}`;
    }
  }

  const results: PersonalBest[] = [];
  if (bestDayDate) {
    results.push({ id: "best-day-hours", icon: "📅", label: "1日の最高稼働時間", value: bestDaySeconds, valueLabel: formatHms(bestDaySeconds), date: bestDayDate });
  }
  if (bestCountDate) {
    results.push({ id: "best-day-count", icon: "🎯", label: "1日の最多記録件数", value: bestCount, valueLabel: `${bestCount}件`, date: bestCountDate });
  }
  if (bestStreak > 0) {
    results.push({ id: "best-streak", icon: "🔥", label: "最長連続記録日数", value: bestStreak, valueLabel: `${bestStreak}日`, date: bestStreakEnd });
  }
  if (bestPct > 0) {
    results.push({
      id: "best-pct",
      icon: "⚡",
      label: "想定比の最高記録",
      value: Math.round(bestPct),
      valueLabel: `${Math.round(bestPct)}%`,
      date: bestPctDate,
      detail: bestPctDetail,
    });
  }
  return results;
}

// 「今日」その自己ベストを更新したかどうかを判定するため、今日を含む結果と含まない結果を
// 突き合わせる。単に日付が一致するだけでなく、値が実際に上回っている場合のみ「更新」とみなす
export function computeNewBestsToday(records: WorkRecord[], masterTasks: MasterTask[], today: string = todayStr()): Set<string> {
  const withToday = computePersonalBests(records, masterTasks);
  const withoutToday = computePersonalBests(records.filter((r) => r.date !== today), masterTasks);
  const withoutMap = new Map(withoutToday.map((b) => [b.id, b.value]));
  const updated = new Set<string>();
  for (const b of withToday) {
    if (b.date !== today) continue;
    const prevValue = withoutMap.get(b.id);
    if (prevValue === undefined || b.value > prevValue) updated.add(b.id);
  }
  return updated;
}
