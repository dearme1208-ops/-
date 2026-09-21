// 森モードのヘッダーに描く、時間帯連動の針葉樹林シーン。
//
// SVGの静止画ではなく毎フレーム描き直すCanvasにしてあるが、モバイルのPWAで
// 常時表示される帯のため、負荷の高い「木のシルエット」は起動時とリサイズ時に
// 一度だけオフスクリーンへ焼き込み、毎フレームはその転写(ブリット)+動くもの
// (霧・光芒・蛍・木の葉・星のまたたき)だけを描く方式にしている。
//
// 奥行きは「大気遠近」で出す。遠い層ほど明るく霞ませ、近い層ほど暗く沈ませることで、
// 色数を増やさずに5層の前後関係が読み取れるようにしてある。

export type ForestTimeBand = "dawn" | "day" | "dusk" | "night";
export type ForestSeason = "spring" | "summer" | "autumn" | "winter";
export type RGB = [number, number, number];

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const rgbOf = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

export function computeForestTimeBand(hour: number): ForestTimeBand {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "dusk";
  return "night";
}

/** 実際の月(1〜12)から季節を決める。時間帯と掛け合わせて16通りの景色になる */
export function computeForestSeason(month: number): ForestSeason {
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

export interface ForestPalette {
  skyTop: RGB;
  skyMid: RGB;
  skyBottom: RGB;
  haze: RGB;
  hazeAlpha: number;
  /** 舞い落ちるものの色。季節で葉→花びら→紅葉→雪と変わる(未設定なら時間帯から決める) */
  leafTint?: RGB;
  /** 冬だけ、舞うものを葉ではなく雪片(丸)にする */
  snow?: boolean;
  /** 遠景→近景の順に5色。遠いほど明るく(霞み)、近いほど暗く(影) */
  layers: [RGB, RGB, RGB, RGB, RGB];
  ray: RGB;
  rayAlpha: number;
  mist: RGB;
  mistAlpha: number;
  celestial: { kind: "sun" | "moon"; body: RGB; glow: RGB; r: number; x: number; y: number };
  fireflyDensity: number;
  leafDensity: number;
  starCount: number;
}

// 4つの時間帯。アプリ名(クリーム色の文字)がヘッダーの上に乗るため、昼でも
// 「梢の下から空を見上げた」暗さに留め、文字が読めなくならない明度に抑えている
export const FOREST_PALETTES: Record<ForestTimeBand, ForestPalette> = {
  dawn: {
    skyTop: [18, 26, 46],
    skyMid: [58, 53, 80],
    skyBottom: [138, 98, 80],
    haze: [255, 200, 170],
    hazeAlpha: 0.12,
    layers: [
      [62, 74, 76],
      [44, 56, 54],
      [30, 41, 39],
      [19, 27, 26],
      [9, 14, 13],
    ],
    ray: [255, 214, 170],
    rayAlpha: 0.1,
    mist: [226, 218, 205],
    mistAlpha: 0.16,
    celestial: { kind: "sun", body: [255, 217, 160], glow: [255, 190, 130], r: 20, x: 0.82, y: 0.52 },
    fireflyDensity: 0.3,
    leafDensity: 0.5,
    starCount: 10,
  },
  day: {
    skyTop: [27, 51, 48],
    skyMid: [45, 74, 65],
    skyBottom: [62, 92, 74],
    haze: [205, 233, 195],
    hazeAlpha: 0.14,
    layers: [
      [86, 116, 94],
      [60, 90, 72],
      [42, 67, 53],
      [26, 45, 35],
      [13, 26, 20],
    ],
    ray: [232, 255, 215],
    rayAlpha: 0.15,
    mist: [214, 238, 208],
    mistAlpha: 0.1,
    celestial: { kind: "sun", body: [242, 247, 207], glow: [235, 250, 190], r: 17, x: 0.78, y: 0.2 },
    fireflyDensity: 0,
    leafDensity: 1,
    starCount: 0,
  },
  dusk: {
    skyTop: [26, 22, 48],
    skyMid: [74, 44, 62],
    skyBottom: [156, 90, 60],
    haze: [255, 170, 120],
    hazeAlpha: 0.14,
    layers: [
      [66, 66, 64],
      [46, 49, 47],
      [32, 37, 35],
      [20, 24, 23],
      [10, 13, 12],
    ],
    ray: [255, 190, 130],
    rayAlpha: 0.17,
    mist: [232, 202, 182],
    mistAlpha: 0.13,
    celestial: { kind: "sun", body: [255, 157, 92], glow: [255, 140, 80], r: 23, x: 0.8, y: 0.58 },
    fireflyDensity: 0.65,
    leafDensity: 0.7,
    starCount: 6,
  },
  night: {
    skyTop: [4, 10, 12],
    skyMid: [8, 20, 26],
    skyBottom: [13, 28, 24],
    haze: [150, 200, 170],
    hazeAlpha: 0.08,
    layers: [
      [30, 56, 50],
      [20, 40, 36],
      [13, 28, 25],
      [8, 18, 16],
      [4, 10, 9],
    ],
    ray: [190, 225, 200],
    rayAlpha: 0.055,
    mist: [140, 185, 165],
    mistAlpha: 0.1,
    celestial: { kind: "moon", body: [223, 233, 216], glow: [223, 233, 216], r: 25, x: 0.86, y: 0.26 },
    fireflyDensity: 1,
    leafDensity: 0.2,
    starCount: 42,
  },
};

// 季節の補正。時間帯パレット(FOREST_PALETTES)を土台に、木立の色・舞うもの・霧・
// 光芒・蛍の量だけを掛け合わせる。時間帯ごとに4枚のパレットを書き直すのではなく
// 補正で乗せることで、「夏の夜」「冬の暁」のような組み合わせが自動で出来上がる
interface SeasonModifier {
  /** 木立の各層をこの色へ寄せる量(0〜1) */
  layerTint: RGB;
  layerMix: number;
  /** 空をこの色へわずかに寄せる(冬の白み、秋の赤みなど) */
  skyTint: RGB;
  skyMix: number;
  leafTint: RGB;
  leafDensityMul: number;
  mistAlphaMul: number;
  rayAlphaMul: number;
  fireflyDensityMul: number;
  snow?: boolean;
}

export const FOREST_SEASON_MODIFIERS: Record<ForestSeason, SeasonModifier> = {
  // 芽吹き。黄緑に寄せ、朝靄を濃くして「まだ冷たい空気」を残す
  spring: {
    layerTint: [124, 172, 104],
    layerMix: 0.2,
    skyTint: [186, 206, 186],
    skyMix: 0.08,
    leafTint: [176, 214, 132],
    leafDensityMul: 1.1,
    mistAlphaMul: 1.3,
    rayAlphaMul: 1.1,
    fireflyDensityMul: 0.7,
  },
  // 盛夏。葉が厚く濃くなり、木漏れ日が強く、夜は蛍が増える
  summer: {
    layerTint: [38, 84, 50],
    layerMix: 0.18,
    skyTint: [64, 118, 96],
    skyMix: 0.08,
    leafTint: [96, 152, 82],
    leafDensityMul: 0.5,
    mistAlphaMul: 0.8,
    rayAlphaMul: 1.3,
    fireflyDensityMul: 1.3,
  },
  // 紅葉。木立まで赤茶に寄せ、落ち葉をいちばん多くする
  autumn: {
    layerTint: [126, 88, 48],
    layerMix: 0.28,
    skyTint: [186, 126, 78],
    skyMix: 0.1,
    leafTint: [206, 124, 58],
    leafDensityMul: 1.9,
    mistAlphaMul: 1.0,
    rayAlphaMul: 1.05,
    fireflyDensityMul: 0.5,
  },
  // 落葉と雪。色味を抜いて青灰へ寄せ、舞うものを雪片に差し替える
  winter: {
    layerTint: [98, 112, 124],
    layerMix: 0.26,
    skyTint: [150, 170, 190],
    skyMix: 0.14,
    leafTint: [228, 240, 248],
    leafDensityMul: 1.4,
    mistAlphaMul: 1.35,
    rayAlphaMul: 0.85,
    fireflyDensityMul: 0.15,
    snow: true,
  },
};

const mixRGB = (a: RGB, b: RGB, amount: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * amount),
  Math.round(a[1] + (b[1] - a[1]) * amount),
  Math.round(a[2] + (b[2] - a[2]) * amount),
];

/** 時間帯のパレットに季節の補正を掛けた、実際に描画へ渡すパレット */
export function resolveForestPalette(band: ForestTimeBand, season: ForestSeason): ForestPalette {
  const base = FOREST_PALETTES[band];
  const m = FOREST_SEASON_MODIFIERS[season];
  const layers = base.layers.map((c) => mixRGB(c, m.layerTint, m.layerMix)) as ForestPalette["layers"];
  return {
    ...base,
    skyTop: mixRGB(base.skyTop, m.skyTint, m.skyMix),
    skyMid: mixRGB(base.skyMid, m.skyTint, m.skyMix),
    skyBottom: mixRGB(base.skyBottom, m.skyTint, m.skyMix),
    layers,
    mistAlpha: base.mistAlpha * m.mistAlphaMul,
    rayAlpha: base.rayAlpha * m.rayAlphaMul,
    fireflyDensity: base.fireflyDensity * m.fireflyDensityMul,
    leafDensity: base.leafDensity * m.leafDensityMul,
    leafTint: m.leafTint,
    snow: m.snow,
  };
}

/** 蛍の発光色。テーマのアクセント(新緑)より一段明るい、生物発光らしい黄緑 */
const FIREFLY_CORE: RGB = [214, 255, 176];
const FIREFLY_GLOW: RGB = [150, 235, 120];

// 木の配置・蛍の初期位置を毎回まったく同じにするための決定的な擬似乱数
// (Math.randomだとリロードのたびに森の形が変わってしまい、「同じ場所に戻ってきた」感が出ない)
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TreeSpec {
  x: number;
  baseY: number;
  h: number;
  w: number;
  tiers: number;
  lean: number;
}

export interface BakedLayer {
  canvas: HTMLCanvasElement;
  cssW: number;
  cssH: number;
  margin: number;
  /** ポインタ追従の視差量(px) */
  parallax: number;
  /** 風のゆらぎの振幅(px)と速さ */
  swayAmp: number;
  swaySpeed: number;
  phase: number;
}

export interface Firefly {
  x: number;
  y: number;
  phase: number;
  speed: number;
  r: number;
  driftX: number;
  driftY: number;
}

export interface Leaf {
  x: number;
  y: number;
  rot: number;
  rotSpeed: number;
  fall: number;
  swayPhase: number;
  swayAmp: number;
  size: number;
  tone: number;
}

export interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
}

export interface ForestScene {
  w: number;
  h: number;
  dpr: number;
  band: ForestTimeBand;
  season: ForestSeason;
  /** 時間帯×季節を解決済みのパレット。毎フレーム作り直さずここから読む */
  palette: ForestPalette;
  layers: BakedLayer[];
  fireflies: Firefly[];
  leaves: Leaf[];
  stars: Star[];
  /** 画面最上部にかぶさる林冠(葉のかたまり)の輪郭 */
  canopy: { x: number; r: number }[];
}

// 針葉樹1本。枝先のギザギザを段ごとに折り返して描くことで、
// 単なる三角形の重ねよりも「モミ/スギの梢」に見えるようにしている
function drawConifer(ctx: CanvasRenderingContext2D, t: TreeSpec, fill: string) {
  ctx.fillStyle = fill;
  // 幹
  ctx.fillRect(t.x - t.w * 0.035, t.baseY - t.h * 0.1, t.w * 0.07, t.h * 0.12);

  const notches = 3;
  for (let i = 0; i < t.tiers; i++) {
    const f = i / t.tiers;
    const tierBase = t.baseY - t.h * (0.05 + f * 0.7);
    const tierTop = tierBase - t.h * (0.36 - f * 0.1);
    const halfW = (t.w / 2) * (1 - f * 0.58);
    const apexX = t.x + t.lean * halfW * 0.18;

    ctx.beginPath();
    ctx.moveTo(t.x - halfW, tierBase);
    for (let s = 1; s <= notches; s++) {
      const p = s / (notches + 1);
      const y = tierBase + (tierTop - tierBase) * p;
      const edge = halfW * (1 - p);
      // 1段ごとに枝先を内側へ引っ込め、輪郭に切れ込みを作る
      ctx.lineTo(t.x - edge * (s % 2 === 0 ? 0.62 : 1), y);
      ctx.lineTo(t.x - edge * 0.82, y + (tierTop - tierBase) * 0.06);
    }
    ctx.lineTo(apexX, tierTop);
    for (let s = notches; s >= 1; s--) {
      const p = s / (notches + 1);
      const y = tierBase + (tierTop - tierBase) * p;
      const edge = halfW * (1 - p);
      ctx.lineTo(t.x + edge * 0.82, y + (tierTop - tierBase) * 0.06);
      ctx.lineTo(t.x + edge * (s % 2 === 0 ? 0.62 : 1), y);
    }
    ctx.lineTo(t.x + halfW, tierBase);
    ctx.closePath();
    ctx.fill();
  }
}

interface LayerConfig {
  spacing: number;
  scaleMin: number;
  scaleMax: number;
  baseY: number;
  parallax: number;
  swayAmp: number;
  swaySpeed: number;
  tiers: number;
}

// 遠景(0)→近景(4)。近いほど大きく・低い位置から生え・視差とゆらぎが大きい
const LAYER_CONFIGS: LayerConfig[] = [
  { spacing: 34, scaleMin: 0.2, scaleMax: 0.3, baseY: 0.6, parallax: 2, swayAmp: 0.6, swaySpeed: 0.18, tiers: 3 },
  { spacing: 52, scaleMin: 0.3, scaleMax: 0.44, baseY: 0.72, parallax: 5, swayAmp: 1.1, swaySpeed: 0.23, tiers: 4 },
  { spacing: 78, scaleMin: 0.46, scaleMax: 0.66, baseY: 0.86, parallax: 9, swayAmp: 1.8, swaySpeed: 0.29, tiers: 4 },
  { spacing: 120, scaleMin: 0.7, scaleMax: 0.95, baseY: 1.0, parallax: 15, swayAmp: 2.8, swaySpeed: 0.35, tiers: 5 },
  { spacing: 240, scaleMin: 1.15, scaleMax: 1.6, baseY: 1.16, parallax: 24, swayAmp: 4.2, swaySpeed: 0.41, tiers: 5 },
];

function bakeLayer(
  w: number,
  h: number,
  dpr: number,
  cfg: LayerConfig,
  color: RGB,
  rand: () => number,
  index: number
): BakedLayer {
  // 視差とゆらぎで左右に動かすぶん、キャンバスを両端に広げて焼いておく
  const margin = Math.ceil(cfg.parallax + cfg.swayAmp + 8);
  const topExtra = Math.ceil(h * 0.35);
  const cssW = w + margin * 2;
  const cssH = h + topExtra;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, cssW, cssH, margin, parallax: cfg.parallax, swayAmp: cfg.swayAmp, swaySpeed: cfg.swaySpeed, phase: index };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(margin, topExtra);

  const fill = rgbOf(color);
  const count = Math.max(2, Math.round(cssW / cfg.spacing));
  for (let i = 0; i < count; i++) {
    const jitter = (rand() - 0.5) * cfg.spacing * 0.8;
    const x = -margin + (i + 0.5) * (cssW / count) + jitter;
    const scale = cfg.scaleMin + rand() * (cfg.scaleMax - cfg.scaleMin);
    const treeH = h * scale * 1.35;
    drawConifer(
      ctx,
      {
        x,
        baseY: h * cfg.baseY,
        h: treeH,
        w: treeH * 0.46,
        tiers: cfg.tiers,
        lean: rand() * 2 - 1,
      },
      fill
    );
  }

  return {
    canvas,
    cssW,
    cssH,
    margin,
    parallax: cfg.parallax,
    swayAmp: cfg.swayAmp,
    swaySpeed: cfg.swaySpeed,
    phase: index * 1.9,
  };
}

export function buildForestScene(
  w: number,
  h: number,
  dpr: number,
  band: ForestTimeBand,
  season: ForestSeason = "summer",
  seed = 20260919
): ForestScene {
  const palette = resolveForestPalette(band, season);
  const rand = mulberry32(seed);

  const layers = LAYER_CONFIGS.map((cfg, i) => bakeLayer(w, h, dpr, cfg, palette.layers[i], rand, i));

  // 蛍は画面幅に比例させつつ上限を設け、狭い画面で密集しすぎないようにする
  const fireflyCount = Math.round(Math.min(26, Math.max(6, w / 46)) * palette.fireflyDensity);
  const fireflies: Firefly[] = Array.from({ length: fireflyCount }, () => ({
    x: rand() * w,
    y: h * (0.38 + rand() * 0.6),
    phase: rand() * Math.PI * 2,
    speed: 0.5 + rand() * 0.7,
    r: 1.4 + rand() * 1.5,
    driftX: 22 + rand() * 40,
    driftY: 8 + rand() * 16,
  }));

  const leafCount = Math.round(Math.min(14, Math.max(3, w / 110)) * palette.leafDensity);
  const leaves: Leaf[] = Array.from({ length: leafCount }, () => ({
    x: rand() * w,
    y: rand() * h,
    rot: rand() * Math.PI * 2,
    rotSpeed: (rand() - 0.5) * 1.1,
    fall: 8 + rand() * 14,
    swayPhase: rand() * Math.PI * 2,
    swayAmp: 10 + rand() * 22,
    size: 4 + rand() * 4,
    tone: rand(),
  }));

  const stars: Star[] = Array.from({ length: palette.starCount }, () => ({
    x: rand() * w,
    y: rand() * h * 0.45,
    r: 0.5 + rand() * 1.1,
    phase: rand() * Math.PI * 2,
  }));

  // 最前面にかぶさる林冠。垂れ下がりの深さを1房ごとにばらつかせ、
  // 等間隔の半円が並んで「泡」に見えてしまわないようにする
  const canopyCount = Math.max(6, Math.round(w / 90));
  const canopy = Array.from({ length: canopyCount }, (_, i) => ({
    x: (i + 0.5) * (w / canopyCount) + (rand() - 0.5) * 42,
    r: h * (0.05 + rand() * 0.17),
  }));

  return { w, h, dpr, band, season, palette, layers, fireflies, leaves, stars, canopy };
}

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, p: ForestPalette) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, rgbOf(p.skyTop));
  g.addColorStop(0.55, rgbOf(p.skyMid));
  g.addColorStop(1, rgbOf(p.skyBottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], t: number) {
  for (const s of stars) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.phase));
    ctx.fillStyle = `rgba(228,238,222,${(0.55 * tw).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCelestial(ctx: CanvasRenderingContext2D, w: number, h: number, p: ForestPalette, t: number) {
  const c = p.celestial;
  const cx = w * c.x;
  const cy = h * c.y;
  const breathe = 0.86 + 0.14 * Math.sin(t * 0.27);

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, c.r * 5.2 * breathe);
  glow.addColorStop(0, rgba(c.glow, 0.5));
  glow.addColorStop(0.45, rgba(c.glow, 0.14));
  glow.addColorStop(1, rgba(c.glow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, c.r * 5.2 * breathe, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = rgba(c.body, c.kind === "moon" ? 0.92 : 0.85);
  ctx.beginPath();
  ctx.arc(cx, cy, c.r, 0, Math.PI * 2);
  ctx.fill();

  // 月は欠けを重ねて三日月寄りにし、太陽との見分けを明確にする
  if (c.kind === "moon") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx + c.r * 0.42, cy - c.r * 0.3, c.r * 0.88, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHaze(ctx: CanvasRenderingContext2D, w: number, h: number, p: ForestPalette) {
  const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
  g.addColorStop(0, rgba(p.haze, 0));
  g.addColorStop(0.6, rgba(p.haze, p.hazeAlpha));
  g.addColorStop(1, rgba(p.haze, p.hazeAlpha * 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.35, w, h * 0.65);
}

// 梢の隙間から差し込む光芒。合成モードを lighter にして、重なった部分が
// 自然に明るくなる(=光が束になる)ようにしている
function drawGodRays(ctx: CanvasRenderingContext2D, w: number, h: number, p: ForestPalette, t: number) {
  if (p.rayAlpha <= 0) return;
  const originX = w * p.celestial.x;
  const originY = -h * 0.45;
  const len = h * 2.6;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const phase = i * 1.7;
    const breathe = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.21 + phase));
    const angle = -0.62 + i * 0.11 + Math.sin(t * 0.045 + phase) * 0.014;
    const spread = 7 + i * 2.6;
    ctx.save();
    ctx.translate(originX, originY);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, rgba(p.ray, p.rayAlpha * breathe));
    g.addColorStop(0.55, rgba(p.ray, p.rayAlpha * breathe * 0.45));
    g.addColorStop(1, rgba(p.ray, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-spread * 0.35, 0);
    ctx.lineTo(spread * 0.35, 0);
    ctx.lineTo(spread * 1.9, len);
    ctx.lineTo(-spread * 1.9, len);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// 地を這う霧。横に引き伸ばした楕円グラデーションを、速さを変えて流す
function drawMist(ctx: CanvasRenderingContext2D, w: number, h: number, p: ForestPalette, t: number, tier: number) {
  const rows = tier === 0 ? [0.68, 0.79] : [0.9, 1.0];
  const speed = tier === 0 ? 7 : 13;
  const alpha = p.mistAlpha * (tier === 0 ? 0.75 : 1);
  for (let r = 0; r < rows.length; r++) {
    const y = h * rows[r];
    const drift = ((t * speed * (r === 0 ? 1 : -0.7)) % (w + 400)) - 200;
    for (let i = -1; i < 3; i++) {
      const cx = drift + i * (w * 0.62) + Math.sin(t * 0.12 + i * 1.3 + tier) * 26;
      const rx = w * 0.42;
      const ry = h * (0.1 + 0.03 * ((i + tier) % 2));
      const g = ctx.createRadialGradient(cx, y, 0, cx, y, rx);
      g.addColorStop(0, rgba(p.mist, alpha));
      g.addColorStop(1, rgba(p.mist, 0));
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(1, ry / rx);
      ctx.translate(-cx, -y);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, y, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// 蛍。直線でも正弦でもない「迷いながら漂う」動きにするため、
// 周期の違う2つの正弦波を重ねて位置を作り、明滅も別周期で揺らしている
function drawFireflies(ctx: CanvasRenderingContext2D, flies: Firefly[], t: number, w: number, h: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const f of flies) {
    const tt = t * f.speed;
    const x = f.x + Math.sin(tt * 0.32 + f.phase) * f.driftX + Math.sin(tt * 0.13 + f.phase * 2.1) * (f.driftX * 0.42);
    const y = f.y + Math.cos(tt * 0.24 + f.phase) * f.driftY + Math.sin(tt * 0.08 + f.phase) * (f.driftY * 0.5);
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    const pulse = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(tt * 1.9 + f.phase * 3), 2);

    const glowR = f.r * 7.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    g.addColorStop(0, rgba(FIREFLY_GLOW, 0.42 * pulse));
    g.addColorStop(0.4, rgba(FIREFLY_GLOW, 0.12 * pulse));
    g.addColorStop(1, rgba(FIREFLY_GLOW, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgba(FIREFLY_CORE, 0.6 + 0.4 * pulse);
    ctx.beginPath();
    ctx.arc(x, y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLeaves(
  ctx: CanvasRenderingContext2D,
  leaves: Leaf[],
  t: number,
  h: number,
  band: ForestTimeBand,
  palette: ForestPalette
) {
  // 季節の色が決まっていればそれを使い、無ければ時間帯から決める(従来の挙動)
  const tint: RGB =
    palette.leafTint ?? (band === "day" ? [120, 168, 96] : band === "night" ? [46, 74, 56] : [168, 124, 70]);
  for (const l of leaves) {
    const y = (l.y + t * l.fall) % (h + 40);
    const x = l.x + Math.sin(t * 0.55 + l.swayPhase) * l.swayAmp;
    const rot = l.rot + t * l.rotSpeed;
    ctx.save();
    ctx.translate(x, y - 20);
    if (palette.snow) {
      // 雪片は向きを持たないので回さず、粒のまま落とす
      ctx.fillStyle = rgba(tint, 0.5 + l.tone * 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, l.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    ctx.rotate(rot);
    // 見る角度で厚みが変わるよう、回転に合わせて横幅を潰す
    ctx.scale(0.45 + 0.55 * Math.abs(Math.cos(rot * 0.8)), 1);
    ctx.fillStyle = rgba(tint, 0.42 + l.tone * 0.3);
    ctx.beginPath();
    ctx.moveTo(0, -l.size);
    ctx.quadraticCurveTo(l.size * 0.85, 0, 0, l.size);
    ctx.quadraticCurveTo(-l.size * 0.85, 0, 0, -l.size);
    ctx.fill();
    ctx.restore();
  }
}

// 画面最上部にかぶさる林冠。ここに乗ることで「梢の下から見上げている」構図になる
function drawCanopy(ctx: CanvasRenderingContext2D, scene: ForestScene, p: ForestPalette, t: number) {
  const { w, h, canopy } = scene;
  // 半円を並べるのではなく、房ごとに深さの違う下端を二次曲線でつないで
  // 一枚続きの葉のかたまりにする。風でわずかに上下に揺れる
  const yOf = (i: number) => canopy[i].r + Math.sin(t * 0.3 + i * 0.9) * 2.4;
  const edgeY = yOf(0) * 0.5;
  ctx.fillStyle = rgbOf(p.layers[4]);
  ctx.beginPath();
  ctx.moveTo(w + 4, -1);
  ctx.lineTo(-4, -1);
  ctx.lineTo(-4, edgeY);
  let prevX = -4;
  let prevY = edgeY;
  for (let i = 0; i < canopy.length; i++) {
    const y = yOf(i);
    // 房と房のあいだを1つおきに深く垂らし、規則正しい波形に見えないようにする
    const cy = Math.max(prevY, y) + (i % 2 === 0 ? h * 0.05 : h * 0.014);
    ctx.quadraticCurveTo((prevX + canopy[i].x) / 2, cy, canopy[i].x, y);
    prevX = canopy[i].x;
    prevY = y;
  }
  ctx.quadraticCurveTo((prevX + w + 4) / 2, prevY + h * 0.04, w + 4, prevY * 0.5);
  ctx.closePath();
  ctx.fill();
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.45, w * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export interface DrawOptions {
  /** ポインタの位置(0〜1)。視差の中心をずらす。未取得時は0.5 */
  px: number;
  py: number;
  /** 動きを止める(prefers-reduced-motion)。時間を固定した1枚だけを描く */
  still: boolean;
}

export function drawForestScene(
  ctx: CanvasRenderingContext2D,
  scene: ForestScene,
  t: number,
  opts: DrawOptions
) {
  const p = scene.palette;
  const { w, h } = scene;
  const ox = (opts.px - 0.5) * 2;
  const oy = (opts.py - 0.5) * 2;

  ctx.clearRect(0, 0, w, h);
  drawSky(ctx, w, h, p);
  if (scene.stars.length > 0) drawStars(ctx, scene.stars, t);
  drawCelestial(ctx, w, h, p, t);
  drawHaze(ctx, w, h, p);

  const blit = (i: number) => {
    const l = scene.layers[i];
    if (!l) return;
    const sway = Math.sin(t * l.swaySpeed + l.phase) * l.swayAmp;
    const dx = -l.margin - ox * l.parallax + sway;
    const dy = -(l.cssH - h) - oy * l.parallax * 0.25;
    ctx.drawImage(l.canvas, dx, dy, l.cssW, l.cssH);
  };

  blit(0);
  drawGodRays(ctx, w, h, p, t);
  blit(1);
  drawMist(ctx, w, h, p, t, 0);
  blit(2);
  if (scene.fireflies.length > 0) drawFireflies(ctx, scene.fireflies, t, w, h);
  blit(3);
  drawMist(ctx, w, h, p, t, 1);
  if (scene.leaves.length > 0) drawLeaves(ctx, scene.leaves, t, h, scene.band, p);
  blit(4);
  drawCanopy(ctx, scene, p, t);
  drawVignette(ctx, w, h);
}
