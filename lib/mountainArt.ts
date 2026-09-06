// 登山モードの図版。すべてCanvasに手で描く。
// 揺らぎ(尾根の凹凸、雲の位置、雪渓の形)には種から決まる擬似乱数を使うので、
// 同じ案件・同じ日には毎回まったく同じ絵が出る。数値そのものは実データのみ。

// ------------------------------------------------------------
// テーマ色の取り込み
// ------------------------------------------------------------
// Canvasは "rgb(var(--accent-rgb))" のようなCSS変数を解決できない
// (fillStyleは黙って無視され、addColorStopは例外を投げる)。
// アクセント色はユーザーが設定で自由に変えられるので、描く直前に
// <html>の計算済みスタイルから実際の値を読み、以後はこの値で描く
export type Rgb = [number, number, number];

export interface Palette {
  accent: Rgb;
  ink: Rgb;
  cream: Rgb;
  panel: Rgb;
}

function readCssRgb(name: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : fallback;
}

let PAL: Palette = {
  accent: [232, 138, 74],
  ink: [15, 22, 34],
  cream: [226, 234, 244],
  panel: [24, 34, 49],
};

/** 描画の直前に呼ぶ。以後の A()/C()/I()/PN() が現在のテーマ色を返すようになる */
export function refreshPalette(): Palette {
  PAL = {
    accent: readCssRgb("--accent-rgb", PAL.accent),
    ink: readCssRgb("--ink-rgb", PAL.ink),
    cream: readCssRgb("--cream-rgb", PAL.cream),
    panel: readCssRgb("--panel-rgb", PAL.panel),
  };
  return PAL;
}

const css = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/** アクセント色 */ export const A = (a = 1) => css(PAL.accent, a);
/** 文字色 */ export const C = (a = 1) => css(PAL.cream, a);
/** 地の色 */ export const I = (a = 1) => css(PAL.ink, a);
/** パネル色 */ export const PN = (a = 1) => css(PAL.panel, a);

export type SkyPhase = "dawn" | "morning" | "noon" | "afternoon" | "dusk" | "night";

export function skyPhaseOf(hour: number): SkyPhase {
  if (hour < 5) return "night";
  if (hour < 7) return "dawn";
  if (hour < 11) return "morning";
  if (hour < 14) return "noon";
  if (hour < 17) return "afternoon";
  if (hour < 19) return "dusk";
  return "night";
}

interface SkyPalette {
  top: string;
  mid: string;
  low: string;
  sun: string;
  sunGlow: string;
  haze: string;
  snow: string;
  rockLit: string;
  rockShade: string;
  forest: string;
  ink: string;
}

// 時間帯ごとの空と岩肌の色。山の絵は光の向きで印象が決まるので、
// 空だけでなく岩の明部・暗部の色も一緒に持たせる
export const SKY: Record<SkyPhase, SkyPalette> = {
  dawn: {
    top: "#2c3a63", mid: "#7b6a8e", low: "#e8a07a", sun: "#ffd9a0", sunGlow: "#ff9d5c",
    haze: "#d9a98f", snow: "#ffe9dc", rockLit: "#8d7a80", rockShade: "#3b3444", forest: "#2f4034", ink: "#241f2e",
  },
  morning: {
    top: "#4a86c8", mid: "#8fbde0", low: "#d8e8f2", sun: "#fffbe8", sunGlow: "#ffeeb8",
    haze: "#cddfea", snow: "#ffffff", rockLit: "#a99b91", rockShade: "#4a4a52", forest: "#33523a", ink: "#2b3038",
  },
  noon: {
    top: "#2f74be", mid: "#79b3dd", low: "#cfe6f3", sun: "#ffffff", sunGlow: "#fff6cf",
    haze: "#c3daea", snow: "#ffffff", rockLit: "#b3a79c", rockShade: "#514f55", forest: "#2f5738", ink: "#252b32",
  },
  afternoon: {
    top: "#3d6fae", mid: "#9dbcd5", low: "#eadfc9", sun: "#fff0c4", sunGlow: "#ffd88f",
    haze: "#d9cdb6", snow: "#fff6ec", rockLit: "#b09283", rockShade: "#4c4249", forest: "#31492f", ink: "#2a262c",
  },
  dusk: {
    top: "#26325c", mid: "#8a5f83", low: "#e2825c", sun: "#ffc78a", sunGlow: "#ff7f4d",
    haze: "#c98a72", snow: "#ffdcc6", rockLit: "#7d6570", rockShade: "#302a3d", forest: "#26332c", ink: "#1e1b28",
  },
  night: {
    top: "#0b1226", mid: "#182242", low: "#2b3757", sun: "#dfe7ff", sunGlow: "#93a7d6",
    haze: "#33405f", snow: "#cfd9f0", rockLit: "#4a4d62", rockShade: "#181c2c", forest: "#16261f", ink: "#0a0e1a",
  },
};

// ------------------------------------------------------------
// 種から決まる擬似乱数(絵の揺らぎ専用)
// ------------------------------------------------------------
export function makeRng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// 1本の尾根線を作る。midpoint displacement で自然な起伏にし、
// rugged(険しさ)で凹凸の激しさを変える
function ridgeLine(rng: () => number, w: number, peakX: number, peakY: number, baseY: number, rugged: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [
    { x: -w * 0.1, y: baseY },
    { x: peakX, y: peakY },
    { x: w * 1.1, y: baseY },
  ];
  for (let pass = 0; pass < 5; pass++) {
    const next: { x: number; y: number }[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mx = (a.x + b.x) / 2;
      const span = Math.abs(b.x - a.x);
      const jitter = (rng() - 0.5) * span * (0.16 + rugged * 0.34);
      let my = (a.y + b.y) / 2 + jitter;
      my = Math.min(baseY, my);
      next.push({ x: mx, y: my }, b);
    }
    pts.length = 0;
    pts.push(...next);
  }
  return pts;
}

function fillRidge(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], bottom: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, bottom);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1].x, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ============================================================
// 主役: 山のパノラマ
// ============================================================
// 空 → 遠景の連山(大気遠近で霞ませる) → 主峰 → 雪渓 → 森林限界 → 樹林帯 →
// ルート線 → 現在地の登山者 → 天候の効果(雨/雪/雷) の順に重ねる
export function paintPanorama(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    phase: SkyPhase;
    seed: string;
    rugged: number; // 0〜1
    progress: number; // 0〜1。ルート上の現在地
    weather: "clear" | "cloudy" | "rain" | "storm";
    summited: boolean;
  }
) {
  refreshPalette();
  const P = SKY[opts.phase];
  const rng = makeRng(opts.seed);
  const horizon = h * 0.78;

  // ---- 空 ----
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, P.top);
  sky.addColorStop(0.55, P.mid);
  sky.addColorStop(1, P.low);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // ---- 太陽/月 ----
  const sunX = w * (0.18 + rng() * 0.1);
  const sunY = h * (opts.phase === "noon" ? 0.14 : 0.26);
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.42);
  glow.addColorStop(0, P.sunGlow);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = opts.weather === "storm" ? 0.18 : opts.weather === "rain" ? 0.35 : 0.7;
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizon);
  ctx.globalAlpha = 1;
  if (opts.weather !== "storm") {
    ctx.beginPath();
    ctx.arc(sunX, sunY, h * 0.038, 0, Math.PI * 2);
    ctx.fillStyle = P.sun;
    ctx.globalAlpha = opts.weather === "rain" ? 0.4 : 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- 星(夜のみ) ----
  if (opts.phase === "night") {
    for (let i = 0; i < 70; i++) {
      const x = rng() * w, y = rng() * horizon * 0.75;
      ctx.globalAlpha = 0.25 + rng() * 0.65;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, rng() > 0.85 ? 1.6 : 1, rng() > 0.85 ? 1.6 : 1);
    }
    ctx.globalAlpha = 1;
  }

  // ---- 雲 ----
  const cloudCount = opts.weather === "clear" ? 3 : opts.weather === "cloudy" ? 6 : 9;
  for (let i = 0; i < cloudCount; i++) {
    const cx = rng() * w;
    const cy = horizon * (0.16 + rng() * 0.5);
    const cw = w * (0.16 + rng() * 0.3);
    const chh = cw * (0.1 + rng() * 0.08);
    ctx.globalAlpha = opts.weather === "clear" ? 0.3 : opts.weather === "storm" ? 0.72 : 0.5;
    ctx.fillStyle = opts.weather === "storm" ? "#4b5364" : opts.weather === "rain" ? "#8f9aa8" : "#ffffff";
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + (k - 2) * cw * 0.17, cy + (rng() - 0.5) * chh, cw * (0.2 + rng() * 0.14), chh * (0.7 + rng() * 0.6), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // ---- 遠景の連山(3列。奥ほど霞ませる) ----
  for (let layer = 0; layer < 3; layer++) {
    const depth = (3 - layer) / 3; // 1=奥
    const baseY = horizon - h * 0.02 * layer;
    const peakY = horizon - h * (0.20 + layer * 0.07 + rng() * 0.05);
    const pts = ridgeLine(rng, w, w * (0.15 + rng() * 0.7), peakY, baseY, 0.35 + rng() * 0.2);
    const g = ctx.createLinearGradient(0, peakY, 0, baseY);
    g.addColorStop(0, mix(P.rockLit, P.haze, depth * 0.75));
    g.addColorStop(1, mix(P.rockShade, P.haze, depth * 0.6));
    fillRidge(ctx, pts, horizon, g);
  }

  // ---- 主峰 ----
  const peakX = w * 0.56;
  const peakY = h * 0.14;
  const mainPts = ridgeLine(rng, w, peakX, peakY, horizon + h * 0.03, opts.rugged);
  const mg = ctx.createLinearGradient(0, peakY, 0, horizon);
  mg.addColorStop(0, P.rockLit);
  mg.addColorStop(0.5, mix(P.rockLit, P.rockShade, 0.55));
  mg.addColorStop(1, P.rockShade);
  fillRidge(ctx, mainPts, horizon + h * 0.05, mg);

  // 主峰の陰影(右側を落とす)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(mainPts[0].x, horizon + h * 0.05);
  for (const p of mainPts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(mainPts[mainPts.length - 1].x, horizon + h * 0.05);
  ctx.closePath();
  ctx.clip();
  const shade = ctx.createLinearGradient(peakX, 0, w, 0);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);

  // ---- 雪渓(稜線から筋状に垂らす) ----
  // 雪は「稜線に薄く積もった冠雪」と「谷筋に残る雪渓」の2枚に分ける。
  // 尾根の全点から三角形を垂らすと氷柱のような棘の塊になってしまうので、
  // 冠雪は稜線に沿った帯として塗り、雪渓は間引いた点からだけ流す
  const snowLine = peakY + (horizon - peakY) * 0.34;
  const capped = mainPts.filter((p) => p.y < snowLine);
  if (capped.length > 1) {
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = P.snow;
    ctx.beginPath();
    ctx.moveTo(capped[0].x, capped[0].y);
    for (const p of capped) ctx.lineTo(p.x, p.y);
    // 冠雪の下端は、稜線から一定の厚みだけ下げた線でなぞる
    for (let i = capped.length - 1; i >= 0; i--) {
      const p = capped[i];
      const depth = (snowLine - p.y) * 0.55;
      ctx.lineTo(p.x, p.y + depth);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 谷筋の雪渓。間引いた点から、下ほど細くなる帯を流す
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = P.snow;
  for (let i = 0; i < capped.length; i += 7) {
    const p = capped[i];
    const len = (snowLine - p.y) * (0.8 + rng() * 1.4);
    const wTop = 2.5 + rng() * 4;
    ctx.beginPath();
    ctx.moveTo(p.x - wTop, p.y + (snowLine - p.y) * 0.4);
    ctx.quadraticCurveTo(p.x - wTop * 0.5, p.y + len * 0.6, p.x + (rng() - 0.5) * 5, p.y + len);
    ctx.quadraticCurveTo(p.x + wTop * 0.6, p.y + len * 0.55, p.x + wTop, p.y + (snowLine - p.y) * 0.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ---- 岩の縦じま(テクスチャ) ----
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const x = rng() * w;
    const y0 = peakY + rng() * (horizon - peakY) * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + (rng() - 0.5) * 10, y0 + 10 + rng() * 40);
    ctx.stroke();
  }
  ctx.restore();

  // ---- 樹林帯と手前の地面 ----
  // 地平線から下を空の色のまま残すと、絵の下端が平らな帯になって未完成に見える。
  // 森 → 草地 → 手前の岩場(スクリー)の3枚を重ねて、足元まで山の中にする
  const treeLine = horizon - h * 0.06;
  const groundTop = horizon - h * 0.01;
  const ground = ctx.createLinearGradient(0, groundTop, 0, h);
  ground.addColorStop(0, mix(P.forest, P.ink, 0.15));
  ground.addColorStop(1, mix(P.forest, P.ink, 0.72));
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundTop, w, h - groundTop);

  ctx.fillStyle = P.forest;
  ctx.beginPath();
  ctx.moveTo(0, groundTop + h * 0.05);
  for (let x = 0; x <= w; x += 4) {
    const t = treeLine + Math.sin(x * 0.05) * 3 + rng() * 4;
    ctx.lineTo(x, t);
  }
  ctx.lineTo(w, groundTop + h * 0.05);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < Math.round(w / 9); i++) {
    const x = rng() * w;
    const yb = treeLine + 6 + rng() * (h * 0.06);
    const th = 7 + rng() * 11;
    ctx.fillStyle = mix(P.forest, P.ink, 0.3 + rng() * 0.4);
    ctx.beginPath();
    ctx.moveTo(x, yb - th);
    ctx.lineTo(x - th * 0.3, yb);
    ctx.lineTo(x + th * 0.3, yb);
    ctx.closePath();
    ctx.fill();
  }

  // 手前の岩場。一番下に大きめの岩を並べて奥行きを出す
  ctx.fillStyle = mix(P.ink, P.rockShade, 0.35);
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, h - h * 0.06);
  for (let x = 0; x <= w; x += 14) {
    ctx.lineTo(x, h - h * (0.03 + rng() * 0.06));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < Math.round(w / 26); i++) {
    const x = rng() * w;
    const y = h - h * (0.005 + rng() * 0.045);
    const rw = 5 + rng() * 13;
    ctx.fillStyle = mix(P.ink, P.rockLit, 0.12 + rng() * 0.2);
    ctx.beginPath();
    ctx.ellipse(x, y, rw, rw * (0.42 + rng() * 0.28), rng() * 0.6 - 0.3, Math.PI, 0);
    ctx.fill();
  }

  // ---- ルート線(登山口から山頂へ) ----
  const route = routePoints(w, h, peakX, peakY, horizon);
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  route.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  // 歩いた分だけ実線で上書き
  const walked = Math.max(1, Math.round(route.length * Math.min(1, Math.max(0, opts.progress))));
  ctx.strokeStyle = A();
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  route.slice(0, walked).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // ---- 現在地の登山者 ----
  const at = route[Math.min(route.length - 1, walked - 1)] ?? route[0];
  paintClimber(ctx, at.x, at.y, 13, P.ink, opts.summited);

  // ---- 山頂の標識 ----
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(peakX, peakY - 14);
  ctx.stroke();
  ctx.fillStyle = opts.summited ? A() : "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.moveTo(peakX, peakY - 14);
  ctx.lineTo(peakX + 13, peakY - 10);
  ctx.lineTo(peakX, peakY - 6);
  ctx.closePath();
  ctx.fill();

  // ---- 天候の効果 ----
  if (opts.weather === "rain" || opts.weather === "storm") {
    const drops = opts.weather === "storm" ? 190 : 90;
    ctx.strokeStyle = opts.weather === "storm" ? "rgba(200,220,255,0.6)" : "rgba(200,220,255,0.42)";
    ctx.lineWidth = 1;
    for (let i = 0; i < drops; i++) {
      const x = rng() * w, y = rng() * h;
      const len = 7 + rng() * 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.28, y + len);
      ctx.stroke();
    }
  }
  if (opts.weather === "storm") {
    // 稲妻。位置は種で決まるので毎回同じところに落ちる
    const lx = w * (0.2 + rng() * 0.6);
    ctx.strokeStyle = "rgba(255,247,200,0.9)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let ly = 0, cx = lx;
    ctx.moveTo(cx, ly);
    while (ly < peakY) {
      ly += 12 + rng() * 16;
      cx += (rng() - 0.5) * 26;
      ctx.lineTo(cx, ly);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#fff7c8";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // ---- 前景の霞 ----
  const mist = ctx.createLinearGradient(0, horizon - h * 0.16, 0, horizon + h * 0.06);
  mist.addColorStop(0, "rgba(255,255,255,0)");
  mist.addColorStop(0.6, hexWithAlpha(P.haze, 0.34));
  mist.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, horizon - h * 0.16, w, h * 0.22);
}

// ルートは登山口(左下)から山頂へ、ジグザグに折り返しながら上がる
function routePoints(w: number, h: number, peakX: number, peakY: number, horizon: number) {
  const pts: { x: number; y: number }[] = [];
  const startX = w * 0.1;
  const startY = horizon - h * 0.01;
  const steps = 44;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = startY + (peakY - startY) * t;
    // 折り返しの幅は上に行くほど狭める(高度が上がるほど尾根が細くなる感じ)
    const zig = Math.sin(t * Math.PI * 3.2) * (1 - t) * w * 0.11;
    const x = startX + (peakX - startX) * t + zig;
    pts.push({ x, y });
  }
  return pts;
}

// 2頭身の登山者。ザックと帽子、登頂時はピッケルを掲げる
export function paintClimber(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, ink: string, summited: boolean) {
  const s = size / 13;
  ctx.save();
  ctx.translate(x, y);
  // 影
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 1, 6 * s, 2 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 体
  ctx.fillStyle = A();
  roundRect(ctx, -3.2 * s, -9 * s, 6.4 * s, 8 * s, 2 * s);
  ctx.fill();
  // ザック
  ctx.fillStyle = ink;
  roundRect(ctx, -5.6 * s, -8.4 * s, 3 * s, 6 * s, 1.2 * s);
  ctx.fill();
  // 頭
  ctx.fillStyle = "#f2ddc8";
  ctx.beginPath();
  ctx.arc(0, -11.5 * s, 3.1 * s, 0, Math.PI * 2);
  ctx.fill();
  // 帽子
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(0, -12 * s, 3.2 * s, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(-4.4 * s, -12.4 * s, 8.8 * s, 1.1 * s);
  // ストック / ピッケル
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2 * s;
  ctx.beginPath();
  if (summited) {
    ctx.moveTo(4 * s, -16 * s);
    ctx.lineTo(4.6 * s, -6 * s);
  } else {
    ctx.moveTo(4.6 * s, -10 * s);
    ctx.lineTo(5.4 * s, 0);
  }
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// 高度断面図(1つの案件の全行程)
// ============================================================
export function paintProfile(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: {
    summit: number;
    current: number;
    waypoints: { title: string; altitude: number; passed: boolean; collapsed: boolean }[];
    seed: string;
    labels: { start: string; summit: string; now: string };
  }
) {
  refreshPalette();
  const rng = makeRng(opts.seed);
  const padL = 40, padR = 14, padT = 22, padB = 30;
  const gw = w - padL - padR;
  const gh = h - padT - padB;
  const base = 600;
  const top = Math.max(opts.summit, base + 300);
  const yOf = (m: number) => padT + gh * (1 - (m - base) / (top - base));

  // 背景(方眼＋標高の目盛り)
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = C(0.12);
  ctx.lineWidth = 1;
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = C(0.45);
  ctx.textAlign = "right";
  const step = top - base > 1800 ? 600 : 300;
  for (let m = base; m <= top; m += step) {
    const y = yOf(m);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(`${m}m`, padL - 5, y + 3);
  }

  // 稜線(登山口→山頂→下り)。通過点を必ず通るように折れ線で結ぶ
  const nodes = [{ x: padL, y: yOf(base) }];
  opts.waypoints.forEach((wp, i) => {
    const x = padL + (gw * (i + 1)) / (opts.waypoints.length + 1);
    nodes.push({ x, y: yOf(wp.altitude) });
  });
  nodes.push({ x: w - padR, y: yOf(opts.summit) });

  // 稜線を細かく刻んで岩肌らしい凹凸を足す
  const ridge: { x: number; y: number }[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1];
    const seg = 12;
    for (let k = 0; k < seg; k++) {
      const t = k / seg;
      ridge.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + (rng() - 0.5) * 5 });
    }
  }
  ridge.push(nodes[nodes.length - 1]);

  const g = ctx.createLinearGradient(0, padT, 0, h - padB);
  g.addColorStop(0, C(0.30));
  g.addColorStop(1, C(0.07));
  ctx.beginPath();
  ctx.moveTo(ridge[0].x, h - padB);
  for (const p of ridge) ctx.lineTo(p.x, p.y);
  ctx.lineTo(ridge[ridge.length - 1].x, h - padB);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = C(0.6);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ridge.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // 現在地までを塗り分ける
  const curY = yOf(opts.current);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, curY, w, h - curY);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(ridge[0].x, h - padB);
  for (const p of ridge) ctx.lineTo(p.x, p.y);
  ctx.lineTo(ridge[ridge.length - 1].x, h - padB);
  ctx.closePath();
  ctx.fillStyle = A(0.28);
  ctx.fill();
  ctx.restore();

  // 現在標高の線
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = A();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(padL, curY);
  ctx.lineTo(w - padR, curY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "left";
  ctx.fillStyle = A();
  ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
  // 現在地が登山口と同じ高さのときは、軸の「登山口」表記と重なるので少し持ち上げる
  const nowLabelY = curY > h - padB - 20 ? curY - 14 : curY - 4;
  ctx.fillText(`${opts.labels.now} ${opts.current}m`, padL + 3, nowLabelY);

  // 通過点
  opts.waypoints.forEach((wp, i) => {
    const n = nodes[i + 1];
    ctx.beginPath();
    ctx.arc(n.x, n.y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = wp.passed
      ? A()
      : wp.collapsed
        ? "#c0392b"
        : PN();
    ctx.fill();
    ctx.strokeStyle = C(0.8);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (wp.collapsed) {
      // 崩落は×印
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(n.x - 2.2, n.y - 2.2); ctx.lineTo(n.x + 2.2, n.y + 2.2);
      ctx.moveTo(n.x + 2.2, n.y - 2.2); ctx.lineTo(n.x - 2.2, n.y + 2.2);
      ctx.stroke();
    }
  });

  // 山頂の旗
  const last = nodes[nodes.length - 1];
  ctx.strokeStyle = C();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(last.x, last.y - 11);
  ctx.stroke();
  ctx.fillStyle = A();
  ctx.beginPath();
  ctx.moveTo(last.x, last.y - 11);
  ctx.lineTo(last.x - 10, last.y - 8);
  ctx.lineTo(last.x, last.y - 5);
  ctx.closePath();
  ctx.fill();

  // 端のラベル
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = C(0.5);
  ctx.textAlign = "left";
  ctx.fillText(opts.labels.start, padL, h - padB + 12);
  ctx.textAlign = "right";
  ctx.fillText(`${opts.labels.summit} ${opts.summit}m`, w - padR, h - padB + 12);
}

export function profileHeight(compact = false): number {
  return compact ? 132 : 190;
}

// ============================================================
// 高度計(円形の計器)
// ============================================================
export function paintAltimeter(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { value: number; max: number; unit: string; caption: string; sub: string }
) {
  refreshPalette();
  // 見出し・補足は文字盤の外(上下)に置く。中に全部入れると目盛りや針と重なる
  const cx = w / 2, cy = h / 2 + 5;
  const r = Math.min(w, h) / 2 - 20;
  // 文字盤
  const face = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
  face.addColorStop(0, PN());
  face.addColorStop(1, I());
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = C(0.35);
  ctx.lineWidth = 2;
  ctx.stroke();
  // 目盛り
  for (let i = 0; i <= 40; i++) {
    const a = -Math.PI * 1.25 + (Math.PI * 1.5 * i) / 40;
    const major = i % 5 === 0;
    const r0 = r - (major ? 11 : 6);
    ctx.strokeStyle = C(major ? 0.75 : 0.32);
    ctx.lineWidth = major ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
    ctx.stroke();
  }
  // 到達分の弧
  const ratio = opts.max > 0 ? Math.min(1.2, opts.value / opts.max) : 0;
  ctx.strokeStyle = A();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 17, -Math.PI * 1.25, -Math.PI * 1.25 + Math.PI * 1.5 * Math.min(1, ratio));
  ctx.stroke();
  // 針
  const a = -Math.PI * 1.25 + Math.PI * 1.5 * Math.min(1, ratio);
  ctx.strokeStyle = A();
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 8, cy - Math.sin(a) * 8);
  ctx.lineTo(cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 3.4, 0, Math.PI * 2);
  ctx.fillStyle = C();
  ctx.fill();
  // 数値は文字盤の中央、見出しは上端、補足は下端
  ctx.textAlign = "center";
  ctx.fillStyle = C();
  ctx.font = "bold 20px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`${opts.value}`, cx, cy + 5);
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = C(0.55);
  ctx.fillText(opts.unit, cx, cy + 17);
  ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = C(0.7);
  ctx.fillText(opts.caption, cx, 11);
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = C(0.45);
  ctx.fillText(fitText(ctx, opts.sub, w - 4), cx, h - 3);
}

// ============================================================
// 天気記号
// ============================================================
export function paintWeatherGlyph(ctx: CanvasRenderingContext2D, w: number, h: number, weather: "clear" | "cloudy" | "rain" | "storm") {
  refreshPalette();
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.26;
  ctx.clearRect(0, 0, w, h);
  if (weather === "clear") {
    ctx.fillStyle = A();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = A();
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
      ctx.lineTo(cx + Math.cos(a) * (r + 10), cy + Math.sin(a) * (r + 10));
      ctx.stroke();
    }
    return;
  }
  // 雲
  const cloud = weather === "storm" ? C(0.35) : C(0.6);
  ctx.fillStyle = cloud;
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.7, cy - r * 0.1, r * 0.8, r * 0.62, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.2, cy - r * 0.45, r * 0.95, r * 0.72, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + r * 0.95, cy - r * 0.05, r * 0.7, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - r * 1.4, cy - r * 0.15, r * 2.8, r * 0.6);
  if (weather === "rain" || weather === "storm") {
    ctx.strokeStyle = A();
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const x = cx - r * 1.0 + i * r * 0.68;
      ctx.beginPath();
      ctx.moveTo(x, cy + r * 0.7);
      ctx.lineTo(x - r * 0.22, cy + r * 1.35);
      ctx.stroke();
    }
  }
  if (weather === "storm") {
    ctx.fillStyle = A();
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.15, cy + r * 0.5);
    ctx.lineTo(cx - r * 0.35, cy + r * 1.35);
    ctx.lineTo(cx + r * 0.05, cy + r * 1.3);
    ctx.lineTo(cx - r * 0.2, cy + r * 2.0);
    ctx.lineTo(cx + r * 0.6, cy + r * 1.0);
    ctx.lineTo(cx + r * 0.18, cy + r * 1.05);
    ctx.closePath();
    ctx.fill();
  }
}

// ============================================================
// 地形図(等高線)。本日の行程の背景に敷く
// ============================================================
export function paintTopo(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, density = 9) {
  refreshPalette();
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, w, h);
  const centers = Array.from({ length: 3 }, () => ({
    x: rng() * w, y: rng() * h, rx: w * (0.2 + rng() * 0.35), ry: h * (0.25 + rng() * 0.45), rot: rng() * Math.PI,
  }));
  for (let ring = density; ring >= 1; ring--) {
    const t = ring / density;
    ctx.strokeStyle = C(0.05 + (1 - t) * 0.09);
    ctx.lineWidth = ring % 5 === 0 ? 1.4 : 0.8;
    for (const c of centers) {
      ctx.beginPath();
      // 円をそのまま描くと機械的なので、角度ごとに半径を少し揺らす
      const steps = 60;
      for (let i = 0; i <= steps; i++) {
        const a = (Math.PI * 2 * i) / steps;
        const wob = 1 + Math.sin(a * 3 + ring) * 0.06 + Math.sin(a * 7 + ring * 2) * 0.035;
        const x = c.x + Math.cos(a + c.rot) * c.rx * t * wob;
        const y = c.y + Math.sin(a + c.rot) * c.ry * t * wob;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

// ============================================================
// 山名板(案件1件ぶんの木の標識)
// ============================================================
export function paintSignboard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: { name: string; altitude: number; grade: string; summited: boolean; seed: string }
) {
  refreshPalette();
  const rng = makeRng(opts.seed);
  ctx.clearRect(0, 0, w, h);
  // 木目の板
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#6d543c");
  g.addColorStop(0.5, "#5b452f");
  g.addColorStop(1, "#452f1f");
  roundRect(ctx, 2, 2, w - 4, h - 4, 5);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 木目
  ctx.save();
  roundRect(ctx, 2, 2, w - 4, h - 4, 5);
  ctx.clip();
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const y = rng() * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.06 + i) * 1.6);
    ctx.stroke();
  }
  ctx.restore();
  // ネジ
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  for (const [x, y] of [[8, 8], [w - 8, 8], [8, h - 8], [w - 8, h - 8]]) {
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 文字(彫り込み風に影を落とす)
  ctx.textAlign = "center";
  ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
  const label = fitText(ctx, opts.name, w - 26);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillText(label, w / 2 + 1, h / 2 + 1);
  ctx.fillStyle = "#f4e6cf";
  ctx.fillText(label, w / 2, h / 2);
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(244,230,207,0.75)";
  ctx.fillText(`標高 ${opts.altitude}m ・ ${opts.grade}`, w / 2, h / 2 + 16);
  if (opts.summited) {
    ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = A();
    ctx.fillText("登頂", w / 2, h / 2 - 16);
  }
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

// ============================================================
// 山行記録のグラフ(直近N日の獲得標高)
// ============================================================
export function paintClimbLog(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  entries: { date: string; meters: number }[],
  label: string
) {
  refreshPalette();
  ctx.clearRect(0, 0, w, h);
  const padT = 18, padB = 16, padL = 6, padR = 6;
  const gh = h - padT - padB;
  const max = Math.max(100, ...entries.map((e) => e.meters));
  const bw = (w - padL - padR) / Math.max(1, entries.length);
  // 稜線のように塗る
  ctx.beginPath();
  ctx.moveTo(padL, h - padB);
  entries.forEach((e, i) => {
    const x = padL + bw * (i + 0.5);
    const y = padT + gh * (1 - e.meters / max);
    i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(w - padR, h - padB);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, padT, 0, h - padB);
  g.addColorStop(0, A(0.45));
  g.addColorStop(1, A(0.05));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = A();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  entries.forEach((e, i) => {
    const x = padL + bw * (i + 0.5);
    const y = padT + gh * (1 - e.meters / max);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = C(0.5);
  ctx.textAlign = "left";
  ctx.fillText(label, padL, 12);
  ctx.textAlign = "right";
  ctx.fillText(`最高 ${max}m`, w - padR, 12);
}

// ------------------------------------------------------------
// 色のユーティリティ
// ------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bb = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${bb})`;
}

function hexWithAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
