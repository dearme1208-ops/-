import type { WorkRecord } from "./types";

export interface HourDowMatrix {
  matrix: number[][]; // matrix[dow][hour] = seconds
  max: number;
}

// 実績(startedAt〜endedAt)を「曜日×時間帯（0〜23時）」のマス目に分解して積み上げる。
// 定時以降の業務集計と同じ考え方で、時刻ベースに実際の作業時間帯を可視化する
export function computeHourDowMatrix(records: WorkRecord[]): HourDowMatrix {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;

  for (const r of records) {
    if (!r.startedAt || !r.endedAt || r.endedAt <= r.startedAt) continue;
    const dayStart = new Date(r.date + "T00:00:00").getTime();
    const dow = new Date(r.date + "T12:00:00").getDay();
    for (let hour = 0; hour < 24; hour++) {
      const hourStart = dayStart + hour * 3600000;
      const hourEnd = hourStart + 3600000;
      const overlapStart = Math.max(r.startedAt, hourStart);
      const overlapEnd = Math.min(r.endedAt, hourEnd);
      const overlapSeconds = Math.max(0, (overlapEnd - overlapStart) / 1000);
      if (overlapSeconds <= 0) continue;
      matrix[dow][hour] += overlapSeconds;
      max = Math.max(max, matrix[dow][hour]);
    }
  }

  return { matrix, max };
}
