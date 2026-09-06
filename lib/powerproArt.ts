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

// ------------------------------------------------------------
// 金属・箔の質感
// ------------------------------------------------------------
// 「高価に見える」かどうかは、面そのものより縁の作り込みで決まる。
// 金の細線・面取り・柔らかい多重の影を共通の道具として持っておく。

const GOLD_DARK: Rgb = [124, 94, 20];
const GOLD_MID: Rgb = [201, 162, 39];
const GOLD_LIT: Rgb = [255, 240, 186];

/** 金箔の縦グラデーション。細い縁取りや紋章の地に使う */
function goldGradient(ctx: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgb(GOLD_LIT));
  g.addColorStop(0.42, rgb(GOLD_MID));
  g.addColorStop(0.62, rgb(GOLD_DARK));
  g.addColorStop(1, rgb(GOLD_MID));
  return g;
}

/** 額装の細線。内側に一本だけ引くと、同じ絵でも一段“据わり”がよくなる */
function goldHairline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, alpha = 0.55) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = goldGradient(ctx, y, y + h);
  ctx.lineWidth = 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 球場(見出しの一枚絵)
// ============================================================
// 時間帯で空の色が変わり、いま計測中かどうかで選手の構えが変わる。
// 電光掲示板の数字は本日の完了件数/予定件数そのもの。
//
// 一枚絵として成立させるため、遠景(空・照明塔)→中景(スタンド・フェンス)→
// 近景(芝・内野・選手)の順に、空気遠近(遠いものほど白く沈める)を掛けながら重ねる。

export type SkyPhase = "morning" | "day" | "evening" | "night";

export function skyPhaseOf(hour: number): SkyPhase {
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "evening";
  return "night";
}

interface SkySpec {
  top: Rgb;
  mid: Rgb;
  horizon: Rgb;
  /** 全体の明るさ。遠景を沈める量と芝の彩度に効く */
  light: number;
  /** 光の当たる向き(-1=左, 1=右)と暖かさ */
  warm: Rgb;
}

const SKY: Record<SkyPhase, SkySpec> = {
  morning: { top: [96, 162, 224], mid: [166, 206, 238], horizon: [232, 240, 246], light: 0.92, warm: [255, 236, 198] },
  day: { top: [38, 122, 208], mid: [124, 186, 236], horizon: [206, 232, 248], light: 1, warm: [255, 250, 232] },
  evening: { top: [86, 78, 140], mid: [226, 128, 88], horizon: [252, 210, 152], light: 0.8, warm: [255, 198, 132] },
  night: { top: [8, 14, 34], mid: [20, 32, 68], horizon: [46, 66, 112], light: 0.46, warm: [214, 230, 255] },
};

export interface StadiumOptions {
  width: number;
  height: number;
  phase: SkyPhase;
  motivation: MotivationLevel;
  running: boolean;
  injured: boolean;
  /** 熱血ゲージの充填率(0〜1)。1になると選手の周りに光がまわる */
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
  const horizon = h * 0.42;
  const groundY = h * 0.86; // 選手が立つ位置
  const roofY = horizon - h * 0.2; // 屋根の庇
  const deckY = horizon - h * 0.11; // 上段と下段の境
  const night = o.phase === "night";

  ctx.clearRect(0, 0, w, h);

  // ---------------- 遠景: 空 ----------------
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizon);
  skyGrad.addColorStop(0, rgb(sky.top));
  skyGrad.addColorStop(0.55, rgb(sky.mid));
  skyGrad.addColorStop(1, rgb(sky.horizon));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, horizon);

  if (night) {
    // 星。明るさに幅を持たせると、点を撒いただけに見えない
    for (let i = 0; i < 90; i++) {
      const x = rng() * w;
      const y = rng() * horizon * 0.85;
      const a = 0.15 + rng() * 0.75;
      ctx.fillStyle = `rgba(226,238,255,${a})`;
      const r = rng() < 0.12 ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 月とその暈
    const mx = w * 0.8;
    const my = horizon * 0.24;
    const halo = ctx.createRadialGradient(mx, my, 2, mx, my, h * 0.22);
    halo.addColorStop(0, "rgba(226,238,255,0.34)");
    halo.addColorStop(1, "rgba(226,238,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = "rgba(240,246,255,0.95)";
    ctx.beginPath();
    ctx.arc(mx, my, 9, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 雲。上下2段に分け、下段ほど小さく薄くして奥行きを出す
    for (let band = 0; band < 2; band++) {
      const count = band === 0 ? 3 : 4;
      for (let i = 0; i < count; i++) {
        const cx = rng() * w * 1.2 - w * 0.1;
        const cy = horizon * (band === 0 ? 0.16 + rng() * 0.2 : 0.5 + rng() * 0.3);
        const cw = w * (band === 0 ? 0.16 + rng() * 0.14 : 0.08 + rng() * 0.1);
        ctx.fillStyle = `rgba(255,255,255,${band === 0 ? 0.62 : 0.4})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, cw, cw * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx - cw * 0.3, cy - cw * 0.08, cw * 0.42, cw * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 地平近くの霞。ここがあるだけで奥行きの説得力が変わる
    const haze = ctx.createLinearGradient(0, horizon - h * 0.16, 0, horizon);
    haze.addColorStop(0, "rgba(255,255,255,0)");
    haze.addColorStop(1, `rgba(255,255,255,${0.45 * sky.light})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, horizon - h * 0.16, w, h * 0.16);
  }

  // ---------------- 遠景: 照明塔 ----------------
  const towerTop = h * 0.03;
  for (const bx of [w * 0.13, w * 0.87]) {
    // 支柱は格子に。1本の棒より圧倒的に「作り込んだ」印象になる
    ctx.strokeStyle = rgba([58, 72, 98], night ? 0.95 : 0.4);
    ctx.lineWidth = 1.6;
    const mastTop = towerTop + 21;
    const mastBottom = roofY + h * 0.02;
    ctx.beginPath();
    ctx.moveTo(bx - 4, mastBottom);
    ctx.lineTo(bx - 2, mastTop);
    ctx.moveTo(bx + 4, mastBottom);
    ctx.lineTo(bx + 2, mastTop);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 7; i++) {
      const t0 = i / 7;
      const t1 = (i + 1) / 7;
      const y0 = mastTop + (mastBottom - mastTop) * t0;
      const y1 = mastTop + (mastBottom - mastTop) * t1;
      ctx.beginPath();
      ctx.moveTo(bx - 4 + t0 * 2, y0);
      ctx.lineTo(bx + 4 - t1 * 2, y1);
      ctx.moveTo(bx + 4 - t0 * 2, y0);
      ctx.lineTo(bx - 4 + t1 * 2, y1);
      ctx.stroke();
    }
    // 灯体の箱
    ctx.fillStyle = rgba([44, 56, 80], night ? 0.98 : 0.5);
    roundRect(ctx, bx - 19, towerTop, 38, 21, 3);
    ctx.fill();
    if (night) {
      ctx.fillStyle = "rgba(255,250,224,0.98)";
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 5; c++) ctx.fillRect(bx - 15 + c * 6.4, towerTop + 4 + r * 8, 4.4, 4.4);
      }
      // 光芒
      const beam = ctx.createLinearGradient(bx, towerTop, bx, horizon + h * 0.34);
      beam.addColorStop(0, "rgba(255,248,214,0.42)");
      beam.addColorStop(1, "rgba(255,248,214,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(bx - 14, towerTop + 18);
      ctx.lineTo(bx + 14, towerTop + 18);
      ctx.lineTo(bx + w * 0.36, horizon + h * 0.34);
      ctx.lineTo(bx - w * 0.36, horizon + h * 0.34);
      ctx.closePath();
      ctx.fill();
      // 灯体まわりのにじみ
      const bloom = ctx.createRadialGradient(bx, towerTop + 10, 2, bx, towerTop + 10, 46);
      bloom.addColorStop(0, "rgba(255,248,214,0.55)");
      bloom.addColorStop(1, "rgba(255,248,214,0)");
      ctx.fillStyle = bloom;
      ctx.fillRect(bx - 50, towerTop - 40, 100, 100);
    }
  }

  // ---------------- 中景: スタンド ----------------
  // 屋根の庇
  ctx.fillStyle = rgba(mix(palette.accent, [10, 14, 28], 0.72), sky.light);
  ctx.beginPath();
  ctx.moveTo(0, roofY + h * 0.022);
  ctx.quadraticCurveTo(w / 2, roofY - h * 0.022, w, roofY + h * 0.022);
  ctx.lineTo(w, roofY + h * 0.05);
  ctx.quadraticCurveTo(w / 2, roofY + h * 0.006, 0, roofY + h * 0.05);
  ctx.closePath();
  ctx.fill();

  // 上段スタンド
  const upper = ctx.createLinearGradient(0, roofY + h * 0.042, 0, deckY);
  upper.addColorStop(0, rgba(mix(palette.accent, [8, 12, 26], 0.62), sky.light));
  upper.addColorStop(1, rgba(mix(palette.accent, [8, 12, 26], 0.78), sky.light));
  ctx.fillStyle = upper;
  ctx.fillRect(0, roofY + h * 0.042, w, deckY - roofY - h * 0.042);
  // 下段スタンド
  const lower = ctx.createLinearGradient(0, deckY, 0, horizon);
  lower.addColorStop(0, rgba(mix(palette.accent, [8, 12, 26], 0.7), sky.light));
  lower.addColorStop(1, rgba(mix(palette.accent, [6, 10, 22], 0.86), sky.light));
  ctx.fillStyle = lower;
  ctx.fillRect(0, deckY, w, horizon - deckY);
  // 段の境の手すり
  ctx.fillStyle = `rgba(226,232,244,${0.22 * sky.light})`;
  ctx.fillRect(0, deckY - 1.5, w, 1.5);

  // 観客。上下2段それぞれに、混み具合(=本日の予定件数)に応じた密度で撒く
  const density = Math.min(1, 0.4 + o.totalCount * 0.075);
  for (const [y0, y1, scaleDot] of [
    [roofY + h * 0.05, deckY - 3, 1.5],
    [deckY + 3, horizon - 2, 1.9],
  ] as const) {
    const rows = Math.max(1, Math.floor((y1 - y0) / (scaleDot + 1.4)));
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * (scaleDot + 1.4);
      const step = scaleDot + 1.6;
      for (let x = (r % 2) * step * 0.5; x < w; x += step) {
        if (rng() > density) continue;
        const t = rng();
        const c: Rgb =
          t < 0.42 ? [238, 234, 226] : t < 0.72 ? mix(palette.accent, [255, 255, 255], 0.42) : [220, 120, 100];
        ctx.fillStyle = rgba(c, (0.3 + rng() * 0.5) * sky.light);
        ctx.fillRect(x, y, scaleDot, scaleDot);
      }
    }
  }

  // ---------------- 中景: 外野フェンス ----------------
  const fenceH = Math.max(10, h * 0.045);
  const fence = ctx.createLinearGradient(0, horizon - fenceH, 0, horizon);
  fence.addColorStop(0, rgba(mix([20, 58, 38], [0, 0, 0], 1 - sky.light), 1));
  fence.addColorStop(1, rgba(mix([12, 40, 26], [0, 0, 0], 1 - sky.light), 1));
  ctx.fillStyle = fence;
  ctx.fillRect(0, horizon - fenceH, w, fenceH);
  // パッドの継ぎ目
  ctx.strokeStyle = `rgba(255,255,255,${0.08 * sky.light})`;
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 26) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, horizon - fenceH + 2);
    ctx.lineTo(x + 0.5, horizon - 2);
    ctx.stroke();
  }
  // 天端の黄色いレール
  ctx.fillStyle = rgba([236, 206, 60], sky.light);
  ctx.fillRect(0, horizon - fenceH - 2, w, 2.4);

  // ---------------- 近景: 芝 ----------------
  const grassLight = mix([104, 200, 112], [0, 0, 0], 1 - sky.light);
  const grassDark = mix([46, 140, 68], [0, 0, 0], 1 - sky.light);
  const grassGrad = ctx.createLinearGradient(0, horizon, 0, h);
  grassGrad.addColorStop(0, rgb(mix(grassDark, [0, 0, 0], 0.2)));
  grassGrad.addColorStop(0.5, rgb(mix(grassDark, grassLight, 0.6)));
  grassGrad.addColorStop(1, rgb(grassLight));
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, horizon, w, h - horizon);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizon, w, h - horizon);
  ctx.clip();
  // 刈り込みの縞。手前ほど広がる台形にして奥行きを出す
  const stripes = 13;
  for (let i = 0; i < stripes; i++) {
    if (i % 2 === 1) continue;
    const t0 = i / stripes;
    const t1 = (i + 1) / stripes;
    ctx.fillStyle = rgba(grassDark, 0.42);
    ctx.beginPath();
    ctx.moveTo(w * (0.5 + (t0 - 0.5) * 0.5), horizon);
    ctx.lineTo(w * (0.5 + (t1 - 0.5) * 0.5), horizon);
    ctx.lineTo(w * t1 * 1.9 - w * 0.45, h);
    ctx.lineTo(w * t0 * 1.9 - w * 0.45, h);
    ctx.closePath();
    ctx.fill();
  }
  // 芝の照り。斜めに一筋通すだけで、平らな緑が生きた面になる
  const sheen = ctx.createLinearGradient(w * 0.1, horizon, w * 0.75, h);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.45, `rgba(255,255,255,${0.1 * sky.light})`);
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.restore();

  // ---------------- 近景: 内野の土 ----------------
  const dirtCenterY = groundY + h * 0.26;
  const dirtRy = h * 0.36;
  const dirtRx = w * 0.66;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(w / 2, dirtCenterY, dirtRx, dirtRy, 0, Math.PI, Math.PI * 2);
  ctx.clip();
  const dirtGrad = ctx.createLinearGradient(0, dirtCenterY - dirtRy, 0, h);
  dirtGrad.addColorStop(0, rgb(mix([214, 166, 114], [0, 0, 0], 1 - sky.light)));
  dirtGrad.addColorStop(1, rgb(mix([166, 112, 68], [0, 0, 0], 1 - sky.light)));
  ctx.fillStyle = dirtGrad;
  ctx.fillRect(0, dirtCenterY - dirtRy, w, h);
  // 整地の筋
  ctx.strokeStyle = `rgba(255,255,255,${0.05 * sky.light})`;
  ctx.lineWidth = 1;
  for (let i = 1; i < 7; i++) {
    const ry = dirtRy * (i / 7);
    ctx.beginPath();
    ctx.ellipse(w / 2, dirtCenterY, dirtRx * (i / 7), ry, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  // 土の粒。細かい斑を散らすと、のっぺりした面が土に見える
  for (let i = 0; i < 220; i++) {
    const x = rng() * w;
    const y = dirtCenterY - dirtRy + rng() * (h - (dirtCenterY - dirtRy));
    ctx.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(60,34,16,0.07)";
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.restore();
  // 土と芝の境の白線
  ctx.strokeStyle = `rgba(255,255,255,${0.4 * sky.light})`;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(w / 2, dirtCenterY, dirtRx, dirtRy, 0, Math.PI, Math.PI * 2);
  ctx.stroke();

  // ホームベース(選手の足元)
  const plateY = groundY + 4;
  ctx.fillStyle = `rgba(255,255,255,${0.9 * sky.light})`;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 17, plateY);
  ctx.lineTo(w / 2 + 17, plateY);
  ctx.lineTo(w / 2 + 13, plateY + 7);
  ctx.lineTo(w / 2, plateY + 12);
  ctx.lineTo(w / 2 - 13, plateY + 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(120,96,70,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ---------------- 電光掲示板 ----------------
  const boardW = Math.min(118, w * 0.33);
  paintScoreboard(ctx, {
    x: w - boardW - 10,
    y: towerTop + 26,
    w: boardW,
    h: 46,
    done: o.doneCount,
    total: o.totalCount,
  });

  // ---------------- フィーバーの光 ----------------
  if (o.fever || o.hot >= 0.999) {
    const g = ctx.createRadialGradient(w / 2, groundY - h * 0.22, 4, w / 2, groundY - h * 0.22, w * 0.5);
    g.addColorStop(0, "rgba(255,232,140,0.5)");
    g.addColorStop(0.6, "rgba(255,214,90,0.16)");
    g.addColorStop(1, "rgba(255,214,90,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------------- 選手 ----------------
  // 頭がスタンドの暗がりに紛れないよう、背後にごく淡い光を敷いて輪郭を立たせる
  const halo = ctx.createRadialGradient(w / 2, groundY - h * 0.3, 2, w / 2, groundY - h * 0.3, w * 0.26);
  halo.addColorStop(0, `rgba(255,255,255,${night ? 0.2 : 0.3})`);
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(h * 0.0056, w * 0.0037);
  paintPlayer(ctx, {
    cx: w / 2,
    baseY: groundY,
    scale,
    motivation: o.motivation,
    running: o.running,
    injured: o.injured,
    accent: palette.accent,
    warm: sky.warm,
    light: sky.light,
  });

  // ---------------- 仕上げ ----------------
  // 四隅を落とす
  const vg = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.74);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(6,10,22,0.3)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  // 額装の金線
  goldHairline(ctx, 5, 5, w - 10, h - 10, 5, 0.42);
}

// 電光掲示板。金の縁で囲った黒い盤に、にじみを持たせた琥珀の数字を出す
function paintScoreboard(
  ctx: CanvasRenderingContext2D,
  o: { x: number; y: number; w: number; h: number; done: number; total: number }
) {
  const { x, y, w, h } = o;
  ctx.save();

  // 影
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, x + 2, y + 3, w, h, 5);
  ctx.fill();

  // 金の枠
  ctx.fillStyle = goldGradient(ctx, y, y + h);
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();

  // 盤面
  const face = ctx.createLinearGradient(0, y, 0, y + h);
  face.addColorStop(0, "rgb(20,26,40)");
  face.addColorStop(1, "rgb(8,11,20)");
  ctx.fillStyle = face;
  roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 3.5);
  ctx.fill();

  // 走査線
  ctx.save();
  roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 3.5);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  for (let yy = y + 3; yy < y + h; yy += 3) ctx.fillRect(x + 2, yy, w - 4, 1);
  ctx.restore();

  const padX = x + 9;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(126,220,158,0.9)";
  ctx.font = `bold ${Math.round(h * 0.2)}px system-ui, sans-serif`;
  ctx.fillText("D O N E", padX, y + h * 0.26);

  ctx.fillStyle = "rgba(255,206,72,0.98)";
  ctx.shadowColor = "rgba(255,186,32,0.9)";
  ctx.shadowBlur = 10;
  ctx.font = `bold ${Math.round(h * 0.5)}px ui-monospace, monospace`;
  const doneStr = `${o.done}`.padStart(2, "0");
  ctx.fillText(doneStr, padX, y + h * 0.66);
  ctx.shadowBlur = 0;

  const doneW = ctx.measureText(doneStr).width;
  ctx.fillStyle = "rgba(178,192,214,0.68)";
  ctx.font = `bold ${Math.round(h * 0.3)}px ui-monospace, monospace`;
  ctx.fillText(` / ${`${o.total}`.padStart(2, "0")}`, padX + doneW, y + h * 0.7);

  ctx.restore();
}

// ============================================================
// 2頭身の選手
// ============================================================
// 元ネタの選手は、頭が体の残り全部と同じくらい大きい2頭身。
// ここでは同じ骨格の考え方で、自前の図形として組み立てている。
//
// 平らな色で塗ると玩具に見えてしまうので、面ごとに
// ①上からの光 ②下からの照り返し ③縁の締め の3つを入れている。
// やる気(眉と口)、計測中かどうか(構え)、ケガの危険(汗)が絵に出る。

export interface PlayerOptions {
  cx: number;
  baseY: number;
  /** 1で全高およそ100px */
  scale: number;
  motivation: MotivationLevel;
  running: boolean;
  injured: boolean;
  accent: Rgb;
  /** その時間帯の光の色。ハイライトに混ぜて場に馴染ませる */
  warm: Rgb;
  light: number;
}

export function paintPlayer(ctx: CanvasRenderingContext2D, o: PlayerOptions) {
  const s = o.scale;
  const uni = o.accent;
  const uniLit = mix(uni, [255, 255, 255], 0.34);
  const uniDim = mix(uni, [8, 12, 24], 0.42);
  const skin: Rgb = [255, 224, 194];
  const skinDim: Rgb = [232, 186, 148];
  const cloth: Rgb = [244, 246, 250]; // ユニフォームのパンツ(白)
  const clothDim: Rgb = [206, 212, 224];
  const leather: Rgb = [24, 28, 40];

  ctx.save();
  ctx.translate(o.cx, o.baseY);

  // ---- 影 ----
  const sh = ctx.createRadialGradient(0, 0, 2 * s, 0, 0, 30 * s);
  sh.addColorStop(0, "rgba(20,12,4,0.4)");
  sh.addColorStop(1, "rgba(20,12,4,0)");
  ctx.fillStyle = sh;
  ctx.beginPath();
  ctx.ellipse(0, 0, 30 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // ---- 脚 ----
  for (const side of [-1, 1] as const) {
    const x = side * 9 * s;
    // スパイク
    ctx.fillStyle = rgb(leather);
    roundRect(ctx, x - 7.5 * s, -7 * s, 15 * s, 7 * s, 3 * s);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    roundRect(ctx, x - 6 * s, -6.4 * s, 12 * s, 2 * s, 1 * s);
    ctx.fill();
    // ストッキング
    ctx.fillStyle = rgb(uniDim);
    roundRect(ctx, x - 6 * s, -19 * s, 12 * s, 13 * s, 2.5 * s);
    ctx.fill();
    // パンツ(白)。膝で少しくびれさせる
    const pg = ctx.createLinearGradient(x - 8 * s, 0, x + 8 * s, 0);
    pg.addColorStop(0, rgb(clothDim));
    pg.addColorStop(0.35, rgb(cloth));
    pg.addColorStop(1, rgb(clothDim));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.moveTo(x - 9 * s, -44 * s);
    ctx.lineTo(x + 9 * s, -44 * s);
    ctx.lineTo(x + 7 * s, -20 * s);
    ctx.lineTo(x - 7 * s, -20 * s);
    ctx.closePath();
    ctx.fill();
    // パンツの縦ライン
    ctx.strokeStyle = rgba(uni, 0.5);
    ctx.lineWidth = 1.1 * s;
    ctx.beginPath();
    ctx.moveTo(x + side * 6 * s, -43 * s);
    ctx.lineTo(x + side * 5 * s, -21 * s);
    ctx.stroke();
  }

  // ---- 胴(ユニフォーム) ----
  const bodyTop = -78 * s;
  const bodyBottom = -40 * s;
  const bg = ctx.createLinearGradient(-18 * s, bodyTop, 18 * s, bodyBottom);
  bg.addColorStop(0, rgb(uniLit));
  bg.addColorStop(0.45, rgb(uni));
  bg.addColorStop(1, rgb(uniDim));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(-17 * s, bodyTop + 6 * s);
  ctx.quadraticCurveTo(-19 * s, bodyBottom, -14 * s, bodyBottom);
  ctx.lineTo(14 * s, bodyBottom);
  ctx.quadraticCurveTo(19 * s, bodyBottom, 17 * s, bodyTop + 6 * s);
  ctx.quadraticCurveTo(0, bodyTop - 2 * s, -17 * s, bodyTop + 6 * s);
  ctx.closePath();
  ctx.fill();
  // 下からの照り返し
  const bounce = ctx.createLinearGradient(0, bodyBottom - 12 * s, 0, bodyBottom);
  bounce.addColorStop(0, "rgba(255,255,255,0)");
  bounce.addColorStop(1, rgba(o.warm, 0.22));
  ctx.fillStyle = bounce;
  ctx.beginPath();
  ctx.moveTo(-18 * s, bodyBottom - 12 * s);
  ctx.lineTo(18 * s, bodyBottom - 12 * s);
  ctx.lineTo(15 * s, bodyBottom);
  ctx.lineTo(-15 * s, bodyBottom);
  ctx.closePath();
  ctx.fill();
  // 前立て
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath();
  ctx.moveTo(0, bodyTop + 6 * s);
  ctx.lineTo(0, bodyBottom - 5 * s);
  ctx.stroke();
  // 襟
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.6 * s;
  ctx.beginPath();
  ctx.arc(0, bodyTop + 4 * s, 7 * s, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  // ベルト
  ctx.fillStyle = rgb(leather);
  roundRect(ctx, -15 * s, bodyBottom - 5 * s, 30 * s, 5 * s, 1.5 * s);
  ctx.fill();
  ctx.fillStyle = goldGradient(ctx, bodyBottom - 5 * s, bodyBottom);
  roundRect(ctx, -3 * s, bodyBottom - 4.6 * s, 6 * s, 4.2 * s, 1 * s);
  ctx.fill();
  // 背番号のかわりに胸の星(そのまま「1」等を出すと実データでない数字になるため置かない)
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 4) / 5;
    const p = i === 0 ? "moveTo" : "lineTo";
    ctx[p](8 * s + Math.cos(a) * 3.4 * s, bodyTop + 16 * s + Math.sin(a) * 3.4 * s);
  }
  ctx.closePath();
  ctx.fill();

  // ---- 腕 ----
  const drawArm = (
    shoulder: [number, number],
    elbow: [number, number],
    hand: [number, number]
  ) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 上腕(袖)
    ctx.strokeStyle = rgb(uni);
    ctx.lineWidth = 9 * s;
    ctx.beginPath();
    ctx.moveTo(shoulder[0] * s, shoulder[1] * s);
    ctx.lineTo(elbow[0] * s, elbow[1] * s);
    ctx.stroke();
    ctx.strokeStyle = rgba(uniLit, 0.7);
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(shoulder[0] * s, (shoulder[1] - 1.5) * s);
    ctx.lineTo(elbow[0] * s, (elbow[1] - 1.5) * s);
    ctx.stroke();
    // 前腕(肌)
    ctx.strokeStyle = rgb(skin);
    ctx.lineWidth = 7 * s;
    ctx.beginPath();
    ctx.moveTo(elbow[0] * s, elbow[1] * s);
    ctx.lineTo(hand[0] * s, hand[1] * s);
    ctx.stroke();
    // 手
    ctx.fillStyle = rgb(skinDim);
    ctx.beginPath();
    ctx.arc(hand[0] * s, hand[1] * s, 4.6 * s, 0, Math.PI * 2);
    ctx.fill();
  };

  if (o.running) {
    // バットを右肩に担いだ構え。顔の前を横切らないよう、右側へ抜けさせる
    const gripX = 13;
    const gripY = -60;
    ctx.save();
    ctx.translate(gripX * s, gripY * s);
    ctx.rotate(Math.PI / 6.4);
    const barrel = 56 * s;
    const bat = ctx.createLinearGradient(-5 * s, 0, 5 * s, 0);
    bat.addColorStop(0, "rgb(140,92,48)");
    bat.addColorStop(0.4, "rgb(226,182,124)");
    bat.addColorStop(1, "rgb(158,108,60)");
    ctx.fillStyle = bat;
    ctx.beginPath();
    ctx.moveTo(-3 * s, 7 * s);
    ctx.lineTo(3 * s, 7 * s);
    ctx.lineTo(6.2 * s, -barrel * 0.7);
    ctx.quadraticCurveTo(6.8 * s, -barrel, 0, -barrel);
    ctx.quadraticCurveTo(-6.8 * s, -barrel, -6.2 * s, -barrel * 0.7);
    ctx.closePath();
    ctx.fill();
    // グリップテープ
    ctx.fillStyle = rgb(leather);
    roundRect(ctx, -3 * s, -1 * s, 6 * s, 8 * s, 1.4 * s);
    ctx.fill();
    ctx.restore();
    // 両手をグリップに添える
    drawArm([-15, -70], [-14, -60], [8, -56]);
    drawArm([15, -70], [20, -62], [12, -57]);
  } else {
    drawArm([-16, -70], [-21, -60], [-20, -48]);
    drawArm([16, -70], [21, -60], [20, -48]);
  }

  // ---- 頭 ----
  const headCy = -100 * s;
  const headRx = 22 * s;
  const headRy = 25 * s;
  // 首
  ctx.fillStyle = rgb(skinDim);
  roundRect(ctx, -6 * s, -82 * s, 12 * s, 8 * s, 3 * s);
  ctx.fill();
  // 顔の地
  const hg = ctx.createRadialGradient(-7 * s, headCy - 7 * s, 2 * s, 0, headCy + 4 * s, headRx * 1.5);
  hg.addColorStop(0, "rgb(255,244,228)");
  hg.addColorStop(0.55, rgb(skin));
  hg.addColorStop(1, rgb(skinDim));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(0, headCy, headRx, headRy, 0, 0, Math.PI * 2);
  ctx.fill();
  // 耳
  ctx.fillStyle = rgb(skinDim);
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(side * headRx * 0.98, headCy + 2 * s, 3.4 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 輪郭を締める
  ctx.strokeStyle = "rgba(96,64,44,0.4)";
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  ctx.ellipse(0, headCy, headRx, headRy, 0, 0, Math.PI * 2);
  ctx.stroke();

  // ---- 帽子 ----
  const capBase = headCy - 6 * s; // つばの高さ。目より必ず上に置く
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, headCy, headRx + 0.6 * s, headRy + 0.6 * s, 0, 0, Math.PI * 2);
  ctx.clip();
  const cg = ctx.createLinearGradient(0, headCy - headRy, 0, capBase);
  cg.addColorStop(0, rgb(uniLit));
  cg.addColorStop(0.5, rgb(uni));
  cg.addColorStop(1, rgb(uniDim));
  ctx.fillStyle = cg;
  ctx.fillRect(-headRx - 2 * s, headCy - headRy - 2 * s, (headRx + 2 * s) * 2, capBase - (headCy - headRy) + 2 * s);
  ctx.restore();
  // 縫い目
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(0, headCy - headRy + 1 * s);
  ctx.lineTo(0, capBase);
  ctx.stroke();
  // つば。右前へ張り出させる
  const brim = ctx.createLinearGradient(0, capBase, 0, capBase + 7 * s);
  brim.addColorStop(0, rgb(uni));
  brim.addColorStop(1, rgb(uniDim));
  ctx.fillStyle = brim;
  ctx.beginPath();
  ctx.moveTo(-headRx * 0.92, capBase - 1 * s);
  ctx.quadraticCurveTo(0, capBase + 9 * s, headRx * 1.16, capBase + 1 * s);
  ctx.quadraticCurveTo(headRx * 0.5, capBase + 3.6 * s, -headRx * 0.9, capBase + 2.6 * s);
  ctx.closePath();
  ctx.fill();
  // つばの下の落ち影
  ctx.fillStyle = "rgba(90,58,38,0.16)";
  ctx.beginPath();
  ctx.ellipse(0, capBase + 4 * s, headRx * 0.9, 3.4 * s, 0, 0, Math.PI);
  ctx.fill();
  // 金の紋章
  ctx.fillStyle = goldGradient(ctx, capBase - 11 * s, capBase - 3 * s);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 4) / 5;
    const p = i === 0 ? "moveTo" : "lineTo";
    ctx[p](Math.cos(a) * 4.2 * s, capBase - 7 * s + Math.sin(a) * 4.2 * s);
  }
  ctx.closePath();
  ctx.fill();

  // ---- 顔 ----
  const eyeY = headCy + 4 * s;
  const eyeDx = 8.6 * s;
  const open = o.motivation >= 1 ? 1 : 0.42;
  for (const side of [-1, 1] as const) {
    // 白目
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.beginPath();
    ctx.ellipse(side * eyeDx, eyeY, 4.4 * s, 5.4 * s * open, 0, 0, Math.PI * 2);
    ctx.fill();
    // 瞳
    ctx.fillStyle = "rgb(32,28,38)";
    ctx.beginPath();
    ctx.ellipse(side * eyeDx, eyeY, 3 * s, 4 * s * open, 0, 0, Math.PI * 2);
    ctx.fill();
    // 光
    if (o.motivation >= 2) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.ellipse(side * eyeDx + 1.2 * s, eyeY - 1.6 * s, 1.3 * s, 1.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 眉。やる気で上がり下がりする
  const tilt = (o.motivation - 2) * 0.26;
  ctx.strokeStyle = "rgb(78,54,38)";
  ctx.lineWidth = 2.4 * s;
  ctx.lineCap = "round";
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(side * 13 * s, eyeY - 9 * s + side * tilt * 5 * s);
    ctx.lineTo(side * 4.5 * s, eyeY - 9 * s - side * tilt * 5 * s);
    ctx.stroke();
  }
  // 頬
  ctx.fillStyle = "rgba(246,150,138,0.32)";
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(side * 15 * s, eyeY + 6 * s, 4.4 * s, 2.6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 口
  ctx.strokeStyle = "rgb(120,62,52)";
  ctx.lineWidth = 2.1 * s;
  ctx.beginPath();
  const curve = (o.motivation - 2) * 3.6;
  ctx.moveTo(-6 * s, eyeY + 12 * s);
  ctx.quadraticCurveTo(0, eyeY + (12 + curve) * s, 6 * s, eyeY + 12 * s);
  ctx.stroke();

  // ---- ケガの危険が高いときの汗 ----
  if (o.injured) {
    ctx.fillStyle = "rgba(126,196,246,0.92)";
    for (const [dx, dy] of [
      [20, -14],
      [24, -4],
    ] as const) {
      const px = dx * s;
      const py = headCy + dy * s;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + 4 * s, py + 5 * s, px, py + 8 * s);
      ctx.quadraticCurveTo(px - 4 * s, py + 5 * s, px, py);
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

/** 記章と同じ配色を、Canvasで塗るための2色として返す */
export function rankColorPair(rank: string): [Rgb, Rgb] {
  return RANK_COLOR[rank] ?? RANK_COLOR.G;
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
// 一覧の各行に置く小さな名鑑写真。誰の顔になるかは件名から決定的に決まるので、
// 同じToDoは並び順が変わっても同じ人物で出る。
//
// 描き方で気をつけていること:
//  ・実際に出るのは54px前後。織りや網点や虹彩の繊維をその大きさで描いても、
//    縮小の過程で潰れて濁るだけなので、描き込みは表示サイズで段階を分ける。
//    小さいときは代わりに「背景と顔の明暗差」「輪郭」を強くする
//  ・顔の作りを種で散らす。同じ骨格に色だけ変えたものを並べると人形の列に見える
//  ・乱数が決めるのは「誰の顔か」だけで、評価・期日・完了状態には一切関わらない

export function paintScoutBust(
  ctx: CanvasRenderingContext2D,
  o: { size: number; seed: string; urgency: number; done: boolean; accent: Rgb; grade?: string }
) {
  const s = o.size;
  ctx.clearRect(0, 0, s, s);
  const rng = makeRng(`scout:${o.seed}`);

  // 表示サイズに応じた描き込みの段階
  const detail = s >= 110 ? 2 : s >= 64 ? 1 : 0;

  // ------------------------------------------------------------
  // 個体の決定
  // ------------------------------------------------------------
  const hue = rng();
  const teamBase: Rgb = hue < 0.28 ? [176, 34, 44] : hue < 0.52 ? [22, 62, 132] : hue < 0.72 ? [16, 96, 70] : hue < 0.88 ? [84, 48, 132] : [26, 30, 40];
  const uni: Rgb = o.done ? [132, 140, 156] : mix(o.accent, teamBase, 0.6 + rng() * 0.3);
  const uniLit = mix(uni, [255, 255, 255], 0.42);
  const uniDim = mix(uni, [6, 10, 22], 0.5);
  const uniDeep = mix(uni, [4, 6, 16], 0.72);
  const skinT = rng();
  const skin: Rgb = mix([255, 226, 194], [206, 150, 108], skinT * 0.9);
  const skinLit = mix(skin, [255, 252, 242], 0.5);
  const skinDim = mix(skin, [150, 84, 58], 0.3);
  const skinDeep = mix(skin, [92, 44, 34], 0.52);
  const hairPick = rng();
  const hair: Rgb = hairPick < 0.62 ? [34, 26, 26] : hairPick < 0.86 ? [72, 48, 32] : [104, 78, 52];
  const hairLit = mix(hair, [255, 236, 200], 0.34);
  const irisPick = rng();
  const iris: Rgb = irisPick < 0.58 ? [64, 42, 28] : irisPick < 0.84 ? [44, 74, 108] : [58, 90, 60];
  const irisLit = mix(iris, [255, 255, 255], 0.42);

  // 顔立ち。骨格そのものを種で散らして、並べたときに別人に見えるようにする
  const faceW = 0.9 + rng() * 0.22; // 顔の幅
  const jawL = 0.84 + rng() * 0.32; // 顎の長さ
  const eyeR = 0.9 + rng() * 0.24; // 目の大きさ
  const eyeGap = 8.8 + rng() * 2; // 目の間隔
  const browW = 0.8 + rng() * 0.5; // 眉の太さ
  const noseW = 0.82 + rng() * 0.4;
  const earR = 0.86 + rng() * 0.34;
  const mouthW = 0.84 + rng() * 0.36;
  const hairStyle = Math.floor(rng() * 4); // 前髪の形
  const capTilt = (rng() - 0.5) * 0.11; // 帽子のかぶり方の癖
  const turn = (rng() - 0.5) * 0.16; // 首の振り
  const tilt = (rng() - 0.5) * 0.1;

  const u = s / 100; // 「顔の高さ100」を基準にした単位
  const heat = o.done ? 0 : o.urgency;

  // ============================================================
  // 台紙(背景)
  // ============================================================
  // 撮影所の背景紙。頭の後ろが明るく、四隅へ向かって落ちる。
  // 小さく出したときに人物の輪郭が浮き上がるかどうかは、ここの明暗差で決まる
  const bgDeep: Rgb = o.done
    ? [104, 110, 124]
    : mix(mix(teamBase, [28, 38, 62], 0.42), [128, 34, 28], heat * 0.5);
  const bgLit: Rgb = o.done
    ? [212, 216, 224]
    : mix(mix(teamBase, [240, 246, 255], 0.78), [255, 216, 198], heat * 0.55);
  const base = ctx.createRadialGradient(s * 0.46, s * 0.3, s * 0.04, s * 0.5, s * 0.4, s * 0.6);
  base.addColorStop(0, rgb(mix(bgLit, [255, 255, 255], 0.35)));
  base.addColorStop(0.4, rgb(bgLit));
  base.addColorStop(1, rgb(bgDeep));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  // 四隅をさらに落とす。ここの明暗差が、小さく出したときの輪郭の見え方を決める
  const vig = ctx.createRadialGradient(s * 0.5, s * 0.44, s * 0.3, s * 0.5, s * 0.5, s * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, `rgba(${o.done ? "30,32,38" : mix(teamBase, [10, 14, 26], 0.55).join(",")},0.55)`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, s, s);

  if (detail >= 2) {
    // 証書のような細かい干渉模様(ギヨシェ)。紙そのものに「刷りもの」の質感を出す
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = rgb(mix(bgDeep, [0, 0, 0], 0.35));
    ctx.lineWidth = Math.max(0.4, s * 0.005);
    for (let k = 0; k < 3; k++) {
      const cx = s * (0.3 + k * 0.2);
      const cy = s * (0.35 + (k % 2) * 0.3);
      for (let r0 = s * 0.12; r0 < s * 0.55; r0 += s * 0.055) {
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = (Math.PI * 2 * i) / 64;
          const rr = r0 * (1 + Math.sin(a * (5 + k) + k) * 0.14);
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr * 0.82;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  if (detail >= 1) {
    // 箔の虹。斜めの帯を薄く重ねて、光の角度で色が変わる紙に見せる
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const foilCols = ["rgba(120,190,255,0.14)", "rgba(255,180,220,0.12)", "rgba(180,255,200,0.1)"];
    for (let i = 0; i < 3; i++) {
      const g = ctx.createLinearGradient(-s * 0.2 + i * s * 0.3, 0, s * 0.3 + i * s * 0.3, s);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, foilCols[i]);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    ctx.restore();
  }

  // 期日が迫っているときだけ、被写体の外側から集中線
  if (!o.done && o.urgency > 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = `rgba(150,36,30,${0.1 + o.urgency * 0.16})`;
    ctx.lineWidth = Math.max(1, s * 0.026);
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI * 2 * i) / 16 + rng() * 0.16;
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * s * 0.62, s / 2 + Math.sin(a) * s * 0.62);
      ctx.lineTo(s / 2 + Math.cos(a) * s * 0.98, s / 2 + Math.sin(a) * s * 0.98);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 被写体が背景に落とす影(光源は左上なので、右下へ流す)
  const cast = ctx.createRadialGradient(s * 0.68, s * 0.8, s * 0.02, s * 0.66, s * 0.78, s * 0.46);
  cast.addColorStop(0, "rgba(10,14,26,0.34)");
  cast.addColorStop(1, "rgba(10,14,26,0)");
  ctx.fillStyle = cast;
  ctx.fillRect(0, 0, s, s);

  // ============================================================
  // 被写体
  // ============================================================
  ctx.save();
  ctx.translate(s / 2, s * 0.6);
  ctx.scale(1.06, 1.06);

  // ---- 胴 ----
  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(-48 * u, 64 * u);
    ctx.quadraticCurveTo(-46 * u, 30 * u, -23 * u, 24 * u);
    ctx.quadraticCurveTo(-10 * u, 20.5 * u, 0, 20.5 * u);
    ctx.quadraticCurveTo(10 * u, 20.5 * u, 23 * u, 24 * u);
    ctx.quadraticCurveTo(46 * u, 30 * u, 48 * u, 64 * u);
    ctx.closePath();
  };
  const bodyG = ctx.createLinearGradient(-42 * u, 22 * u, 44 * u, 60 * u);
  bodyG.addColorStop(0, rgb(uniLit));
  bodyG.addColorStop(0.4, rgb(uni));
  bodyG.addColorStop(1, rgb(uniDeep));
  ctx.fillStyle = bodyG;
  bodyPath();
  ctx.fill();

  ctx.save();
  bodyPath();
  ctx.clip();
  if (detail >= 2) {
    // 布の織り。極細の斜めの網で、平らな面に生地の感じを出す
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = Math.max(0.4, 0.7 * u);
    for (let i = -60; i < 60; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i * u, 18 * u);
      ctx.lineTo((i + 26) * u, 66 * u);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (detail >= 1) {
    // ピンストライプ
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = Math.max(0.6, 1.3 * u);
    for (let x = -46; x <= 46; x += 11) {
      ctx.beginPath();
      ctx.moveTo(x * u, 18 * u);
      ctx.lineTo(x * u + 3 * u, 66 * u);
      ctx.stroke();
    }
  }
  // 肩の上面に当たる光
  const shoulderLit = ctx.createLinearGradient(0, 19 * u, 0, 40 * u);
  shoulderLit.addColorStop(0, "rgba(255,255,255,0.4)");
  shoulderLit.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shoulderLit;
  ctx.fillRect(-48 * u, 19 * u, 96 * u, 24 * u);
  // 右肩の陰(光源の反対側)
  const shoulderShade = ctx.createLinearGradient(18 * u, 0, 48 * u, 0);
  shoulderShade.addColorStop(0, "rgba(0,0,0,0)");
  shoulderShade.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = shoulderShade;
  ctx.fillRect(-48 * u, 18 * u, 96 * u, 50 * u);
  // 襟が胸に落とす影(接触影)。これがあると襟が「乗っている」ではなく「付いている」になる
  const collarAo = ctx.createRadialGradient(0, 26 * u, 2 * u, 0, 30 * u, 26 * u);
  collarAo.addColorStop(0, "rgba(0,0,0,0.42)");
  collarAo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = collarAo;
  ctx.fillRect(-48 * u, 18 * u, 96 * u, 40 * u);
  ctx.restore();

  // 襟(厚みのある2枚)と前立て
  ctx.fillStyle = rgb(mix(uni, [255, 255, 255], 0.86));
  ctx.beginPath();
  ctx.moveTo(-15 * u, 23 * u);
  ctx.lineTo(0, 45 * u);
  ctx.lineTo(15 * u, 23 * u);
  ctx.lineTo(9.5 * u, 21.5 * u);
  ctx.lineTo(0, 38 * u);
  ctx.lineTo(-9.5 * u, 21.5 * u);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rgba(uniDeep, 0.45);
  ctx.lineWidth = Math.max(0.5, 0.9 * u);
  ctx.stroke();
  if (detail >= 1) {
    // 前立てと縫い目
    ctx.fillStyle = rgb(mix(uni, [255, 255, 255], 0.92));
    ctx.fillRect(-2.4 * u, 41 * u, 4.8 * u, 24 * u);
    ctx.strokeStyle = rgba(uniDim, 0.5);
    ctx.setLineDash([1.6 * u, 1.6 * u]);
    ctx.lineWidth = Math.max(0.4, 0.7 * u);
    ctx.beginPath();
    ctx.moveTo(-3.6 * u, 41 * u); ctx.lineTo(-3.6 * u, 66 * u);
    ctx.moveTo(3.6 * u, 41 * u); ctx.lineTo(3.6 * u, 66 * u);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(uniDim, 0.6);
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(0, (49 + i * 11) * u, 1.7 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- 首 ----
  ctx.fillStyle = rgb(skinDim);
  roundRect(ctx, -9 * u, 4 * u, 18 * u, 24 * u, 5 * u);
  ctx.fill();
  // 顎が首に落とす影
  const neckAo = ctx.createLinearGradient(0, 4 * u, 0, 24 * u);
  neckAo.addColorStop(0, rgba(skinDeep, 0.95));
  neckAo.addColorStop(0.7, "rgba(0,0,0,0)");
  ctx.fillStyle = neckAo;
  roundRect(ctx, -9 * u, 4 * u, 18 * u, 24 * u, 5 * u);
  ctx.fill();

  // ---- 頭 ----
  ctx.save();
  ctx.rotate(tilt);
  ctx.translate(turn * 10 * u, 0);

  const hw = 23 * faceW; // 顔の半幅
  const chin = 18 * jawL; // 顎先
  const headPath = () => {
    ctx.beginPath();
    ctx.moveTo(-hw * u, -14 * u);
    ctx.quadraticCurveTo(-hw * u, -44 * u, 0, -44 * u);
    ctx.quadraticCurveTo(hw * u, -44 * u, hw * u, -14 * u);
    ctx.quadraticCurveTo(hw * u, chin * 0.1 * u, hw * 0.66 * u, chin * 0.62 * u);
    ctx.quadraticCurveTo(hw * 0.36 * u, chin * u, 0, chin * u);
    ctx.quadraticCurveTo(-hw * 0.36 * u, chin * u, -hw * 0.66 * u, chin * 0.62 * u);
    ctx.quadraticCurveTo(-hw * u, chin * 0.1 * u, -hw * u, -14 * u);
    ctx.closePath();
  };

  // 耳(頭より先に、頭の下へ潜り込ませる)
  for (const dx of [-1, 1] as const) {
    ctx.fillStyle = rgb(skinDim);
    ctx.beginPath();
    ctx.ellipse(dx * (hw - 0.5) * u, -6 * u, 4.2 * earR * u, 6 * earR * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(skinDeep, 0.5);
    ctx.beginPath();
    ctx.ellipse(dx * (hw - 1) * u, -6 * u, 2.1 * earR * u, 3.4 * earR * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 顔の下地。左上からの主光を球として置く
  const faceG = ctx.createRadialGradient(-9 * u, -26 * u, 2 * u, 0, -8 * u, 34 * u);
  faceG.addColorStop(0, rgb(skinLit));
  faceG.addColorStop(0.5, rgb(skin));
  faceG.addColorStop(1, rgb(skinDim));
  ctx.fillStyle = faceG;
  headPath();
  ctx.fill();

  ctx.save();
  headPath();
  ctx.clip();

  // 陰の境目(ターミネーター)。右側を面で落として球体感を作る
  const term = ctx.createLinearGradient(2 * u, 0, (hw + 1) * u, 0);
  term.addColorStop(0, "rgba(0,0,0,0)");
  term.addColorStop(1, rgba(skinDeep, 0.5));
  ctx.fillStyle = term;
  ctx.fillRect(-30 * u, -46 * u, 60 * u, 70 * u);
  // ユニフォームからの照り返し。顎の下だけをユニフォームの色で温める
  const bounce = ctx.createLinearGradient(0, chin * u, 0, 2 * u);
  bounce.addColorStop(0, rgba(uni, 0.32));
  bounce.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bounce;
  ctx.fillRect(-30 * u, 0, 60 * u, chin * u);
  // 帽子が落とす影。額から目元までを一段沈める
  const capAo = ctx.createLinearGradient(0, -32 * u, 0, -10 * u);
  capAo.addColorStop(0, rgba(skinDeep, 0.7));
  capAo.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = capAo;
  ctx.fillRect(-30 * u, -32 * u, 60 * u, 24 * u);
  // 頬の血色。頬骨の上に薄く置く程度にとどめる
  ctx.fillStyle = `rgba(216,120,102,${0.09 + heat * 0.11})`;
  for (const dx of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(dx * hw * 0.6 * u, -1.5 * u, 6 * u, 3.4 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 鼻。右に影、下に小鼻の影。
  // 稜線のハイライトは、縦長に入れると顔の真ん中に棒が立って見えるので、
  // 鼻先のわずかな照りだけにとどめる
  ctx.fillStyle = rgba(skinDeep, 0.34);
  ctx.beginPath();
  ctx.moveTo(0.8 * u, -5 * u);
  ctx.quadraticCurveTo(4.6 * noseW * u, -0.5 * u, 3.4 * noseW * u, 4.4 * u);
  ctx.quadraticCurveTo(0, 7 * u, -2.8 * noseW * u, 4.8 * u);
  ctx.quadraticCurveTo(-0.8 * u, 1 * u, -0.6 * u, -4 * u);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,252,244,0.26)";
  ctx.beginPath();
  ctx.ellipse(-0.8 * u, 2.4 * u, 1.2 * u, 1.5 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(skinDeep, 0.36);
  ctx.beginPath();
  ctx.ellipse(0, 6 * u, 4.2 * noseW * u, 1.6 * u, 0, 0, Math.PI);
  ctx.fill();
  // 顎の下と、口の下のくぼみ
  const jawAo = ctx.createLinearGradient(0, chin * 0.35 * u, 0, chin * 1.1 * u);
  jawAo.addColorStop(0, "rgba(0,0,0,0)");
  jawAo.addColorStop(1, rgba(skinDeep, 0.6));
  ctx.fillStyle = jawAo;
  ctx.fillRect(-30 * u, chin * 0.35 * u, 60 * u, chin * u);
  // 頬骨と額の照り(鏡面)
  ctx.fillStyle = "rgba(255,253,246,0.26)";
  ctx.beginPath();
  ctx.ellipse(-10 * u, -22 * u, 8 * u, 4.5 * u, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // 髪。帽子の下からのぞく分だけを、面として置く。
  // 束を何本も生やすと縮小したときに顔の上の引っかき傷に見えるので、
  // もみあげは1枚の面、前髪は型ごとの輪郭で描く
  const hairG = ctx.createLinearGradient(-hw * u, -28 * u, hw * u, -14 * u);
  hairG.addColorStop(0, rgb(hairLit));
  hairG.addColorStop(0.45, rgb(hair));
  hairG.addColorStop(1, rgb(mix(hair, [0, 0, 0], 0.3)));
  ctx.fillStyle = hairG;
  // もみあげ
  const burnLen = [2, 6, -2, 4][hairStyle];
  for (const dir of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(dir * hw * u, -27 * u);
    ctx.lineTo(dir * hw * u, (-12 + burnLen) * u);
    ctx.quadraticCurveTo(dir * (hw - 2.4) * u, (-15 + burnLen) * u, dir * (hw - 3.6) * u, -20 * u);
    ctx.quadraticCurveTo(dir * (hw - 3.2) * u, -25 * u, dir * (hw - 4) * u, -27 * u);
    ctx.closePath();
    ctx.fill();
  }
  // 前髪。帽子の縁(-19u あたり)より下へは決して降ろさない
  ctx.beginPath();
  if (hairStyle === 0) {
    // まっすぐ下ろした前髪
    ctx.moveTo(-hw * u, -28 * u);
    ctx.quadraticCurveTo(-hw * 0.5 * u, -17.5 * u, 0, -18.5 * u);
    ctx.quadraticCurveTo(hw * 0.5 * u, -19.5 * u, hw * u, -22 * u);
  } else if (hairStyle === 1) {
    // 右へ流した前髪
    ctx.moveTo(-hw * u, -26 * u);
    ctx.quadraticCurveTo(-hw * 0.2 * u, -25 * u, hw * 0.55 * u, -18.5 * u);
    ctx.quadraticCurveTo(hw * 0.85 * u, -19.5 * u, hw * u, -23 * u);
  } else if (hairStyle === 2) {
    // 立てた前髪
    ctx.moveTo(-hw * u, -25 * u);
    for (let i = 0; i < 5; i++) {
      const x0 = (-hw + (i * 2 * hw) / 5) * u;
      const x1 = (-hw + ((i + 1) * 2 * hw) / 5) * u;
      ctx.lineTo((x0 + x1) / 2, -19 * u);
      ctx.lineTo(x1, -24 * u);
    }
  } else {
    // 短く刈った髪(縁からわずかにのぞく)
    ctx.moveTo(-hw * u, -27 * u);
    ctx.quadraticCurveTo(0, -21 * u, hw * u, -25 * u);
  }
  ctx.lineTo(hw * u, -30 * u);
  ctx.lineTo(-hw * u, -30 * u);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ---- 目 ----
  const eyeY = -8 * u;
  const open = o.done ? 0.3 : 1;
  const gaze = turn * 6 * u;
  const eyeRx = 5.1 * eyeR * u;
  const eyeRy = 3.7 * eyeR * u * open;
  const irisR = 2.9 * eyeR * u;
  for (const dir of [-1, 1] as const) {
    const ex = dir * eyeGap * u;
    // 眼窩の影
    ctx.fillStyle = rgba(skinDeep, 0.28);
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - 0.5 * u, eyeRx * 1.3, 6 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    // 白目。上を暗くして、まぶたの落とす影を作る
    const scl = ctx.createLinearGradient(0, eyeY - 5 * u, 0, eyeY + 4 * u);
    scl.addColorStop(0, "rgb(210,202,196)");
    scl.addColorStop(0.45, "rgb(250,248,246)");
    scl.addColorStop(1, "rgb(230,224,220)");
    ctx.fillStyle = scl;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, Math.PI * 2);
    ctx.clip();
    const ix = ex + gaze;
    const iy = eyeY + 0.3 * u;
    // 虹彩
    const irisG = ctx.createRadialGradient(ix - 0.8 * u, iy - 0.8 * u, 0.4 * u, ix, iy + 0.4 * u, irisR);
    irisG.addColorStop(0, rgb(irisLit));
    irisG.addColorStop(1, rgb(iris));
    ctx.fillStyle = irisG;
    ctx.beginPath();
    ctx.arc(ix, iy, irisR, 0, Math.PI * 2);
    ctx.fill();
    if (detail >= 2) {
      // 放射の繊維。大きく出すときだけ
      ctx.strokeStyle = rgba(mix(iris, [255, 255, 255], 0.5), 0.5);
      ctx.lineWidth = Math.max(0.3, 0.4 * u);
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12;
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * irisR * 0.4, iy + Math.sin(a) * irisR * 0.4);
        ctx.lineTo(ix + Math.cos(a) * irisR * 0.92, iy + Math.sin(a) * irisR * 0.92);
        ctx.stroke();
      }
    }
    // 外周の濃い輪(リンバルリング)
    ctx.strokeStyle = rgba(mix(iris, [0, 0, 0], 0.55), 0.85);
    ctx.lineWidth = Math.max(0.5, 0.8 * u);
    ctx.beginPath();
    ctx.arc(ix, iy, irisR * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgb(14,12,16)";
    ctx.beginPath();
    ctx.arc(ix, iy, irisR * 0.48, 0, Math.PI * 2);
    ctx.fill();
    // まぶたが白目に落とす影
    ctx.fillStyle = "rgba(48,32,26,0.32)";
    ctx.fillRect(ex - eyeRx * 1.2, eyeY - 6.5 * u, eyeRx * 2.4, 3.2 * u);
    ctx.restore();

    // キャッチライト
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(ix - 1.4 * u, eyeY - 1.4 * u, 1.25 * u, 0, Math.PI * 2);
    ctx.fill();
    if (detail >= 1) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(ix + 1.7 * u, eyeY + 1.5 * u, 0.65 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    // 上まつげ(太く)と下まぶたの反射
    ctx.strokeStyle = "rgba(38,24,20,0.9)";
    ctx.lineWidth = Math.max(0.9, 1.8 * u);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, Math.PI * 1.03, Math.PI * 1.97);
    ctx.stroke();
    if (detail >= 1) {
      ctx.strokeStyle = "rgba(255,250,244,0.5)";
      ctx.lineWidth = Math.max(0.4, 0.7 * u);
      ctx.beginPath();
      ctx.ellipse(ex, eyeY + 0.6 * u, eyeRx * 0.9, eyeRy * 0.9, 0, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    }
  }

  // 眉。表情は期日の切迫と完了状態だけで決まる(乱数は形の太さにしか関わらない)
  const browTilt = o.done ? -0.1 : o.urgency > 0.7 ? 0.4 : o.urgency > 0.4 ? 0.2 : 0.05;
  for (const dir of [-1, 1] as const) {
    const strands = detail >= 1 ? 6 : 3;
    for (let i = 0; i < strands; i++) {
      const t = i / (strands - 1);
      const x0 = dir * (eyeGap + 6 - t * 11) * u;
      const y0 = eyeY - 8 * u + dir * browTilt * (1 - t) * 4 * u - t * 1.6 * u;
      ctx.strokeStyle = rgba(mix(hair, hairLit, t * 0.3), 0.92);
      ctx.lineWidth = Math.max(0.7, (2.4 - t * 0.9) * browW * u);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0 + 1.4 * u);
      ctx.quadraticCurveTo(x0 - dir * 1.5 * u, y0 - 1.6 * u, x0 - dir * 2.6 * u, y0 - 1.2 * u);
      ctx.stroke();
    }
  }

  // ---- 口 ----
  const mouthY = chin * 0.5 * u;
  const mw = 6.6 * mouthW * u;
  const curve = o.done ? 3.4 * u : o.urgency > 0.7 ? -3 * u : 1.3 * u;
  // 上唇(暗い) → 下唇(明るい) → 下唇の照り
  ctx.fillStyle = rgba(skinDeep, 0.72);
  ctx.beginPath();
  ctx.moveTo(-mw, mouthY);
  ctx.quadraticCurveTo(0, mouthY + curve, mw, mouthY);
  ctx.quadraticCurveTo(0, mouthY + curve - 1.8 * u, -mw, mouthY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(mix(skin, [216, 128, 116], 0.5), 0.75);
  ctx.beginPath();
  ctx.moveTo(-mw * 0.8, mouthY + 0.6 * u);
  ctx.quadraticCurveTo(0, mouthY + curve + 2.6 * u, mw * 0.8, mouthY + 0.6 * u);
  ctx.quadraticCurveTo(0, mouthY + curve + 0.8 * u, -mw * 0.8, mouthY + 0.6 * u);
  ctx.closePath();
  ctx.fill();
  if (detail >= 1) {
    ctx.fillStyle = "rgba(255,250,244,0.4)";
    ctx.beginPath();
    ctx.ellipse(-1 * u, mouthY + curve * 0.55 + 1.6 * u, 2 * u, 0.8 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- 帽子 ----
  // かぶり方の癖を少しだけ付ける。回転の中心は頭のてっぺんではなく鉢のあたり
  ctx.save();
  ctx.translate(0, -30 * u);
  ctx.rotate(capTilt);
  ctx.translate(0, 30 * u);

  const cw = hw + 2.5; // 帽子の半幅(顔より少し大きい)
  // つばを先に描き、根元をクラウンで覆う(実際の帽子と同じ順)
  const brimY = -25 * u;
  const brimG = ctx.createLinearGradient(0, brimY - 4 * u, 0, brimY + 12 * u);
  brimG.addColorStop(0, rgb(mix(uni, [255, 255, 255], 0.36)));
  brimG.addColorStop(0.38, rgb(uni));
  brimG.addColorStop(1, rgb(uniDeep));
  ctx.fillStyle = brimG;
  ctx.beginPath();
  ctx.moveTo(-cw * u, brimY - 3 * u);
  ctx.quadraticCurveTo(2 * u, brimY + 9 * u, (cw + 7) * u, brimY + 1 * u);
  ctx.quadraticCurveTo((cw + 2) * u, brimY + 4.5 * u, cw * 0.78 * u, brimY + 5.5 * u);
  ctx.quadraticCurveTo(0, brimY + 6.5 * u, -cw * u, brimY + 2.5 * u);
  ctx.closePath();
  ctx.fill();
  if (detail >= 1) {
    // つばの縁の縫い目
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.setLineDash([1.4 * u, 1.4 * u]);
    ctx.lineWidth = Math.max(0.4, 0.6 * u);
    ctx.beginPath();
    ctx.moveTo(-(cw - 2) * u, brimY - 1.4 * u);
    ctx.quadraticCurveTo(2 * u, brimY + 7.6 * u, (cw + 5) * u, brimY + 1.2 * u);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // クラウン
  const capPath = () => {
    ctx.beginPath();
    ctx.moveTo(-(cw - 0.5) * u, -24 * u);
    ctx.quadraticCurveTo(-(cw + 1) * u, -50 * u, 0, -50 * u);
    ctx.quadraticCurveTo((cw + 1) * u, -50 * u, (cw - 0.5) * u, -24 * u);
    ctx.closePath();
  };
  const capG = ctx.createRadialGradient(-10 * u, -44 * u, 1 * u, 0, -34 * u, 32 * u);
  capG.addColorStop(0, rgb(mix(uni, [255, 255, 255], 0.55)));
  capG.addColorStop(0.5, rgb(uni));
  capG.addColorStop(1, rgb(uniDeep));
  ctx.fillStyle = capG;
  capPath();
  ctx.fill();

  ctx.save();
  capPath();
  ctx.clip();
  if (detail >= 1) {
    // 6枚はぎのパネル縫い
    ctx.strokeStyle = rgba(uniDeep, 0.6);
    ctx.lineWidth = Math.max(0.5, 1 * u);
    for (const dx of [-16, -8, 8, 16]) {
      ctx.beginPath();
      ctx.moveTo(dx * u, -24 * u);
      ctx.quadraticCurveTo(dx * 1.15 * u, -43 * u, 0, -49 * u);
      ctx.stroke();
    }
    // 通気孔
    ctx.fillStyle = rgba(uniDeep, 0.7);
    for (const dx of [-12, 12]) {
      ctx.beginPath();
      ctx.arc(dx * u, -34 * u, 1 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 右側の陰
  const capShade = ctx.createLinearGradient(4 * u, 0, (cw + 2) * u, 0);
  capShade.addColorStop(0, "rgba(0,0,0,0)");
  capShade.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = capShade;
  ctx.fillRect(-(cw + 3) * u, -52 * u, (cw + 3) * 2 * u, 30 * u);
  // 帽子の艶(細い弧)
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(1, 2.6 * u);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(-3 * u, -37 * u, 19 * u, 12 * u, -0.24, Math.PI * 1.12, Math.PI * 1.62);
  ctx.stroke();
  ctx.restore();

  // てっぺんのボタンと、正面の星
  ctx.fillStyle = rgb(mix(uni, [255, 255, 255], 0.4));
  ctx.beginPath();
  ctx.arc(0, -49.5 * u, 2.3 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(-0.7 * u, -50.2 * u, 1 * u, 0, Math.PI * 2);
  ctx.fill();
  const star = 4.8 * u;
  ctx.fillStyle = "rgba(20,24,40,0.28)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
    ctx.lineTo(Math.cos(a) * star + 0.6 * u, -36.4 * u + Math.sin(a) * star);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(Math.cos(a2) * star * 0.44 + 0.6 * u, -36.4 * u + Math.sin(a2) * star * 0.44);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / 5;
    ctx.lineTo(Math.cos(a) * star, -37 * u + Math.sin(a) * star);
    const a2 = a + Math.PI / 5;
    ctx.lineTo(Math.cos(a2) * star * 0.44, -37 * u + Math.sin(a2) * star * 0.44);
  }
  ctx.closePath();
  ctx.fill();

  ctx.restore(); // 帽子のかぶり方
  ctx.restore(); // 頭の傾き
  ctx.restore(); // 被写体

  // ============================================================
  // 台紙の仕上げ
  // ============================================================
  if (detail >= 2) {
    // 印刷の網点
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = "rgb(18,24,42)";
    const dot = Math.max(1, s * 0.012);
    for (let y = 0; y < s; y += dot * 2) {
      for (let x = (Math.round(y / (dot * 2)) % 2) * dot; x < s; x += dot * 2) {
        ctx.fillRect(x, y, dot * 0.8, dot * 0.8);
      }
    }
    ctx.restore();
  }
  // 表面の照り
  const sheen = ctx.createLinearGradient(0, 0, s, s);
  sheen.addColorStop(0, "rgba(255,255,255,0.22)");
  sheen.addColorStop(0.42, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0.1)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, s, s);

  // 縁。小さいときは評価の色の1本だけにする。
  // 面取りと切り欠きまで入れると、54pxでは絵より枠のほうが太くなってしまう
  // 評価の色は記章と揃える。
  // (rankCssColor はCSSの linear-gradient を返すのでCanvasには渡せない。
  //  無効な値を strokeStyle に入れても例外にならず黙って無視されるため、
  //  ここでは2色を受け取ってCanvasの勾配を組み直す)
  let rimCol: string | CanvasGradient = rgba(o.accent, 0.7);
  if (o.grade) {
    const [light, dark] = rankColorPair(o.grade);
    const rg = ctx.createLinearGradient(0, 0, 0, s);
    rg.addColorStop(0, rgb(mix(light, [255, 255, 255], 0.25)));
    rg.addColorStop(0.5, rgb(light));
    rg.addColorStop(1, rgb(dark));
    rimCol = rg;
  }
  if (detail === 0) {
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.strokeRect(s * 0.025, s * 0.025, s * 0.95, s * 0.95);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = Math.max(0.6, s * 0.014);
    ctx.strokeRect(s * 0.075, s * 0.075, s * 0.85, s * 0.85);
  } else {
    const bevel = Math.max(1.5, s * 0.055);
    const bg1 = ctx.createLinearGradient(0, 0, s, s);
    bg1.addColorStop(0, "rgba(255,255,255,0.85)");
    bg1.addColorStop(0.5, "rgba(255,255,255,0.25)");
    bg1.addColorStop(1, "rgba(40,50,70,0.5)");
    ctx.strokeStyle = bg1;
    ctx.lineWidth = bevel;
    ctx.strokeRect(bevel / 2, bevel / 2, s - bevel, s - bevel);
    ctx.strokeStyle = rimCol;
    ctx.lineWidth = Math.max(1, s * 0.024);
    ctx.strokeRect(bevel * 0.95, bevel * 0.95, s - bevel * 1.9, s - bevel * 1.9);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(0.5, s * 0.008);
    ctx.strokeRect(bevel * 1.35, bevel * 1.35, s - bevel * 2.7, s - bevel * 2.7);
    if (detail >= 2) {
      // 四隅の切り欠き。名鑑の台紙らしさを足す
      ctx.strokeStyle = "rgba(255,255,255,0.38)";
      ctx.lineWidth = Math.max(0.6, s * 0.012);
      const c0 = bevel * 1.35;
      const cl = s * 0.09;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
        const x = sx > 0 ? c0 : s - c0;
        const y = sy > 0 ? c0 : s - c0;
        ctx.beginPath();
        ctx.moveTo(x + sx * cl, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * cl);
        ctx.stroke();
      }
    }
  }
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

// ============================================================
// ドラフトボード(スカウトリストの見出し)
// ============================================================
// 球団のスカウト部が壁に掛けている board のつもりで描く。
// 左に最優先ターゲットの札、右に階級ごとの人数。
// 一覧を読み下す前に「今どこに人が溜まっているか」が形で分かるようにする。

export interface DraftBoardOptions {
  width: number;
  height: number;
  tiers: { grade: string; count: number }[];
  topName: string | null;
  topCategory: string | null;
  topGrade: string;
  /** 期日までの日数。nullは期日なし */
  topDays: number | null;
  topLabel: string;
  active: number;
  signed: number;
  labels: { title: string; target: string; active: string; signed: string; noTarget: string };
  accent: Rgb;
}

export function draftBoardHeight(): number {
  return 172;
}

export function paintDraftBoard(ctx: CanvasRenderingContext2D, o: DraftBoardOptions) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);

  // 盤面。濃紺のフェルトに金の縁
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(24,32,52)");
  g.addColorStop(1, "rgb(10,14,26)");
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();
  // チームカラーを上端から薄く流す
  const tint = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  tint.addColorStop(0, rgba(o.accent, 0.22));
  tint.addColorStop(1, rgba(o.accent, 0));
  ctx.fillStyle = tint;
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();
  goldHairline(ctx, 0, 0, w, h, 8, 0.5);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // 見出し
  ctx.fillStyle = "rgba(226,203,131,0.95)";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.fillText(o.labels.title, 14, 13);
  // 見出しの下に金の罫
  const rule = ctx.createLinearGradient(14, 0, w - 14, 0);
  rule.addColorStop(0, "rgba(201,162,39,0)");
  rule.addColorStop(0.5, "rgba(255,240,186,0.75)");
  rule.addColorStop(1, "rgba(201,162,39,0)");
  ctx.fillStyle = rule;
  ctx.fillRect(14, 30, w - 28, 1);

  // ---- 左: 最優先ターゲット ----
  const leftW = Math.min(w * 0.56, w - 132);
  ctx.fillStyle = "rgba(178,192,214,0.55)";
  ctx.font = "bold 9px system-ui, sans-serif";
  ctx.fillText(o.labels.target, 14, 40);

  if (o.topName === null) {
    ctx.fillStyle = "rgba(178,192,214,0.5)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(o.labels.noTarget, 14, 62);
  } else {
    // ランクの盾
    const emblem = 48;
    ctx.save();
    ctx.translate(14, 56);
    paintRankEmblem(ctx, { size: emblem, rank: o.topGrade });
    ctx.restore();

    const tx = 14 + emblem + 10;
    const maxW = leftW - (emblem + 24);
    if (o.topCategory) {
      ctx.fillStyle = "rgba(178,192,214,0.5)";
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(fitText(ctx, o.topCategory, maxW), tx, 58);
    }
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillText(fitText(ctx, o.topName, maxW), tx, o.topCategory ? 72 : 66);

    // 交渉期限。過ぎているものは赤く光らせる
    const over = o.topDays !== null && o.topDays < 0;
    const color = over ? "rgba(255,120,104,0.95)" : "rgba(255,214,84,0.95)";
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.font = "bold 13px ui-monospace, monospace";
    ctx.fillText(fitText(ctx, o.topLabel, maxW), tx, o.topCategory ? 94 : 88);
    ctx.shadowBlur = 0;
  }

  // ---- 右: 階級ごとの人数 ----
  const rx = w - 118;
  const ry = 42;
  const rowH = 22;
  for (let i = 0; i < o.tiers.length; i++) {
    const t = o.tiers[i];
    const y = ry + rowH * i;
    // 階級の札
    const [light, dark] = RANK_COLOR[t.grade] ?? RANK_COLOR.G;
    const chipG = ctx.createLinearGradient(0, y, 0, y + 15);
    chipG.addColorStop(0, rgb(light));
    chipG.addColorStop(1, rgb(dark));
    ctx.fillStyle = chipG;
    roundRect(ctx, rx, y, 20, 15, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = "900 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(t.grade, rx + 10, y + 3);

    // 人数ぶんの目盛り。棒ではなく刻みにして、名鑑の余白を活かす
    ctx.textAlign = "left";
    const barX = rx + 26;
    const barW = 60;
    const max = Math.max(1, ...o.tiers.map((x) => x.count));
    const fill = (t.count / max) * barW;
    ctx.fillStyle = "rgba(150,170,204,0.16)";
    roundRect(ctx, barX, y + 4.5, barW, 6, 3);
    ctx.fill();
    if (fill > 0.5) {
      ctx.fillStyle = rgba(light, 0.9);
      roundRect(ctx, barX, y + 4.5, Math.max(3, fill), 6, 3);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(226,232,244,0.85)";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(String(t.count), w - 12, y + 3);
    ctx.textAlign = "left";
  }

  // ---- 下段: 交渉中 / 契約済 ----
  ctx.fillStyle = "rgba(178,192,214,0.5)";
  ctx.font = "9px system-ui, sans-serif";
  const footY = h - 30;
  ctx.fillText(o.labels.active, 14, footY);
  ctx.fillStyle = "rgba(255,214,84,0.95)";
  ctx.font = "bold 14px ui-monospace, monospace";
  ctx.fillText(String(o.active), 14, footY + 11);
  const activeW = ctx.measureText(String(o.active)).width;
  ctx.fillStyle = "rgba(178,192,214,0.5)";
  ctx.font = "9px system-ui, sans-serif";
  ctx.fillText(o.labels.signed, 14 + activeW + 18, footY);
  ctx.fillStyle = "rgba(126,220,158,0.9)";
  ctx.font = "bold 14px ui-monospace, monospace";
  ctx.fillText(String(o.signed), 14 + activeW + 18, footY + 11);

  gloss(ctx, 0, 0, w, h, 8, 0.08);
}

/** 与えられた幅に収まるよう、末尾を…で詰める */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

// ============================================================
// 順位表(契約案件の見出し)
// ============================================================
// 段階の消化を勝敗に見立てた、球団の順位表。
// 勝率順に並ぶので、走っている案件と止まっている案件が一列で分かる。

export interface StandingsOptions {
  width: number;
  height: number;
  rows: {
    title: string;
    wins: number;
    losses: number;
    remaining: number;
    winRate: number;
    standing: string;
    daysLeft: number | null;
  }[];
  labels: { title: string; team: string; win: string; lose: string; rest: string; rate: string; days: string; empty: string };
  accent: Rgb;
}

export function standingsHeight(rowCount: number): number {
  return 46 + Math.max(1, rowCount) * 26 + 10;
}

export function paintStandings(ctx: CanvasRenderingContext2D, o: StandingsOptions) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "rgb(24,32,52)");
  g.addColorStop(1, "rgb(10,14,26)");
  ctx.fillStyle = g;
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();
  const tint = ctx.createLinearGradient(0, 0, 0, h * 0.36);
  tint.addColorStop(0, rgba(o.accent, 0.2));
  tint.addColorStop(1, rgba(o.accent, 0));
  ctx.fillStyle = tint;
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();
  goldHairline(ctx, 0, 0, w, h, 8, 0.5);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(226,203,131,0.95)";
  ctx.font = "bold 10px system-ui, sans-serif";
  ctx.fillText(o.labels.title, 12, 11);

  // 列の位置。右から 残 / 敗 / 勝 を積み、勝率をいちばん右に置く
  const colRate = w - 14;
  const colRest = colRate - 44;
  const colLose = colRest - 26;
  const colWin = colLose - 26;
  const nameRight = colWin - 34;

  // 見出し行
  const headY = 28;
  ctx.font = "bold 9px system-ui, sans-serif";
  ctx.fillStyle = "rgba(150,170,204,0.6)";
  ctx.fillText(o.labels.team, 30, headY);
  ctx.textAlign = "right";
  ctx.fillText(o.labels.win, colWin, headY);
  ctx.fillText(o.labels.lose, colLose, headY);
  ctx.fillText(o.labels.rest, colRest, headY);
  ctx.fillText(o.labels.rate, colRate, headY);
  ctx.textAlign = "left";

  const rule = ctx.createLinearGradient(12, 0, w - 12, 0);
  rule.addColorStop(0, "rgba(201,162,39,0)");
  rule.addColorStop(0.5, "rgba(255,240,186,0.6)");
  rule.addColorStop(1, "rgba(201,162,39,0)");
  ctx.fillStyle = rule;
  ctx.fillRect(12, 41, w - 24, 1);

  if (o.rows.length === 0) {
    ctx.fillStyle = "rgba(178,192,214,0.5)";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(o.labels.empty, 14, 54);
    return;
  }

  o.rows.forEach((r, i) => {
    const y = 48 + i * 26;
    // 1行おきに薄く敷いて、目が横に流れるようにする
    if (i % 2 === 1) {
      ctx.fillStyle = "rgba(150,170,204,0.05)";
      ctx.fillRect(8, y - 3, w - 16, 24);
    }
    // 順位。首位だけ金にする
    const top = i === 0;
    ctx.fillStyle = top ? "rgba(255,240,186,0.95)" : "rgba(150,170,204,0.6)";
    ctx.font = `bold ${top ? 13 : 11}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1), 12, y + (top ? 1 : 2));

    ctx.fillStyle = "rgba(240,244,252,0.92)";
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillText(fitText(ctx, r.title, nameRight - 30), 30, y + 1);

    ctx.textAlign = "right";
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillStyle = "rgba(126,220,158,0.92)";
    ctx.fillText(String(r.wins), colWin, y + 1);
    ctx.fillStyle = r.losses > 0 ? "rgba(255,120,104,0.92)" : "rgba(150,170,204,0.45)";
    ctx.fillText(String(r.losses), colLose, y + 1);
    ctx.fillStyle = "rgba(178,192,214,0.7)";
    ctx.fillText(String(r.remaining), colRest, y + 1);

    // 勝率。野球の表記に合わせて .000 形式
    ctx.fillStyle = "rgba(255,214,84,0.95)";
    ctx.fillText(r.winRate.toFixed(3).replace(/^0/, ""), colRate, y + 1);

    // 期日までの日数を、名前の下に小さく
    if (r.daysLeft !== null) {
      ctx.textAlign = "left";
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillStyle = r.daysLeft < 0 ? "rgba(255,120,104,0.85)" : "rgba(150,170,204,0.5)";
      ctx.fillText(`${o.labels.days} ${r.daysLeft}`, 30, y + 13);
    }
    ctx.textAlign = "left";
  });

  gloss(ctx, 0, 0, w, h, 8, 0.06);
}
