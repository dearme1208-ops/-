import type { WorkRecord } from "./types";

export interface SuggestedTask {
  category: string;
  name: string;
  count: number;
}

const HOUR_WINDOW = 1; // 前後1時間を「近い時間帯」とみなす
const MIN_COUNT = 2; // これ未満の実績数では提案しない

// 同じ曜日・近い時間帯に過去よく行っていた作業を、実績の開始時刻から推定する
export function computeSuggestedTask(records: WorkRecord[], weekday: number, hour: number): SuggestedTask | null {
  const counts = new Map<string, { category: string; name: string; count: number }>();
  for (const r of records) {
    if (!r.startedAt) continue;
    const started = new Date(r.startedAt);
    if (started.getDay() !== weekday) continue;
    const diff = Math.min(
      Math.abs(started.getHours() - hour),
      24 - Math.abs(started.getHours() - hour)
    );
    if (diff > HOUR_WINDOW) continue;
    const key = `${r.category}::${r.name}`;
    if (!counts.has(key)) counts.set(key, { category: r.category, name: r.name, count: 0 });
    counts.get(key)!.count += 1;
  }

  let best: SuggestedTask | null = null;
  for (const v of counts.values()) {
    if (v.count < MIN_COUNT) continue;
    if (!best || v.count > best.count) best = v;
  }
  return best;
}
