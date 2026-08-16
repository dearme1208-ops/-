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

// ぼくのなつやすみ風: 入道雲の湧く夏空・太陽・緑の丘に、遠くの鳥居と風鈴、そして
// 手前にひまわり畑を足して田舎の夏休みらしい懐かしさをもう一段強める(1970年代の
// 農村を舞台にした本家シリーズの原風景で最も象徴的なモチーフがひまわりのため)。
// 他テーマのダークな夜景とは正反対の、明るく懐かしい昼下がりの田舎の情景に描き替える
function NatsuyasumiArt() {
  const sunflowerPetals = Array.from({ length: 8 }, (_, i) => i * 45);
  const sunflowers = [
    { x: 60, y: 208, r: 15 },
    { x: 100, y: 214, r: 11 },
    { x: 1150, y: 210, r: 14 },
    { x: 1110, y: 216, r: 10 },
  ];
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="夏空と緑の丘、鳥居と風鈴、ひまわり畑のイラスト">
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
      {/* 遠くの鳥居(小さな神社への参道を思わせる) */}
      <g stroke="rgb(var(--nat-sun-rgb))" strokeOpacity="0.45" strokeWidth="4" fill="none">
        <line x1="470" y1="128" x2="470" y2="164" />
        <line x1="530" y1="128" x2="530" y2="164" />
        <line x1="460" y1="128" x2="540" y2="128" />
        <line x1="454" y1="118" x2="546" y2="118" />
      </g>
      <path
        d="M0,220 L0,190 Q200,150 420,185 T840,180 T1200,175 L1200,220 Z"
        fill="rgb(var(--nat-leaf-rgb))"
      />
      {/* 手前のひまわり畑(茎+花びら)。シリーズ原風景を象徴するモチーフ */}
      {sunflowers.map((f, i) => (
        <g key={i} transform={`translate(${f.x} ${f.y})`}>
          <line x1="0" y1="0" x2="0" y2={220 - f.y} stroke="rgb(var(--nat-leaf-rgb))" strokeWidth="3" />
          <g>
            {sunflowerPetals.map((deg) => (
              <ellipse key={deg} cx="0" cy={-f.r} rx={f.r * 0.32} ry={f.r * 0.62} fill="rgb(var(--nat-sun-rgb))" transform={`rotate(${deg})`} />
            ))}
          </g>
          <circle r={f.r * 0.42} fill="rgb(var(--nat-leaf-rgb))" opacity="0.9" />
        </g>
      ))}
      <text x="0" y="110" fontSize="26" className="nat-butterfly">
        🦋
      </text>
      {/* 軒先の風鈴 */}
      <text x="1110" y="60" fontSize="24" opacity="0.7">
        🎐
      </text>
    </svg>
  );
}

// パワプロ風: ナイター照明に照らされた球場のダイヤモンド・外野フェンス・照明塔のシルエットに、
// 観客席のシルエットとスコアボードの電光、弧を描いて飛ぶ打球を足して球場の熱気を強める
function PowerproArt() {
  const crowd = Array.from({ length: 24 }, (_, i) => i);
  const scoreLamps = Array.from({ length: 6 }, (_, i) => i);
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="ナイター球場と観客席、飛球のイラスト">
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
      {/* スコアボードの電光(装飾。実際の数値とは連動しない) */}
      <g transform="translate(150 24)">
        {scoreLamps.map((i) => (
          <rect
            key={i}
            x={i * 14}
            y="0"
            width="9"
            height="9"
            fill={i % 2 === 0 ? "rgb(var(--pp-gold-rgb))" : "rgb(var(--pp-green-rgb))"}
            opacity="0.6"
          />
        ))}
      </g>
      {/* 査定ランクバッジ(装飾。シリーズを象徴する能力の格付け表示を模したもの。
          実際の評価データとは連動しない) */}
      <g transform="translate(1140 44)">
        <circle r="20" fill="rgb(var(--ink-rgb))" stroke="rgb(var(--pp-gold-rgb))" strokeWidth="3" />
        <circle r="14" fill="none" stroke="rgb(var(--pp-gold-rgb))" strokeOpacity="0.5" strokeWidth="1" />
        <text x="0" y="7" fontSize="18" fontWeight="900" textAnchor="middle" fill="rgb(var(--pp-gold-rgb))">
          A
        </text>
      </g>
      {/* 観客席のシルエット */}
      <g fill="rgb(var(--cream-rgb))" opacity="0.14">
        {crowd.map((i) => (
          <circle key={i} cx={860 + (i % 12) * 24} cy={38 + Math.floor(i / 12) * 16} r="6" />
        ))}
      </g>
      {/* 外野フェンス */}
      <path d="M0,220 L0,175 Q600,140 1200,175 L1200,220 Z" fill="rgb(var(--pp-green-rgb))" opacity="0.7" />
      {/* 内野(ダイヤモンド)の一部 */}
      <polygon points="600,220 500,150 600,90 700,150" fill="rgb(var(--panel-rgb))" opacity="0.9" />
      <polygon points="600,220 500,150 600,90 700,150" fill="none" stroke="rgb(var(--pp-green-rgb))" strokeWidth="3" />
      <circle cx="600" cy="150" r="10" fill="rgb(var(--pp-green-rgb))" />
      {/* 弧を描いて飛ぶ打球 */}
      <path d="M 630,140 Q 760,40 920,70" fill="none" stroke="rgb(var(--pp-gold-rgb))" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="4 6" />
      <circle cx="920" cy="70" r="6" fill="rgb(var(--pp-gold-rgb))" opacity="0.85" />
    </svg>
  );
}

// VA-11 HALL-A風: 雨に濡れたネオン街のビル群と、カウンターに置かれたカクテルグラスのシルエット。
// 他テーマ共通のDefaultArt(岩肌と高層ビル)をそのまま使っていたが、ここも専用の情景に描き替える
function Va11Art() {
  const windows = [
    { x: 74, y: 78 }, { x: 96, y: 100 }, { x: 74, y: 130 }, { x: 100, y: 150 },
    { x: 156, y: 60 }, { x: 168, y: 100 }, { x: 156, y: 140 }, { x: 172, y: 170 },
    { x: 918, y: 70 }, { x: 940, y: 100 }, { x: 918, y: 130 }, { x: 944, y: 160 },
    { x: 1020, y: 46 }, { x: 1034, y: 80 }, { x: 1020, y: 120 }, { x: 1040, y: 160 },
  ];
  // 本家はDOS時代のドット絵を思わせるブロック単位の見た目のため、雨脚も滑らかな線ではなく
  // 短い矩形を斜めに並べたピクセル状のしずくにする
  const rainDrops = Array.from({ length: 40 }, (_, i) => ({ x: (i * 53) % 1220, y: (i * 37) % 220 }));
  return (
    <svg viewBox="0 0 1200 220" preserveAspectRatio="none" className="h-24 w-full sm:h-28" role="img" aria-label="雨に濡れるネオン街とカクテルグラスのイラスト">
      <defs>
        <linearGradient id="v11Sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--ink-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--panel-rgb))" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#v11Sky)" />
      {/* 高層ビルのシルエット */}
      <g fill="rgb(var(--ink-rgb))" stroke="rgb(var(--v11-cyan-rgb))" strokeOpacity="0.35" strokeWidth="1.5">
        <rect x="60" y="56" width="60" height="164" />
        <rect x="142" y="26" width="50" height="194" />
        <rect x="900" y="46" width="70" height="174" />
        <rect x="1000" y="16" width="55" height="204" />
        <rect x="1080" y="66" width="60" height="154" />
      </g>
      {/* 窓明かり(ピンク/シアンのネオン) */}
      {windows.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="7" height="7" fill={i % 2 === 0 ? "rgb(var(--v11-pink-rgb))" : "rgb(var(--v11-cyan-rgb))"} opacity="0.75" />
      ))}
      {/* ピクセル状の雨脚(ドット絵時代のDOSゲームらしいブロック単位の見た目) */}
      <g fill="rgb(var(--v11-cyan-rgb))" opacity="0.22">
        {rainDrops.map((d, i) => (
          <rect key={i} x={d.x} y={d.y} width="2" height="10" transform={`rotate(18 ${d.x} ${d.y})`} />
        ))}
      </g>
      {/* カウンターに置かれたカクテルグラス */}
      <g transform="translate(600 108)">
        <path d="M -30,-56 L 30,-56 L 6,18 L -6,18 Z" fill="none" stroke="rgb(var(--v11-cyan-rgb))" strokeWidth="2" opacity="0.75" />
        <path d="M -22,-48 L 22,-48 L 3,10 L -3,10 Z" fill="rgb(var(--v11-pink-rgb))" opacity="0.4" />
        <line x1="0" y1="18" x2="0" y2="40" stroke="rgb(var(--v11-cyan-rgb))" strokeWidth="2" opacity="0.75" />
        <line x1="-16" y1="40" x2="16" y2="40" stroke="rgb(var(--v11-cyan-rgb))" strokeWidth="2" opacity="0.75" />
      </g>
      {/* 8bit風のブロック段差を持つバーの看板シルエット(本家のドット絵ウィンドウ枠を意識) */}
      <g transform="translate(60 26)">
        <rect x="0" y="0" width="70" height="24" fill="none" stroke="rgb(var(--v11-pink-rgb))" strokeOpacity="0.7" strokeWidth="3" />
        <rect x="-4" y="4" width="4" height="16" fill="rgb(var(--v11-pink-rgb))" opacity="0.7" />
        <rect x="70" y="4" width="4" height="16" fill="rgb(var(--v11-pink-rgb))" opacity="0.7" />
      </g>
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

// ロボトミーコーポレーション風: 本家キービジュアル(黒地に酸性の黄緑が鋭く割れて
// 放射する背景、切り絵のようなギザギザの岩山シルエット、隅の暗いティールに浮かぶ
// 三日月、赤×黄緑のロゴエンブレム)を踏まえて描き替えた。基調色(ink/cream/panel)
// 自体は他テーマと違い据え置きのままだが、このヘッダーの一枚絵だけは本家の
// 黄緑・ティールという実在の固定色を使う
function LobotomyArt() {
  const burstCx = 620;
  const burstCy = 60;
  // 黄緑の光条を2層重ねる: 外側は大きく淡いハロー、内側は本体。
  // どちらも指数を元にした決定的な揺らぎでギザギザにする(SSR/CSHでずれないようMath.randomは使わない)
  function burstPolygon(spikes: number, outer: number, inner: number, cx: number, cy: number, jitter: number) {
    return Array.from({ length: spikes }, (_, i) => {
      const angle = (i / spikes) * Math.PI * 2;
      const r = i % 2 === 0 ? outer + ((i * 7) % jitter) : inner + ((i * 5) % (jitter * 0.6));
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(" ");
  }
  const haloPoints = burstPolygon(20, 205, 120, burstCx, burstCy, 26);
  const burstPoints = burstPolygon(28, 165, 60, burstCx, burstCy, 30);
  // 光条内部を走る亀裂線(結晶が割れたような細い線を放射状に何本か)
  const cracks = Array.from({ length: 9 }, (_, i) => {
    const angle = (i / 9) * Math.PI * 2 + 0.3;
    const len = 40 + ((i * 11) % 55);
    return {
      x1: burstCx,
      y1: burstCy,
      x2: (burstCx + len * Math.cos(angle)).toFixed(1),
      y2: (burstCy + len * Math.sin(angle)).toFixed(1),
    };
  });
  // 光条まわりに散る火の粉(小さな粒)
  const embers = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2 + 0.5;
    const r = 175 + ((i * 13) % 70);
    return { cx: burstCx + r * Math.cos(angle), cy: burstCy + r * Math.sin(angle), s: i % 3 === 0 ? 2.6 : 1.5 };
  });
  const lights = Array.from({ length: 5 }, (_, i) => i);
  const ticks = Array.from({ length: 16 }, (_, i) => i * 22.5);
  return (
    <svg
      viewBox="0 0 1200 220"
      preserveAspectRatio="none"
      className="h-24 w-full sm:h-28"
      role="img"
      aria-label="黄緑に割れた背景と多層の黒い岩山シルエット、精緻なロゴエンブレムのイラスト"
    >
      <defs>
        <radialGradient id="loboBgGlow" cx={`${(burstCx / 1200) * 100}%`} cy={`${(burstCy / 220) * 100}%`} r="70%">
          <stop offset="0%" stopColor="rgb(var(--lobo-yellow-dark-rgb) / 0.35)" />
          <stop offset="100%" stopColor="#050505" />
        </radialGradient>
        <radialGradient id="loboEmblemShine" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="rgb(var(--lobo-yellow-rgb) / 0.5)" />
          <stop offset="60%" stopColor="rgb(var(--accent-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--accent-rgb))" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#loboBgGlow)" />
      {/* 光条: 淡いハロー→本体→内部の亀裂線→火の粉、の順に重ねて奥行きを出す */}
      <polygon points={haloPoints} fill="rgb(var(--lobo-yellow-rgb) / 0.22)" />
      <polygon points={burstPoints} fill="rgb(var(--lobo-yellow-rgb))" />
      <g stroke="rgb(var(--lobo-yellow-dark-rgb))" strokeWidth="1.6" opacity="0.6">
        {cracks.map((c, i) => (
          <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />
        ))}
      </g>
      <g fill="rgb(var(--lobo-yellow-rgb))">
        {embers.map((e, i) => (
          <circle key={i} cx={e.cx} cy={e.cy} r={e.s} opacity={i % 2 === 0 ? 0.8 : 0.4} />
        ))}
      </g>
      {/* 隅の暗いティール(右上)。グラデーションと星屑で夜空らしい奥行きを足す */}
      <polygon points="940,0 1200,0 1200,190" fill="rgb(var(--lobo-teal-rgb))" />
      <g fill="rgb(var(--cream-rgb))">
        <circle cx="1010" cy="26" r="1.3" opacity="0.6" />
        <circle cx="1060" cy="70" r="1" opacity="0.5" />
        <circle cx="990" cy="100" r="1.4" opacity="0.4" />
        <circle cx="1155" cy="110" r="1" opacity="0.5" />
      </g>
      <circle cx="1130" cy="42" r="26" fill="rgb(var(--cream-rgb) / 0.12)" />
      <g transform="translate(1130,42)">
        <circle r="18" fill="rgb(var(--cream-rgb))" opacity="0.94" />
        <circle cx="8" cy="-6" r="16" fill="rgb(var(--lobo-teal-rgb))" />
      </g>
      {/* 遠景の岩山(淡く低いシルエット。奥行きを出すための背後の層) */}
      <polygon
        points="0,220 0,196 90,206 170,178 250,200 340,160 430,192 520,172 610,150 700,182 790,162 880,196 970,176 1060,204 1150,188 1200,198 1200,220"
        fill="rgb(var(--cream-rgb) / 0.07)"
      />
      {/* 近景のギザギザの黒い岩山シルエット(光条にかぶさる切り絵のような構図)。
          縁にわずかな稜線のハイライトを添えて、平坦な塗りに見えないようにする */}
      <polygon
        points="0,220 0,168 70,190 130,120 190,175 260,90 320,165 400,70 470,150 540,110 610,50 680,130 750,85 820,155 890,115 960,170 1030,130 1100,175 1170,140 1200,165 1200,220"
        fill="#050505"
      />
      <polyline
        points="0,168 70,190 130,120 190,175 260,90 320,165 400,70 470,150 540,110 610,50 680,130 750,85 820,155 890,115 960,170 1030,130 1100,175 1170,140 1200,165"
        fill="none"
        stroke="rgb(var(--lobo-yellow-dark-rgb) / 0.7)"
        strokeWidth="1.5"
      />
      {/* ロゴエンブレム: 外側のダイヤル状の目盛りリング+2重リング+光沢グラデーション+
          複数の脳回線+中央のL字。アプリタイトルの定位置(左下)と重ならない右下に配置 */}
      <g transform="translate(1080,150)" className="lobo-warning-light">
        <g stroke="rgb(var(--accent-rgb))" strokeWidth="2" opacity="0.55">
          {ticks.map((deg) => (
            <line key={deg} x1="0" y1="-40" x2="0" y2="-46" transform={`rotate(${deg})`} />
          ))}
        </g>
        <circle r="36" fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth="1.5" opacity="0.5" />
        <circle r="30" fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth="3" opacity="0.9" />
        <circle r="23" fill="url(#loboEmblemShine)" />
        <path
          d="M -10,-13 Q 2,-16 8,-6 Q 13,2 5,8 Q -3,13 -11,5"
          fill="none"
          stroke="rgb(var(--lobo-yellow-rgb))"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M -6,-4 Q 0,-7 4,-2"
          fill="none"
          stroke="rgb(var(--lobo-yellow-rgb) / 0.7)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polygon points="-5,-2 6,-2 6,3 3,3 3,14 -5,14" fill="rgb(var(--lobo-yellow-rgb))" />
      </g>
      {/* 監視ステータスランプ。時間差で明滅し、管制卓らしさを足す */}
      <g transform="translate(30 24)">
        {lights.map((i) => (
          <rect
            key={i}
            x={i * 16}
            y="0"
            width="9"
            height="9"
            fill="rgb(var(--accent-rgb))"
            className="lobo-status-light"
            style={{ animationDelay: `${i * 0.35}s` }}
          />
        ))}
      </g>
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

// 禅モード: 他テーマのような情景も、Claudeモードの放射スパークのような装飾も一切描かない。
// ごくわずかに濃淡のあるだけの余白そのものを見せる、最も「引き算」された構図。
// 高さも他テーマのh-24/h-28より低くし、ヘッダーの存在感自体を薄くする
function ZenArt() {
  return (
    <svg viewBox="0 0 1200 80" preserveAspectRatio="none" className="h-10 w-full sm:h-12" role="img" aria-label="静かな余白のイラスト">
      <defs>
        <linearGradient id="zenWash" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgb(var(--panel-rgb))" />
          <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="80" fill="url(#zenWash)" />
    </svg>
  );
}

export default function HeaderArt() {
  const { natsuyasumiMode, powerproMode, claudeMode, persona5Mode, lobotomyMode, va11hallaMode, zenMode } = useVisualMode();
  if (claudeMode) return <ClaudeArt />;
  if (zenMode) return <ZenArt />;
  if (persona5Mode) return <Persona5Art />;
  if (lobotomyMode) return <LobotomyArt />;
  if (va11hallaMode) return <Va11Art />;
  if (natsuyasumiMode) return <NatsuyasumiArt />;
  if (powerproMode) return <PowerproArt />;
  return <DefaultArt />;
}
