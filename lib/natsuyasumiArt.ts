import type { Phase, Species, Weather } from "./natsuyasumi";

// ぼくのなつやすみ風モードの図版。
//
// 原作の画面は、株式会社草薙が描いた「絵」としての背景が主役で、
// 朝・昼・夕方・夜で同じ場所の絵が描き替わっていく。カメラは動かず、
// ただそこにある風景を眺める時間そのものがゲームになっている。
//
// ここでも同じ考え方で、遠景(空・入道雲・山)→中景(森・田んぼ・電線)→
// 近景(あぜ道・縁側・ひまわり)を、空気遠近を掛けながら重ねて一枚の絵にする。
// 外部画像は一切持ち込まない(オフライン動作・容量・権利のため)のは他モードと同じ。

export type Rgb = [number, number, number];

function rgb(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

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

// ============================================================
// 時間帯ごとの光
// ============================================================
// 原作でいちばん印象に残るのは、同じ風景の色が時間で変わっていくところ。
// 空の3色と、地上に回る光の色・明るさを時間帯ごとに持っておく。

interface Light {
  skyTop: Rgb;
  skyMid: Rgb;
  skyLow: Rgb;
  /** 地上に回る光の色。草や屋根のハイライトに混ぜる */
  warm: Rgb;
  /** 全体の明るさ。遠景を沈める量に効く */
  level: number;
  /** 太陽(または月)の位置。0=左, 1=右 */
  sunX: number;
  sunY: number;
  isNight: boolean;
}

const LIGHT: Record<Phase, Light> = {
  // 夜明け前。まだ紺色が残っている
  late: { skyTop: [16, 22, 52], skyMid: [38, 46, 88], skyLow: [86, 84, 120], warm: [140, 150, 200], level: 0.32, sunX: 0.5, sunY: 1.4, isNight: true },
  // 朝。空が白み、光は低く長い
  dawn: { skyTop: [96, 148, 206], skyMid: [186, 208, 232], skyLow: [252, 224, 186], warm: [255, 224, 176], level: 0.82, sunX: 0.14, sunY: 0.76, isNight: false },
  morning: { skyTop: [58, 140, 214], skyMid: [138, 198, 236], skyLow: [214, 238, 246], warm: [255, 246, 216], level: 0.96, sunX: 0.26, sunY: 0.34, isNight: false },
  // 真昼。空がいちばん濃く、影が短い
  noon: { skyTop: [30, 118, 206], skyMid: [110, 186, 234], skyLow: [206, 234, 246], warm: [255, 252, 232], level: 1, sunX: 0.5, sunY: 0.16, isNight: false },
  // 夕方。オレンジから紫へ。原作でもっとも有名な時間帯
  evening: { skyTop: [92, 76, 142], skyMid: [232, 128, 88], skyLow: [252, 208, 140], warm: [255, 186, 120], level: 0.74, sunX: 0.82, sunY: 0.68, isNight: false },
  // 夜。星と天の川、そしてホタル
  night: { skyTop: [10, 16, 44], skyMid: [24, 34, 74], skyLow: [52, 60, 104], warm: [178, 198, 240], level: 0.36, sunX: 0.74, sunY: 0.24, isNight: true },
};

export interface SceneryOptions {
  width: number;
  height: number;
  phase: Phase;
  weather: Weather;
  /** 咲いている花の数。ひまわりの本数に出る */
  blooms: number;
  /** 0〜1。つるの伸び具合。縁側の朝顔の高さに出る */
  growth: number;
  /** 本日つかまえた虫の数。飛んでいる虫の数に出る */
  caught: number;
  seed: string;
}

export function sceneryHeight(width: number): number {
  return Math.round(Math.max(200, Math.min(300, width * 0.66)));
}

export function paintScenery(ctx: CanvasRenderingContext2D, o: SceneryOptions) {
  const { width: w, height: h } = o;
  const L = LIGHT[o.phase];
  const rng = makeRng(`scene:${o.seed}`);
  const horizon = h * 0.56;
  const rain = o.weather === "shower";
  const cloudy = o.weather === "cloudy" || rain;

  ctx.clearRect(0, 0, w, h);

  // ---------------- 空 ----------------
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, rgb(L.skyTop));
  sky.addColorStop(0.58, rgb(cloudy ? mix(L.skyMid, [150, 150, 158], 0.42) : L.skyMid));
  sky.addColorStop(1, rgb(cloudy ? mix(L.skyLow, [176, 176, 182], 0.4) : L.skyLow));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);

  // 夜は星と天の川
  if (L.isNight) {
    // 天の川。斜めに薄く流す
    ctx.save();
    ctx.translate(w * 0.5, horizon * 0.42);
    ctx.rotate(-0.42);
    const mw = ctx.createLinearGradient(0, -26, 0, 26);
    mw.addColorStop(0, "rgba(200,214,255,0)");
    mw.addColorStop(0.5, "rgba(214,224,255,0.13)");
    mw.addColorStop(1, "rgba(200,214,255,0)");
    ctx.fillStyle = mw;
    ctx.fillRect(-w, -26, w * 2, 52);
    ctx.restore();
    for (let i = 0; i < 130; i++) {
      const x = rng() * w;
      const y = rng() * horizon * 0.92;
      const a = 0.2 + rng() * 0.75;
      ctx.fillStyle = `rgba(232,240,255,${a})`;
      const r = rng() < 0.1 ? 1.3 : 0.75;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 月
    const mx = w * L.sunX;
    const my = horizon * L.sunY;
    const halo = ctx.createRadialGradient(mx, my, 2, mx, my, h * 0.24);
    halo.addColorStop(0, "rgba(236,242,255,0.3)");
    halo.addColorStop(1, "rgba(236,242,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = "rgba(246,248,255,0.96)";
    ctx.beginPath();
    ctx.arc(mx, my, 11, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 太陽と、そのまわりのにじみ
    const sx = w * L.sunX;
    const sy = horizon * L.sunY;
    const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, h * 0.42);
    glow.addColorStop(0, rgba(L.warm, o.phase === "evening" ? 0.75 : 0.5));
    glow.addColorStop(1, rgba(L.warm, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, horizon + h * 0.1);
    if (!cloudy) {
      ctx.fillStyle = rgba(L.warm, 0.95);
      ctx.beginPath();
      ctx.arc(sx, sy, o.phase === "evening" ? 16 : 13, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------------- 入道雲 ----------------
  // このシリーズの象徴。もこもこした輪郭を、円を重ねて作る
  if (!L.isNight) {
    // 先に遠くの薄い雲。入道雲より奥に置かないと、横に伸びた雲が積乱雲を切ってしまう
    ctx.fillStyle = `rgba(255,255,255,${cloudy ? 0.34 : 0.45})`;
    for (let i = 0; i < 4; i++) {
      const cx = rng() * w;
      const cy = horizon * (0.1 + rng() * 0.22);
      const cw = w * (0.06 + rng() * 0.08);
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, cw * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const towerX = w * (0.26 + rng() * 0.1);
    const baseY = horizon - h * 0.02;
    const towerH = h * (rain ? 0.6 : 0.54);
    const lit = mix([255, 255, 255], L.warm, o.phase === "evening" ? 0.55 : 0.16);
    const shade = mix(lit, cloudy ? [126, 128, 140] : [186, 196, 212], rain ? 0.6 : 0.4);
    // 影の側を先に置き、上から明るい側を重ねると立体に見える
    for (const [pass, color, dx] of [
      [0, shade, 6],
      [1, lit, -3],
    ] as const) {
      ctx.fillStyle = rgb(color as Rgb);
      const r2 = makeRng(`cloud:${o.seed}:${pass}`);
      ctx.beginPath();
      for (let i = 0; i < 30; i++) {
        const t = i / 29;
        // 下ほど広く、上ほど細い。実際の積乱雲の形に寄せる
        const spread = Math.pow(1 - t, 1.5) * w * 0.24 + w * 0.03;
        const cx = towerX + dx + (r2() - 0.5) * spread * 1.5;
        const cy = baseY - t * towerH - r2() * 8;
        const rr = (1 - t * 0.42) * (11 + r2() * 15);
        ctx.moveTo(cx + rr, cy);
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  // ---------------- 遠景の山 ----------------
  // 2枚重ね。奥ほど空の色に近づけて、距離を出す
  for (const [depth, top] of [
    [0.82, horizon - h * 0.17],
    [0.5, horizon - h * 0.1],
  ] as const) {
    const base: Rgb = L.isNight ? [22, 34, 46] : [58, 96, 68];
    ctx.fillStyle = rgb(mix(base, L.skyLow, depth * (L.isNight ? 0.5 : 0.62)));
    ctx.beginPath();
    ctx.moveTo(-2, horizon + 2);
    const r3 = makeRng(`mt:${o.seed}:${depth}`);
    let x = -2;
    ctx.lineTo(x, top + r3() * 10);
    while (x < w + 2) {
      const step = w * (0.1 + r3() * 0.14);
      const peak = top + (r3() - 0.5) * h * 0.07;
      ctx.quadraticCurveTo(x + step * 0.5, peak - h * 0.03, x + step, peak);
      x += step;
    }
    ctx.lineTo(w + 2, horizon + 2);
    ctx.closePath();
    ctx.fill();
  }

  // ---------------- 森 ----------------
  const forest: Rgb = L.isNight ? [14, 26, 30] : mix([44, 92, 54], L.warm, 0.1);
  ctx.fillStyle = rgb(forest);
  ctx.beginPath();
  ctx.moveTo(-2, horizon + 4);
  const r4 = makeRng(`forest:${o.seed}`);
  for (let x = -2; x < w + 12; x += 9) {
    ctx.lineTo(x, horizon - 4 - r4() * h * 0.045);
  }
  ctx.lineTo(w + 2, horizon + 4);
  ctx.closePath();
  ctx.fill();

  // ---------------- 田んぼ ----------------
  // 手前ほど広い台形の帯を重ねる。水面が空を映すので、奥の列は空の色を混ぜる
  const paddyTop = horizon;
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows;
    const t1 = (i + 1) / rows;
    const y0 = paddyTop + (h - paddyTop) * t0 * t0;
    const y1 = paddyTop + (h - paddyTop) * t1 * t1;
    const green: Rgb = L.isNight ? [18, 34, 34] : [96, 162, 74];
    const c = mix(mix(green, L.warm, 0.18 * (1 - t0)), L.skyLow, (1 - t0) * 0.42);
    ctx.fillStyle = rgb(i % 2 === 0 ? c : mix(c, [0, 0, 0], 0.08));
    ctx.beginPath();
    ctx.moveTo(w * (0.5 - (0.5 + t0 * 1.6) * 0.5), y0);
    ctx.lineTo(w * (0.5 + (0.5 + t0 * 1.6) * 0.5), y0);
    ctx.lineTo(w * (0.5 + (0.5 + t1 * 1.6) * 0.5), y1);
    ctx.lineTo(w * (0.5 - (0.5 + t1 * 1.6) * 0.5), y1);
    ctx.closePath();
    ctx.fill();
    // あぜ道の白い線
    ctx.strokeStyle = rgba(mix([214, 200, 168], L.warm, 0.3), L.isNight ? 0.12 : 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * (0.5 - (0.5 + t0 * 1.6) * 0.5), y0);
    ctx.lineTo(w * (0.5 + (0.5 + t0 * 1.6) * 0.5), y0);
    ctx.stroke();
  }
  // あぜ道の縦線。消失点(地平線の中央)へ収束させると、帯だけの平面が一気に奥行きを持つ
  const vx = w * 0.5;
  ctx.strokeStyle = rgba(mix([222, 208, 172], L.warm, 0.3), L.isNight ? 0.14 : 0.34);
  ctx.lineWidth = 1;
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    ctx.beginPath();
    ctx.moveTo(vx + i * w * 0.045, paddyTop);
    ctx.lineTo(vx + i * w * 0.42, h);
    ctx.stroke();
  }
  // 手前に一本だけ、幅のあるあぜ道を通す。ここを歩いて帰る道
  ctx.fillStyle = rgba(mix([226, 210, 172], L.warm, 0.34), L.isNight ? 0.2 : 0.62);
  ctx.beginPath();
  ctx.moveTo(vx - w * 0.012, paddyTop);
  ctx.lineTo(vx + w * 0.012, paddyTop);
  ctx.lineTo(vx + w * 0.14, h);
  ctx.lineTo(vx - w * 0.1, h);
  ctx.closePath();
  ctx.fill();

  // 稲の穂。手前の列だけ、細かい縦線で表情を付ける
  ctx.strokeStyle = rgba(L.isNight ? [26, 48, 44] : [70, 128, 56], 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 160; i++) {
    const t = 0.55 + rng() * 0.45;
    const y = paddyTop + (h - paddyTop) * t * t;
    const x = w * (0.5 + (rng() - 0.5) * (0.5 + t * 1.6));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 3, y - 3 - rng() * 5);
    ctx.stroke();
  }

  // ---------------- 電柱と電線 ----------------
  // 田舎の風景を一気に「そこ」にする小道具
  const poleColor = rgba(L.isNight ? [16, 20, 28] : [72, 66, 60], L.isNight ? 0.9 : 0.68);
  const poles = [
    { x: w * 0.12, y: horizon - h * 0.005, hh: h * 0.2 },
    { x: w * 0.42, y: horizon - h * 0.012, hh: h * 0.13 },
    { x: w * 0.62, y: horizon - h * 0.016, hh: h * 0.09 },
  ];
  ctx.strokeStyle = poleColor;
  for (const p of poles) {
    ctx.lineWidth = Math.max(1.2, p.hh * 0.035);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x, p.y - p.hh);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, p.hh * 0.022);
    ctx.beginPath();
    ctx.moveTo(p.x - p.hh * 0.12, p.y - p.hh * 0.86);
    ctx.lineTo(p.x + p.hh * 0.12, p.y - p.hh * 0.86);
    ctx.stroke();
  }
  // 電線。たわませる
  ctx.lineWidth = 1;
  for (let k = 0; k < 2; k++) {
    ctx.beginPath();
    for (let i = 0; i < poles.length - 1; i++) {
      const a = poles[i];
      const b = poles[i + 1];
      const ay = a.y - a.hh * (0.86 - k * 0.08);
      const by = b.y - b.hh * (0.86 - k * 0.08);
      ctx.moveTo(a.x, ay);
      ctx.quadraticCurveTo((a.x + b.x) / 2, Math.max(ay, by) + 8, b.x, by);
    }
    ctx.stroke();
  }

  // ---------------- 縁側のある家 ----------------
  // 右手前。原作でいちばん帰ってくる場所
  const houseW = w * 0.32;
  const houseH = h * 0.23;
  const hx = w - houseW * 0.94;
  const hy = h - houseH * 1.02;
  // 屋根
  ctx.fillStyle = rgb(mix(L.isNight ? [24, 26, 34] : [78, 74, 82], L.warm, L.isNight ? 0.05 : 0.16));
  ctx.beginPath();
  ctx.moveTo(hx - houseW * 0.14, hy);
  ctx.lineTo(hx + houseW, hy - houseH * 0.3);
  ctx.lineTo(hx + houseW, hy - houseH * 0.12);
  ctx.lineTo(hx - houseW * 0.2, hy + houseH * 0.13);
  ctx.closePath();
  ctx.fill();
  // 壁と障子
  ctx.fillStyle = rgb(mix(L.isNight ? [30, 30, 38] : [232, 222, 200], L.warm, 0.2));
  ctx.fillRect(hx, hy + houseH * 0.06, houseW, houseH * 0.7);
  // 障子の桟。夜は中から灯りが漏れる
  const shoji: Rgb = L.isNight ? [255, 216, 140] : [250, 246, 234];
  ctx.fillStyle = rgba(shoji, L.isNight ? 0.9 : 0.85);
  ctx.fillRect(hx + houseW * 0.08, hy + houseH * 0.14, houseW * 0.76, houseH * 0.42);
  ctx.strokeStyle = rgba(L.isNight ? [120, 80, 30] : [140, 126, 100], 0.55);
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = hx + houseW * 0.08 + (houseW * 0.76 * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, hy + houseH * 0.14);
    ctx.lineTo(x, hy + houseH * 0.56);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(hx + houseW * 0.08, hy + houseH * 0.35);
  ctx.lineTo(hx + houseW * 0.84, hy + houseH * 0.35);
  ctx.stroke();
  // 縁側の板張り
  ctx.fillStyle = rgb(mix(L.isNight ? [40, 32, 26] : [166, 126, 82], L.warm, 0.2));
  ctx.fillRect(hx - houseW * 0.06, hy + houseH * 0.76, houseW * 1.06, houseH * 0.12);
  // 夜は家から漏れる光を地面に落とす
  if (L.isNight) {
    const spill = ctx.createRadialGradient(hx + houseW * 0.46, hy + houseH * 0.5, 4, hx + houseW * 0.46, hy + houseH * 0.5, houseW);
    spill.addColorStop(0, "rgba(255,214,140,0.22)");
    spill.addColorStop(1, "rgba(255,214,140,0)");
    ctx.fillStyle = spill;
    ctx.fillRect(hx - houseW, hy - houseH, houseW * 3, houseH * 3);
  }

  // ---------------- 縁側の朝顔 ----------------
  // 実働時間で伸びるつる。0なら何も出ない
  if (o.growth > 0.02) {
    paintVine(ctx, {
      x: hx - houseW * 0.16,
      baseY: hy + houseH * 0.86,
      height: houseH * 1.5 * o.growth,
      blooms: o.blooms,
      seed: `vine:${o.seed}`,
      night: L.isNight,
      warm: L.warm,
    });
  }

  // ---------------- 手前のひまわり ----------------
  // 完了した数だけ咲く。左手前に、大きさを変えて並べる
  const sunflowers = Math.min(5, o.blooms);
  for (let i = 0; i < sunflowers; i++) {
    const sx = w * (0.05 + i * 0.085) + (rng() - 0.5) * 6;
    const sh = h * (0.2 + rng() * 0.1);
    paintSunflower(ctx, { x: sx, baseY: h + 4, height: sh, night: L.isNight, warm: L.warm, seed: `sf${i}` });
  }

  // ---------------- 飛んでいるもの ----------------
  if (L.isNight) {
    // ホタル。つかまえた数だけ灯る
    const fireflies = Math.min(14, 3 + o.caught * 2);
    for (let i = 0; i < fireflies; i++) {
      const fx = rng() * w;
      const fy = horizon + rng() * (h - horizon) * 0.85;
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 7);
      g.addColorStop(0, "rgba(214,255,160,0.95)");
      g.addColorStop(1, "rgba(180,255,120,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx, fy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (!rain) {
    // トンボとチョウの影。数はつかまえた虫の数
    const flyers = Math.min(6, 1 + o.caught);
    for (let i = 0; i < flyers; i++) {
      const fx = w * (0.1 + rng() * 0.8);
      const fy = horizon - h * 0.02 - rng() * h * 0.2;
      ctx.strokeStyle = rgba(L.isNight ? [200, 210, 240] : [60, 60, 70], 0.4);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(fx - 4, fy - 2);
      ctx.quadraticCurveTo(fx, fy + 1, fx + 4, fy - 2);
      ctx.stroke();
    }
  }

  // ---------------- 夕立 ----------------
  if (rain) {
    ctx.strokeStyle = "rgba(206,222,236,0.4)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const x = rng() * w;
      const y = rng() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 2.5, y + 11);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(120,132,148,0.12)";
    ctx.fillRect(0, 0, w, h);
  }

  // ---------------- 仕上げ ----------------
  // 絵の具のにじみ。水彩らしさは、この弱い斑と四隅の落ちで出す
  const grain = ctx.getImageData(0, 0, Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h)));
  const d = grain.data;
  const gr = makeRng(`grain:${o.seed}`);
  for (let i = 0; i < d.length; i += 4) {
    const n = (gr() - 0.5) * 9;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(grain, 0, 0);

  const vg = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.34, w / 2, h * 0.52, Math.max(w, h) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, L.isNight ? "rgba(4,8,20,0.34)" : "rgba(60,44,20,0.2)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ---- 朝顔のつる ----
function paintVine(
  ctx: CanvasRenderingContext2D,
  o: { x: number; baseY: number; height: number; blooms: number; seed: string; night: boolean; warm: Rgb }
) {
  const rng = makeRng(o.seed);
  const leaf: Rgb = o.night ? [26, 48, 40] : [72, 138, 66];
  // 支柱
  ctx.strokeStyle = rgba(o.night ? [40, 36, 30] : [176, 152, 106], 0.8);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(o.x, o.baseY);
  ctx.lineTo(o.x, o.baseY - o.height);
  ctx.stroke();
  // つる。支柱に巻きつける
  ctx.strokeStyle = rgb(leaf);
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  const turns = Math.max(2, Math.round(o.height / 12));
  for (let i = 0; i <= turns * 8; i++) {
    const t = i / (turns * 8);
    const y = o.baseY - o.height * t;
    const x = o.x + Math.sin(t * turns * Math.PI * 2) * 5;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  // 葉
  ctx.fillStyle = rgb(mix(leaf, o.warm, 0.12));
  for (let i = 0; i < turns; i++) {
    const t = (i + 0.5) / turns;
    const y = o.baseY - o.height * t;
    const side = i % 2 === 0 ? -1 : 1;
    ctx.beginPath();
    ctx.ellipse(o.x + side * 8, y, 6.4, 4.4, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // 花。完了した数だけ咲く
  for (let i = 0; i < o.blooms; i++) {
    const t = 0.35 + (i / Math.max(1, o.blooms)) * 0.6;
    const y = o.baseY - o.height * t;
    const side = i % 2 === 0 ? 1 : -1;
    const cx = o.x + side * 8 + (rng() - 0.5) * 3;
    const petal: Rgb = o.night ? [122, 108, 176] : [138, 116, 206];
    ctx.fillStyle = rgb(mix(petal, o.warm, o.night ? 0.1 : 0.16));
    ctx.beginPath();
    ctx.arc(cx, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(cx, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- ひまわり ----
function paintSunflower(
  ctx: CanvasRenderingContext2D,
  o: { x: number; baseY: number; height: number; night: boolean; warm: Rgb; seed: string }
) {
  const stem: Rgb = o.night ? [22, 42, 34] : [68, 126, 58];
  const top = o.baseY - o.height;
  ctx.strokeStyle = rgb(stem);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(o.x, o.baseY);
  ctx.quadraticCurveTo(o.x + 3, o.baseY - o.height * 0.5, o.x, top);
  ctx.stroke();
  // 葉
  ctx.fillStyle = rgb(stem);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(o.x + s * 8, o.baseY - o.height * (s < 0 ? 0.42 : 0.6), 9, 4.6, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 花びら
  const petal: Rgb = o.night ? [128, 106, 46] : [244, 190, 46];
  ctx.fillStyle = rgb(mix(petal, o.warm, o.night ? 0.06 : 0.18));
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12;
    ctx.beginPath();
    ctx.ellipse(o.x + Math.cos(a) * 9, top + Math.sin(a) * 9, 5.4, 2.9, a, 0, Math.PI * 2);
    ctx.fill();
  }
  // 花芯
  ctx.fillStyle = rgb(o.night ? [58, 44, 26] : [104, 68, 32]);
  ctx.beginPath();
  ctx.arc(o.x, top, 5.6, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================
// ラジオ体操カード
// ============================================================
// 首から下げる厚紙のカード。マス目に朱肉の判子が押される。

export function stampCardHeight(): number {
  return 92;
}

export function paintStampCard(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; stamps: boolean[]; title: string; seed: string }
) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);
  const rng = makeRng(`card:${o.seed}`);

  // 厚紙
  const paper = ctx.createLinearGradient(0, 0, 0, h);
  paper.addColorStop(0, "rgb(250,244,226)");
  paper.addColorStop(1, "rgb(238,228,202)");
  ctx.fillStyle = paper;
  roundRect(ctx, 1, 1, w - 2, h - 2, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(122,102,66,0.45)";
  ctx.lineWidth = 1;
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, 6);
  ctx.stroke();
  // 紙の斑
  for (let i = 0; i < w * h * 0.02; i++) {
    ctx.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.5)" : "rgba(120,96,54,0.045)";
    ctx.fillRect(rng() * w, rng() * h, 1, 1);
  }
  // 綴じ穴
  ctx.fillStyle = "rgba(120,100,64,0.35)";
  ctx.beginPath();
  ctx.arc(13, 13, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // 見出し
  ctx.fillStyle = "rgba(86,66,38,0.85)";
  ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(o.title, 24, 9);

  // マス目
  const n = o.stamps.length;
  const padX = 12;
  const cellW = (w - padX * 2) / n;
  const top = 32;
  const cellH = h - top - 12;
  for (let i = 0; i < n; i++) {
    const x = padX + cellW * i;
    ctx.strokeStyle = "rgba(122,102,66,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, top, cellW - 2, cellH);
    ctx.fillStyle = "rgba(122,102,66,0.35)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(String(i + 1), x + cellW / 2, top + 2);

    if (o.stamps[i]) {
      // 朱の判子。わずかにずらして押すと、機械的に見えない
      const cx = x + cellW / 2 + (rng() - 0.5) * 3;
      const cy = top + cellH * 0.58 + (rng() - 0.5) * 3;
      const r = Math.min(cellW, cellH) * 0.3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rng() - 0.5) * 0.5);
      ctx.strokeStyle = "rgba(198,58,42,0.82)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(198,58,42,0.78)";
      ctx.font = `bold ${Math.round(r * 1.25)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("済", 0, 0.5);
      ctx.restore();
    }
  }
}

// ============================================================
// 虫
// ============================================================
// 虫かごに並べる1匹。種類ごとに輪郭を描き分け、大きさは想定時間から決まる。

export function paintInsect(
  ctx: CanvasRenderingContext2D,
  o: { size: number; species: Species; scale: number; rarity: number; dim: boolean }
) {
  const s = o.size;
  ctx.clearRect(0, 0, s, s);
  const alpha = o.dim ? 0.35 : 1;

  // めずらしいものほど、背景の光を強くする
  const glow = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s * 0.5);
  const heat = [0.05, 0.1, 0.18, 0.28][o.rarity] ?? 0.05;
  glow.addColorStop(0, `rgba(244,196,72,${heat * alpha})`);
  glow.addColorStop(1, "rgba(244,196,72,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, s, s);

  ctx.save();
  ctx.translate(s / 2, s / 2);
  const k = (0.42 + o.scale * 0.5) * s * 0.5; // 体の基準半径
  ctx.globalAlpha = alpha;

  const shell = (base: Rgb, hi: Rgb) => {
    const g = ctx.createLinearGradient(-k, -k, k * 0.6, k);
    g.addColorStop(0, rgb(hi));
    g.addColorStop(0.55, rgb(base));
    g.addColorStop(1, rgb(mix(base, [0, 0, 0], 0.35)));
    return g;
  };

  switch (o.species) {
    case "kabuto": {
      // カブトムシ。角と光沢のある背中
      ctx.fillStyle = shell([88, 52, 30], [172, 118, 66]);
      ctx.beginPath();
      ctx.ellipse(0, k * 0.2, k * 0.62, k * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb([64, 38, 22]);
      ctx.beginPath();
      ctx.ellipse(0, -k * 0.62, k * 0.4, k * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      // 角
      ctx.strokeStyle = rgb([72, 42, 24]);
      ctx.lineWidth = k * 0.17;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.78);
      ctx.quadraticCurveTo(k * 0.1, -k * 1.32, -k * 0.16, -k * 1.5);
      ctx.stroke();
      ctx.lineWidth = k * 0.1;
      ctx.beginPath();
      ctx.moveTo(-k * 0.1, -k * 1.34);
      ctx.lineTo(-k * 0.42, -k * 1.44);
      ctx.stroke();
      // 背の筋
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.32);
      ctx.lineTo(0, k * 0.98);
      ctx.stroke();
      break;
    }
    case "kuwagata": {
      // クワガタ。大あごが左右に開く
      ctx.fillStyle = shell([54, 38, 28], [128, 98, 66]);
      ctx.beginPath();
      ctx.ellipse(0, k * 0.24, k * 0.55, k * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb([40, 28, 20]);
      ctx.beginPath();
      ctx.ellipse(0, -k * 0.6, k * 0.36, k * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgb([44, 30, 20]);
      ctx.lineWidth = k * 0.14;
      ctx.lineCap = "round";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(side * k * 0.24, -k * 0.76);
        ctx.quadraticCurveTo(side * k * 0.62, -k * 1.3, side * k * 0.16, -k * 1.5);
        ctx.stroke();
      }
      break;
    }
    case "semi": {
      // セミ。透けた羽が体より大きい
      ctx.fillStyle = "rgba(220,232,238,0.6)";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * k * 0.42, k * 0.1, k * 0.32, k * 0.82, side * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(120,140,150,0.6)";
      ctx.lineWidth = 0.8;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * k * 0.42, k * 0.1, k * 0.32, k * 0.82, side * 0.28, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = shell([56, 62, 54], [116, 124, 108]);
      ctx.beginPath();
      ctx.ellipse(0, k * 0.1, k * 0.26, k * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb([38, 44, 38]);
      ctx.beginPath();
      ctx.ellipse(0, -k * 0.62, k * 0.3, k * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tonbo": {
      // トンボ。細長い体と4枚の羽
      ctx.strokeStyle = "rgba(200,216,226,0.85)";
      ctx.fillStyle = "rgba(214,230,238,0.5)";
      for (const side of [-1, 1]) {
        for (const dy of [-0.12, 0.16]) {
          ctx.beginPath();
          ctx.ellipse(side * k * 0.6, k * dy, k * 0.62, k * 0.17, side * 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
      ctx.fillStyle = shell([180, 66, 48], [230, 128, 96]);
      ctx.beginPath();
      roundRect(ctx, -k * 0.11, -k * 0.5, k * 0.22, k * 1.5, k * 0.11);
      ctx.fill();
      ctx.fillStyle = rgb([54, 48, 44]);
      ctx.beginPath();
      ctx.arc(0, -k * 0.62, k * 0.24, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "chou": {
      // チョウ。4枚の羽に模様
      const wing: Rgb = [238, 196, 92];
      for (const side of [-1, 1]) {
        ctx.fillStyle = rgb(mix(wing, [255, 255, 255], 0.15));
        ctx.beginPath();
        ctx.ellipse(side * k * 0.5, -k * 0.28, k * 0.5, k * 0.42, side * 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgb(mix(wing, [0, 0, 0], 0.14));
        ctx.beginPath();
        ctx.ellipse(side * k * 0.42, k * 0.42, k * 0.38, k * 0.34, side * -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(60,44,30,0.5)";
        ctx.beginPath();
        ctx.arc(side * k * 0.6, -k * 0.32, k * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgb([62, 50, 40]);
      ctx.beginPath();
      ctx.ellipse(0, 0, k * 0.08, k * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgb([62, 50, 40]);
      ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -k * 0.56);
        ctx.quadraticCurveTo(side * k * 0.2, -k * 0.9, side * k * 0.34, -k * 0.82);
        ctx.stroke();
      }
      break;
    }
    case "batta": {
      // バッタ。後ろ脚が跳ねる形
      ctx.fillStyle = shell([98, 148, 62], [166, 200, 108]);
      ctx.beginPath();
      ctx.ellipse(0, k * 0.1, k * 0.3, k * 0.76, -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb([76, 120, 50]);
      ctx.beginPath();
      ctx.ellipse(k * 0.06, -k * 0.6, k * 0.26, k * 0.22, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgb([76, 120, 50]);
      ctx.lineWidth = k * 0.13;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-k * 0.16, k * 0.2);
      ctx.lineTo(-k * 0.66, -k * 0.16);
      ctx.lineTo(-k * 0.5, k * 0.72);
      ctx.stroke();
      break;
    }
    case "tentou": {
      // テントウムシ。丸くて点がある
      ctx.fillStyle = shell([206, 58, 46], [244, 132, 110]);
      ctx.beginPath();
      ctx.arc(0, k * 0.12, k * 0.66, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb([38, 30, 28]);
      ctx.beginPath();
      ctx.arc(0, -k * 0.5, k * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -k * 0.44);
      ctx.lineTo(0, k * 0.76);
      ctx.stroke();
      ctx.fillStyle = "rgba(30,24,22,0.9)";
      for (const [dx, dy] of [
        [-0.3, 0.0],
        [0.3, 0.0],
        [-0.22, 0.42],
        [0.22, 0.42],
      ] as const) {
        ctx.beginPath();
        ctx.arc(dx * k, k * 0.12 + dy * k, k * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    default: {
      // コガネムシ。金属質の背中
      ctx.fillStyle = shell([64, 128, 78], [150, 210, 140]);
      ctx.beginPath();
      ctx.ellipse(0, k * 0.14, k * 0.56, k * 0.76, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb([44, 92, 56]);
      ctx.beginPath();
      ctx.ellipse(0, -k * 0.56, k * 0.34, k * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(-k * 0.2, -k * 0.06, k * 0.32, Math.PI * 0.9, Math.PI * 1.5);
      ctx.stroke();
      break;
    }
  }

  // 脚。どの虫にも共通で3対
  ctx.strokeStyle = "rgba(40,32,26,0.7)";
  ctx.lineWidth = Math.max(1, k * 0.07);
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    for (const dy of [-0.3, 0.06, 0.42]) {
      ctx.beginPath();
      ctx.moveTo(side * k * 0.35, k * dy);
      ctx.lineTo(side * k * 0.78, k * (dy - 0.16));
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ============================================================
// 絵日記の絵
// ============================================================
// クレヨンで塗ったような、輪郭のゆらいだ一枚。
// 描かれるのは「今日いちばん時間を使った作業」の情景で、
// 種はその作業名なので、同じ作業なら毎回同じ絵になる。

export function diaryPictureHeight(width: number): number {
  return Math.round(Math.max(110, Math.min(170, width * 0.52)));
}

export function paintDiaryPicture(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; seed: string; phase: Phase; weather: Weather; blooms: number }
) {
  const { width: w, height: h } = o;
  const rng = makeRng(`diary:${o.seed}`);
  const L = LIGHT[o.phase];
  ctx.clearRect(0, 0, w, h);

  // 画用紙
  ctx.fillStyle = "rgb(252,248,238)";
  ctx.fillRect(0, 0, w, h);

  // クレヨンで塗った空。塗りムラを線の重ねで出す
  const skyH = h * 0.56;
  const skyC = L.isNight ? ([44, 62, 152] as Rgb) : o.phase === "evening" ? ([242, 158, 96] as Rgb) : ([132, 196, 236] as Rgb);
  const skyA = L.isNight ? 0.2 : 0.1;
  ctx.lineCap = "round";
  ctx.lineWidth = 4;
  for (let i = 0; i < 90; i++) {
    const y = rng() * skyH;
    const x0 = rng() * w;
    ctx.strokeStyle = rgba(skyC, skyA + rng() * 0.2);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + 12 + rng() * 34, y + (rng() - 0.5) * 3);
    ctx.stroke();
  }
  // 地面
  const groundC: Rgb = L.isNight ? [34, 78, 56] : [128, 186, 96];
  for (let i = 0; i < 70; i++) {
    const y = skyH + rng() * (h - skyH);
    const x0 = rng() * w;
    ctx.strokeStyle = rgba(groundC, (L.isNight ? 0.2 : 0.12) + rng() * 0.2);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + 14 + rng() * 30, y + (rng() - 0.5) * 3);
    ctx.stroke();
  }

  // 太陽か月
  ctx.strokeStyle = L.isNight ? "rgba(214,178,52,0.95)" : "rgba(232,132,54,0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(w * 0.8, skyH * 0.34, 15, 0, Math.PI * 2);
  ctx.stroke();

  // 入道雲か雨雲
  // 雲。円を全周描くと数珠つなぎに見えるので、上側の弧だけをつないで輪郭にする
  const cloudX = w * 0.16;
  const cloudY = skyH * 0.4;
  ctx.strokeStyle =
    o.weather === "shower" ? "rgba(110,120,140,0.85)" : L.isNight ? "rgba(150,160,190,0.9)" : "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cloudX, cloudY + 10);
  for (let i = 0; i < 5; i++) {
    const cx = cloudX + 8 + i * 15;
    const rr = i === 2 ? 15 : 11;
    ctx.arc(cx, cloudY + 10 - rr * 0.45, rr, Math.PI * 0.95, Math.PI * 2.05);
  }
  ctx.lineTo(cloudX + 78, cloudY + 10);
  ctx.stroke();
  if (o.weather === "shower") {
    ctx.strokeStyle = "rgba(110,140,190,0.8)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const x = w * 0.16 + i * 9;
      ctx.beginPath();
      ctx.moveTo(x, skyH * 0.6);
      ctx.lineTo(x - 3, skyH * 0.6 + 12);
      ctx.stroke();
    }
  }

  // 地平線
  ctx.strokeStyle = "rgba(90,120,70,0.8)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, skyH);
  for (let x = 0; x <= w; x += 12) ctx.lineTo(x, skyH + (rng() - 0.5) * 3);
  ctx.stroke();

  // ひまわり。完了した数だけ
  const n = Math.max(1, Math.min(5, o.blooms || 1));
  for (let i = 0; i < n; i++) {
    const x = w * (0.14 + (i * 0.62) / Math.max(1, n - 1 || 1));
    const top = skyH + 14 + rng() * 10;
    ctx.strokeStyle = "rgba(84,140,60,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, h - 6);
    ctx.lineTo(x + (rng() - 0.5) * 4, top);
    ctx.stroke();
    ctx.strokeStyle = "rgba(236,178,44,0.95)";
    ctx.lineWidth = 3;
    for (let p = 0; p < 8; p++) {
      const a = (Math.PI * 2 * p) / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 4, top + Math.sin(a) * 4);
      ctx.lineTo(x + Math.cos(a) * 11, top + Math.sin(a) * 11);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(120,76,34,0.9)";
    ctx.beginPath();
    ctx.arc(x, top, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 画用紙の縁。紙の四隅がめくれた感じを、内側の細い線で出す
  ctx.strokeStyle = "rgba(140,120,86,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
}

// ============================================================
// 日記の罫線
// ============================================================

export function paintRuledPaper(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; lineHeight: number }
) {
  const { width: w, height: h } = o;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgb(252,249,240)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(122,142,168,0.32)";
  ctx.lineWidth = 1;
  for (let y = o.lineHeight; y < h; y += o.lineHeight) {
    ctx.beginPath();
    ctx.moveTo(10, y + 0.5);
    ctx.lineTo(w - 10, y + 0.5);
    ctx.stroke();
  }
  // 左端の朱線
  ctx.strokeStyle = "rgba(200,90,70,0.35)";
  ctx.beginPath();
  ctx.moveTo(22.5, 0);
  ctx.lineTo(22.5, h);
  ctx.stroke();
}
