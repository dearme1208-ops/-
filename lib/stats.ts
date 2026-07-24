export interface IqrBounds {
  q1: number;
  q3: number;
  iqr: number;
  lower: number;
  upper: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function computeIqrBounds(values: number[]): IqrBounds | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  return { q1, q3, iqr, lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr };
}

export function isOutlier(value: number, bounds: IqrBounds | null): boolean {
  if (!bounds) return false;
  return value < bounds.lower || value > bounds.upper;
}
