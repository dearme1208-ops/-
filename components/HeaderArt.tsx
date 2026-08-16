"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useVisualMode } from "@/lib/theme";
import { useSetting } from "@/lib/settings";
import { db } from "@/lib/db";
import { fetchCurrentWeatherCode, weatherCodeToCategory, type WeatherCategory } from "@/lib/weather";

const NATSUYASUMI_WEATHER_REFRESH_MS = 30 * 60000;
// 位置情報が使えない場合のフォールバック地点(東京駅)
const NATSUYASUMI_FALLBACK_LOCATION = { lat: 35.6812, lon: 139.7671 };

// なつやすみモードのヘッダー背景の空模様を、実際の天気に連動させる。
// 位置は「天気変化通知」に登録済みの地点があればそれを優先し(権限確認不要)、
// 無ければ端末の位置情報(未許可・失敗時は東京)を使う。約30分ごとに再取得し、
// 取得できるまで/失敗時は既定の"clear"(晴れ)のまま据え置く
function useNatsuyasumiWeather(active: boolean): WeatherCategory {
  const [syncEnabledStr] = useSetting("theme.natsuyasumiWeatherSync", "true");
  const syncEnabled = syncEnabledStr === "true";
  const weatherPlaces = useLiveQuery(() => db.weatherPlaces.toArray(), []);
  const [category, setCategory] = useState<WeatherCategory>("clear");

  useEffect(() => {
    if (!active || !syncEnabled) return;
    let cancelled = false;

    async function resolveLocation(): Promise<{ lat: number; lon: number }> {
      if (weatherPlaces && weatherPlaces.length > 0) {
        return { lat: weatherPlaces[0].lat, lon: weatherPlaces[0].lon };
      }
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              timeout: 8000,
              maximumAge: NATSUYASUMI_WEATHER_REFRESH_MS,
            })
          );
          return { lat: pos.coords.latitude, lon: pos.coords.longitude };
        } catch {
          // 権限拒否・タイムアウト時はフォールバック地点を使う
        }
      }
      return NATSUYASUMI_FALLBACK_LOCATION;
    }

    async function refresh() {
      try {
        const { lat, lon } = await resolveLocation();
        const { weathercode } = await fetchCurrentWeatherCode(lat, lon);
        if (!cancelled) setCategory(weatherCodeToCategory(weathercode));
      } catch {
        // 取得失敗時は直前のカテゴリのまま据え置く
      }
    }

    refresh();
    const timer = setInterval(refresh, NATSUYASUMI_WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, syncEnabled, weatherPlaces]);

  return active && syncEnabled ? category : "clear";
}

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
const NATSUYASUMI_WEATHER_LABEL: Record<WeatherCategory, string> = {
  clear: "夏空と緑の丘、鳥居と風鈴、ひまわり畑のイラスト",
  cloudy: "くもり空と緑の丘、鳥居と風鈴、ひまわり畑のイラスト",
  rain: "夕立の降る緑の丘、鳥居と風鈴、ひまわり畑のイラスト",
  thunderstorm: "雷雨の緑の丘、鳥居と風鈴、ひまわり畑のイラスト",
  snow: "雪の降る緑の丘、鳥居と風鈴、ひまわり畑のイラスト",
};

function NatsuyasumiArt({ weather = "clear" }: { weather?: WeatherCategory }) {
  const sunflowerPetals = Array.from({ length: 8 }, (_, i) => i * 45);
  const sunflowers = [
    { x: 60, y: 208, r: 15 },
    { x: 100, y: 214, r: 11 },
    { x: 1150, y: 210, r: 14 },
    { x: 1110, y: 216, r: 10 },
  ];
  // 雨/雷雨/雪の日はひまわりを心持ち沈ませ、蝶は隠れて羽ばたかない
  const isWet = weather === "rain" || weather === "thunderstorm";
  const isDim = isWet || weather === "snow";
  // 晴れ以外は入道雲を1段厚くして空を覆う
  const extraClouds = weather !== "clear";
  const showSun = weather === "clear" || weather === "cloudy";
  const showButterfly = weather === "clear";
  // 斜めの雨脚(決定的な配列。VA-11のドット状とは違い、柔らかい線で夕立らしさを出す)
  const rainLines = Array.from({ length: weather === "thunderstorm" ? 34 : 22 }, (_, i) => ({
    x: (i * 53) % 1200,
    y: 8 + ((i * 29) % 150),
  }));
  // 静止した雪の粒(決定的な配列)
  const snowDots = Array.from({ length: 26 }, (_, i) => ({
    x: (i * 47) % 1200,
    y: 6 + ((i * 23) % 160),
    r: 1.5 + (i % 3),
  }));
  return (
    <svg
      viewBox="0 0 1200 220"
      preserveAspectRatio="none"
      className="h-24 w-full sm:h-28"
      role="img"
      aria-label={NATSUYASUMI_WEATHER_LABEL[weather]}
    >
      <defs>
        <linearGradient id="natSky" x1="0" y1="0" x2="0" y2="1">
          {weather === "cloudy" ? (
            <>
              <stop offset="0%" stopColor="rgb(var(--panel-rgb))" stopOpacity="0.8" />
              <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
            </>
          ) : weather === "snow" ? (
            <>
              <stop offset="0%" stopColor="rgb(var(--nat-sea-rgb))" stopOpacity="0.2" />
              <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="rgb(var(--nat-sea-rgb))" stopOpacity={isWet ? "0.28" : "0.55"} />
              <stop offset="100%" stopColor="rgb(var(--ink-rgb))" />
            </>
          )}
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1200" height="220" fill="url(#natSky)" />
      {isWet && <rect x="0" y="0" width="1200" height="220" fill="rgb(var(--ink-rgb))" opacity="0.3" />}
      {showSun && <circle cx="1040" cy="55" r="34" fill="rgb(var(--nat-sun-rgb))" opacity={weather === "clear" ? "0.9" : "0.35"} />}
      {weather === "thunderstorm" && (
        <polygon points="1000,8 984,58 1006,58 984,102 1036,46 1012,46 1030,8" fill="rgb(var(--nat-sun-rgb))" opacity="0.9" />
      )}
      <g fill={isWet ? "rgb(var(--nat-sea-rgb))" : "rgb(var(--panel-rgb))"} opacity={isWet ? 0.55 : extraClouds ? 0.9 : 0.85}>
        <ellipse cx="180" cy="60" rx="46" ry="20" />
        <ellipse cx="220" cy="50" rx="34" ry="16" />
        <ellipse cx="140" cy="52" rx="30" ry="14" />
        <ellipse cx="620" cy="42" rx="50" ry="22" />
        <ellipse cx="670" cy="34" rx="32" ry="15" />
        {extraClouds && (
          <>
            <ellipse cx="980" cy="50" rx="60" ry="24" />
            <ellipse cx="1040" cy="38" rx="40" ry="18" />
            <ellipse cx="360" cy="36" rx="46" ry="20" />
          </>
        )}
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
      {isWet && (
        <g stroke="rgb(var(--nat-sea-rgb))" strokeOpacity={weather === "thunderstorm" ? 0.55 : 0.42} strokeWidth="2" strokeLinecap="round">
          {rainLines.map((d, i) => (
            <line key={i} x1={d.x} y1={d.y} x2={d.x - 10} y2={d.y + 22} />
          ))}
        </g>
      )}
      {/* 手前のひまわり畑(茎+花びら)。シリーズ原風景を象徴するモチーフ */}
      {sunflowers.map((f, i) => (
        <g key={i} transform={`translate(${f.x} ${f.y})`} opacity={isDim ? 0.75 : 1}>
          <line x1="0" y1="0" x2="0" y2={220 - f.y} stroke="rgb(var(--nat-leaf-rgb))" strokeWidth="3" />
          <g>
            {sunflowerPetals.map((deg) => (
              <ellipse key={deg} cx="0" cy={-f.r} rx={f.r * 0.32} ry={f.r * 0.62} fill="rgb(var(--nat-sun-rgb))" transform={`rotate(${deg})`} />
            ))}
          </g>
          <circle r={f.r * 0.42} fill="rgb(var(--nat-leaf-rgb))" opacity="0.9" />
        </g>
      ))}
      {showButterfly && (
        <text x="0" y="110" fontSize="26" className="nat-butterfly">
          🦋
        </text>
      )}
      {/* 軒先の風鈴 */}
      <text x="1110" y="60" fontSize="24" opacity="0.7">
        🎐
      </text>
      {weather === "snow" && (
        <g fill="rgb(var(--cream-rgb))" opacity="0.75">
          {snowDots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} />
          ))}
        </g>
      )}
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

// ロボトミーコーポレーション風: タイトル画面の背景モチーフ(左下〜中央の淡い黄色の帯、
// 中央〜右上へ稲妻/根のように枝分かれする亀裂、右上の地平線に沿った摩天楼シルエット)を、
// 他テーマと同じ短冊型のヘッダー比率(viewBox 1200x220、h-24/h-28)の中に自然に収まる
// よう構図を調整して再現する。フラットな単色塗りのみで、グラデーションや光彩は加えない
function LobotomyArt() {
  // 中心線の点列を、法線方向へ幅(w)ぶん左右にオフセットして
  // 先細りするリボン状の多角形(稲妻/根のような亀裂)を作る
  function ribbon(points: { x: number; y: number; w: number }[]): string {
    const left: string[] = [];
    const right: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[i - 1] ?? p;
      const next = points[i + 1] ?? p;
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      left.push(`${(p.x + nx * p.w).toFixed(1)},${(p.y + ny * p.w).toFixed(1)}`);
      right.push(`${(p.x - nx * p.w).toFixed(1)},${(p.y - ny * p.w).toFixed(1)}`);
    }
    return [...left, ...right.reverse()].join(" ");
  }

  // 中央から右上へ向かう主要な亀裂と、そこから分岐する2本の根
  const mainCrack = ribbon([
    { x: 230, y: 55, w: 20 },
    { x: 285, y: 38, w: 13 },
    { x: 315, y: 62, w: 8 },
    { x: 375, y: 28, w: 11 },
    { x: 405, y: 42, w: 6 },
    { x: 465, y: 18, w: 9 },
    { x: 505, y: 30, w: 5 },
    { x: 565, y: 12, w: 8 },
    { x: 620, y: 24, w: 5 },
    { x: 680, y: 8, w: 9 },
    { x: 740, y: 20, w: 5 },
    { x: 800, y: 30, w: 16 },
  ]);
  const branchA = ribbon([
    { x: 375, y: 28, w: 8 },
    { x: 398, y: 10, w: 3 },
    { x: 416, y: 2, w: 1 },
  ]);
  const branchB = ribbon([
    { x: 505, y: 30, w: 6 },
    { x: 542, y: 8, w: 3 },
    { x: 564, y: 1, w: 1 },
  ]);

  // 右上の湾曲した地平線(2次ベジェ)に沿って建ち並ぶビル群
  const arcP0 = { x: 800, y: 30 };
  const arcC = { x: 980, y: 150 };
  const arcP1 = { x: 1200, y: 110 };
  function pointOnArc(t: number) {
    const mt = 1 - t;
    return {
      x: mt * mt * arcP0.x + 2 * mt * t * arcC.x + t * t * arcP1.x,
      y: mt * mt * arcP0.y + 2 * mt * t * arcC.y + t * t * arcP1.y,
    };
  }
  const buildingCount = 16;
  const buildings = Array.from({ length: buildingCount }, (_, i) => {
    const t = 0.06 + (i / (buildingCount - 1)) * 0.9;
    const base = pointOnArc(t);
    const h = 14 + ((i * 13) % 40);
    const w = 8 + ((i * 7) % 12);
    return { x: base.x, y: base.y, h, w, antenna: i % 4 === 0 };
  });

  return (
    <svg
      viewBox="0 0 1200 220"
      preserveAspectRatio="none"
      className="h-24 w-full sm:h-28"
      role="img"
      aria-label="左下から伸びる淡い黄色の帯、右上へ枝分かれする亀裂、地平線に沿った摩天楼シルエットのイラスト"
    >
      {/* 背景(漆黒) */}
      <rect x="0" y="0" width="1200" height="220" fill="#0a0a0a" />
      {/* 左下〜中央の光の帯: 上辺は鋭い直線境界、下は末広がり */}
      <polygon points="0,220 0,120 230,55 320,220" fill="rgb(var(--lobo-yellow-rgb))" />
      {/* 中央〜右上の分岐(稲妻/根のような鋭角の亀裂) */}
      <polygon points={mainCrack} fill="rgb(var(--lobo-yellow-rgb))" />
      <polygon points={branchA} fill="rgb(var(--lobo-yellow-rgb))" />
      <polygon points={branchB} fill="rgb(var(--lobo-yellow-rgb))" />
      {/* 右上の淡い黄色の地平線ポケット+摩天楼シルエット */}
      <path d="M800,30 Q980,150 1200,110 L1200,0 Z" fill="rgb(var(--lobo-yellow-rgb))" />
      <g fill="#0a0a0a">
        {buildings.map((b, i) => (
          <g key={i}>
            <rect x={b.x - b.w / 2} y={b.y - b.h} width={b.w} height={b.h} />
            {b.antenna && <line x1={b.x} y1={b.y - b.h} x2={b.x} y2={b.y - b.h - 10} stroke="#0a0a0a" strokeWidth="1.5" />}
          </g>
        ))}
      </g>
      {/* ビルの窓格子(細い縦線) */}
      <g stroke="rgb(var(--lobo-yellow-dark-rgb))" strokeWidth="1" opacity="0.8">
        {buildings.map((b, i) => (
          <line key={i} x1={b.x} y1={b.y - b.h + 3} x2={b.x} y2={b.y - 3} />
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
  const { mode, natsuyasumiMode, powerproMode, claudeMode, persona5Mode, lobotomyMode, va11hallaMode, zenMode } = useVisualMode();
  // ロボトミー/VA-11 HALL-A/ペルソナ5/ぼくのなつやすみ/パワプロの5テーマは、設定画面から
  // 自分の画像にヘッダーを差し替えられる。未設定(空文字)なら従来どおりテーマ専用の
  // イラストを描画する(=「オリジナル」)。Claude/禅/オフには画像差し替えの仕組みは無い
  const customizable = persona5Mode || lobotomyMode || va11hallaMode || natsuyasumiMode || powerproMode;
  const [customImage] = useSetting(`theme.headerImage.${mode}`, "");
  const [customPosition] = useSetting(`theme.headerImagePosition.${mode}`, "50% 50%");
  const natsuyasumiWeather = useNatsuyasumiWeather(natsuyasumiMode && !(customizable && customImage));
  if (customizable && customImage) {
    return (
      <img
        src={customImage}
        alt=""
        style={{ objectPosition: customPosition }}
        className="h-24 w-full object-cover sm:h-28"
      />
    );
  }
  if (claudeMode) return <ClaudeArt />;
  if (zenMode) return <ZenArt />;
  if (persona5Mode) return <Persona5Art />;
  if (lobotomyMode) return <LobotomyArt />;
  if (va11hallaMode) return <Va11Art />;
  if (natsuyasumiMode) return <NatsuyasumiArt weather={natsuyasumiWeather} />;
  if (powerproMode) return <PowerproArt />;
  return <DefaultArt />;
}
