export function computeCost(seconds: number, hourlyRate: number): number {
  return (seconds / 3600) * hourlyRate;
}

export function formatYen(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

// カテゴリ別の時給/単価設定(JSON: { カテゴリ名: 金額 })の読み書き
export function parseCategoryRates(json: string): Record<string, number> {
  try {
    const obj = JSON.parse(json);
    if (typeof obj !== "object" || obj === null) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (typeof k === "string" && Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeCategoryRates(rates: Record<string, number>): string {
  return JSON.stringify(rates);
}

// カテゴリ別単価 → デフォルト単価の順で有効な時給/単価を決定する（どちらも無ければnull）
export function resolveCategoryRate(
  category: string,
  categoryRates: Record<string, number>,
  defaultRate: number | null
): number | null {
  return categoryRates[category] ?? defaultRate;
}
