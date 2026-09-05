import type { AbilityColor, ExpKind, MotivationLevel, PracticeKind } from "./powerpro";

// パワプロ風モードの図版を、ブラウザのCanvasでその場で描く。
//
// 元ネタのサクセスの画面は「明るい球場の一枚絵の上に、光沢のあるUIパーツが乗る」構成で、
// ・青空〜夕焼けまで時間帯で変わる背景
// ・芝の刈り込み跡が縞になったグラウンド
// ・2頭身のキャラクターが中央に立つ
// ・経験点は5色に色分けされ、能力値はG〜Sのランク付き
// といった要素が並ぶ。ここではそれらを、実データを引数に取る描画関数として用意する。
//
// 外部画像は一切持ち込まない(オフライン動作・容量・権利のため)のは他モードと同じ。
// 種は作業名や案件IDなので、同じ対象には毎回まったく同じ絵が出る。

export function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h / 4294967296;
  };
}

export type Rgb = [number, number, number];

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function rgb(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function readCssRgb(name: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) return [parts[0], parts[1], parts[2]];
  return fallback;
}

export interface Palette {
  accent: Rgb; // チームカラーの青
  ink: Rgb; // ページの地(ほぼ白)
  cream: Rgb; // 文字色(濃紺)
  panel: Rgb; // カード面(白)
}

export function readPalette(): Palette {
  return {
    accent: readCssRgb("--accent-rgb", [32, 108, 214]),
    ink: readCssRgb("--ink-rgb", [246, 248, 252]),
    cream: readCssRgb("--cream-rgb", [26, 32, 46]),
    panel: readCssRgb("--panel-rgb", [255, 255, 255]),
  };
}

// 経験点の5色。元ネタの色分け(筋力=赤/敏捷=青/技術=黄/変化球=緑/精神=紫)に合わせている
export const EXP_COLOR: Record<ExpKind, Rgb> = {
  muscle: [226, 59, 59],
  agility: [46, 123, 228],
  technique: [232, 178, 28],
  breaking: [47, 168, 91],
  mental: [122, 111, 208],
};

export const SPECIAL_COLOR: Record<AbilityColor, Rgb> = {
  gold: [214, 163, 32],
  blue: [46, 123, 228],
  red: [212, 52, 52],
};

// ------------------------------------------------------------
// 共通の下地
// ------------------------------------------------------------

/** 角丸の矩形。パスだけ引く(塗り/線は呼び出し側) */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 上半分に白い光沢を乗せる。スポーツゲームUIらしい艶はほぼこれで出る */
function gloss(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, strength = 0.32) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  g.addColorStop(0, `rgba(255,255,255,${strength})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h * 0.55);
  ctx.restore();
}

// ============================================================
// 球場(見出しの一枚絵)
// ============================================================
// 時間帯で空の色が変わり、いま計測中かどうかでキャラクターの構えが変わる。
// 電光掲示板の数字は本日の完了件数/予定件数そのもの。

export type SkyPhase = "morning" | "day" | "evening" | "night";

export function skyPhaseOf(hour: number): SkyPhase {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "evening";
  return "night";
}

const SKY: Record<SkyPhase, { top: Rgb; bottom: Rgb; light: number }> = {
  morning: { top: [126, 186, 236], bottom: [216, 236, 248], light: 0.9 },
  day: { top: [58, 148, 224], bottom: [186, 224, 246], light: 1 },
  evening: { top: [232, 138, 84], bottom: [250, 214, 168], light: 0.78 },
  night: { top: [16, 26, 54], bottom: [42, 62, 106], light: 0.45 },
};

export interface StadiumOptions {
  width: number;
  height: number;
  phase: SkyPhase;
  motivation: MotivationLevel;
  running: boolean;
  injured: boolean;
  /** 熱血ゲージの充填率(0〜1)。1になるとキャラクターの周りに光がまわる */
  hot: number;
  fever: boolean;
  doneCount: number;
  totalCount: number;
  seed: string;
  palette: Palette;
}

export function paintStadium(ctx: CanvasRenderingContext2D, o: StadiumOptions) {
  const { width: w, height: h, palette } = o;
  const rng = makeRng(`stadium:${o.seed}`);
  const sky = SKY[o.phase];
  const horizon = h * 0.44;

  ctx.clearRect(0, 0, w, h);

  // --- 空 ---
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
  skyGrad.addColorStop(0, rgb(sky.top));
  skyGrad.addColorStop(1, rgb(sky.bottom));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, horizon);

  // 夜だけ、ナイター照明の光芒を四隅から差し込ませる
  if (o.phase === "night") {
    for (const bx of [w * 0.16, w * 0.84]) {
      const g = ctx.createRadialGradient(bx, h * 0.06, 2, bx, h * 0.06, h * 0.7);
      g.addColorStop(0, "rgba(255,248,214,0.55)");
      g.addColorStop(1, "rgba(255,248,214,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx, h * 0.06);
      ctx.lineTo(bx - w * 0.34, horizon + h * 0.3);
      ctx.lineTo(bx + w * 0.34, horizon + h * 0.3);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // 昼〜夕方はうっすら雲を流す
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    for (let i = 0; i < 4; i++) {
      const cx = rng() * w;
      const cy = horizon * (0.12 + rng() * 0.45);
      const cw = w * (0.12 + rng() * 0.16);
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, cw * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- 照明塔 ---
  ctx.fillStyle = rgba([70, 84, 108], o.phase === "night" ? 0.9 : 0.45);
  for (const bx of [w * 0.14, w * 0.86]) {
    ctx.fillRect(bx - 2, h * 0.05, 4, horizon * 0.62);
    roundRect(ctx, bx - 17, h * 0.03, 34, 18, 3);
    ctx.fill();
  }
  if (o.phase === "night") {
    ctx.fillStyle = "rgba(255,250,220,0.95)";
    for (const bx of [w * 0.14, w * 0.86]) {
      for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) ctx.fillRect(bx - 14 + c * 6, h * 0.03 + 4 + r * 7, 4, 4);
    }
  }

  // --- スタンド(観客) ---
  const standTop = horizon - h * 0.2;
  const standGrad = ctx.createLinearGradient(0, standTop, 0, horizon);
  standGrad.addColorStop(0, rgba(mix(palette.accent, [12, 18, 34], 0.55), sky.light));
  standGrad.addColorStop(1, rgba(mix(palette.accent, [12, 18, 34], 0.78), sky.light));
  ctx.fillStyle = standGrad;
  ctx.fillRect(0, standTop, w, horizon - standTop);

  // 観客は点で。混み具合(=本日の予定件数)が多いほど密になる
  const density = Math.min(1, 0.35 + o.totalCount * 0.08);
  const dots = Math.floor(w * (horizon - standTop) * 0.012 * density);
  for (let i = 0; i < dots; i++) {
    const x = rng() * w;
    const y = standTop + rng() * (horizon - standTop);
    const t = rng();
    const c: Rgb = t < 0.4 ? [236, 232, 224] : t < 0.7 ? mix(palette.accent, [255, 255, 255], 0.35) : [214, 92, 84];
    ctx.fillStyle = rgba(c, (0.35 + rng() * 0.45) * sky.light);
    ctx.fillRect(x, y, 2, 2);
  }

  // --- 外野フェンス ---
  ctx.fillStyle = rgba([22, 62, 40], sky.light);
  ctx.fillRect(0, horizon - 12, w, 12);
  ctx.fillStyle = rgba([236, 206, 60], sky.light);
  ctx.fillRect(0, horizon - 13, w, 2);

  // --- 芝(刈り込みの縞) ---
  // 奥は濃く手前は明るい、いわゆる「刈り込み跡」の見え方に合わせる。
  // 白を薄く重ねるだけだと濁って見えたので、濃淡2色の芝を交互に敷いている
  const grassLight = mix([96, 196, 106], [0, 0, 0], 1 - sky.light);
  const grassDark = mix([54, 146, 72], [0, 0, 0], 1 - sky.light);
  const grassGrad = ctx.createLinearGradient(0, horizon, 0, h);
  grassGrad.addColorStop(0, rgb(mix(grassDark, [0, 0, 0], 0.12)));
  grassGrad.addColorStop(1, rgb(grassLight));
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, horizon, w, h - horizon);

  // 手前ほど広がる縞。台形にすることで奥行きが出る
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon, w, h - horizon);
  ctx.clip();
  const stripes = 9;
  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 1) continue;
    const t0 = i / stripes;
    const t1 = (i + 1) / stripes;
    ctx.fillStyle = rgba(grassDark, 0.55);
    ctx.beginPath();
    ctx.moveTo(w * (0.5 + (t0 - 0.5) * 0.55), horizon);
    ctx.lineTo(w * (0.5 + (t1 - 0.5) * 0.55), horizon);
    ctx.lineTo(w * t1 * 1.6 - w * 0.3, h);
    ctx.lineTo(w * t0 * 1.6 - w * 0.3, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // --- 内野の土 ---
  // 選手が立つ位置(groundY)を基準に土の帯を敷く。画面の下端いっぱいまで土にすると
  // 下部のゲージ盤と重なって荒れ地のように見えるため、選手の足元だけを土にしている
  const groundY = h * 0.72;
  const dirtCenterY = groundY + h * 0.22;
  const dirtRy = h * 0.34;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(w / 2, dirtCenterY, w * 0.62, dirtRy, 0, Math.PI, Math.PI * 2);
  ctx.clip();
  const dirtGrad = ctx.createLinearGradient(0, dirtCenterY - dirtRy, 0, h);
  dirtGrad.addColorStop(0, rgb(mix([206, 156, 104], [0, 0, 0], 1 - sky.light)));
  dirtGrad.addColorStop(1, rgb(mix([176, 120, 74], [0, 0, 0], 1 - sky.light)));
  ctx.fillStyle = dirtGrad;
  ctx.fillRect(0, dirtCenterY - dirtRy, w, h);
  ctx.restore();
  // 土と芝の境目に白線
  ctx.strokeStyle = `rgba(255,255,255,${0.45 * sky.light})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(w / 2, dirtCenterY, w * 0.62, dirtRy, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  // ホームベース(選手の足元)
  const plateY = groundY + 3;
  ctx.fillStyle = `rgba(255,255,255,${0.85 * sky.light})`;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 16, plateY);
  ctx.lineTo(w / 2 + 16, plateY);
  ctx.lineTo(w / 2 + 12, plateY + 7);
  ctx.lineTo(w / 2, plateY + 12);
  ctx.lineTo(w / 2 - 12, plateY + 7);
  ctx.closePath();
  ctx.fill();

  // --- 電光掲示板 ---
  paintScoreboard(ctx, {
    x: w - Math.min(112, w * 0.34) - 8,
    y: standTop - 26,
    w: Math.min(112, w * 0.34),
    h: 40,
    done: o.doneCount,
    total: o.totalCount,
    light: sky.light,
  });

  // --- フィーバー時の光輪 ---
  if (o.fever || o.hot >= 0.999) {
    const g = ctx.createRadialGradient(w / 2, h * 0.58, 4, w / 2, h * 0.58, w * 0.42);
    g.addColorStop(0, "rgba(255,226,120,0.55)");
    g.addColorStop(1, "rgba(255,226,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // --- 選手 ---
  // 頭がスタンドの暗がりに紛れないよう、背後にごく淡い光を敷いて輪郭を立たせる
  const halo = ctx.createRadialGradient(w / 2, groundY - h * 0.24, 2, w / 2, groundY - h * 0.24, w * 0.24);
  halo.addColorStop(0, "rgba(255,255,255,0.28)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(h * 0.0072, w * 0.005);
  paintPlayer(ctx, {
    cx: w / 2,
    baseY: groundY,
    scale,
    motivation: o.motivation,
    running: o.running,
    injured: o.injured,
    accent: palette.accent,
  });

  // --- 周縁の落ち込み ---
  const vg = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(8,14,28,0.2)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function paintScoreboard(
  ctx: CanvasRenderingContext2D,
  o: { x: number; y: number; w: number; h: number; done: number; total: number; light: number }
) {
  const { x, y, w, h } = o;
  ctx.save();
  ctx.fillStyle = rgba([16, 22, 34], 0.92);
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = rgba([200, 212, 232], 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "rgba(120,220,150,0.85)";
  ctx.font = `bold ${Math.round(h * 0.26)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("DONE", x + 7, y + 5);

  // 7セグ風に見せたいので、数字は等幅・発光色で大きく置く
  ctx.font = `bold ${Math.round(h * 0.5)}px ui-monospace, monospace`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,214,84,0.95)";
  ctx.shadowColor = "rgba(255,196,40,0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(`${o.done}`.padStart(2, "0"), x + 7, y + h - 7);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(190,204,226,0.7)";
  ctx.font = `bold ${Math.round(h * 0.3)}px ui-monospace, monospace`;
  ctx.fillText(`/${`${o.total}`.padStart(2, "0")}`, x + 7 + Math.round(h * 0.62), y + h - 8);
  ctx.restore();
}

// ============================================================
// 2頭身のキャラクター
// ============================================================
// 元ネタのキャラクターは丸みのある頭が体より大きく、胴体が足から少し浮いている
// のが特徴。ここでは同じ骨格の考え方で、自前の図形として組み立てている。
// やる気(眉と口)と、計測中かどうか(構え)と、ケガの危険(汗)が絵に出る。

export interface PlayerOptions {
  cx: number;
  baseY: number;
  scale: number; // 1で頭の直径がおよそ34px
  motivation: MotivationLevel;
  running: boolean;
  injured: boolean;
  accent: Rgb;
}

export function paintPlayer(ctx: CanvasRenderingContext2D, o: PlayerOptions) {
  const s = o.scale;
  const skin: Rgb = [250, 214, 176];
  const uniform = o.accent;
  const dark = mix(uniform, [0, 0, 0], 0.35);

  ctx.save();
  ctx.translate(o.cx, o.baseY);

  // 影
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 26 * s, 7 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // 脚(胴体との間に隙間を残すのがこの体型の要)
  ctx.fillStyle = rgb(dark);
  for (const dx of [-8, 8]) {
    roundRect(ctx, dx * s - 5 * s, -17 * s, 10 * s, 12 * s, 4 * s);
    ctx.fill();
  }
  // 靴
  ctx.fillStyle = "rgb(30,36,48)";
  for (const dx of [-8, 8]) {
    roundRect(ctx, dx * s - 7 * s, -6 * s, 14 * s, 7 * s, 3 * s);
    ctx.fill();
  }

  // 胴体。足の上に浮かせる
  const bodyY = -44 * s;
  const bodyGrad = ctx.createLinearGradient(0, bodyY, 0, bodyY + 24 * s);
  bodyGrad.addColorStop(0, rgb(mix(uniform, [255, 255, 255], 0.22)));
  bodyGrad.addColorStop(1, rgb(dark));
  ctx.fillStyle = bodyGrad;
  roundRect(ctx, -15 * s, bodyY, 30 * s, 25 * s, 9 * s);
  ctx.fill();
  // 前立てのライン
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  ctx.moveTo(0, bodyY + 3 * s);
  ctx.lineTo(0, bodyY + 22 * s);
  ctx.stroke();

  // 腕。計測中はバットを構え、そうでなければ下ろす
  ctx.fillStyle = rgb(uniform);
  if (o.running) {
    roundRect(ctx, 8 * s, bodyY + 2 * s, 16 * s, 8 * s, 4 * s);
    ctx.fill();
    roundRect(ctx, -22 * s, bodyY + 4 * s, 16 * s, 8 * s, 4 * s);
    ctx.fill();
    // バット
    ctx.save();
    ctx.translate(20 * s, bodyY + 4 * s);
    ctx.rotate(-Math.PI / 3.1);
    const bg = ctx.createLinearGradient(0, 0, 0, -46 * s);
    bg.addColorStop(0, "rgb(168,116,64)");
    bg.addColorStop(1, "rgb(222,176,116)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-2.4 * s, 0);
    ctx.lineTo(2.4 * s, 0);
    ctx.lineTo(4.4 * s, -46 * s);
    ctx.lineTo(-4.4 * s, -46 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else {
    roundRect(ctx, 12 * s, bodyY + 5 * s, 8 * s, 17 * s, 4 * s);
    ctx.fill();
    roundRect(ctx, -20 * s, bodyY + 5 * s, 8 * s, 17 * s, 4 * s);
    ctx.fill();
  }

  // 頭。丸みのあるカプセル型で、体より一回り大きい
  const headY = bodyY - 30 * s;
  const headGrad = ctx.createRadialGradient(-6 * s, headY - 6 * s, 2 * s, 0, headY, 24 * s);
  headGrad.addColorStop(0, rgb(mix(skin, [255, 255, 255], 0.45)));
  headGrad.addColorStop(1, rgb(skin));
  ctx.fillStyle = headGrad;
  roundRect(ctx, -21 * s, headY - 20 * s, 42 * s, 40 * s, 17 * s);
  ctx.fill();
  ctx.strokeStyle = "rgba(64,48,36,0.5)";
  ctx.lineWidth = 1.2 * s;
  roundRect(ctx, -21 * s, headY - 20 * s, 42 * s, 40 * s, 17 * s);
  ctx.stroke();

  // 帽子
  ctx.fillStyle = rgb(uniform);
  ctx.beginPath();
  ctx.ellipse(0, headY - 10 * s, 21 * s, 15 * s, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(dark);
  roundRect(ctx, -3 * s, headY - 7 * s, 28 * s, 5 * s, 2.5 * s);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = `bold ${13 * s}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("P", -7 * s, headY - 15 * s);

  // 目
  ctx.fillStyle = "rgb(28,26,32)";
  const eyeY = headY + 1 * s;
  const eyeOpen = o.motivation >= 1 ? 1 : 0.45;
  for (const dx of [-8, 8]) {
    ctx.beginPath();
    ctx.ellipse(dx * s, eyeY, 3 * s, 4 * s * eyeOpen, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (o.motivation >= 3) {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    for (const dx of [-8, 8]) {
      ctx.beginPath();
      ctx.ellipse(dx * s + 1 * s, eyeY - 1.5 * s, 1.1 * s, 1.3 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 眉。やる気が高いほど上がり、低いほど八の字に下がる
  const browTilt = (o.motivation - 2) * 0.22;
  ctx.strokeStyle = "rgb(64,48,36)";
  ctx.lineWidth = 2.2 * s;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 12 * s, eyeY - 8 * s + side * browTilt * 5 * s);
    ctx.lineTo(side * 4 * s, eyeY - 8 * s - side * browTilt * 5 * s);
    ctx.stroke();
  }

  // 口。やる気で弧の向きが変わる
  ctx.strokeStyle = "rgb(64,40,36)";
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  const curve = (o.motivation - 2) * 3.2;
  ctx.moveTo(-6 * s, eyeY + 9 * s);
  ctx.quadraticCurveTo(0, eyeY + (9 + curve) * s, 6 * s, eyeY + 9 * s);
  ctx.stroke();

  // ケガの危険が高いときは汗
  if (o.injured) {
    ctx.fillStyle = "rgba(110,180,240,0.9)";
    for (const [dx, dy] of [
      [20, -8],
      [24, 2],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(dx * s, headY + dy * s);
      ctx.quadraticCurveTo((dx + 4) * s, (headY / s + dy + 5) * s, dx * s, (headY / s + dy + 8) * s);
      ctx.quadraticCurveTo((dx - 4) * s, (headY / s + dy + 5) * s, dx * s, headY + dy * s);
      ctx.fill();
    }
  }

  ctx.restore();
}

// ============================================================
// 練習コマンドのアイコン
// ============================================================
// 6種の練習それぞれに、線画のアイコンを持たせる。ボタン自体はDOMなので
// 当たり判定はブラウザ任せにでき、ここは絵に専念できる。

export function paintPracticeIcon(
  ctx: CanvasRenderingContext2D,
  o: { size: number; kind: PracticeKind; color: Rgb; dim: boolean }
) {
  const s = o.size;
  ctx.clearRect(0, 0, s, s);
  const c = o.color;
  const alpha = o.dim ? 0.35 : 1;

  // 丸い下地
  const g = ctx.createRadialGradient(s * 0.36, s * 0.3, s * 0.05, s * 0.5, s * 0.5, s * 0.55);
  g.addColorStop(0, rgba(mix(c, [255, 255, 255], 0.4), alpha));
  g.addColorStop(1, rgba(mix(c, [0, 0, 0], 0.22), alpha));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.55 * alpha})`;
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.stroke();

  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = `rgba(255,255,255,${0.96 * alpha})`;
  ctx.fillStyle = `rgba(255,255,255,${0.96 * alpha})`;
  ctx.lineWidth = Math.max(1.4, s * 0.075);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const u = s * 0.28; // 図形の基準半径

  switch (o.kind) {
    case "batting": {
      // バットとボール
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(0, u * 1.05);
      ctx.lineTo(0, -u * 0.9);
      ctx.stroke();
      ctx.lineWidth = Math.max(2.4, s * 0.135);
      ctx.beginPath();
      ctx.moveTo(0, -u * 0.35);
      ctx.lineTo(0, -u * 0.95);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(u * 0.75, u * 0.7, u * 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "running": {
      // 走塁: 塁と走者の軌跡
      ctx.beginPath();
      ctx.moveTo(-u * 0.9, u * 0.7);
      ctx.quadraticCurveTo(0, -u * 1.0, u * 0.9, u * 0.7);
      ctx.stroke();
      ctx.save();
      ctx.translate(u * 0.9, u * 0.75);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-u * 0.28, -u * 0.28, u * 0.56, u * 0.56);
      ctx.restore();
      ctx.save();
      ctx.translate(-u * 0.9, u * 0.75);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-u * 0.28, -u * 0.28, u * 0.56, u * 0.56);
      ctx.restore();
      break;
    }
    case "pitching": {
      // 投球: ボールと縫い目、後ろに速度線
      ctx.beginPath();
      ctx.arc(u * 0.15, 0, u * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath();
      ctx.arc(u * 0.15 - u * 0.42, 0, u * 0.62, -Math.PI / 2.4, Math.PI / 2.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(u * 0.15 + u * 0.42, 0, u * 0.62, Math.PI - Math.PI / 2.4, Math.PI + Math.PI / 2.4);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.4, s * 0.075);
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-u * 1.35, i * u * 0.42);
        ctx.lineTo(-u * 0.85, i * u * 0.42);
        ctx.stroke();
      }
      break;
    }
    case "fielding": {
      // 守備: グラブ
      ctx.beginPath();
      ctx.arc(0, u * 0.05, u * 0.78, Math.PI * 0.92, Math.PI * 2.08);
      ctx.lineTo(u * 0.62, u * 0.72);
      ctx.lineTo(-u * 0.62, u * 0.72);
      ctx.closePath();
      ctx.stroke();
      for (const dx of [-0.36, 0, 0.36]) {
        ctx.beginPath();
        ctx.moveTo(dx * u, -u * 0.6);
        ctx.lineTo(dx * u, -u * 0.05);
        ctx.stroke();
      }
      break;
    }
    case "catching": {
      // 捕手のマスク
      roundRect(ctx, -u * 0.72, -u * 0.72, u * 1.44, u * 1.44, u * 0.42);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, s * 0.05);
      for (const t of [-0.3, 0.1, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(-u * 0.7, t * u);
        ctx.lineTo(u * 0.7, t * u);
        ctx.stroke();
      }
      for (const t of [-0.35, 0.35]) {
        ctx.beginPath();
        ctx.moveTo(t * u, -u * 0.7);
        ctx.lineTo(t * u, u * 0.7);
        ctx.stroke();
      }
      break;
    }
    case "mental": {
      // メンタル: 頭と、そこから立ちのぼる集中線
      ctx.beginPath();
      ctx.arc(0, u * 0.22, u * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(i * u * 0.42, -u * 0.66);
        ctx.lineTo(i * u * 0.62, -u * 1.2);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

// ============================================================
// 光沢ゲージ(体力・やる気・熱血)
// ============================================================

export interface GaugeOptions {
  width: number;
  height: number;
  value: number; // 0〜1
  color: Rgb;
  /** 区切り線の本数。0で無段階のバーになる */
  segments: number;
  danger: boolean;
}

export function paintGauge(ctx: CanvasRenderingContext2D, o: GaugeOptions) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);
  const r = h / 2;

  // 溝
  ctx.fillStyle = "rgba(18,26,44,0.16)";
  roundRect(ctx, 0, 0, w, h, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(18,26,44,0.22)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, r);
  ctx.stroke();

  const fillW = Math.max(0, Math.min(1, o.value)) * w;
  if (fillW > 1) {
    ctx.save();
    roundRect(ctx, 0, 0, w, h, r);
    ctx.clip();
    const c = o.danger ? ([214, 58, 58] as Rgb) : o.color;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgb(mix(c, [255, 255, 255], 0.5)));
    g.addColorStop(0.45, rgb(c));
    g.addColorStop(1, rgb(mix(c, [0, 0, 0], 0.28)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, fillW, h);
    // 上面のハイライト
    const hg = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    hg.addColorStop(0, "rgba(255,255,255,0.55)");
    hg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, fillW, h * 0.5);
    ctx.restore();
  }

  // 区切り
  if (o.segments > 1) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    for (let i = 1; i < o.segments; i++) {
      const x = (w / o.segments) * i;
      ctx.beginPath();
      ctx.moveTo(x, 1);
      ctx.lineTo(x, h - 1);
      ctx.stroke();
    }
  }
}

// ============================================================
// 能力値の六角形(レーダー)
// ============================================================

export interface HexOptions {
  width: number;
  height: number;
  /** 6つの値(0〜150)。ABILITY_KEYSの順 */
  values: number[];
  labels: string[];
  accent: Rgb;
  ink: Rgb;
}

export function paintAbilityHex(ctx: CanvasRenderingContext2D, o: HexOptions) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2 + 2;
  const R = Math.min(w, h) * 0.36;
  const n = 6;
  const angleAt = (i: number) => -Math.PI / 2 + (Math.PI * 2 * i) / n;

  // 目盛りの六角形
  for (let ring = 1; ring <= 4; ring++) {
    const rr = (R * ring) / 4;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = angleAt(i);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = rgba(o.ink, ring === 4 ? 0.35 : 0.14);
    ctx.lineWidth = ring === 4 ? 1.4 : 1;
    ctx.stroke();
  }
  // 軸
  ctx.strokeStyle = rgba(o.ink, 0.14);
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.stroke();
  }

  // 実測の多角形
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    const rr = (R * Math.max(0, Math.min(150, o.values[i] ?? 0))) / 150;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
  g.addColorStop(0, rgba(mix(o.accent, [255, 255, 255], 0.5), 0.55));
  g.addColorStop(1, rgba(o.accent, 0.3));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgb(o.accent);
  ctx.lineWidth = 2;
  ctx.stroke();

  // 頂点
  ctx.fillStyle = rgb(o.accent);
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    const rr = (R * Math.max(0, Math.min(150, o.values[i] ?? 0))) / 150;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ラベル
  ctx.fillStyle = rgba(o.ink, 0.7);
  ctx.font = `bold ${Math.max(9, Math.round(R * 0.19))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const a = angleAt(i);
    ctx.fillText(o.labels[i] ?? "", cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 12));
  }
}

// ============================================================
// ランクの記章
// ============================================================
// S〜Gの一文字を、金属質の盾に打ち抜く。選手カードの顔になる部分

const RANK_COLOR: Record<string, [Rgb, Rgb]> = {
  S: [[236, 196, 72], [180, 130, 20]],
  A: [[228, 82, 78], [166, 40, 40]],
  B: [[238, 152, 62], [186, 100, 24]],
  C: [[236, 206, 80], [186, 152, 30]],
  D: [[110, 196, 128], [50, 138, 74]],
  E: [[104, 168, 224], [40, 106, 176]],
  F: [[150, 158, 178], [98, 106, 128]],
  G: [[168, 172, 184], [116, 120, 136]],
};

/** 記章と同じ配色を、DOM側のバッジでも使えるようにCSSの色として返す */
export function rankCssColor(rank: string): string {
  const [light, dark] = RANK_COLOR[rank] ?? RANK_COLOR.G;
  return `linear-gradient(to bottom, ${rgb(light)}, ${rgb(dark)})`;
}

export function paintRankEmblem(ctx: CanvasRenderingContext2D, o: { size: number; rank: string }) {
  const s = o.size;
  ctx.clearRect(0, 0, s, s);
  const [light, dark] = RANK_COLOR[o.rank] ?? RANK_COLOR.G;

  ctx.save();
  ctx.translate(s / 2, s / 2);

  // 盾の形
  ctx.beginPath();
  ctx.moveTo(-s * 0.36, -s * 0.4);
  ctx.lineTo(s * 0.36, -s * 0.4);
  ctx.lineTo(s * 0.36, s * 0.1);
  ctx.quadraticCurveTo(s * 0.36, s * 0.36, 0, s * 0.44);
  ctx.quadraticCurveTo(-s * 0.36, s * 0.36, -s * 0.36, s * 0.1);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.44);
  g.addColorStop(0, rgb(mix(light, [255, 255, 255], 0.4)));
  g.addColorStop(0.5, rgb(light));
  g.addColorStop(1, rgb(dark));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(mix(dark, [0, 0, 0], 0.35), 0.9);
  ctx.lineWidth = Math.max(1, s * 0.045);
  ctx.stroke();

  // 文字
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.font = `900 ${s * 0.52}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = rgba(mix(dark, [0, 0, 0], 0.5), 0.7);
  ctx.shadowOffsetY = Math.max(1, s * 0.03);
  ctx.fillText(o.rank, 0, s * 0.02);
  ctx.restore();
}

// ============================================================
// スカウト候補の胸像(ToDo一覧用)
// ============================================================
// 一覧の各行に置く小さな図。ヘルメットの色は件名から決定的に決まるので、
// 同じToDoは一覧の並びが変わっても同じ顔で出る。評価が高いほど背景が熱を帯びる。

export function paintScoutBust(
  ctx: CanvasRenderingContext2D,
  o: { size: number; seed: string; urgency: number; done: boolean; accent: Rgb }
) {
  const s = o.size;
  ctx.clearRect(0, 0, s, s);
  const rng = makeRng(`scout:${o.seed}`);
  const hue = rng();
  const helmet: Rgb = o.done
    ? [156, 162, 176]
    : mix(o.accent, hue < 0.33 ? [214, 62, 62] : hue < 0.66 ? [40, 152, 96] : [122, 92, 200], hue);

  // 背景。期日が近いほど赤みが差す
  const bg = ctx.createLinearGradient(0, 0, 0, s);
  const heat: Rgb = o.done ? [226, 230, 238] : mix([226, 236, 250], [252, 216, 208], o.urgency);
  bg.addColorStop(0, rgb(mix(heat, [255, 255, 255], 0.5)));
  bg.addColorStop(1, rgb(heat));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);

  // 集中線(期日が迫っているときだけ)
  if (!o.done && o.urgency > 0.5) {
    ctx.strokeStyle = `rgba(214,72,60,${0.12 + o.urgency * 0.2})`;
    ctx.lineWidth = Math.max(1, s * 0.03);
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10 + rng() * 0.2;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * s * 0.4, s / 2 + Math.sin(a) * s * 0.4);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.72, s / 2 + Math.sin(a) * s * 0.72);
      ctx.stroke();
    }
  }

  const skin: Rgb = [250, 214, 176];
  ctx.save();
  ctx.translate(s / 2, s * 0.62);

  // 肩
  ctx.fillStyle = rgb(mix(helmet, [0, 0, 0], 0.25));
  ctx.beginPath();
  ctx.ellipse(0, s * 0.3, s * 0.34, s * 0.2, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // 顔
  ctx.fillStyle = rgb(skin);
  roundRect(ctx, -s * 0.22, -s * 0.28, s * 0.44, s * 0.5, s * 0.18);
  ctx.fill();
  ctx.strokeStyle = "rgba(72,54,40,0.45)";
  ctx.lineWidth = Math.max(0.8, s * 0.018);
  roundRect(ctx, -s * 0.22, -s * 0.28, s * 0.44, s * 0.5, s * 0.18);
  ctx.stroke();

  // ヘルメット
  const hg = ctx.createLinearGradient(0, -s * 0.42, 0, -s * 0.05);
  hg.addColorStop(0, rgb(mix(helmet, [255, 255, 255], 0.45)));
  hg.addColorStop(1, rgb(helmet));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.14, s * 0.24, s * 0.2, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgb(mix(helmet, [0, 0, 0], 0.3));
  roundRect(ctx, -s * 0.04, -s * 0.11, s * 0.3, s * 0.05, s * 0.025);
  ctx.fill();

  // 目
  ctx.fillStyle = "rgb(30,28,34)";
  for (const dx of [-0.085, 0.085]) {
    ctx.beginPath();
    ctx.ellipse(dx * s, -s * 0.02, s * 0.03, o.done ? s * 0.012 : s * 0.042, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 口
  ctx.strokeStyle = "rgb(80,50,44)";
  ctx.lineWidth = Math.max(1, s * 0.022);
  ctx.beginPath();
  const curve = o.done ? s * 0.05 : o.urgency > 0.7 ? -s * 0.05 : s * 0.02;
  ctx.moveTo(-s * 0.06, s * 0.12);
  ctx.quadraticCurveTo(0, s * 0.12 + curve, s * 0.06, s * 0.12);
  ctx.stroke();

  ctx.restore();

  // 枠
  ctx.strokeStyle = rgba(o.accent, 0.3);
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
}

// ============================================================
// ペナントレースの勝敗バー(案件一覧用)
// ============================================================
// 段階(マイルストーン)を1試合ずつのマス目にして並べる。
// 勝(完了) / 負(期日超過) / 未消化 が一目で分かる

export interface PennantBarOptions {
  width: number;
  height: number;
  cells: ("win" | "loss" | "rest")[];
  accent: Rgb;
  ink: Rgb;
  label: string;
}

export function pennantBarHeight(): number {
  return 30;
}

export function paintPennantBar(ctx: CanvasRenderingContext2D, o: PennantBarOptions) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);

  // 電光掲示板の地
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(30,40,62)");
  g.addColorStop(1, "rgb(16,22,38)");
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 4);
  ctx.fill();

  // 見出し
  ctx.fillStyle = "rgba(180,200,232,0.75)";
  ctx.font = `bold ${Math.round(h * 0.32)}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const labelW = ctx.measureText(o.label).width + 10;
  ctx.fillText(o.label, 6, h / 2);

  const n = Math.max(1, o.cells.length);
  const left = labelW + 4;
  const avail = Math.max(10, w - left - 6);
  const cw = Math.min(14, avail / n);
  const gap = Math.min(2, cw * 0.18);
  const boxW = cw - gap;
  const boxH = Math.min(h - 10, boxW * 1.3);
  const y = (h - boxH) / 2;

  for (let i = 0; i < n; i++) {
    const x = left + i * cw;
    const kind = o.cells[i];
    const c: Rgb = kind === "win" ? [76, 186, 108] : kind === "loss" ? [216, 68, 62] : [92, 106, 132];
    const cg = ctx.createLinearGradient(0, y, 0, y + boxH);
    cg.addColorStop(0, rgb(mix(c, [255, 255, 255], 0.35)));
    cg.addColorStop(1, rgb(mix(c, [0, 0, 0], 0.2)));
    ctx.fillStyle = kind === "rest" ? "rgba(120,134,164,0.28)" : cg;
    roundRect(ctx, x, y, boxW, boxH, 2);
    ctx.fill();
    if (kind !== "rest") {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `900 ${Math.round(boxH * 0.62)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(kind === "win" ? "○" : "●", x + boxW / 2, y + boxH / 2 + 0.5);
      ctx.textAlign = "left";
    }
  }

  gloss(ctx, 0, 0, w, h, 4, 0.14);
}

// ============================================================
// スコアボード(練習日誌タブの見出し)
// ============================================================
// 球場の電光掲示板そのもの。作業1件を1イニングの列に見立て、
// その回に入った点(実働の分数)と、予定内(○)/予定超過(●)を並べる。
// 右端の「計」は本日の実働合計、「失」は予定を超えた件数。

export interface LineScoreCell {
  minutes: number;
  over: boolean;
  running: boolean;
}

export interface LineScoreOptions {
  width: number;
  height: number;
  cells: LineScoreCell[];
  totalMinutes: number;
  errors: number;
  labels: { inning: string; runs: string; total: string; errors: string };
}

export function lineScoreHeight(): number {
  return 84;
}

export function paintLineScore(ctx: CanvasRenderingContext2D, o: LineScoreOptions) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);

  // 盤面
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(28,38,60)");
  g.addColorStop(1, "rgb(12,18,32)");
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(150,172,208,0.4)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 6);
  ctx.stroke();

  const padX = 8;
  const labelW = 30; // 左端の行見出し(回/計)の幅
  const summaryW = 76; // 右端の「計」「失」
  const boardX = padX + labelW;
  const boardW = Math.max(40, w - padX * 2 - labelW - summaryW);

  // 表示できる列数。入りきらない場合は先頭から入るだけ並べ、末尾に…を置く
  const minCell = 20;
  const maxCells = Math.max(1, Math.floor(boardW / minCell));
  const shown = o.cells.slice(0, maxCells);
  const truncated = o.cells.length > shown.length;
  const cellW = shown.length > 0 ? boardW / shown.length : boardW;

  const rowTop = 22;
  const rowH = (h - rowTop - 10) / 2;

  ctx.textBaseline = "middle";

  // 行見出し
  ctx.fillStyle = "rgba(160,182,216,0.75)";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(o.labels.inning, padX, rowTop + rowH / 2);
  ctx.fillText(o.labels.runs, padX, rowTop + rowH + rowH / 2);

  // 罫線
  ctx.strokeStyle = "rgba(150,172,208,0.2)";
  ctx.beginPath();
  ctx.moveTo(padX, rowTop);
  ctx.lineTo(w - padX, rowTop);
  ctx.moveTo(padX, rowTop + rowH);
  ctx.lineTo(w - padX, rowTop + rowH);
  ctx.moveTo(boardX - 4, rowTop - 4);
  ctx.lineTo(boardX - 4, h - 8);
  ctx.moveTo(boardX + boardW + 4, rowTop - 4);
  ctx.lineTo(boardX + boardW + 4, h - 8);
  ctx.stroke();

  // 各回
  ctx.textAlign = "center";
  for (let i = 0; i < shown.length; i++) {
    const cx = boardX + cellW * (i + 0.5);
    const c = shown[i];
    ctx.fillStyle = "rgba(160,182,216,0.6)";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillText(truncated && i === shown.length - 1 ? "…" : String(i + 1), cx, rowTop + rowH / 2);

    // 点(実働の分数)。予定超過は赤、計測中は緑で光らせる
    const color = c.over ? "rgba(255,120,104,0.95)" : c.running ? "rgba(120,230,150,0.95)" : "rgba(255,214,84,0.95)";
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 7;
    ctx.font = "bold 15px ui-monospace, monospace";
    ctx.fillText(String(Math.round(c.minutes)), cx, rowTop + rowH + rowH * 0.38);
    ctx.shadowBlur = 0;
    // 予定内/超過の印
    ctx.fillStyle = c.over ? "rgba(255,120,104,0.95)" : "rgba(180,200,230,0.85)";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(c.over ? "●" : "○", cx, rowTop + rowH + rowH * 0.82);
  }

  // 右端の集計
  const sx = boardX + boardW + 8;
  const sw = (w - padX - sx) / 2;
  const summary: [string, string, string][] = [
    [o.labels.total, String(Math.round(o.totalMinutes)), "rgba(255,214,84,0.95)"],
    [o.labels.errors, String(o.errors), o.errors > 0 ? "rgba(255,120,104,0.95)" : "rgba(160,182,216,0.7)"],
  ];
  summary.forEach(([label, value, color], i) => {
    const cx = sx + sw * (i + 0.5);
    ctx.fillStyle = "rgba(160,182,216,0.6)";
    ctx.font = "bold 10px system-ui, sans-serif";
    ctx.fillText(label, cx, rowTop + rowH / 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 7;
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(value, cx, rowTop + rowH + rowH * 0.5);
    ctx.shadowBlur = 0;
  });

  gloss(ctx, 0, 0, w, h, 6, 0.1);
}

// ============================================================
// 選手カードの地(能力値パネルの背景)
// ============================================================

export function paintCardBase(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; accent: Rgb; rank: string; seed: string }
) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);
  const [light, dark] = RANK_COLOR[o.rank] ?? RANK_COLOR.G;

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, rgb(mix(o.accent, [8, 14, 30], 0.45)));
  g.addColorStop(1, rgb(mix(o.accent, [8, 14, 30], 0.78)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 斜めのストライプ。ランクの色を薄く流す
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  for (let x = -h; x < w + h; x += 26) {
    ctx.fillStyle = rgba(light, 0.07);
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 12, h);
    ctx.lineTo(x + 12 + h, 0);
    ctx.lineTo(x + h, 0);
    ctx.closePath();
    ctx.fill();
  }
  // 左上から光を差す
  const lg = ctx.createRadialGradient(w * 0.2, -h * 0.2, 4, w * 0.2, -h * 0.2, h * 1.6);
  lg.addColorStop(0, rgba(light, 0.24));
  lg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // 下辺にランク色のライン
  ctx.fillStyle = rgb(dark);
  ctx.fillRect(0, h - 3, w, 3);
  ctx.fillStyle = rgb(light);
  ctx.fillRect(0, h - 3, w * 0.5, 3);
}
