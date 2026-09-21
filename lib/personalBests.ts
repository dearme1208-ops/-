import type { MasterTask, ProjectItem, WorkRecord } from "./types";
import { daysBetweenDateStrs, formatDateJp, formatHms, shiftDateStr, todayStr } from "./time";
import { stageCompletionCountByDate, stagesCompletedOn } from "./stageProgress";

export interface PersonalBest {
  id: string;
  icon: string;
  label: string;
  value: number; // 比較用の生値(秒・件・日・pt)
  valueLabel: string; // 表示用に整形した値
  date: string; // 達成日(YYYY-MM-DD)。連続記録系はストリークの最終日
  detail?: string; // 作業名など補足
  rangeStart?: string; // 連続記録系のみ、ストリークの初日(YYYY-MM-DD)
  recordId?: string; // 想定比の最高記録のみ、その元になった実績のID(同日同名の重複を避けるため)
}

const MIN_PRODUCTIVITY_SAMPLE_SECONDS = 60; // 極端に短い作業のpctが偶然跳ねるのを防ぐ下限

// 平均との比較ではなく、これまでの実績の中で最も良かった記録(自己ベスト)を4種類算出する。
// 「1日の最高稼働時間」「1日の最多記録件数」は累計ではなく単日の最大値、
// 「最長連続記録日数」は現在進行中のストリークに関わらず過去最長を、
// 「想定比の最高記録」は個々の作業単位での最速記録を見る
export function computePersonalBests(
  records: WorkRecord[],
  masterTasks: MasterTask[],
  projects: ProjectItem[] = []
): PersonalBest[] {
  const valid = records.filter((r) => !r.excludedFromStats && r.seconds > 0);
  const stageBests = computeStageBests(projects);
  if (valid.length === 0) return stageBests;

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
  let bestStreakStart = "";
  let curStreak = 0;
  let curStreakStart = "";
  let prevDate: string | null = null;
  for (const d of sortedDates) {
    if (prevDate && daysBetweenDateStrs(prevDate, d) === 1) {
      curStreak += 1;
    } else {
      curStreak = 1;
      curStreakStart = d;
    }
    if (curStreak > bestStreak) {
      bestStreak = curStreak;
      bestStreakEnd = d;
      bestStreakStart = curStreakStart;
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
  let bestPctRecordId = "";
  for (const r of valid) {
    if (r.seconds < MIN_PRODUCTIVITY_SAMPLE_SECONDS) continue;
    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (!estimatedSeconds) continue;
    const pct = (estimatedSeconds / r.seconds) * 100;
    if (pct > bestPct) {
      bestPct = pct;
      bestPctDate = r.date;
      bestPctDetail = `${r.category} / ${r.name}`;
      bestPctRecordId = r.id;
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
    results.push({
      id: "best-streak",
      icon: "🔥",
      label: "最長連続記録日数",
      value: bestStreak,
      valueLabel: `${bestStreak}日`,
      date: bestStreakEnd,
      rangeStart: bestStreakStart,
    });
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
      recordId: bestPctRecordId,
    });
  }
  results.push(...stageBests);
  return results;
}

// 案件の段階(マイルストーン)完了だけを見た自己ベスト。時間の実績(WorkRecord)とは
// 独立した記録なので、実績が1件も無い(=まだ何も計測していない)状態でも成立する
function computeStageBests(projects: ProjectItem[]): PersonalBest[] {
  const countByDate = stageCompletionCountByDate(projects);
  if (countByDate.size === 0) return [];

  let bestDayDate = "";
  let bestDayCount = 0;
  for (const [date, count] of countByDate) {
    if (count > bestDayCount) {
      bestDayCount = count;
      bestDayDate = date;
    }
  }

  const sortedDates = [...countByDate.keys()].sort();
  let bestStreak = 0;
  let bestStreakEnd = "";
  let bestStreakStart = "";
  let curStreak = 0;
  let curStreakStart = "";
  let prevDate: string | null = null;
  for (const d of sortedDates) {
    if (prevDate && daysBetweenDateStrs(prevDate, d) === 1) {
      curStreak += 1;
    } else {
      curStreak = 1;
      curStreakStart = d;
    }
    if (curStreak > bestStreak) {
      bestStreak = curStreak;
      bestStreakEnd = d;
      bestStreakStart = curStreakStart;
    }
    prevDate = d;
  }

  const results: PersonalBest[] = [];
  if (bestDayCount > 0) {
    results.push({
      id: "best-stage-day-count",
      icon: "🧩",
      label: "1日の最多段階完了数",
      value: bestDayCount,
      valueLabel: `${bestDayCount}件`,
      date: bestDayDate,
    });
  }
  if (bestStreak > 1) {
    results.push({
      id: "best-stage-streak",
      icon: "🔗",
      label: "段階完了の連続記録",
      value: bestStreak,
      valueLabel: `${bestStreak}日`,
      date: bestStreakEnd,
      rangeStart: bestStreakStart,
    });
  }
  return results;
}

// 「今日」その自己ベストを更新したかどうかを判定するため、今日を含む結果と含まない結果を
// 突き合わせる。単に日付が一致するだけでなく、値が実際に上回っている場合のみ「更新」とみなす
export function computeNewBestsToday(
  records: WorkRecord[],
  masterTasks: MasterTask[],
  today: string = todayStr(),
  projects: ProjectItem[] = []
): Set<string> {
  const withToday = computePersonalBests(records, masterTasks, projects);
  // 段階の自己ベストは実績(records)ではなくprojectsから独立に算出されるため、
  // 「今日を除いた場合」を作るにはrecordsのフィルタだけでは足りず、今日完了した
  // 段階もここで取り除いておく必要がある
  const projectsWithoutToday = projects.map((p) => ({
    ...p,
    stages: (p.stages ?? []).filter((s) => !(s.completedAt && todayStr(new Date(s.completedAt)) === today)),
  }));
  const withoutToday = computePersonalBests(
    records.filter((r) => r.date !== today),
    masterTasks,
    projectsWithoutToday
  );
  const withoutMap = new Map(withoutToday.map((b) => [b.id, b.value]));
  const updated = new Set<string>();
  for (const b of withToday) {
    if (b.date !== today) continue;
    const prevValue = withoutMap.get(b.id);
    if (prevValue === undefined || b.value > prevValue) updated.add(b.id);
  }
  return updated;
}

export interface PersonalBestDetailRow {
  label: string;
  sublabel?: string;
  value: string;
}

export interface PersonalBestDetail {
  title: string;
  intro?: string;
  rows: PersonalBestDetailRow[];
  emptyMessage?: string;
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftDateStr(d, 1)) {
    out.push(d);
    if (out.length > 400) break; // 壊れた範囲で無限ループしないための保険
  }
  return out;
}

// カードをタップした際の内訳。自己ベストの種類ごとに「何がその記録を作ったか」を
// 遡って見せる。値は再計算せず、達成日・範囲・(想定比のみ)元の実績IDから
// 該当する実績・段階をrecords/projectsから引き直すだけにしてある
export function buildPersonalBestDetail(
  best: PersonalBest,
  records: WorkRecord[],
  projects: ProjectItem[]
): PersonalBestDetail {
  switch (best.id) {
    case "best-day-hours":
    case "best-day-count": {
      const dayRecords = records
        .filter((r) => !r.excludedFromStats && r.seconds > 0 && r.date === best.date)
        .sort((a, b) => b.seconds - a.seconds);
      return {
        title: `${formatDateJp(best.date)}の実績`,
        rows: dayRecords.map((r) => ({ label: r.name, sublabel: r.category, value: formatHms(r.seconds) })),
        emptyMessage: "この日の実績が見当たりません。",
      };
    }
    case "best-streak": {
      const start = best.rangeStart ?? best.date;
      const byDate = new Map<string, number>();
      for (const r of records) {
        if (r.excludedFromStats || r.seconds <= 0) continue;
        byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
      }
      return {
        title: `${formatDateJp(start)}〜${formatDateJp(best.date)}の連続記録`,
        intro: `${best.valueLabel}続けて実績が記録されています(土日は記録が無くても途切れません)`,
        rows: enumerateDates(start, best.date).map((d) => ({ label: formatDateJp(d), value: formatHms(byDate.get(d) ?? 0) })),
      };
    }
    case "best-pct": {
      const record = records.find((r) => r.id === best.recordId);
      if (!record) return { title: best.label, rows: [], emptyMessage: "元になった実績が見当たりません。" };
      return {
        title: `${record.category} / ${record.name}`,
        intro: formatDateJp(record.date),
        rows: [{ label: "実際にかかった時間", value: formatHms(record.seconds) }],
      };
    }
    case "best-stage-day-count": {
      const stages = stagesCompletedOn(projects, best.date);
      return {
        title: `${formatDateJp(best.date)}に完了した段階`,
        rows: stages.map((s) => ({ label: s.stageTitle, sublabel: s.projectTitle, value: "完了" })),
        emptyMessage: "この日に完了した段階が見当たりません。",
      };
    }
    case "best-stage-streak": {
      const start = best.rangeStart ?? best.date;
      return {
        title: `${formatDateJp(start)}〜${formatDateJp(best.date)}の連続記録`,
        intro: `${best.valueLabel}連続で段階が完了しています`,
        rows: enumerateDates(start, best.date).map((d) => {
          const stages = stagesCompletedOn(projects, d);
          return {
            label: formatDateJp(d),
            value: stages.length > 0 ? stages.map((s) => s.stageTitle).join("、") : "—",
          };
        }),
      };
    }
    default:
      return { title: best.label, rows: [] };
  }
}
