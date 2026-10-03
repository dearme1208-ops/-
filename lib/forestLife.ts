import { daysBetweenDateStrs, shiftDateStr } from "./time";
import type { MasterTask, WorkRecord } from "./types";

// 森モード(家庭で毎日使うモード)の、記録で育つものの計算。
// 見出しの森は時刻と季節で変わるだけだったので、ここでは実際の記録から
// 「この4週間の木立」と「暮らしの手入れ(家事を前回からの間隔で見る)」を導く

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

export type CareState = "fresh" | "soon" | "due" | "overgrown";

export interface CareItem {
  masterId: string;
  label: string;
  category: string;
  name: string;
  /** 前回から何日たったか */
  sinceDays: number;
  /** いつもの間隔(日)。記録の日付の間隔の中央値 */
  usualDays: number;
  state: CareState;
  /** 前回から ÷ いつもの間隔 */
  ratio: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 暮らしの手入れ。家事は期限より「前回からの間隔」が大事なので、作業ごとに記録の日付の
 * 間隔からいつもの間隔を求め、前回からの日数と比べる。設定は要らない(3回以上記録した作業が対象)
 */
export function buildCare(records: WorkRecord[], masters: MasterTask[], today: string, ignored: string[] = []): CareItem[] {
  const since = shiftDateStr(today, -180);
  const dates = new Map<string, Set<string>>();
  for (const r of records) {
    if (!r.masterTaskId || r.date < since || r.date > today) continue;
    const set = dates.get(r.masterTaskId) ?? new Set<string>();
    set.add(r.date);
    dates.set(r.masterTaskId, set);
  }
  const out: CareItem[] = [];
  for (const m of masters) {
    if (m.archived || m.excludedFromHome || ignored.includes(m.id)) continue;
    const ds = [...(dates.get(m.id) ?? [])].sort();
    if (ds.length < 3) continue;
    const gaps = ds.slice(1).map((d, i) => daysBetweenDateStrs(ds[i], d));
    const usualDays = Math.max(1, Math.round(median(gaps)));
    const sinceDays = daysBetweenDateStrs(ds[ds.length - 1], today);
    const ratio = sinceDays / usualDays;
    const state: CareState = ratio >= 1.5 ? "overgrown" : ratio >= 1 ? "due" : ratio >= 0.75 ? "soon" : "fresh";
    out.push({ masterId: m.id, label: `${m.category} / ${m.name}`, category: m.category, name: m.name, sinceDays, usualDays, state, ratio });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}
