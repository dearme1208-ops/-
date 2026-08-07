"use client";

// 体調レベルを表す、色分けされた丸い顔アイコン。
// パワプロの「調子アイコン」のように一目で状態が分かる色分けデザインからヒントを得た、独自のオリジナルデザイン
// (5=絶好調 のような明るい色から 1=絶不調 の落ち着いた色まで、色相と表情の両方で段階を表す)
const LEVEL_STYLE: Record<
  string,
  { from: string; to: string; mouth: "biggrin" | "smile" | "flat" | "frown" | "gasp"; eyes: "happy" | "line" | "worried" }
> = {
  "5": { from: "#f472b6", to: "#db2777", mouth: "biggrin", eyes: "happy" },
  "4": { from: "#f87171", to: "#dc2626", mouth: "smile", eyes: "line" },
  "3": { from: "#fbbf24", to: "#d97706", mouth: "flat", eyes: "line" },
  "2": { from: "#60a5fa", to: "#2563eb", mouth: "frown", eyes: "line" },
  "1": { from: "#a78bfa", to: "#7c3aed", mouth: "gasp", eyes: "worried" },
};

export default function ConditionIcon({ level, size = 24 }: { level: string; size?: number }) {
  const style = LEVEL_STYLE[level] ?? LEVEL_STYLE["3"];
  const gradId = `cond-grad-${level}`;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={gradId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={style.from} />
          <stop offset="100%" stopColor={style.to} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill={`url(#${gradId})`} />

      {style.eyes === "happy" && (
        <>
          <path d="M26 44 Q34 34 42 44" stroke="#2a1245" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M58 44 Q66 34 74 44" stroke="#2a1245" strokeWidth="5" fill="none" strokeLinecap="round" />
        </>
      )}
      {style.eyes === "worried" && (
        <>
          <path d="M28 38 Q35 32 42 37" stroke="#2a1245" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M58 37 Q65 32 72 38" stroke="#2a1245" strokeWidth="4" fill="none" strokeLinecap="round" />
        </>
      )}
      {style.eyes === "line" && (
        <>
          <line x1="34" y1="40" x2="34" y2="50" stroke="#2a1245" strokeWidth="5" strokeLinecap="round" />
          <line x1="66" y1="40" x2="66" y2="50" stroke="#2a1245" strokeWidth="5" strokeLinecap="round" />
        </>
      )}

      {style.mouth === "biggrin" && (
        <>
          <path d="M26 58 Q50 66 74 58 Q50 88 26 58 Z" fill="#2a1245" />
          <path d="M35 64 Q50 70 65 64" stroke={style.from} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
      {style.mouth === "smile" && (
        <path d="M32 62 Q50 80 68 62" stroke="#2a1245" strokeWidth="6" fill="none" strokeLinecap="round" />
      )}
      {style.mouth === "flat" && <line x1="33" y1="68" x2="67" y2="68" stroke="#2a1245" strokeWidth="6" strokeLinecap="round" />}
      {style.mouth === "frown" && (
        <path d="M33 74 Q50 58 67 74" stroke="#2a1245" strokeWidth="6" fill="none" strokeLinecap="round" />
      )}
      {style.mouth === "gasp" && <ellipse cx="50" cy="72" rx="11" ry="9" fill="#2a1245" />}
    </svg>
  );
}
