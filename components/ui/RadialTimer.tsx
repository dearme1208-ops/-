"use client";

// 計測中カード用の、残り想定時間を減っていく円弧で見せる小さなビジュアルタイマー。
// デジタル数字の残り時間表示を補い、直感的な時間感覚を与える(ADHD等の時間感覚支援の考え方)
export default function RadialTimer({
  progressPct,
  overEstimate,
  size = 36,
}: {
  progressPct: number; // 0-100（想定に対する経過割合）
  overEstimate: boolean;
  size?: number;
}) {
  const radius = size / 2 - 3;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, progressPct));
  const dash = (clamped / 100) * circumference;
  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgb(var(--cream-rgb) / 0.12)" strokeWidth={3} />
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke={overEstimate ? "rgb(var(--accent-rgb) / 0.9)" : "rgb(var(--cream-rgb) / 0.85)"}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
      />
    </svg>
  );
}
