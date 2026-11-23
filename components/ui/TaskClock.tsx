"use client";

import { useId } from "react";
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
  // 森の立体の飾り(縁・影・ガラスの丸み)のグラデーションの id。useId の「:」は url() で扱いにくいので外す
  const gid = `tc${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const label =
    endMs === undefined ? "見込みなし" : overrun ? `${formatClock(endMs)}を過ぎています` : `${formatClock(endMs)}ごろ終わる見込み`;

  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5" data-testid="task-clock">
      {/* 森モードの月暈(::before)を文字盤の後ろに敷くための包み。data-testid は外側の div のまま */}
      <span className="tc-wrap">
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="img"
        aria-label={`今 ${formatClock(now)}、${label}`}
        className="overflow-visible"
      >
        {/* 森の立体の飾り(動かない)。ほかのモードでは CSS で隠す */}
        <defs>
          <radialGradient id={`${gid}-cast`} cx="50%" cy="50%" r="50%">
            <stop offset="78%" style={{ stopColor: "rgb(0 0 0)", stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: "rgb(0 0 0)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id={`${gid}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "rgb(var(--cream-rgb))", stopOpacity: 0.55 }} />
            <stop offset="45%" style={{ stopColor: "rgb(var(--accent-rgb))", stopOpacity: 0.3 }} />
            <stop offset="100%" style={{ stopColor: "rgb(0 0 0)", stopOpacity: 0.7 }} />
          </linearGradient>
          <linearGradient id={`${gid}-bevel`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "rgb(0 0 0)", stopOpacity: 0.55 }} />
            <stop offset="100%" style={{ stopColor: "rgb(var(--cream-rgb))", stopOpacity: 0.16 }} />
          </linearGradient>
          <radialGradient id={`${gid}-dome`} cx="36%" cy="24%" r="70%">
            <stop offset="0%" style={{ stopColor: "rgb(255 255 255)", stopOpacity: 0.17 }} />
            <stop offset="45%" style={{ stopColor: "rgb(255 255 255)", stopOpacity: 0.04 }} />
            <stop offset="100%" style={{ stopColor: "rgb(255 255 255)", stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        {/* 下に落ちる影(文字盤より少し下にずらす) */}
        <circle className="tc-depth" cx={C} cy={C + 4} r={53} fill={`url(#${gid}-cast)`} />
        {/* 文字盤 */}
        <circle className="tc-face" cx={C} cy={C} r={48} fill="rgb(var(--ink-rgb) / 0.55)" stroke="rgb(var(--cream-rgb) / 0.2)" strokeWidth={1} />
        {/* 縁の面取り: 上が光り下が沈む外の縁と、その内側の逆向きの細い段 */}
        <circle className="tc-depth" cx={C} cy={C} r={48} fill="none" stroke={`url(#${gid}-rim)`} strokeWidth={2.2} />
        <circle className="tc-depth" cx={C} cy={C} r={46.4} fill="none" stroke={`url(#${gid}-bevel)`} strokeWidth={1} />
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
              <path className="tc-remain" d={arc(ringR, angle(now), angle(endMs))} fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth={5} strokeLinecap="round" />
            )}
            {overrun && (
              <path d={arc(ringR, angle(endMs), angle(now))} fill="none" stroke="rgb(var(--alert-rgb))" strokeWidth={5} strokeLinecap="round" />
            )}
            {/* 終わる見込みの位置の旗 */}
            {(() => {
              const a = angle(endMs);
              const [x, y] = polar(ringR, a);
              return (
                <>
                  <circle className="tc-flag-dot" cx={x} cy={y} r={4} fill={overrun ? "rgb(var(--alert-rgb))" : "rgb(var(--cream-rgb))"} stroke="rgb(var(--ink-rgb))" strokeWidth={1.2} />
                  {/* 森モード: 終わる見込みの所に一枚の葉(丸い旗の代わり。ほかのモードでは CSS で隠す) */}
                  <path
                    className="tc-flag-leaf"
                    d="M0 -6.5c3.3 1.7 3.8 5.4 0 8.8-3.8-3.4-3.3-7.1 0-8.8z"
                    transform={`translate(${x} ${y}) rotate(${a})`}
                    fill={overrun ? "rgb(var(--alert-rgb))" : "rgb(var(--cream-rgb))"}
                    stroke="rgb(var(--ink-rgb))"
                    strokeWidth={1}
                  />
                </>
              );
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
              {/* 森: 針の小さな落ち影(filter を使わず、ずらした線を重ねる) */}
              <g className="tc-depth" stroke="rgb(0 0 0 / 0.45)" strokeLinecap="round" transform="translate(0.7 1.4)">
                <line x1={C} y1={C} x2={hx} y2={hy} strokeWidth={3.4} />
                <line x1={C} y1={C} x2={mx} y2={my} strokeWidth={2.2} />
                <line x1={tx} y1={ty} x2={sx} y2={sy} strokeWidth={1} />
              </g>
              <line x1={C} y1={C} x2={hx} y2={hy} stroke="rgb(var(--cream-rgb))" strokeWidth={3.4} strokeLinecap="round" />
              <line x1={C} y1={C} x2={mx} y2={my} stroke="rgb(var(--cream-rgb))" strokeWidth={2.2} strokeLinecap="round" />
              <line x1={tx} y1={ty} x2={sx} y2={sy} stroke="rgb(var(--alert-rgb))" strokeWidth={1} strokeLinecap="round" />
              {/* 森モード: 秒針の先に蛍(ほかのモードでは CSS で隠す) */}
              <circle className="tc-firefly" cx={sx} cy={sy} r={1.7} fill="rgb(214 255 176)" />
              <circle cx={C} cy={C} r={2.4} fill="rgb(var(--alert-rgb))" />
              {/* 森: ガラスの丸み(左上の淡い光と、縁に沿う細い光の弧)。いちばん上に重ねる */}
              <circle className="tc-depth" cx={C} cy={C} r={46} fill={`url(#${gid}-dome)`} />
              <path className="tc-depth" d={arc(44, 292, 352)} fill="none" stroke="rgb(255 255 255 / 0.2)" strokeWidth={1.2} strokeLinecap="round" />
            </>
          );
        })()}
      </svg>
      </span>
      <div className={`text-center text-[10px] leading-tight tabular-nums ${overrun ? "font-bold text-alert" : "text-cream/60"}`}>
        {endMs === undefined ? `今 ${formatClock(now)}` : overrun ? `${formatClock(endMs)}を過ぎた` : `●${formatClock(endMs)}に終わる見込み`}
      </div>
    </div>
  );
}
