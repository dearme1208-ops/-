// 森モードのヘッダーに描く、時間帯連動の針葉樹林シーン。
//
// SVGの静止画ではなく毎フレーム描き直すCanvasにしてあるが、モバイルのPWAで
// 常時表示される帯のため、負荷の高い「木のシルエット」は起動時とリサイズ時に
// 一度だけオフスクリーンへ焼き込み、毎フレームはその転写(ブリット)+動くもの
// (霧・光芒・蛍・木の葉・星のまたたき)だけを描く方式にしている。
//
// 奥行きは「大気遠近」で出す。遠い層ほど明るく霞ませ、近い層ほど暗く沈ませることで、
// 色数を増やさずに5層の前後関係が読み取れるようにしてある。
//
// 負荷(モバイルの4倍CPU制限で毎フレーム描くと30fpsを割っていた):
// ・毎フレーム作っていたグラデーション(空・霞・天体の光暈・光芒・霧・蛍・周辺減光)は、
//   すべて buildForestScene で一度だけ小さな「スプライト」へ焼き、毎フレームは drawImage + globalAlpha で重ねる。
//   動き(位置・大きさ・明るさの揺らぎ)はスプライトの置き方と不透明度で出すので、見た目の動きは同じ
// ・描く頻度・解像度・粒の数は lib/forestPerf.ts のプロファイルで決める(軽量モードでは光芒・霧を間引く)
//
// 重ね順(奥→手前)。drawForestScene の本体はこの順に1行ずつ並べてある:
//   backdrop(空+霞) → 星 → 天体(光暈+本体) → 木立0 → 光芒 → 木立1 → 霧(奥) → 木立2 → 蛍
//   → 木立3 → 霧(手前) → 舞うもの → 木立4 → 林冠 → 周辺減光
// 木立は scene.layers(BakedLayer)。画像の視差レイヤーを足す場合は、BakedLayer と同じ形
// (source に HTMLImageElement / ImageBitmap 等、cssW/cssH/margin/parallax/sway…)で scene.layers に
// 差し込むか置き換えれば、blitLayer が同じ視差・ゆらぎで動かす(差し込む位置=上の重ね順のどこに挟むか)。
//
// 挿絵レイヤー(public/art/forest-{far,mid,near}.webp。黒+αのマスク):
// ・loadForestArt で非同期に読み、読み終わるまでは上の手続き生成の木立のまま(読めなければずっとそのまま)
// ・buildForestScene({art}) の時に、時間帯×季節のパレットで source-in 着色した横並び(鏡映しで継ぎ目なし)の
//   オフスクリーンへ焼く。中景の上辺の月明かりの縁取りも焼き込み。毎フレームは3枚の drawImage だけ
// ・重ね順: backdrop → 星 → 天体 → 光芒 → 遠景 → 霧(奥) → 中景 → 蛍 → 霧(手前) → 舞うもの → 林冠 → 近景 → 周辺減光

export type ForestTimeBand = "dawn" | "day" | "dusk" | "night";
export type ForestSeason = "spring" | "summer" | "autumn" | "winter";
export type RGB = [number, number, number];

export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const rgbOf = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

// 完了の瞬間に、ヘッダーの蛍と月を一度だけふわっと明るくする(CompletionPopupHost から呼ぶ)。
// 描画ループの外から呼ばれるので、時刻だけを覚えて、描くときに強さ(0〜1)へ直す。
// 新しい状態の受け渡し(ForestCanvasへのprops等)を作らず、既存のrAF描画が読むだけにしている
let bloomAt = -Infinity;
const BLOOM_MS = 1400;
export function forestBloom(): void {
  // 動きを減らす設定では1枚絵のまま。リサイズで描き直した1枚に明るさが焼き付かないよう、そもそも覚えない
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  bloomAt = typeof performance !== "undefined" ? performance.now() : 0;
}
function bloomLevel(): number {
  if (typeof performance === "undefined") return 0;
  const x = (performance.now() - bloomAt) / BLOOM_MS;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
}

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
  /** 焼き込んだ木立。画像の視差レイヤーなら HTMLImageElement / ImageBitmap などを入れてよい */
  canvas: CanvasImageSource;
  cssW: number;
  cssH: number;
  margin: number;
  /** ポインタ追従の視差量(px) */
  parallax: number;
  /** 風のゆらぎの振幅(px)と速さ */
  swayAmp: number;
  swaySpeed: number;
  phase: number;
  /** 画面の下端より下へはみ出して焼いた量(px)。視差で持ち上がっても下に隙間が出ないように */
  bleed?: number;
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
  /** 一度だけ焼いたグラデーション類(上の「負荷」の説明) */
  sprites: SceneSprites;
  /** 軽量モード(光芒・霧を間引く) */
  lite: boolean;
  /** 挿絵レイヤーで組んだか(true なら layers は [遠景, 中景, 近景]) */
  art: boolean;
}

/** buildForestScene で一度だけ焼く、静止したグラデーションの絵 */
export interface SceneSprites {
  /** 空のグラデーション+地平の霞(w×h) */
  backdrop: HTMLCanvasElement;
  /** 天体の光暈(中心が不透明度1になるよう焼いてあり、描く時に大きさと不透明度を変える) */
  celestialGlow: HTMLCanvasElement;
  /** 天体の本体(月は欠けを抜いた三日月)。celestialBodyPad は本体の半径に足した余白 */
  celestialBody: HTMLCanvasElement;
  celestialBodyPad: number;
  /** 光芒1本ぶん(回転前・不透明度1)。rays[i] は i 本目 */
  rays: { canvas: HTMLCanvasElement; spread: number }[];
  /** 霧のひとかたまり(円形の放射グラデーション。描く時に横長の楕円へ引き伸ばす) */
  mist: HTMLCanvasElement;
  /** 蛍の光暈 */
  fireflyGlow: HTMLCanvasElement;
  /** 周辺減光(w×h) */
  vignette: HTMLCanvasElement;
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

/** bakeLayer が引くのと同じ回数だけ乱数を進める(木1本につき3回) */
function skipLayerRand(w: number, cfg: LayerConfig, rand: () => number) {
  const margin = Math.ceil(cfg.parallax + cfg.swayAmp + 8);
  const count = Math.max(2, Math.round((w + margin * 2) / cfg.spacing));
  for (let i = 0; i < count * 3; i++) rand();
}

function spriteCanvas(cssW: number, cssH: number, scale: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(cssW * scale));
  c.height = Math.max(1, Math.round(cssH * scale));
  const ctx = c.getContext("2d");
  ctx?.setTransform(c.width / cssW, 0, 0, c.height / cssH, 0, 0);
  return [c, ctx];
}

// 中心から外へ消える放射グラデーションを、size×size の正方形に焼く。
// どれも縁がぼやけた光なので、描く大きさより小さく焼いて拡大しても見分けがつかない
function radialSprite(size: number, color: RGB, stops: [number, number][]): HTMLCanvasElement {
  const [c, ctx] = spriteCanvas(size, size, 1);
  if (!ctx) return c;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, a] of stops) g.addColorStop(at, rgba(color, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** 光芒の本数。軽量モードでは1本おきに間引く(drawGodRays) */
const RAY_COUNT = 7;
const raySpread = (i: number) => 7 + i * 2.6;
const rayLength = (h: number) => h * 2.6;

function bakeSprites(w: number, h: number, dpr: number, p: ForestPalette): SceneSprites {
  // 空+霞(以前は毎フレーム2本のグラデーションで塗っていた)
  const [backdrop, bctx] = spriteCanvas(w, h, dpr);
  if (bctx) {
    const g = bctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgbOf(p.skyTop));
    g.addColorStop(0.55, rgbOf(p.skyMid));
    g.addColorStop(1, rgbOf(p.skyBottom));
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, w, h);
    const hz = bctx.createLinearGradient(0, h * 0.35, 0, h);
    hz.addColorStop(0, rgba(p.haze, 0));
    hz.addColorStop(0.6, rgba(p.haze, p.hazeAlpha));
    hz.addColorStop(1, rgba(p.haze, p.hazeAlpha * 0.35));
    bctx.fillStyle = hz;
    bctx.fillRect(0, h * 0.35, w, h * 0.65);
  }

  // 天体の光暈は中心0.5→0.14→0の3段。不透明度は描く時に掛けるので、ここでは中心を1にして焼く
  const c = p.celestial;
  const celestialGlow = radialSprite(128, c.glow, [
    [0, 1],
    [0.45, 0.14 / 0.5],
    [1, 0],
  ]);
  const pad = 2;
  const bodySize = (c.r + pad) * 2;
  const [celestialBody, cbx] = spriteCanvas(bodySize, bodySize, dpr);
  if (cbx) {
    const o = c.r + pad;
    cbx.fillStyle = rgba(c.body, c.kind === "moon" ? 0.92 : 0.85);
    cbx.beginPath();
    cbx.arc(o, o, c.r, 0, Math.PI * 2);
    cbx.fill();
    // 月は欠けを抜いて三日月寄りにし、太陽との見分けを明確にする。
    // 以前は本体のキャンバスに destination-out で穴を開けていたが、スプライトの中で抜けば空はそのまま残る
    if (c.kind === "moon") {
      cbx.globalCompositeOperation = "destination-out";
      cbx.beginPath();
      cbx.arc(o + c.r * 0.42, o - c.r * 0.3, c.r * 0.88, 0, Math.PI * 2);
      cbx.fill();
      cbx.globalCompositeOperation = "source-over";
    }
  }

  // 光芒1本ぶん(回転前)。明るさの呼吸は描く時の globalAlpha で掛ける
  const len = rayLength(h);
  const rays = Array.from({ length: RAY_COUNT }, (_, i) => {
    const spread = raySpread(i);
    const rw = spread * 3.8;
    const [rc, rctx] = spriteCanvas(rw, len, dpr);
    if (rctx && p.rayAlpha > 0) {
      const g = rctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, rgba(p.ray, p.rayAlpha));
      g.addColorStop(0.55, rgba(p.ray, p.rayAlpha * 0.45));
      g.addColorStop(1, rgba(p.ray, 0));
      rctx.fillStyle = g;
      const cx = rw / 2;
      rctx.beginPath();
      rctx.moveTo(cx - spread * 0.35, 0);
      rctx.lineTo(cx + spread * 0.35, 0);
      rctx.lineTo(cx + spread * 1.9, len);
      rctx.lineTo(cx - spread * 1.9, len);
      rctx.closePath();
      rctx.fill();
    }
    return { canvas: rc, spread };
  });

  const mist = radialSprite(96, p.mist, [
    [0, 1],
    [1, 0],
  ]);
  const fireflyGlow = radialSprite(48, FIREFLY_GLOW, [
    [0, 1],
    [0.4, 0.12 / 0.42],
    [1, 0],
  ]);

  const [vignette, vctx] = spriteCanvas(w, h, dpr);
  if (vctx) {
    const g = vctx.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.45, w * 0.72);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    vctx.fillStyle = g;
    vctx.fillRect(0, 0, w, h);
  }

  return { backdrop, celestialGlow, celestialBody, celestialBodyPad: pad, rays, mist, fireflyGlow, vignette };
}

// ---- 挿絵レイヤー -------------------------------------------------------------

/** 読み込み済みの挿絵マスク(黒+α)。着色は buildForestScene で行う */
export interface ForestArt {
  far: CanvasImageSource & { width: number; height: number };
  mid: CanvasImageSource & { width: number; height: number };
  near: CanvasImageSource & { width: number; height: number };
}

const artCache = new Map<boolean, Promise<ForestArt | null>>();
const artReady = new Map<boolean, ForestArt>();

/** 幅800px以下・軽量モードは -sm(800px幅)を使う */
export function forestArtSmall(cssW: number, lite: boolean): boolean {
  return lite || cssW <= 800;
}

/** 読み終わっていれば同期で返す(再マウント時に一瞬だけ手続き生成へ戻らないように) */
export function peekForestArt(small: boolean): ForestArt | null {
  return artReady.get(small) ?? null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  return img.decode().then(() => {
    if (!img.naturalWidth) throw new Error("empty image");
    return img;
  });
}

/** 3枚まとめて読む。1枚でも失敗したら null(手続き生成のまま) */
export function loadForestArt(small: boolean): Promise<ForestArt | null> {
  const hit = artCache.get(small);
  if (hit) return hit;
  if (typeof Image === "undefined") return Promise.resolve(null);
  const sfx = small ? "-sm" : "";
  const p = Promise.all(["far", "mid", "near"].map((n) => loadImage(`/art/forest-${n}${sfx}.webp`)))
    .then(([far, mid, near]) => {
      const art = { far, mid, near };
      artReady.set(small, art);
      return art;
    })
    .catch(() => null);
  artCache.set(small, p);
  return p;
}

/** 少し青へ寄せる(遠いものほど空気の青をかぶる) */
const coolRGB = (c: RGB): RGB => [Math.round(c[0] * 0.88), Math.round(c[1] * 0.97), Math.min(255, Math.round(c[2] * 1.14 + 6))];

/** 時間帯×季節のパレットから、挿絵3層の色を決める(遠いほど明るく青く・低コントラスト、近いほど暗く) */
export function forestArtTints(p: ForestPalette, band: ForestTimeBand) {
  // 遠景の高さ(画面の5〜7割)にある空の色。遠景はこれをわずかに沈めた色にして、空との差を小さくする
  const skyAt = mixRGB(mixRGB(p.skyMid, p.skyBottom, 0.55), p.haze, p.hazeAlpha * 0.8);
  const far = coolRGB(mixRGB(skyAt, p.layers[2], 0.45));
  const mid = mixRGB(p.layers[1], p.layers[2], 0.6);
  return {
    /** 遠景の奥にもう1枚重ねる、さらに空へ溶けた稜線 */
    distant: mixRGB(skyAt, far, 0.45),
    far,
    /** 遠景の裾。霞で空の色へ抜ける */
    farFoot: mixRGB(far, skyAt, 0.35),
    mid,
    near: p.layers[4],
    /** 中景の上辺の縁取り(天体の光) */
    rim: mixRGB(p.celestial.glow, mid, 0.35),
    rimAlpha: band === "night" ? 0.5 : band === "day" ? 0.26 : 0.4,
  };
}

type ArtImage = ForestArt["far"];

/** マスクを横へ鏡映しで並べる(1枚おきに左右反転するので継ぎ目の輪郭が必ず一致する) */
function tileMask(
  ctx: CanvasRenderingContext2D,
  img: ArtImage,
  src: { y0: number; y1: number },
  x0: number,
  xEnd: number,
  yBottom: number,
  dh: number,
  stretch: number
) {
  const sy = Math.round(img.height * src.y0);
  const sh = Math.max(1, Math.round(img.height * src.y1) - sy);
  const dw = dh * (img.width / sh) * stretch;
  for (let x = x0, i = 0; x < xEnd; x += dw, i++) {
    if (i % 2 === 0) {
      ctx.drawImage(img, 0, sy, img.width, sh, x, yBottom - dh, dw, dh);
    } else {
      ctx.save();
      ctx.translate(x + dw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, sy, img.width, sh, 0, yBottom - dh, dw, dh);
      ctx.restore();
    }
  }
}

interface ArtFrame {
  cssW: number;
  cssH: number;
  margin: number;
  top: number;
}

/** マスクを描いて source-in で塗る。座標は画面基準(左上0,0。左右に margin、上に top だけはみ出せる) */
function tintedMask(
  f: ArtFrame,
  dpr: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  fill: (ctx: CanvasRenderingContext2D) => string | CanvasGradient
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(f.cssW * dpr));
  c.height = Math.max(1, Math.round(f.cssH * dpr));
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.setTransform(dpr, 0, 0, dpr, f.margin * dpr, f.top * dpr);
  draw(ctx);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = fill(ctx);
  ctx.fillRect(-f.margin, -f.top, f.cssW, f.cssH);
  return c;
}

/** under の上に over を重ねる(どちらも同じ大きさ) */
function stack(under: HTMLCanvasElement, over: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = under.getContext("2d");
  if (!ctx) return over;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.drawImage(over, 0, 0);
  return under;
}

function artFrame(w: number, h: number, parallax: number, swayAmp: number, top: number): ArtFrame & { bleed: number } {
  const margin = Math.ceil(parallax + swayAmp + 8);
  const bleed = Math.ceil(parallax * 0.25 + 2);
  return { cssW: w + margin * 2, cssH: h + top + bleed, margin, top, bleed };
}

// 視差は遠いほど小さく、近いほど大きい(手続き生成の木立 LAYER_CONFIGS の 2〜24 と同じ幅)
const ART_FAR = { parallax: 4, swayAmp: 0.4, swaySpeed: 0.17 };
const ART_MID = { parallax: 9, swayAmp: 1.1, swaySpeed: 0.24 };
const ART_NEAR = { parallax: 18, swayAmp: 2.2, swaySpeed: 0.38 };
/** 近景の画像のうち、下草(シダ・草)の帯と左上の枝の範囲(元画像に対する割合) */
const NEAR_GROUND = { y0: 0.458, y1: 1 };
const NEAR_BRANCH = { x1: 0.198, y1: 0.34 };

/** アプリ名(左下。px-6 pb-3 の見出し)の後ろの近景を、楕円のぼかしで半分ほど抜く */
function fadeBehindTitle(c: HTMLCanvasElement, f: ArtFrame, dpr: number, h: number) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const cx = 80;
  const cy = h - 30;
  const rx = 150;
  const ry = 42;
  ctx.setTransform(dpr, 0, 0, dpr, f.margin * dpr, f.top * dpr);
  ctx.translate(cx, cy);
  ctx.scale(rx / ry, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(0.6, "rgba(0,0,0,0.3)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = g;
  ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
  ctx.globalCompositeOperation = "source-over";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function bakeArtLayers(w: number, h: number, dpr: number, art: ForestArt, p: ForestPalette, band: ForestTimeBand, rand: () => number): BakedLayer[] {
  const tint = forestArtTints(p, band);
  const full = { y0: 0, y1: 1 };

  // 遠景: 空へ溶けた奥の稜線+手前の稜線。空の色をわずかに沈めただけの低コントラストで、画面の下半分に低く置く
  const fF = artFrame(w, h, ART_FAR.parallax, ART_FAR.swayAmp, 2);
  const farX0 = -fF.margin;
  const farEnd = w + fF.margin;
  const distant = tintedMask(
    fF,
    dpr,
    (ctx) => tileMask(ctx, art.far, full, farX0 - rand() * h * 3, farEnd, h * 0.9, h * 0.4, 1.8),
    () => rgbOf(tint.distant)
  );
  const farMain = tintedMask(
    fF,
    dpr,
    (ctx) => tileMask(ctx, art.far, full, farX0 - rand() * h * 3, farEnd, h + fF.bleed, h * 0.46, 1.5),
    (ctx) => {
      const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
      g.addColorStop(0, rgbOf(tint.far));
      g.addColorStop(1, rgbOf(tint.farFoot));
      return g;
    }
  );
  const far: BakedLayer = { canvas: stack(distant, farMain), ...fF, ...ART_FAR, phase: 0.4 };

  // 中景: 針葉樹の列。大きく描いて本数と繰り返しを減らし、梢の並び(元画像の上から3割)が画面の約4割の高さに来るよう置く。
  // いちばん高い穂先は林冠の裏へ抜ける。天体の側・上へ少しずらした明るい写しを後ろに敷き、上辺だけに光の縁を残す
  const fM = artFrame(w, h, ART_MID.parallax, ART_MID.swayAmp, 2);
  const midH = Math.max(h * 1.25, Math.min(h * 1.6, w / (2.2 * (art.mid.width / art.mid.height))));
  const midTop = h * 0.42 - midH * 0.3;
  const midX0 = -fM.margin - rand() * midH;
  const midEnd = w + fM.margin;
  const drawMid = (ctx: CanvasRenderingContext2D) =>
    tileMask(ctx, art.mid, full, midX0, midEnd, Math.max(h + fM.bleed, midTop + midH), midH, 1);
  const lightDir = p.celestial.x >= 0.5 ? 1 : -1;
  const rim = tintedMask(
    fM,
    dpr,
    (ctx) => {
      ctx.translate(0.8 * lightDir, -1.4);
      drawMid(ctx);
    },
    () => rgba(tint.rim, tint.rimAlpha)
  );
  const midMain = tintedMask(fM, dpr, drawMid, () => rgbOf(tint.mid));
  const mid: BakedLayer = { canvas: stack(rim, midMain), ...fM, ...ART_MID, phase: 2.3 };

  // 近景: 下端に下草の帯、左上に枝。シダは大きく(横にも少し伸ばして)描き、390pxで1〜2株・1280pxで2〜3株にする。
  // 根元の帯は画面の下へ沈める。アプリ名(左下)の後ろだけシダを透かして文字を読みやすくする
  const nTop = Math.ceil(ART_NEAR.parallax * 0.25) + 8;
  const fN = artFrame(w, h, ART_NEAR.parallax, ART_NEAR.swayAmp, nTop);
  const groundH = h * 0.78;
  const nearCanvas = tintedMask(
    fN,
    dpr,
    (ctx) => {
      tileMask(ctx, art.near, NEAR_GROUND, -fN.margin - rand() * h * 2, w + fN.margin, h + groundH * 0.06, groundH, 1.7);
      const img = art.near;
      const sw = Math.round(img.width * NEAR_BRANCH.x1);
      const sh = Math.round(img.height * NEAR_BRANCH.y1);
      // アプリ名は下端から約50px(pb-3+行の高さ)より下。枝の下端がそこへ届かない高さにする
      const bh = Math.min(h * 0.5, Math.max(24, h - 54));
      const bw = bh * (sw / sh);
      // 枝の切り口(左端)は、視差+ゆらぎで最大に右へ動いても画面の左端より外に残す
      const cut = ART_NEAR.parallax + ART_NEAR.swayAmp + 1;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(img, 0, 0, sw, sh, -cut, -6, bw, bh);
    },
    () => rgbOf(tint.near)
  );
  fadeBehindTitle(nearCanvas, fN, dpr, h);
  const near: BakedLayer = { canvas: nearCanvas, ...fN, ...ART_NEAR, phase: 4.1 };

  return [far, mid, near];
}

export interface BuildOptions {
  /** 軽量モード(lib/forestPerf.ts)。光芒を1本おきに、蛍を6割に間引く */
  lite?: boolean;
  /** 読み込み済みの挿絵。あれば木立を挿絵3層に置き換える(無ければ手続き生成) */
  art?: ForestArt | null;
}

export function buildForestScene(
  w: number,
  h: number,
  dpr: number,
  band: ForestTimeBand,
  season: ForestSeason = "summer",
  seed = 20260919,
  opts: BuildOptions = {}
): ForestScene {
  const palette = resolveForestPalette(band, season);
  const rand = mulberry32(seed);
  const lite = !!opts.lite;

  const art = opts.art ?? null;
  // 挿絵のときも乱数は手続き生成と同じ回数だけ進める(蛍・星・林冠の位置が、挿絵へ切り替わった瞬間に飛ばないように)
  const layers = art
    ? (LAYER_CONFIGS.forEach((cfg) => skipLayerRand(w, cfg, rand)),
      bakeArtLayers(w, h, dpr, art, palette, band, mulberry32(seed ^ 0x5eed)))
    : LAYER_CONFIGS.map((cfg, i) => bakeLayer(w, h, dpr, cfg, palette.layers[i], rand, i));

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

  const sprites = bakeSprites(w, h, dpr, palette);
  // 軽量モードの間引きは、乱数を引き終えた後で行う(引く回数が変わると林冠や星の配置まで変わってしまう)
  if (lite) fireflies.length = Math.round(fireflies.length * 0.6);

  return { w, h, dpr, band, season, palette, layers, fireflies, leaves, stars, canopy, sprites, lite, art: !!art };
}

function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], t: number) {
  // 色は1つなので、星ごとに rgba 文字列を作らず不透明度だけを変える
  ctx.fillStyle = "rgb(228,238,222)";
  for (const s of stars) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.phase));
    ctx.globalAlpha = 0.55 * tw;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawCelestial(ctx: CanvasRenderingContext2D, scene: ForestScene, t: number) {
  const { w, h, sprites } = scene;
  const c = scene.palette.celestial;
  const cx = w * c.x;
  const cy = h * c.y;
  const breathe = 0.86 + 0.14 * Math.sin(t * 0.27);
  const b = bloomLevel();

  // 光暈: 中心の不透明度0.5の1枚を呼吸で伸縮。完了の瞬間(bloom)は一回り大きい光を重ねて明るくする
  const R = c.r * 5.2 * breathe;
  ctx.globalAlpha = 0.5;
  ctx.drawImage(sprites.celestialGlow, cx - R, cy - R, R * 2, R * 2);
  if (b > 0) {
    const Rb = R * (1 + 0.35 * b);
    ctx.globalAlpha = 0.6 * b;
    ctx.drawImage(sprites.celestialGlow, cx - Rb, cy - Rb, Rb * 2, Rb * 2);
  }
  ctx.globalAlpha = 1;

  const o = c.r + sprites.celestialBodyPad;
  ctx.drawImage(sprites.celestialBody, cx - o, cy - o, o * 2, o * 2);
}

// 梢の隙間から差し込む光芒。合成モードを lighter にして、重なった部分が
// 自然に明るくなる(=光が束になる)ようにしている
function drawGodRays(ctx: CanvasRenderingContext2D, scene: ForestScene, t: number) {
  const { w, h, palette: p, sprites } = scene;
  if (p.rayAlpha <= 0) return;
  const originX = w * p.celestial.x;
  const originY = -h * 0.45;
  const len = rayLength(h);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < sprites.rays.length; i++) {
    // 軽量モードは1本おき(4本)。残す光芒の明るさは変えない
    if (scene.lite && i % 2 === 1) continue;
    const phase = i * 1.7;
    const breathe = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.21 + phase));
    const angle = -0.62 + i * 0.11 + Math.sin(t * 0.045 + phase) * 0.014;
    const { canvas, spread } = sprites.rays[i];
    ctx.save();
    ctx.translate(originX, originY);
    ctx.rotate(angle);
    ctx.globalAlpha = breathe;
    ctx.drawImage(canvas, -spread * 1.9, 0, spread * 3.8, len);
    ctx.restore();
  }
  ctx.restore();
}

// 地を這う霧。横に引き伸ばした楕円グラデーション(焼いた円を楕円の箱へ描く)を、速さを変えて流す
function drawMist(ctx: CanvasRenderingContext2D, scene: ForestScene, t: number, tier: number) {
  const { w, h, palette: p, sprites } = scene;
  const rows = tier === 0 ? [0.68, 0.79] : [0.9, 1.0];
  const speed = tier === 0 ? 7 : 13;
  ctx.globalAlpha = p.mistAlpha * (tier === 0 ? 0.75 : 1);
  for (let r = 0; r < rows.length; r++) {
    const y = h * rows[r];
    const drift = ((t * speed * (r === 0 ? 1 : -0.7)) % (w + 400)) - 200;
    for (let i = -1; i < 3; i++) {
      const cx = drift + i * (w * 0.62) + Math.sin(t * 0.12 + i * 1.3 + tier) * 26;
      const rx = w * 0.42;
      const ry = h * (0.1 + 0.03 * ((i + tier) % 2));
      if (cx + rx < 0 || cx - rx > w) continue;
      ctx.drawImage(sprites.mist, cx - rx, y - ry, rx * 2, ry * 2);
    }
  }
  ctx.globalAlpha = 1;
}

// 蛍。直線でも正弦でもない「迷いながら漂う」動きにするため、
// 周期の違う2つの正弦波を重ねて位置を作り、明滅も別周期で揺らしている
function drawFireflies(ctx: CanvasRenderingContext2D, scene: ForestScene, t: number) {
  const { w, h, fireflies: flies, sprites } = scene;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = rgbOf(FIREFLY_CORE);
  const b = bloomLevel();
  for (const f of flies) {
    const tt = t * f.speed;
    const x = f.x + Math.sin(tt * 0.32 + f.phase) * f.driftX + Math.sin(tt * 0.13 + f.phase * 2.1) * (f.driftX * 0.42);
    const y = f.y + Math.cos(tt * 0.24 + f.phase) * f.driftY + Math.sin(tt * 0.08 + f.phase) * (f.driftY * 0.5);
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    const pulse = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(tt * 1.9 + f.phase * 3), 2);
    const lit = Math.min(1, pulse + 0.7 * b);

    const glowR = f.r * (7.5 + 4 * b);
    ctx.globalAlpha = 0.42 * lit;
    ctx.drawImage(sprites.fireflyGlow, x - glowR, y - glowR, glowR * 2, glowR * 2);

    ctx.globalAlpha = 0.6 + 0.4 * lit;
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
function drawCanopy(ctx: CanvasRenderingContext2D, scene: ForestScene, p: ForestPalette, t: number, depth = 1, alpha = 1) {
  const { w, canopy } = scene;
  // depth: 垂れ下がりの深さの倍率(挿絵のときは浅く薄くして、上辺が泥の帯に見えないようにする)
  const h = scene.h * depth;
  // 半円を並べるのではなく、房ごとに深さの違う下端を二次曲線でつないで
  // 一枚続きの葉のかたまりにする。風でわずかに上下に揺れる
  const yOf = (i: number) => canopy[i].r * depth + Math.sin(t * 0.3 + i * 0.9) * 2.4;
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
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export interface DrawOptions {
  /** ポインタの位置(0〜1)。視差の中心をずらす。未取得時は0.5 */
  px: number;
  py: number;
  /** 動きを止める(prefers-reduced-motion)。時間を固定した1枚だけを描く */
  still: boolean;
}

/** 木立(または画像の視差レイヤー)1枚を、視差とゆらぎの分だけずらして転写する */
function blitLayer(ctx: CanvasRenderingContext2D, scene: ForestScene, l: BakedLayer | undefined, t: number, ox: number, oy: number) {
  if (!l) return;
  const sway = Math.sin(t * l.swaySpeed + l.phase) * l.swayAmp;
  const dx = -l.margin - ox * l.parallax + sway;
  const dy = -(l.cssH - scene.h - (l.bleed ?? 0)) - oy * l.parallax * 0.25;
  ctx.drawImage(l.canvas, dx, dy, l.cssW, l.cssH);
}

export function drawForestScene(
  ctx: CanvasRenderingContext2D,
  scene: ForestScene,
  t: number,
  opts: DrawOptions
) {
  const p = scene.palette;
  const { w, h, sprites, layers } = scene;
  const ox = (opts.px - 0.5) * 2;
  const oy = (opts.py - 0.5) * 2;

  // 空は不透明なので、消してから塗る必要はない(backdrop が全面を上書きする)
  ctx.drawImage(sprites.backdrop, 0, 0, w, h);
  if (scene.stars.length > 0) drawStars(ctx, scene.stars, t);
  drawCelestial(ctx, scene, t);

  if (scene.art) {
    // 挿絵3層(遠景・中景・近景)。林冠は近景の枝の後ろに置き、枝が梢から垂れて見えるようにする
    drawGodRays(ctx, scene, t);
    blitLayer(ctx, scene, layers[0], t, ox, oy);
    drawMist(ctx, scene, t, 0);
    blitLayer(ctx, scene, layers[1], t, ox, oy);
    if (scene.fireflies.length > 0) drawFireflies(ctx, scene, t);
    drawMist(ctx, scene, t, 1);
    if (scene.leaves.length > 0) drawLeaves(ctx, scene.leaves, t, h, scene.band, p);
    drawCanopy(ctx, scene, p, t, 0.5, 0.55);
    blitLayer(ctx, scene, layers[2], t, ox, oy);
    ctx.drawImage(sprites.vignette, 0, 0, w, h);
    return;
  }

  blitLayer(ctx, scene, layers[0], t, ox, oy);
  drawGodRays(ctx, scene, t);
  blitLayer(ctx, scene, layers[1], t, ox, oy);
  drawMist(ctx, scene, t, 0);
  blitLayer(ctx, scene, layers[2], t, ox, oy);
  if (scene.fireflies.length > 0) drawFireflies(ctx, scene, t);
  blitLayer(ctx, scene, layers[3], t, ox, oy);
  drawMist(ctx, scene, t, 1);
  if (scene.leaves.length > 0) drawLeaves(ctx, scene.leaves, t, h, scene.band, p);
  blitLayer(ctx, scene, layers[4], t, ox, oy);
  drawCanopy(ctx, scene, p, t);
  ctx.drawImage(sprites.vignette, 0, 0, w, h);
}
