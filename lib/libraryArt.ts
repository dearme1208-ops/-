import type { RoomPhase } from "./library";

// 図書館モードの図版をブラウザのCanvasでその場で描く。
//
// このモードだけは明るい紙のテーマなので、他モードの図版(暗い背景に細い光の線)とは
// 逆向きの絵作りになる。羊皮紙の地にセピアのインクで刷った版画、という方向で揃えた。
//
// 外部画像を持ち込まないのは他モードと同じ理由(オフライン動作・容量・権利)。
// 種は作業名なので、同じ本には毎回同じ背表紙が出る。

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

// このモードの4色をまとめて読む。明るいテーマなのでinkが紙、creamが文字の色になる
export interface Palette {
  accent: Rgb;
  ink: Rgb; // 地(羊皮紙)
  cream: Rgb; // 文字・線(濃いセピア)
  panel: Rgb; // カード面
}

export function readPalette(): Palette {
  return {
    accent: readCssRgb("--accent-rgb", [122, 74, 42]),
    ink: readCssRgb("--ink-rgb", [238, 227, 200]),
    cream: readCssRgb("--cream-rgb", [51, 38, 26]),
    panel: readCssRgb("--panel-rgb", [250, 244, 228]),
  };
}

// 紙の風合い。どの図版にも最後にこれを掛けて、印刷物らしいざらつきを出す
function paperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, strength = 10) {
  if (w <= 0 || h <= 0) return;
  const rng = makeRng(`grain:${seed}`);
  const img = ctx.getImageData(0, 0, Math.floor(w), Math.floor(h));
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * strength;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// ============================================================
// 閲覧室(見出しの一枚絵)
// ============================================================
// 時間帯で採光が変わり、借りている冊数だけ机の灯りがともる。
// 実データが絵の中身を決めるのは他モードと同じ考え方

export interface ReadingRoomOptions {
  width: number;
  height: number;
  phase: RoomPhase;
  lampsLit: number; // ともす灯りの数 = 本日借りている冊数
  overdue: number; // 延滞している冊数。多いほど奥が翳る
  palette: Palette;
  seed: string;
}

const PHASE_LIGHT: Record<RoomPhase, { warm: number; strength: number; shaft: number }> = {
  morning: { warm: 0.15, strength: 0.9, shaft: 0.55 },
  day: { warm: 0.05, strength: 1, shaft: 0.4 },
  evening: { warm: 0.5, strength: 0.7, shaft: 0.75 },
  night: { warm: 0.7, strength: 0.28, shaft: 0.1 },
};

export function paintReadingRoom(ctx: CanvasRenderingContext2D, o: ReadingRoomOptions): void {
  const { width: w, height: h, palette: p } = o;
  const rng = makeRng(`room:${o.seed}`);
  const light = PHASE_LIGHT[o.phase];
  const ink = p.cream; // 線の色(濃いセピア)
  const paper = p.ink; // 地(羊皮紙)

  // 地。夜は落として、昼は明るく
  const base = mix(paper, ink, (1 - light.strength) * 0.35);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, rgba(mix(base, p.accent, light.warm * 0.18), 1));
  bg.addColorStop(1, rgba(mix(base, ink, 0.12), 1));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const floorY = h * 0.78;

  // --- 奥のアーチ窓。3連 ---
  const archW = w * 0.17;
  const archTop = h * 0.14;
  const archBottom = floorY - h * 0.06;
  for (let i = 0; i < 3; i++) {
    const cx = w * (0.5 + (i - 1) * 0.26);
    const x = cx - archW / 2;
    ctx.beginPath();
    ctx.moveTo(x, archBottom);
    ctx.lineTo(x, archTop + archW / 2);
    ctx.arc(cx, archTop + archW / 2, archW / 2, Math.PI, 0);
    ctx.lineTo(x + archW, archBottom);
    ctx.closePath();

    const gw = ctx.createLinearGradient(0, archTop, 0, archBottom);
    const glass = mix(paper, [255, 250, 232], light.strength * 0.8);
    gw.addColorStop(0, rgba(mix(glass, p.accent, light.warm * 0.35), 0.2 + light.strength * 0.7));
    gw.addColorStop(1, rgba(mix(glass, ink, 0.25), 0.12 + light.strength * 0.35));
    ctx.fillStyle = gw;
    ctx.fill();
    ctx.strokeStyle = rgba(ink, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();

    // 窓の桟
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, archBottom);
    ctx.lineTo(x, archTop + archW / 2);
    ctx.arc(cx, archTop + archW / 2, archW / 2, Math.PI, 0);
    ctx.lineTo(x + archW, archBottom);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = rgba(ink, 0.35);
    ctx.lineWidth = 1.2;
    for (let k = 1; k < 3; k++) {
      const gx = x + (archW * k) / 3;
      ctx.beginPath();
      ctx.moveTo(gx, archTop);
      ctx.lineTo(gx, archBottom);
      ctx.stroke();
    }
    for (let k = 1; k < 5; k++) {
      const gy = archTop + ((archBottom - archTop) * k) / 5;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.lineTo(x + archW, gy);
      ctx.stroke();
    }
    ctx.restore();

    // 差し込む光の帯
    if (light.shaft > 0.05) {
      ctx.save();
      ctx.globalAlpha = light.shaft * 0.3;
      const shaft = ctx.createLinearGradient(cx, archTop, cx - w * 0.1, floorY + h * 0.1);
      shaft.addColorStop(0, rgba(mix([255, 248, 226], p.accent, light.warm * 0.4), 0.9));
      shaft.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(x, archBottom);
      ctx.lineTo(x + archW, archBottom);
      ctx.lineTo(x + archW - w * 0.05, h);
      ctx.lineTo(x - w * 0.16, h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // --- 左右の高い書架 ---
  for (const side of [-1, 1] as const) {
    const sw = w * 0.2;
    const sx = side < 0 ? 0 : w - sw;
    ctx.fillStyle = rgba(mix(paper, ink, 0.3 + (1 - light.strength) * 0.2), 1);
    ctx.fillRect(sx, h * 0.06, sw, floorY - h * 0.06);
    ctx.strokeStyle = rgba(ink, 0.5);
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, h * 0.06, sw, floorY - h * 0.06);
    // 棚板と、そこに詰まった本
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const ry = h * 0.06 + ((floorY - h * 0.06) * (r + 1)) / rows;
      ctx.beginPath();
      ctx.moveTo(sx, ry);
      ctx.lineTo(sx + sw, ry);
      ctx.strokeStyle = rgba(ink, 0.45);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      let bx = sx + 3;
      while (bx < sx + sw - 5) {
        const bwid = 3 + rng() * 6;
        const bh = ((floorY - h * 0.06) / rows) * (0.55 + rng() * 0.32);
        ctx.fillStyle = rgba(mix(ink, p.accent, rng() * 0.7), 0.22 + rng() * 0.4);
        ctx.fillRect(bx, ry - bh, bwid, bh);
        bx += bwid + 1.2;
      }
    }
  }

  // --- 床 ---
  ctx.fillStyle = rgba(mix(paper, ink, 0.18), 1);
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.strokeStyle = rgba(ink, 0.14);
  ctx.lineWidth = 1;
  for (let i = -6; i < 14; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + (i - 4) * w * 0.06, floorY);
    ctx.lineTo(w * 0.5 + (i - 4) * w * 0.28, h);
    ctx.stroke();
  }

  // --- 閲覧机と灯り。借りている冊数だけ灯る ---
  const desks = 4;
  for (let i = 0; i < desks; i++) {
    const dx = w * (0.2 + i * 0.2);
    const dy = floorY + h * 0.05;
    const dw = w * 0.14;
    const lit = i < o.lampsLit;

    if (lit) {
      const pool = ctx.createRadialGradient(dx, dy - h * 0.02, 0, dx, dy - h * 0.02, dw * 1.1);
      pool.addColorStop(0, rgba(mix([255, 236, 190], p.accent, 0.25), 0.85));
      pool.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = pool;
      ctx.fillRect(dx - dw * 1.2, dy - h * 0.2, dw * 2.4, h * 0.4);
    }

    // 机
    ctx.fillStyle = rgba(mix(paper, ink, lit ? 0.12 : 0.3), 1);
    ctx.fillRect(dx - dw / 2, dy, dw, h * 0.05);
    ctx.strokeStyle = rgba(ink, 0.55);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(dx - dw / 2, dy, dw, h * 0.05);
    // 卓上ランプ
    ctx.beginPath();
    ctx.moveTo(dx + dw * 0.26, dy);
    ctx.lineTo(dx + dw * 0.26, dy - h * 0.055);
    ctx.strokeStyle = rgba(ink, 0.6);
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dx + dw * 0.13, dy - h * 0.055);
    ctx.lineTo(dx + dw * 0.39, dy - h * 0.055);
    ctx.lineTo(dx + dw * 0.32, dy - h * 0.085);
    ctx.lineTo(dx + dw * 0.2, dy - h * 0.085);
    ctx.closePath();
    ctx.fillStyle = lit ? rgba(mix(p.accent, [255, 214, 140], 0.6), 0.95) : rgba(mix(paper, ink, 0.35), 1);
    ctx.fill();
    ctx.strokeStyle = rgba(ink, 0.6);
    ctx.stroke();
  }

  // --- 延滞があるほど、奥が翳る ---
  if (o.overdue > 0) {
    const v = Math.min(0.34, 0.1 + o.overdue * 0.07);
    const vg = ctx.createRadialGradient(w / 2, h * 0.45, w * 0.16, w / 2, h * 0.5, w * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, rgba(mix(ink, p.accent, 0.35), v));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  paperGrain(ctx, w, h, o.seed, 12);
}

// ============================================================
// 書架(本日の作業 = 並んだ背表紙)
// ============================================================

export interface Spine {
  id: string;
  title: string;
  callNumber: string;
  thickness: number; // 0〜1
  wear: number; // 0〜1
  progress: number; // 0〜1超。1超で延滞
  state: "予約" | "閲覧中" | "書見台に伏せて" | "返却済";
  selected: boolean;
}

export interface SpineRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SHELF_H = 156;
const SHELF_PAD = 10;
const SPINE_MIN = 26;
const SPINE_MAX = 58;

export function spineWidth(thickness: number): number {
  return Math.round(SPINE_MIN + (SPINE_MAX - SPINE_MIN) * Math.max(0, Math.min(1, thickness)));
}

// 背表紙の並びを計算する。描画と当たり判定で同じ関数を使うので、
// 見えている本と押せる本が必ず一致する
export function layoutSpines(spines: Spine[], width: number): { rects: SpineRect[]; height: number } {
  const rects: SpineRect[] = [];
  const usable = width - SHELF_PAD * 2;
  let x = SHELF_PAD;
  let row = 0;
  for (const s of spines) {
    const sw = spineWidth(s.thickness);
    if (x + sw > SHELF_PAD + usable && x > SHELF_PAD) {
      row += 1;
      x = SHELF_PAD;
    }
    rects.push({ id: s.id, x, y: SHELF_PAD + row * SHELF_H, w: sw, h: SHELF_H - 22 });
    x += sw + 2;
  }
  const rows = spines.length === 0 ? 1 : row + 1;
  return { rects, height: SHELF_PAD * 2 + rows * SHELF_H };
}

export function shelfHeightFor(spines: Spine[], width: number): number {
  return layoutSpines(spines, width).height;
}

export function paintShelf(
  ctx: CanvasRenderingContext2D,
  o: { spines: Spine[]; width: number; height: number; palette: Palette }
): void {
  const { width: w, height: h, palette: p } = o;
  const ink = p.cream;
  const paper = p.ink;
  ctx.clearRect(0, 0, w, h);

  // 書架の地(木の面)
  ctx.fillStyle = rgba(mix(paper, ink, 0.16), 1);
  ctx.fillRect(0, 0, w, h);
  // 木目
  const grain = makeRng("shelf-grain");
  ctx.strokeStyle = rgba(ink, 0.06);
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = grain() * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + (grain() - 0.5) * 6, w * 0.7, y + (grain() - 0.5) * 6, w, y);
    ctx.stroke();
  }

  const { rects } = layoutSpines(o.spines, w);
  const rows = Math.max(1, Math.round((h - SHELF_PAD * 2) / SHELF_H));

  // 棚板
  for (let r = 0; r < rows; r++) {
    const y = SHELF_PAD + r * SHELF_H + (SHELF_H - 22) + 2;
    ctx.fillStyle = rgba(mix(paper, ink, 0.42), 1);
    ctx.fillRect(0, y, w, 8);
    ctx.fillStyle = rgba(ink, 0.16);
    ctx.fillRect(0, y + 8, w, 3);
  }

  for (let i = 0; i < o.spines.length; i++) {
    const s = o.spines[i];
    const r = rects[i];
    if (!r) continue;
    drawSpine(ctx, s, r, p);
  }

  paperGrain(ctx, w, h, "shelf", 8);
}

function drawSpine(ctx: CanvasRenderingContext2D, s: Spine, r: SpineRect, p: Palette) {
  const rng = makeRng(`spine:${s.title}`);
  const ink = p.cream;
  const paper = p.ink;
  // 背表紙の地の色。同じ本には毎回同じ色になる。彩度は落としてセピアの範囲に収める
  const tone = mix(mix(paper, ink, 0.35 + rng() * 0.4), p.accent, 0.15 + rng() * 0.5);
  // 読まれた回数が多いほど、色が褪せて角が丸くなる
  const faded = mix(tone, paper, s.wear * 0.35);

  const returned = s.state === "返却済";
  const overdue = s.progress > 1;

  ctx.save();
  // 返却済の本はわずかに奥へ、閲覧中の本は少し手前へ引き出して見せる
  const pull = s.state === "閲覧中" ? -6 : s.state === "書見台に伏せて" ? -3 : 0;
  const x = r.x;
  const y = r.y + (returned ? 3 : 0) + pull * 0;
  const hh = r.h - (returned ? 3 : 0) + (pull ? -pull : 0);

  // 影
  ctx.fillStyle = rgba(ink, 0.18);
  ctx.fillRect(x + 2, y + 3, r.w, hh);

  ctx.fillStyle = rgba(faded, returned ? 0.72 : 0.95);
  ctx.fillRect(x, y, r.w, hh);

  // 上下の飾り帯
  ctx.fillStyle = rgba(mix(faded, ink, 0.4), 0.9);
  ctx.fillRect(x, y + 8, r.w, 3);
  ctx.fillRect(x, y + hh - 26, r.w, 3);

  // 金の罫。延滞中はアクセント色で強く出る
  ctx.strokeStyle = overdue ? rgba(p.accent, 0.95) : rgba(mix(faded, [214, 178, 106], 0.7), 0.9);
  ctx.lineWidth = overdue ? 2 : 1.2;
  ctx.strokeRect(x + 2.5, y + 2.5, r.w - 5, hh - 5);

  // 擦り切れ。読まれた本ほど傷が増える
  const scuffs = Math.round(s.wear * 7);
  ctx.strokeStyle = rgba(paper, 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < scuffs; i++) {
    const sy = y + 12 + rng() * (hh - 30);
    ctx.beginPath();
    ctx.moveTo(x + 1 + rng() * 3, sy);
    ctx.lineTo(x + r.w - 1 - rng() * 3, sy + (rng() - 0.5) * 3);
    ctx.stroke();
  }

  // 縦書きの書名。栞と重ならないよう、背の中央よりわずかに左へ寄せる
  ctx.save();
  ctx.translate(x + r.w * 0.42, y + 18);
  ctx.fillStyle = rgba(mix(paper, [255, 252, 240], 0.55), 0.95);
  const fs = Math.min(13, Math.max(9, r.w * 0.38));
  ctx.font = `${fs}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const step = fs + 1.5;
  const maxChars = Math.floor((hh - 46) / step);
  const title = s.title.length > maxChars ? s.title.slice(0, Math.max(1, maxChars - 1)) + "…" : s.title;
  for (let i = 0; i < title.length; i++) {
    ctx.fillText(title[i], 0, i * step);
  }
  ctx.restore();

  // 裾の請求記号ラベル
  const labelH = 18;
  ctx.fillStyle = rgba([252, 250, 240], 0.92);
  ctx.fillRect(x + 3, y + hh - labelH - 4, r.w - 6, labelH);
  ctx.strokeStyle = rgba(ink, 0.3);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 3.5, y + hh - labelH - 3.5, r.w - 7, labelH - 1);
  ctx.fillStyle = rgba(ink, 0.8);
  ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = "center";
  ctx.fillText(s.callNumber.split(" / ")[0], x + r.w / 2, y + hh - labelH + 8);

  // 閲覧中の栞。進み具合の位置に垂れる。書名の上に重ならないよう右端に寄せる
  if (s.state === "閲覧中" || s.state === "書見台に伏せて") {
    const t = Math.max(0.04, Math.min(1, s.progress));
    const rx = x + r.w - 8;
    ctx.fillStyle = overdue ? rgba(p.accent, 0.95) : rgba(mix(p.accent, [190, 60, 50], 0.35), 0.85);
    ctx.fillRect(rx - 2.5, y, 5, 14 + (hh - 30) * t);
    ctx.beginPath();
    ctx.moveTo(rx - 2.5, y + 14 + (hh - 30) * t);
    ctx.lineTo(rx, y + 9 + (hh - 30) * t);
    ctx.lineTo(rx + 2.5, y + 14 + (hh - 30) * t);
    ctx.closePath();
    ctx.fill();
  }

  // 返却済の印
  if (returned) {
    ctx.save();
    ctx.translate(x + r.w / 2, y + hh * 0.44);
    ctx.rotate(-0.24);
    ctx.strokeStyle = rgba(p.accent, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(r.w, 40) * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(p.accent, 0.8);
    ctx.font = `${Math.min(11, r.w * 0.34)}px "Hiragino Mincho ProN", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("済", 0, 0.5);
    ctx.restore();
  }

  // 選択中は縁が光る
  if (s.selected) {
    ctx.strokeStyle = rgba(p.accent, 1);
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x - 1.5, y - 1.5, r.w + 3, hh + 3);
  }
  ctx.restore();
}

// ============================================================
// 書見台(いま閲覧している本)
// ============================================================

export function paintOpenBook(
  ctx: CanvasRenderingContext2D,
  o: {
    width: number;
    height: number;
    title: string;
    progress: number; // 0〜1超
    overdue: boolean;
    seed: string;
    palette: Palette;
    idle: boolean; // 閲覧中の本が無い(閉じた本を置く)
  }
): void {
  const { width: w, height: h, palette: p } = o;
  const ink = p.cream;
  const paper = p.ink;
  const rng = makeRng(`book:${o.seed}`);
  ctx.clearRect(0, 0, w, h);

  // 机の面
  const desk = ctx.createLinearGradient(0, 0, 0, h);
  desk.addColorStop(0, rgba(mix(paper, ink, 0.3), 1));
  desk.addColorStop(1, rgba(mix(paper, ink, 0.44), 1));
  ctx.fillStyle = desk;
  ctx.fillRect(0, 0, w, h);

  // ランプの光だまり
  const pool = ctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.5, w * 0.62);
  pool.addColorStop(0, rgba(mix([255, 240, 205], p.accent, o.overdue ? 0.4 : 0.12), 0.9));
  pool.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);

  const bw = w * 0.86;
  const bh = h * 0.66;
  const bx = (w - bw) / 2;
  const by = (h - bh) / 2 + h * 0.04;

  // 影
  ctx.fillStyle = rgba(ink, 0.22);
  ctx.beginPath();
  ctx.ellipse(w / 2, by + bh + 4, bw * 0.5, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();

  if (o.idle) {
    // 閉じた本を伏せて置く
    ctx.fillStyle = rgba(mix(paper, p.accent, 0.35), 1);
    ctx.fillRect(bx, by + bh * 0.2, bw, bh * 0.6);
    ctx.strokeStyle = rgba(ink, 0.5);
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by + bh * 0.2, bw, bh * 0.6);
    ctx.strokeStyle = rgba(mix(paper, [214, 178, 106], 0.7), 0.9);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(bx + 8, by + bh * 0.2 + 8, bw - 16, bh * 0.6 - 16);
    ctx.fillStyle = rgba(ink, 0.35);
    ctx.font = '12px "Hiragino Mincho ProN", "Yu Mincho", serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(o.title, w / 2, by + bh * 0.5);
    paperGrain(ctx, w, h, o.seed, 10);
    return;
  }

  // 見開き。中央でわずかに谷折り
  const gut = w / 2;
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    const outer = side < 0 ? bx : bx + bw;
    ctx.moveTo(gut, by + 4);
    ctx.quadraticCurveTo(gut + side * bw * 0.25, by - 4, outer, by + 6);
    ctx.lineTo(outer, by + bh - 6);
    ctx.quadraticCurveTo(gut + side * bw * 0.25, by + bh + 4, gut, by + bh - 4);
    ctx.closePath();
    const pg = ctx.createLinearGradient(gut, 0, outer, 0);
    pg.addColorStop(0, rgba(mix(paper, ink, 0.2), 1));
    pg.addColorStop(0.16, rgba(mix(paper, [255, 253, 244], 0.7), 1));
    pg.addColorStop(1, rgba(mix(paper, [255, 253, 244], 0.5), 1));
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = rgba(ink, 0.35);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // 本文の行。左は読み終えた分だけ濃く、右はこれからの分で薄い
  const t = Math.max(0, Math.min(1, o.progress));
  const lines = 13;
  for (const side of [-1, 1] as const) {
    const x0 = side < 0 ? bx + bw * 0.08 : gut + bw * 0.06;
    const x1 = side < 0 ? gut - bw * 0.06 : bx + bw - bw * 0.08;
    for (let i = 0; i < lines; i++) {
      const y = by + bh * 0.16 + (i * (bh * 0.68)) / lines;
      const readRatio = side < 0 ? 1 : t;
      const filled = side < 0 ? 1 : i / lines < t ? 1 : 0.18;
      const len = (x1 - x0) * (0.72 + rng() * 0.28);
      ctx.strokeStyle = rgba(ink, 0.42 * filled * (side < 0 ? 0.75 : 1) * readRatio + 0.06);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + len, y);
      ctx.stroke();
    }
  }

  // 栞。進み具合の位置に垂れ、延滞すると紙面からはみ出して赤く伸びる
  const ribbonX = gut + bw * (o.progress > 1 ? 0.42 : -0.42 + 0.84 * t);
  const overflow = o.progress > 1 ? Math.min(h * 0.16, (o.progress - 1) * h * 0.14) : 0;
  ctx.fillStyle = o.overdue ? rgba(p.accent, 0.95) : rgba(mix(p.accent, [180, 60, 52], 0.4), 0.8);
  ctx.fillRect(ribbonX - 4, by - 8, 8, bh * 0.55 + overflow);
  ctx.beginPath();
  ctx.moveTo(ribbonX - 4, by - 8 + bh * 0.55 + overflow);
  ctx.lineTo(ribbonX, by - 14 + bh * 0.55 + overflow);
  ctx.lineTo(ribbonX + 4, by - 8 + bh * 0.55 + overflow);
  ctx.closePath();
  ctx.fill();

  // 綴じ目の影
  const gutter = ctx.createLinearGradient(gut - bw * 0.05, 0, gut + bw * 0.05, 0);
  gutter.addColorStop(0, "rgba(0,0,0,0)");
  gutter.addColorStop(0.5, rgba(ink, 0.22));
  gutter.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gutter;
  ctx.fillRect(gut - bw * 0.05, by, bw * 0.1, bh);

  paperGrain(ctx, w, h, o.seed, 10);
}

// ============================================================
// 返却期限票(実績の日付印)
// ============================================================

export function dateSlipHeight(count: number, width: number): number {
  const cols = Math.max(2, Math.floor((width - 24) / 62));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
  return 46 + rows * 30;
}

export function paintDateSlip(
  ctx: CanvasRenderingContext2D,
  o: {
    width: number;
    height: number;
    stamps: { date: string; overdue: boolean }[];
    palette: Palette;
    title: string;
  }
): void {
  const { width: w, height: h, palette: p } = o;
  const ink = p.cream;
  ctx.clearRect(0, 0, w, h);

  // 巻末に貼られた票
  ctx.fillStyle = rgba(mix(p.panel, [255, 255, 250], 0.4), 1);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = rgba(ink, 0.4);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  ctx.fillStyle = rgba(ink, 0.65);
  ctx.font = '10px "Hiragino Mincho ProN", "Yu Mincho", serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(o.title, 10, 10);
  ctx.beginPath();
  ctx.moveTo(10, 26);
  ctx.lineTo(w - 10, 26);
  ctx.strokeStyle = rgba(ink, 0.3);
  ctx.lineWidth = 1;
  ctx.stroke();

  const cols = Math.max(2, Math.floor((w - 24) / 62));
  const cw = (w - 24) / cols;

  // 罫のマス目
  const rows = Math.max(1, Math.ceil(Math.max(o.stamps.length, 1) / cols));
  ctx.strokeStyle = rgba(ink, 0.14);
  for (let r = 0; r <= rows; r++) {
    const y = 34 + r * 30;
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(w - 12, y);
    ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    const x = 12 + c * cw;
    ctx.beginPath();
    ctx.moveTo(x, 34);
    ctx.lineTo(x, 34 + rows * 30);
    ctx.stroke();
  }

  if (o.stamps.length === 0) {
    ctx.fillStyle = rgba(ink, 0.32);
    ctx.font = '11px "Hiragino Mincho ProN", serif';
    ctx.textAlign = "center";
    ctx.fillText("貸出の記録はまだありません", w / 2, 42);
    return;
  }

  // 日付印。押すたびに角度とインクの乗りが少しずつ違う
  for (let i = 0; i < o.stamps.length; i++) {
    const s = o.stamps[i];
    const rng = makeRng(`stamp:${s.date}:${i}`);
    const c = i % cols;
    const r = Math.floor(i / cols);
    const cx = 12 + c * cw + cw / 2;
    const cy = 34 + r * 30 + 15;
    const [, mm, dd] = s.date.split("-");

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rng() - 0.5) * 0.22);
    const tint: Rgb = s.overdue ? p.accent : mix(p.accent, [60, 70, 120], 0.75);
    const alpha = 0.5 + rng() * 0.35;

    ctx.strokeStyle = rgba(tint, alpha);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-24, -11, 48, 22);
    ctx.strokeRect(-22, -9, 44, 18);

    ctx.fillStyle = rgba(tint, alpha + 0.12);
    ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${mm}.${dd}`, 0, 0.5);

    // インクのかすれ
    ctx.globalCompositeOperation = "destination-out";
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(-22 + rng() * 44, -10 + rng() * 20, rng() * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ============================================================
// 目録カード(カード紙の地)
// ============================================================

export function paintCardStock(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; palette: Palette; seed: string }
): void {
  const { width: w, height: h, palette: p } = o;
  const ink = p.cream;
  const rng = makeRng(`card:${o.seed}`);
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = rgba(mix(p.panel, [255, 255, 248], 0.35), 1);
  ctx.fillRect(0, 0, w, h);

  // 紙の繊維
  ctx.strokeStyle = rgba(ink, 0.05);
  ctx.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    const x = rng() * w;
    const y = rng() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 22, y + (rng() - 0.5) * 6);
    ctx.stroke();
  }

  // 罫線
  ctx.strokeStyle = rgba(ink, 0.1);
  for (let y = 30; y < h - 16; y += 18) {
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(w - 12, y);
    ctx.stroke();
  }

  // 目録カード特有の、下端に開いた綴じ穴
  ctx.fillStyle = rgba(ink, 0.16);
  ctx.beginPath();
  ctx.arc(w / 2, h - 11, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.3);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(w / 2, h - 11, 6, 0, Math.PI * 2);
  ctx.stroke();

  // 枠
  ctx.strokeStyle = rgba(ink, 0.35);
  ctx.lineWidth = 1.4;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  paperGrain(ctx, w, h, o.seed, 9);
}
