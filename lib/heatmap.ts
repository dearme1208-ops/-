import type { WorkRecord } from "./types";

export interface HourDowCellDetail {
  category: string;
  name: string;
  seconds: number; // このマス目内での重なり時間の合計(複数日にまたがる分を合算)
  count: number; // このマス目に重なった実績の件数
  dates: string[]; // 発生日(重複あり得るが日付ごとに重複排除)
}

export interface HourDowMatrix {
  matrix: number[][]; // matrix[dow][hour] = seconds
  max: number;
  details: HourDowCellDetail[][][]; // details[dow][hour] = 内訳(時間降順)
}

// 実績(startedAt〜endedAt)を「曜日×時間帯（0〜23時）」のマス目に分解して積み上げる。
// 定時以降の業務集計と同じ考え方で、時刻ベースに実際の作業時間帯を可視化する。
// 各マス目には、そのマス目に重なった実績の区分・作業名別の内訳も持たせ、
// セルをタップした際の詳細表示に使えるようにする
export function computeHourDowMatrix(records: WorkRecord[]): HourDowMatrix {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const detailMaps: Map<string, HourDowCellDetail>[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => new Map<string, HourDowCellDetail>())
  );
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

      const cellMap = detailMaps[dow][hour];
      const key = `${r.category}::${r.name}`;
      if (!cellMap.has(key)) cellMap.set(key, { category: r.category, name: r.name, seconds: 0, count: 0, dates: [] });
      const cell = cellMap.get(key)!;
      cell.seconds += overlapSeconds;
      cell.count += 1;
      if (!cell.dates.includes(r.date)) cell.dates.push(r.date);
    }
  }

  const details = detailMaps.map((row) =>
    row.map((cellMap) => [...cellMap.values()].sort((a, b) => b.seconds - a.seconds))
  );

  return { matrix, max, details };
}
