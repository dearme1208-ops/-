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
