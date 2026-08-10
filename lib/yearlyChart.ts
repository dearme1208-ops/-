import type { WorkRecord } from "./types";

export interface MonthlyLaborStat {
  month: string; // YYYY-MM
  label: string; // "4月" など
  totalSeconds: number;
  normalSeconds: number; // 所定時間内（労働日数×所定労働時間を上限）
  overtimeSeconds: number; // 所定時間を超えた分
  avgTaskSeconds: number; // その月の実績1件あたりの平均時間
  taskCount: number;
  workDays: number;
}

// 年度(4月始まり)の12ヶ月分について、月ごとの実績合計・所定時間内/残業時間の内訳・
// 平均作業時間を求める。残業時間 = 総実績 - (入力された労働日数 × 所定労働時間)（0未満は0）
export function computeMonthlyLaborStats(
  records: WorkRecord[],
  fiscalYear: number,
  standardDailyHours: number,
  workDaysByMonth: Map<string, number>
): MonthlyLaborStat[] {
  const byMonth = new Map<string, { totalSeconds: number; count: number }>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const month = r.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { totalSeconds: 0, count: 0 });
    const entry = byMonth.get(month)!;
    entry.totalSeconds += r.seconds;
    entry.count += 1;
  }

  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const y = fiscalYear + Math.floor((3 + i) / 12);
    const m = ((3 + i) % 12) + 1;
    months.push(`${y}-${String(m).padStart(2, "0")}`);
  }

  return months.map((month) => {
    const entry = byMonth.get(month) ?? { totalSeconds: 0, count: 0 };
    const workDays = workDaysByMonth.get(month) ?? 0;
    const baselineSeconds = workDays * standardDailyHours * 3600;
    const overtimeSeconds = Math.max(0, entry.totalSeconds - baselineSeconds);
    const normalSeconds = entry.totalSeconds - overtimeSeconds;
    const monthNum = Number(month.slice(5, 7));
    return {
      month,
      label: `${monthNum}月`,
      totalSeconds: entry.totalSeconds,
      normalSeconds,
      overtimeSeconds,
      avgTaskSeconds: entry.count > 0 ? entry.totalSeconds / entry.count : 0,
      taskCount: entry.count,
      workDays,
    };
  });
}

// 変動が激しい月（前月からの実績合計の増減率が大きい月）を上位N件ピックアップする。
// 星マークを表示する対象の判定に使う
export function pickVolatileMonths(stats: MonthlyLaborStat[], topN = 3): Set<string> {
  const changes: { month: string; absChangeRatio: number }[] = [];
  for (let i = 1; i < stats.length; i++) {
    const prev = stats[i - 1].totalSeconds;
    const cur = stats[i].totalSeconds;
    if (prev <= 0 && cur <= 0) continue;
    const ratio = prev > 0 ? Math.abs(cur - prev) / prev : 1;
    changes.push({ month: stats[i].month, absChangeRatio: ratio });
  }
  changes.sort((a, b) => b.absChangeRatio - a.absChangeRatio);
  return new Set(changes.slice(0, topN).map((c) => c.month));
}

export interface MonthTaskDeviationRow {
  key: string;
  category: string;
  name: string;
  monthAvgSeconds: number;
  otherAvgSeconds: number; // 同年度内の他の月における平均
  deltaSeconds: number; // monthAvgSeconds - otherAvgSeconds
  monthCount: number;
}

function taskKey(r: WorkRecord): string {
  return r.isTrouble ? `__trouble__::${r.category}` : (r.masterTaskId ?? `${r.category}::${r.name}`);
}

// 指定した月について、同じ年度内の他の月と比べて平均作業時間が長くなった/短くなった
// 作業をランキングする（両方の期間に実績がある作業のみが対象）
export function computeMonthTaskDeviationRanking(
  records: WorkRecord[],
  month: string,
  fiscalYear: number,
  minSampleCount = 2
): { increased: MonthTaskDeviationRow[]; decreased: MonthTaskDeviationRow[] } {
  const fyStart = `${fiscalYear}-04`;
  const fyEnd = `${fiscalYear + 1}-03`;
  const inFiscalYear = records.filter(
    (r) => !r.excludedFromStats && r.date.slice(0, 7) >= fyStart && r.date.slice(0, 7) <= fyEnd
  );

  const monthMap = new Map<string, { category: string; name: string; total: number; count: number }>();
  const otherMap = new Map<string, { category: string; name: string; total: number; count: number }>();

  for (const r of inFiscalYear) {
    const key = taskKey(r);
    const isThisMonth = r.date.slice(0, 7) === month;
    const target = isThisMonth ? monthMap : otherMap;
    if (!target.has(key)) {
      target.set(key, { category: r.category, name: r.isTrouble ? "（全件合計）" : r.name, total: 0, count: 0 });
    }
    const entry = target.get(key)!;
    entry.total += r.seconds;
    entry.count += 1;
  }

  const rows: MonthTaskDeviationRow[] = [];
  for (const [key, m] of monthMap) {
    const other = otherMap.get(key);
    if (!other || m.count < minSampleCount || other.count < minSampleCount) continue;
    const monthAvgSeconds = m.total / m.count;
    const otherAvgSeconds = other.total / other.count;
    rows.push({
      key,
      category: m.category,
      name: m.name,
      monthAvgSeconds,
      otherAvgSeconds,
      deltaSeconds: monthAvgSeconds - otherAvgSeconds,
      monthCount: m.count,
    });
  }

  return {
    increased: rows.filter((r) => r.deltaSeconds > 0).sort((a, b) => b.deltaSeconds - a.deltaSeconds),
    decreased: rows.filter((r) => r.deltaSeconds < 0).sort((a, b) => a.deltaSeconds - b.deltaSeconds),
  };
}
