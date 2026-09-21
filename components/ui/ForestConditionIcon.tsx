"use client";

// 森モードの体調アイコン。通常モードの「色分けされた顔」(ConditionIcon)は
// 5色とも彩度が高く、深緑の画面の中でそこだけ浮いてしまうため、森モードでは
// 同じ5段階を「葉のみずみずしさ」で表す。
// 良いほど若葉で立ち、悪いほど黄ばんで垂れ、最後は枯れ葉になる。
const LEAF_STYLE: Record<
  string,
  { from: string; to: string; vein: string; tilt?: number; dew?: boolean; withered?: boolean }
> = {
  // 色だけだと小さく表示したときに5・4・3の見分けが付きにくいので、
  // 葉の傾き(立っている→垂れている)も段階に合わせて変えて二重の手がかりにする
  "5": { from: "#d4fa96", to: "#6cc247", vein: "#edffd8", tilt: -9, dew: true },
  "4": { from: "#a8e074", to: "#4f9c3f", vein: "#dcf5c4", tilt: -2 },
  "3": { from: "#8aa86a", to: "#4a6b3c", vein: "#cddcbc", tilt: 4 },
  "2": { from: "#d9c46a", to: "#95803a", vein: "#f0e3b4", tilt: 10 },
  "1": { from: "#b98b57", to: "#79502f", vein: "#e0c4a2", tilt: 17, withered: true },
};

export default function ForestConditionIcon({ level, size = 24 }: { level: string; size?: number }) {
  const style = LEAF_STYLE[level] ?? LEAF_STYLE["3"];
  const gradId = `forest-cond-${level}`;
  const tilt = style.tilt ?? 0;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor={style.from} />
          <stop offset="100%" stopColor={style.to} />
        </linearGradient>
      </defs>
      <g transform={`rotate(${tilt} 50 55)`}>
        {/* 葉柄 */}
        <path d="M50 88 Q50 80 50 74" stroke={style.to} strokeWidth="5" strokeLinecap="round" fill="none" />
        {/* 葉身 */}
        <path
          d="M50 10 C80 28 88 52 50 90 C12 52 20 28 50 10 Z"
          fill={`url(#${gradId})`}
          opacity={style.withered ? 0.92 : 1}
        />
        {/* 主脈と側脈 */}
        <path d="M50 16 L50 84" stroke={style.vein} strokeWidth="3" strokeLinecap="round" opacity="0.75" />
        <path
          d="M50 34 L68 30 M50 34 L32 30 M50 52 L72 50 M50 52 L28 50 M50 68 L66 68 M50 68 L34 68"
          stroke={style.vein}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.5"
        />
        {/* 絶好調の葉にだけ、朝露を一粒 */}
        {style.dew && (
          <>
            <circle cx="64" cy="40" r="7" fill="#eafff0" opacity="0.7" />
            <circle cx="62" cy="37" r="2.4" fill="#ffffff" opacity="0.85" />
          </>
        )}
        {/* 枯れ葉は縁が欠け、裂け目が入る */}
        {style.withered && (
          <>
            <path d="M74 44 q-9 6 -3 14" stroke="#2b1c10" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.55" />
            <path d="M50 58 L34 66" stroke="#3a2614" strokeWidth="2.4" strokeLinecap="round" opacity="0.5" />
          </>
        )}
      </g>
    </svg>
  );
}
