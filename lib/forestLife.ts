import { shiftDateStr } from "./time";
import type { WorkRecord } from "./types";

// 森モード(家庭で毎日使うモード)の、記録で育つものの計算。
// 見出しの森は時刻と季節で変わるだけだったので、ここでは実際の記録から
// 「この4週間の木立」を導く

export type GroveStage = "none" | "sprout" | "young" | "tree";

export interface GroveDay {
  date: string;
  hours: number;
  /** その日に記録した作業の件数(実の数。多くても5つまで描く) */
  fruits: number;
  stage: GroveStage;
}

export function groveStage(hours: number): GroveStage {
  if (hours <= 0) return "none";
  if (hours < 1) return "sprout";
  if (hours < 3) return "young";
  return "tree";
}

/** 今日までの days 日分。記録した日だけ木が立ち、時間で育ち、件数だけ実がなる */
export function buildGrove(records: WorkRecord[], today: string, days = 28): GroveDay[] {
  const from = shiftDateStr(today, -(days - 1));
  const sec = new Map<string, number>();
  const cnt = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats || r.date < from || r.date > today) continue;
    sec.set(r.date, (sec.get(r.date) ?? 0) + r.seconds);
    cnt.set(r.date, (cnt.get(r.date) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = shiftDateStr(from, i);
    const hours = (sec.get(date) ?? 0) / 3600;
    return { date, hours, fruits: cnt.get(date) ?? 0, stage: groveStage(hours) };
  });
}

/** 今日(記録がまだ無ければ昨日)から遡って、記録が続いている日数 */
export function groveStreak(grove: GroveDay[]): number {
  let i = grove.length - 1;
  if (i >= 0 && grove[i].stage === "none") i--;
  let n = 0;
  for (; i >= 0 && grove[i].stage !== "none"; i--) n++;
  return n;
}
