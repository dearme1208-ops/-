"use client";

import { formatClock } from "@/lib/time";

// 計測中の作業の「アナログ時計」。今の時刻を針で動かし、文字盤の縁に
// 「始めた時刻 → 終わる見込みの時刻」を帯で描く。数字の残り時間ではピンと来なくても、
// 「長針があそこまで行ったら終わり」と見て分かるようにする。
//  - 始めてから終わる見込みまでが1時間以内なら、長針の目盛り(分)の帯で描く
//  - それより長ければ、短針の目盛り(時)の帯で描く
//  - 見込みを過ぎたら、見込みの時刻から今までを警告の色で描く

const C = 50;

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
}

/** a1 から時計回りに a2 までの弧 */
function arc(r: number, a1: number, a2: number): string {
  let sweep = (((a2 - a1) % 360) + 360) % 360;
  if (sweep === 0 && a2 !== a1) sweep = 359.99;
  const end = a1 + Math.min(sweep, 359.99);
  const [x1, y1] = polar(r, a1);
  const [x2, y2] = polar(r, end);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

const minuteAngle = (ms: number) => {
  const d = new Date(ms);
  return ((d.getMinutes() + d.getSeconds() / 60) / 60) * 360;
};
const hourAngle = (ms: number) => {
  const d = new Date(ms);
  return (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * 360;
};

export default function TaskClock({
  now,
  startMs,
  endMs,
  size = 104,
}: {
  now: number;
  /** 今の区間を始めた時刻 */
  startMs: number;
  /** 終わる見込みの時刻(見込みが立たなければ undefined) */
  endMs?: number;
  size?: number;
}) {
  const d = new Date(now);
  const secA = (d.getSeconds() / 60) * 360;
  const minA = minuteAngle(now);
  const hourA = hourAngle(now);
  // 帯を分の目盛りで描くか、時の目盛りで描くか
  const byMinute = endMs !== undefined && Math.max(endMs, now) - startMs <= 60 * 60_000;
  const angle = byMinute ? minuteAngle : hourAngle;
  const ringR = byMinute ? 46 : 33;
  const overrun = endMs !== undefined && now > endMs;
  const label =
    endMs === undefined ? "見込みなし" : overrun ? `${formatClock(endMs)}を過ぎています` : `${formatClock(endMs)}ごろ終わる見込み`;

  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5" data-testid="task-clock">
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="img"
        aria-label={`今 ${formatClock(now)}、${label}`}
        className="overflow-visible"
      >
        {/* 文字盤 */}
        <circle cx={C} cy={C} r={48} fill="rgb(var(--ink-rgb) / 0.55)" stroke="rgb(var(--cream-rgb) / 0.2)" strokeWidth={1} />
        {Array.from({ length: 60 }, (_, i) => {
          const major = i % 5 === 0;
          const [x1, y1] = polar(major ? 40 : 43, i * 6);
          const [x2, y2] = polar(45, i * 6);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={`rgb(var(--cream-rgb) / ${major ? 0.55 : 0.18})`}
              strokeWidth={major ? 1.6 : 0.7}
              strokeLinecap="round"
            />
          );
        })}
        {[12, 3, 6, 9].map((n) => {
          const [x, y] = polar(33, (n % 12) * 30);
          return (
            <text key={n} x={x} y={y + 3} textAnchor="middle" fontSize={8} fill="rgb(var(--cream-rgb) / 0.45)" fontWeight={700}>
              {n}
            </text>
          );
        })}

        {endMs !== undefined && (
          <>
            {/* 始めてから今まで(済んだ分)は薄く、今から見込みまで(残り)はくっきり */}
            <path d={arc(ringR, angle(startMs), angle(Math.min(now, endMs)))} fill="none" stroke="rgb(var(--accent-rgb) / 0.45)" strokeWidth={5} strokeLinecap="round" />
            {!overrun && (
              <path d={arc(ringR, angle(now), angle(endMs))} fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth={5} strokeLinecap="round" />
            )}
            {overrun && (
              <path d={arc(ringR, angle(endMs), angle(now))} fill="none" stroke="rgb(var(--alert-rgb))" strokeWidth={5} strokeLinecap="round" />
            )}
            {/* 終わる見込みの位置の旗 */}
            {(() => {
              const [x, y] = polar(ringR, angle(endMs));
              return <circle cx={x} cy={y} r={4} fill={overrun ? "rgb(var(--alert-rgb))" : "rgb(var(--cream-rgb))"} stroke="rgb(var(--ink-rgb))" strokeWidth={1.2} />;
            })()}
          </>
        )}

        {/* 針 */}
        {(() => {
          const [hx, hy] = polar(24, hourA);
          const [mx, my] = polar(36, minA);
          const [sx, sy] = polar(40, secA);
          const [tx, ty] = polar(-8, secA);
          return (
            <>
              <line x1={C} y1={C} x2={hx} y2={hy} stroke="rgb(var(--cream-rgb))" strokeWidth={3.4} strokeLinecap="round" />
              <line x1={C} y1={C} x2={mx} y2={my} stroke="rgb(var(--cream-rgb))" strokeWidth={2.2} strokeLinecap="round" />
              <line x1={tx} y1={ty} x2={sx} y2={sy} stroke="rgb(var(--alert-rgb))" strokeWidth={1} strokeLinecap="round" />
              <circle cx={C} cy={C} r={2.4} fill="rgb(var(--alert-rgb))" />
            </>
          );
        })()}
      </svg>
      <div className={`text-center text-[10px] leading-tight tabular-nums ${overrun ? "font-bold text-alert" : "text-cream/60"}`}>
        {endMs === undefined ? `今 ${formatClock(now)}` : overrun ? `${formatClock(endMs)}を過ぎた` : `●${formatClock(endMs)}に終わる見込み`}
      </div>
    </div>
  );
}
