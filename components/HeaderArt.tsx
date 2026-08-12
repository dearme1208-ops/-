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

export default function HeaderArt() {
  const { natsuyasumiMode, powerproMode } = useVisualMode();
  if (natsuyasumiMode) return <NatsuyasumiArt />;
  if (powerproMode) return <PowerproArt />;
  return <DefaultArt />;
}
