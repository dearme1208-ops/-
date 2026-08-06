import type { WorkRecord } from "./types";
import { todayStr } from "./time";

export interface CalendarDay {
  date: string;
  seconds: number;
  weekIndex: number;
  dow: number; // 0=日 ... 6=土
}

export interface CalendarHeatmapData {
  days: CalendarDay[];
  weekCount: number;
  maxSeconds: number;
}

// 今週の土曜日を終端として、weeksBack週分（日曜始まり）のGitHub風カレンダーヒートマップ用データを作る
export function computeCalendarHeatmap(
  records: WorkRecord[],
  weeksBack = 52,
  today: string = todayStr()
): CalendarHeatmapData {
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  }

  const todayDate = new Date(today + "T00:00:00");
  const todayDow = todayDate.getDay();
  const endSaturday = new Date(todayDate.getTime() + (6 - todayDow) * 86400000);
  const startSunday = new Date(endSaturday.getTime() - (weeksBack * 7 - 1) * 86400000);

  const days: CalendarDay[] = [];
  let maxSeconds = 0;
  for (let i = 0; i < weeksBack * 7; i++) {
    const d = new Date(startSunday.getTime() + i * 86400000);
    const dateStr = todayStr(d);
    const seconds = byDate.get(dateStr) ?? 0;
    maxSeconds = Math.max(maxSeconds, seconds);
    days.push({ date: dateStr, seconds, weekIndex: Math.floor(i / 7), dow: d.getDay() });
  }

  return { days, weekCount: weeksBack, maxSeconds };
}

// 0(未記録)〜4(最も多い)の5段階に量子化する
export function heatLevel(seconds: number, maxSeconds: number): number {
  if (seconds <= 0 || maxSeconds <= 0) return 0;
  const ratio = seconds / maxSeconds;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}
