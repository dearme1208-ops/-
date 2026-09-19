import type { WorkRecord } from "./types";

// 見積もりを「過去実績の平均1つ」から「分布」に広げる。
//
// 作業時間の分布は右に裾を引く(たいていは想定どおり、たまに大きく伸びる)ため、
// 平均で立てた予定は半分以上の確率で溢れる。これは個人の性格ではなく、
// 内側から所要時間を想像すると起きる系統的な偏り(planning fallacy)で、
// Kahneman が示した処方箋が「過去の似た事例の実績分布から外側で見る」
// reference class forecasting。公共事業の実務でも、80〜90%が収まる水準に
// 緩衝を取るのが標準になっている。
//
// このアプリは実績(WorkRecord.seconds)を作業マスタ単位で持っているので、
// 新しい入力を増やさずに分布を出せる。
// ・P50 = 半分はこれ以内。自分の予定を立てるときの目安
// ・P80 = 8割はこれ以内。相手に締切を約束するときの目安

/** 分布として意味を持ち始める最低サンプル数。これ未満は正直に「読めない」と出す */
export const MIN_DISTRIBUTION_SAMPLES = 5;

export interface EstimateDistribution {
  sampleCount: number;
  /** 秒 */
  p50: number;
  p80: number;
  mean: number;
  max: number;
  /** P80 ÷ P50。1に近いほど読みやすく、大きいほど「たまに大化けする」作業 */
  spread: number;
}

/**
 * 線形補間による百分位数(Excel の PERCENTILE.INC と同じ定義)。
 * サンプルが少ないうちも値が飛び跳ねにくい
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * p;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedAsc[lower];
  return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * (pos - lower);
}

export function computeDistribution(secondsList: number[]): EstimateDistribution | null {
  const values = secondsList.filter((s) => s > 0).sort((a, b) => a - b);
  if (values.length < MIN_DISTRIBUTION_SAMPLES) return null;
  const p50 = Math.round(percentile(values, 0.5));
  const p80 = Math.round(percentile(values, 0.8));
  const mean = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  return {
    sampleCount: values.length,
    p50,
    p80,
    mean,
    max: values[values.length - 1],
    spread: p50 > 0 ? Math.round((p80 / p50) * 100) / 100 : 1,
  };
}

/**
 * 作業マスタごとの分布をまとめて求める。
 * 外れ値として除外された実績(excludedFromStats)は、想定時間の自動更新と同じく対象外にする
 */
export function distributionsByMaster(records: WorkRecord[]): Map<string, EstimateDistribution> {
  const byMaster = new Map<string, number[]>();
  for (const r of records) {
    if (!r.masterTaskId || r.excludedFromStats) continue;
    const list = byMaster.get(r.masterTaskId);
    if (list) list.push(r.seconds);
    else byMaster.set(r.masterTaskId, [r.seconds]);
  }

  const out = new Map<string, EstimateDistribution>();
  for (const [id, list] of byMaster) {
    const dist = computeDistribution(list);
    if (dist) out.set(id, dist);
  }
  return out;
}

/**
 * 現在の想定時間が分布のどのあたりに立っているかを、言葉で返す。
 * 「この見積もりでいくと何割の確率で溢れるのか」を一目で分かるようにするためのもの
 */
export function estimateStanding(estimatedSeconds: number, dist: EstimateDistribution): string {
  if (estimatedSeconds <= 0) return "想定時間が未設定です";
  if (estimatedSeconds >= dist.max) return "過去の最長より長い見積もりです";
  if (estimatedSeconds >= dist.p80) return "8割はこの時間内に収まっています";
  if (estimatedSeconds >= dist.p50) return "半分以上はこの時間内に収まっています";
  return "半分以上はこの見積もりを超えています";
}
