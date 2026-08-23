import type { MasterTask, WorkRecord } from "./types";

export interface TimeOfDayBucket {
  id: string;
  label: string;
  startHour: number; // inclusive
  endHour: number; // exclusive (24 = 翌0時)
}

// 一日を、生活実感に近い7つの時間帯に分ける(重複なく24時間をカバー)
export const TIME_OF_DAY_BUCKETS: TimeOfDayBucket[] = [
  { id: "midnight", label: "深夜", startHour: 0, endHour: 5 },
  { id: "early", label: "早朝", startHour: 5, endHour: 9 },
  { id: "morning", label: "午前", startHour: 9, endHour: 12 },
  { id: "noon", label: "昼", startHour: 12, endHour: 14 },
  { id: "afternoon", label: "午後", startHour: 14, endHour: 18 },
  { id: "evening", label: "夕方", startHour: 18, endHour: 21 },
  { id: "night", label: "夜", startHour: 21, endHour: 24 },
];

function bucketOf(hour: number): TimeOfDayBucket | undefined {
  return TIME_OF_DAY_BUCKETS.find((b) => hour >= b.startHour && hour < b.endHour);
}

export interface TimeOfDayRow {
  bucket: TimeOfDayBucket;
  avgProductivityPct: number;
  sampleCount: number;
  dominantCategory: string;
  dominantCategorySeconds: number;
  totalSeconds: number;
}

const MIN_SAMPLES = 3;

// 実績の開始時刻から時間帯を割り出し、時間帯ごとに「想定時間÷実績時間」の平均(生産性)と、
// 最も時間を使っているカテゴリ(得意分野)を集計する。体調別/天気別の生産性分析と同じ考え方。
export function computeProductivityByTimeOfDay(records: WorkRecord[], masterTasks: MasterTask[]): TimeOfDayRow[] {
  const estimatedByKey = new Map<string, number>();
  for (const m of masterTasks) {
    if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }

  const byBucket = new Map<string, { sumPct: number; count: number; categorySeconds: Map<string, number>; totalSeconds: number }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.startedAt) continue;
    const bucket = bucketOf(new Date(r.startedAt).getHours());
    if (!bucket) continue;
    if (!byBucket.has(bucket.id)) {
      byBucket.set(bucket.id, { sumPct: 0, count: 0, categorySeconds: new Map(), totalSeconds: 0 });
    }
    const entry = byBucket.get(bucket.id)!;
    entry.totalSeconds += r.seconds;
    entry.categorySeconds.set(r.category, (entry.categorySeconds.get(r.category) ?? 0) + r.seconds);

    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (estimatedSeconds) {
      entry.sumPct += (estimatedSeconds / r.seconds) * 100;
      entry.count += 1;
    }
  }

  const rows: TimeOfDayRow[] = [];
  for (const bucket of TIME_OF_DAY_BUCKETS) {
    const entry = byBucket.get(bucket.id);
    if (!entry || entry.count < MIN_SAMPLES) continue;
    let dominantCategory = "";
    let dominantCategorySeconds = 0;
    for (const [category, seconds] of entry.categorySeconds) {
      if (seconds > dominantCategorySeconds) {
        dominantCategory = category;
        dominantCategorySeconds = seconds;
      }
    }
    rows.push({
      bucket,
      avgProductivityPct: Math.round(entry.sumPct / entry.count),
      sampleCount: entry.count,
      dominantCategory,
      dominantCategorySeconds,
      totalSeconds: entry.totalSeconds,
    });
  }
  return rows;
}

export interface TimeOfDayInsight {
  best: TimeOfDayRow;
  worst: TimeOfDayRow;
}

// 最も生産性の高い時間帯・低い時間帯を一言サマリー用に抽出する(2件以上の候補が無ければnull)
export function computeTimeOfDayInsight(rows: TimeOfDayRow[]): TimeOfDayInsight | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => b.avgProductivityPct - a.avgProductivityPct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (best.bucket.id === worst.bucket.id) return null;
  return { best, worst };
}
