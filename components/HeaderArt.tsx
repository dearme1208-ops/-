"use client";

import { useVisualMode } from "@/lib/theme";

function DefaultArt() {
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="岩肌と高層ビル群のイラスト">
      <defs>
        <linearGradient id="skyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--ink-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--panel-rgb))" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#skyFade)" />
      <g fill="rgb(var(--cream-rgb))" opacity="0.18">
        <rect x="150" y="70" width="26" height="110" />
        <rect x="190" y="40" width="20" height="140" />
        <rect x="222" y="88" width="30" height="92" />
        <rect x="640" y="60" width="24" height="120" />
        <rect x="676" y="30" width="18" height="150" />
        <rect x="706" y="78" width="26" height="102" />
        <rect x="740" y="50" width="22" height="130" />
        <rect x="900" y="66" width="24" height="114" />
        <rect x="936" y="36" width="20" height="144" />
        <rect x="968" y="84" width="30" height="96" />
      </g>
      <g fill="rgb(var(--cream-rgb))" opacity="0.12">
        <rect x="170" y="96" width="6" height="84" />
        <rect x="200" y="60" width="6" height="120" />
        <rect x="656" y="80" width="6" height="100" />
        <rect x="686" y="46" width="6" height="134" />
        <rect x="918" y="82" width="6" height="98" />
        <rect x="948" y="52" width="6" height="128" />
      </g>
      <polygon
        points="0,220 0,150 90,60 160,120 230,40 300,110 380,20 470,130 560,70 640,150 720,90 810,160 900,50 980,140 1060,80 1150,170 1200,120 1200,220"
        fill="rgb(var(--ink-rgb))"
        stroke="rgb(var(--cream-rgb))"
        strokeOpacity="0.25"
        strokeWidth="2"
      />
      <polygon
        points="0,220 0,180 120,110 210,160 320,90 420,170 540,120 650,190 760,140 880,200 1000,150 1100,200 1200,170 1200,220"
        fill="rgb(var(--ink-rgb))"
      />
    </svg>
  );
}

// ぼくのなつやすみ風: 入道雲の湧く夏空・太陽・緑の丘。他テーマのダークな夜景とは正反対の、
// 明るく懐かしい昼下がりの田舎の情景に描き替える
function NatsuyasumiArt() {
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="夏空と緑の丘のイラスト">
      <defs>
        <linearGradient id="natSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--nat-sea-rgb))" stopOpacity="0.55" />
          <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#natSky)" />
      <circle cx="1040" cy="55" r="34" fill="rgb(var(--nat-sun-rgb))" opacity="0.9" />
      <g fill="rgb(var(--panel-rgb))" opacity="0.85">
        <ellipse cx="180" cy="60" rx="46" ry="20" />
        <ellipse cx="220" cy="50" rx="34" ry="16" />
        <ellipse cx="140" cy="52" rx="30" ry="14" />
        <ellipse cx="620" cy="42" rx="50" ry="22" />
        <ellipse cx="670" cy="34" rx="32" ry="15" />
      </g>
      <path
        d="M0,220 L0,160 Q150,110 300,150 T600,140 T900,160 T1200,140 L1200,220 Z"
        fill="rgb(var(--nat-leaf-rgb))"
        opacity="0.55"
      />
      <path
        d="M0,220 L0,190 Q200,150 420,185 T840,180 T1200,175 L1200,220 Z"
        fill="rgb(var(--nat-leaf-rgb))"
      />
      <text x="0" y="110" fontSize="26" className="nat-butterfly">
        🦋
      </text>
    </svg>
  );
}

// パワプロ風: ナイター照明に照らされた球場のダイヤモンド・外野フェンス・照明塔のシルエット
function PowerproArt() {
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="野球場のイラスト">
      <defs>
        <linearGradient id="ppSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--pp-green-rgb))" stopOpacity="0.18" />
          <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#ppSky)" />
      {/* 照明塔 */}
      <g fill="rgb(var(--cream-rgb))" opacity="0.35">
        <rect x="60" y="30" width="8" height="150" />
        <rect x="30" y="20" width="76" height="16" />
        <rect x="1080" y="30" width="8" height="150" />
        <rect x="1050" y="20" width="76" height="16" />
      </g>
      {/* 外野フェンス */}
      <path d="M0,220 L0,175 Q600,140 1200,175 L1200,220 Z" fill="rgb(var(--pp-green-rgb))" opacity="0.7" />
      {/* 内野(ダイヤモンド)の一部 */}
      <polygon points="600,220 500,150 600,90 700,150" fill="rgb(var(--panel-rgb))" opacity="0.9" />
      <polygon points="600,220 500,150 600,90 700,150" fill="none" stroke="rgb(var(--pp-green-rgb))" strokeWidth="3" />
      <circle cx="600" cy="150" r="10" fill="rgb(var(--pp-green-rgb))" />
    </svg>
  );
}

// ペルソナ5風: 対角線に切り裂かれた赤黒のスプリット背景に、ギザギザの黒いスカイライン
// シルエットと白い三日月、ハーフトーンドットを重ねた「予告状」めいた構図にする。
// 他テーマは共通のDefaultArt(岩肌と高層ビル)をそのまま使っているが、ペルソナ5風だけは
// 既存の情景を流用せず丸ごと描き替える(UIデザインの縛りを破ってほしいという要望に対応)
function Persona5Art() {
  return (
    <svg
      viewBox="0 0 1200 220"
      preserveAspectRatio="none"
      className="h-24 w-full sm:h-28"
      role="img"
      aria-label="赤と黒に切り裂かれた夜景と白い三日月のイラスト"
    >
      <defs>
        <linearGradient id="p5SplitRed" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--p5-red-rgb))" stopOpacity="0.7" />
          <stop offset="100%" stopColor="rgb(var(--p5-red-rgb))" stopOpacity="0.25" />
        </linearGradient>
        <pattern id="p5HeaderDots" width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="1.4" cy="1.4" r="1.4" fill="rgb(var(--p5-white-rgb))" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="#050506" />
      <polygon points="0,0 780,0 340,220 0,220" fill="url(#p5SplitRed)" />
      <polygon points="0,0 780,0 340,220 0,220" fill="url(#p5HeaderDots)" opacity="0.18" />
      <polygon points="780,0 1200,0 1200,220 340,220" fill="none" stroke="rgb(var(--p5-red-rgb))" strokeOpacity="0.5" strokeWidth="3" />
      {/* ギザギザの黒いスカイラインシルエット(赤帯・黒帯の両方にかぶせて切り絵風に) */}
      <g fill="#050506">
        <polygon points="0,220 0,128 34,150 62,96 96,142 130,78 168,146 200,112 236,150 236,220" />
        <polygon points="560,220 560,150 606,178 642,116 686,168 724,104 760,158 796,132 830,164 830,220" />
        <polygon points="960,220 960,142 998,168 1030,110 1070,158 1108,100 1146,150 1180,124 1200,140 1200,220" />
      </g>
      {/* 白い三日月(黒い欠け円を少しずらして重ねる) */}
      <g transform="translate(1040,58)">
        <circle r="32" fill="rgb(var(--p5-white-rgb))" opacity="0.95" />
        <circle cx="15" cy="-9" r="29" fill="#050506" />
      </g>
    </svg>
  );
}

// ロボトミーコーポレーション風: 中央に据えた収容ユニットの隔壁扉(同心円+スポーク+
// 明滅する警告灯)と、下端に走るハザードストライプ(黒×アクセント色の斜めテープ)。
// 他テーマは共通のDefaultArt(岩肌と高層ビル)をそのまま使っているが、ロボトミー風だけは
// 既存の情景を流用せず丸ごと描き替える(UIデザインの縛りを破ってほしいという要望に対応)。
// 配色は基調色をそのまま使い(ペルソナ5風のように固定パレットへは差し替えない)、
// 素っ気ない管理局施設らしい抑制の効いた見た目を保つ
function LobotomyArt() {
  const spokes = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg
      viewBox="0 0 1200 220"
      preserveAspectRatio="none"
      className="h-24 w-full sm:h-28"
      role="img"
      aria-label="収容ユニットの隔壁扉とハザードストライプのイラスト"
    >
      <defs>
        <linearGradient id="loboSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--ink-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--panel-rgb))" />
        </linearGradient>
        <pattern id="loboHazard" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="13" height="26" fill="rgb(var(--accent-rgb))" />
          <rect x="13" width="13" height="26" fill="rgb(var(--ink-rgb))" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#loboSky)" />
      {/* 隔壁扉: 同心円+放射スポーク */}
      <g transform="translate(600 106)" fill="none" stroke="rgb(var(--cream-rgb))">
        <circle r="94" strokeOpacity="0.14" strokeWidth="10" />
        <circle r="68" strokeOpacity="0.22" strokeWidth="2.5" />
        <circle r="46" strokeOpacity="0.28" strokeWidth="2" />
        {spokes.map((deg) => (
          <line key={deg} x1="0" y1="0" x2="94" y2="0" strokeOpacity="0.13" strokeWidth="2" transform={`rotate(${deg})`} />
        ))}
      </g>
      {/* 明滅する警告灯 */}
      <circle cx="600" cy="106" r="7" fill="rgb(var(--accent-rgb))" className="lobo-warning-light" />
      {/* 下端のハザードストライプ */}
      <rect x="0" y="194" width="1200" height="26" fill="url(#loboHazard)" opacity="0.6" />
    </svg>
  );
}

// Claudeモード: 他テーマのような具体的な情景(街・空・球場)を描かず、Claude自身のロゴを
// 思わせる放射状のスパークだけを中央に置いた、抽象的で余白の多い構図にする
function ClaudeArt() {
  const rays = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="放射状のスパークのイラスト">
      <defs>
        <linearGradient id="claudeSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--panel-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
        </linearGradient>
        <radialGradient id="claudeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(var(--claude-glow-rgb))" stopOpacity="0.55" />
          <stop offset="100%" stopColor="rgb(var(--claude-glow-rgb))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#claudeSky)" />
      <circle cx="150" cy="110" r="120" fill="url(#claudeGlow)" />
      <g className="claude-spark" transform="translate(150 110)">
        {rays.map((deg) => (
          <rect
            key={deg}
            x={-2.5}
            y={deg % 90 === 0 ? -58 : -34}
            width="5"
            height={deg % 90 === 0 ? 58 : 34}
            rx="2.5"
            fill="rgb(var(--accent-rgb))"
            transform={`rotate(${deg})`}
          />
        ))}
      </g>
      <text x="230" y="122" fontSize="15" letterSpacing="0.08em" fill="rgb(var(--cream-rgb) / 0.35)">
        今、この作業に集中しています
      </text>
    </svg>
  );
}

export default function HeaderArt() {
  const { natsuyasumiMode, powerproMode, claudeMode, persona5Mode, lobotomyMode } = useVisualMode();
  if (claudeMode) return <ClaudeArt />;
  if (persona5Mode) return <Persona5Art />;
  if (lobotomyMode) return <LobotomyArt />;
  if (natsuyasumiMode) return <NatsuyasumiArt />;
  if (powerproMode) return <PowerproArt />;
  return <DefaultArt />;
}
