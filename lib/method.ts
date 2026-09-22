import { aggregateKey } from "./aggregate";
import type { WorkRecord } from "./types";

// 「手段」（Excel→マクロ→クエリ→Claude、といった作業のやり方の変化）にまつわる集計。
// 手段自体はcategory/nameとは独立した自由入力の文字列で、同じ作業(aggregateKeyが同じ)の
// 実績群を手段ごとに束ねることで、やり方を変えた前後の所要時間の変化を比較できるようにする

export const UNSET_METHOD_LABEL = "（未設定）";

// 実績全体から、過去に入力された手段の候補一覧を返す(入力欄のdatalist用)。
// 使用頻度が高い順、同数なら直近に使われた順で並べる
export function collectMethodSuggestions(records: WorkRecord[]): string[] {
  const stats = new Map<string, { count: number; lastUsed: number }>();
  for (const r of records) {
    const m = r.method?.trim();
    if (!m) continue;
    const s = stats.get(m) ?? { count: 0, lastUsed: 0 };
    s.count += 1;
    s.lastUsed = Math.max(s.lastUsed, r.endedAt);
    stats.set(m, s);
  }
  return [...stats.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastUsed - a[1].lastUsed).map(([m]) => m);
}

export interface MethodStat {
  method: string; // 未設定の実績はUNSET_METHOD_LABELにまとめる
  count: number;
  totalSeconds: number;
  avgSeconds: number;
  firstDate: string; // その手段を最初に使った実績の日付(YYYY-MM-DD)
  lastDate: string; // 最後に使った実績の日付
}

// 特定の作業(aggregateRecordsが返すkeyと同じ単位)について、手段ごとの件数・合計・平均時間を
// 集計する。初めて使われた日の古い順に並べるため、「Excel→マクロ→Claude」のように手段を
// 乗り換えてきた履歴をそのまま時系列で見比べられる
export function computeMethodBreakdown(records: WorkRecord[], key: string, includeExcluded = false): MethodStat[] {
  const matching = records.filter((r) => aggregateKey(r) === key && (includeExcluded || !r.excludedFromStats));
  const map = new Map<string, MethodStat>();
  for (const r of matching) {
    const method = r.method?.trim() || UNSET_METHOD_LABEL;
    if (!map.has(method)) {
      map.set(method, { method, count: 0, totalSeconds: 0, avgSeconds: 0, firstDate: r.date, lastDate: r.date });
    }
    const stat = map.get(method)!;
    stat.count += 1;
    stat.totalSeconds += r.seconds;
    if (r.date < stat.firstDate) stat.firstDate = r.date;
    if (r.date > stat.lastDate) stat.lastDate = r.date;
  }
  return [...map.values()]
    .map((s) => ({ ...s, avgSeconds: s.totalSeconds / s.count }))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
}
