// Claudeモードの図版。
//
// 他モードの図版が「その世界を再現する絵」なのに対し、ここでの図版は
// 「主張の根拠を見せるための図」に徹する。派手さより、読めば分かることを優先する。
//
// 見た目の方針は、Claude自身の製品が持つ落ち着いた紙の質感に合わせる:
//   ・地は温かい紙、線は細く、余白を広く取る
//   ・色はテラコッタ(アクセント)と墨(文字色)の2色だけで組み立てる
//   ・目盛りや補助線は主張しない。読み手の視線を数字そのものへ通す
//
// このモードだけはOSのライト/ダーク設定に追従するため、色は必ずCSS変数から
// その場で読む(固定色を焼き込まない)。

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

function readCssRgb(name: string, fallback: Rgb): Rgb {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) return [parts[0], parts[1], parts[2]];
  return fallback;
}

export interface Palette {
  accent: Rgb; // テラコッタ
  ink: Rgb; // 地(紙)
  cream: Rgb; // 文字(墨)
  panel: Rgb;
}

export function readPalette(): Palette {
  return {
    accent: readCssRgb("--accent-rgb", [217, 119, 87]),
    ink: readCssRgb("--ink-rgb", [250, 248, 240]),
    cream: readCssRgb("--cream-rgb", [38, 34, 28]),
    panel: readCssRgb("--panel-rgb", [255, 253, 247]),
  };
}

/** 種から決まる擬似乱数。線のわずかな揺らぎにだけ使い、数値には一切使わない */
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
// 紙の地
// ============================================================
// ごく薄い斑を敷くだけ。目に付いたら失敗なので、かなり弱くしている

export function paintPaper(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; seed: string; palette: Palette }
) {
  const { width: w, height: h, palette } = o;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = rgb(palette.panel);
  ctx.fillRect(0, 0, w, h);
  const rng = makeRng(`paper:${o.seed}`);
  const dark = palette.ink[0] < 120; // ダークテーマかどうか
  for (let i = 0; i < Math.floor(w * h * 0.01); i++) {
    const x = rng() * w;
    const y = rng() * h;
    ctx.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${dark ? 0.012 : 0.5})` : `rgba(90,70,50,${dark ? 0.04 : 0.022})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

// ============================================================
// 思考の系(推論の道筋)
// ============================================================
// このモードの署名にあたる図。分析が実際に通った手順を、
// 上から下へ一本の糸として描く。節が手順、糸の揺らぎは種から決まる。

export interface ThreadNode {
  label: string;
  note: string;
}

/**
 * 思考の系の1行分。行の高さは本文の量で決まるため、
 * 図のほうを行に合わせる(逆にすると節と本文がずれる)。
 * 各行が上下の辺まで糸を引くので、積み重なると一本の糸につながる。
 */
export function paintThreadRow(
  ctx: CanvasRenderingContext2D,
  o: {
    width: number;
    height: number;
    seed: string;
    palette: Palette;
    /** この節まで到達しているか */
    lit: boolean;
    first: boolean;
    last: boolean;
    /** 節を置く高さ(本文1行目の中心に合わせる) */
    nodeY: number;
  }
) {
  const { width: w, height: h, palette } = o;
  const rng = makeRng(`thread:${o.seed}`);
  ctx.clearRect(0, 0, w, h);
  const x = w / 2;

  // 糸。定規で引いた線に見えないよう、わずかに左右へ揺らす
  const drawLine = (from: number, to: number, color: string, width: number) => {
    if (to <= from) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x, from);
    const steps = Math.max(2, Math.round((to - from) / 6));
    for (let i = 1; i <= steps; i++) {
      ctx.lineTo(x + (rng() - 0.5) * 2.2, from + ((to - from) * i) / steps);
    }
    ctx.stroke();
  };

  const color = o.lit ? rgba(palette.accent, 0.75) : rgba(palette.cream, 0.16);
  const width = o.lit ? 1.8 : 1.4;
  if (!o.first) drawLine(0, o.nodeY - 7, color, width);
  if (!o.last) drawLine(o.nodeY + 7, h, color, width);

  // 節
  ctx.beginPath();
  ctx.arc(x, o.nodeY, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = o.lit ? rgb(palette.accent) : rgb(palette.panel);
  ctx.fill();
  ctx.strokeStyle = o.lit ? rgba(palette.accent, 0.9) : rgba(palette.cream, 0.28);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  if (o.lit) {
    ctx.fillStyle = rgba(palette.panel, 0.95);
    ctx.beginPath();
    ctx.arc(x, o.nodeY, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// 較正図(想定 vs 実績)
// ============================================================
// 45度線より上なら超過、下なら早く終わった。
// 軸は対数にしている。5分の作業と5時間の作業を同じ図に載せるには、
// 等間隔の軸だと短い作業が原点付近に潰れてしまうため。

export interface CalibrationDot {
  estimateMinutes: number;
  actualMinutes: number;
  over: boolean;
}

export function calibrationHeight(width: number): number {
  return Math.round(Math.max(190, Math.min(280, width * 0.78)));
}

export function paintCalibration(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; dots: CalibrationDot[]; palette: Palette; highlight: number | null }
) {
  const { width: w, height: h, palette } = o;
  ctx.clearRect(0, 0, w, h);

  const padL = 46;
  const padR = 22;
  const padT = 14;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // 目盛りは1分・10分・1時間・10時間の4点。分かりやすい刻みだけを置く
  const ticks = [1, 10, 60, 600];
  const lo = Math.log10(1);
  const hi = Math.log10(900);
  const sx = (min: number) => padL + ((Math.log10(Math.max(1, min)) - lo) / (hi - lo)) * plotW;
  const sy = (min: number) => padT + plotH - ((Math.log10(Math.max(1, min)) - lo) / (hi - lo)) * plotH;

  // 枠と目盛り
  ctx.strokeStyle = rgba(palette.cream, 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = rgba(palette.cream, 0.4);
  for (const t of ticks) {
    const gx = sx(t);
    const gy = sy(t);
    ctx.strokeStyle = rgba(palette.cream, 0.07);
    ctx.beginPath();
    ctx.moveTo(gx, padT);
    ctx.lineTo(gx, padT + plotH);
    ctx.moveTo(padL, gy);
    ctx.lineTo(padL + plotW, gy);
    ctx.stroke();
    const label = t >= 60 ? `${t / 60}h` : `${t}m`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, gx, padT + plotH + 6);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(label, padL - 6, gy);
  }

  // 45度線 = 想定どおり
  ctx.strokeStyle = rgba(palette.cream, 0.3);
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx(1), sy(1));
  ctx.lineTo(sx(900), sy(900));
  ctx.stroke();
  ctx.setLineDash([]);

  // 超過側をごく薄く塗って、上下どちらが超過かを言葉なしで示す
  ctx.fillStyle = rgba(palette.accent, 0.05);
  ctx.beginPath();
  ctx.moveTo(sx(1), sy(1));
  ctx.lineTo(sx(900), sy(900));
  ctx.lineTo(sx(1), sy(900));
  ctx.closePath();
  ctx.fill();

  // 点
  for (const d of o.dots) {
    const x = sx(d.estimateMinutes);
    const y = sy(d.actualMinutes);
    ctx.beginPath();
    ctx.arc(x, y, 3.1, 0, Math.PI * 2);
    ctx.fillStyle = d.over ? rgba(palette.accent, 0.62) : rgba(mix(palette.cream, palette.ink, 0.35), 0.5);
    ctx.fill();
  }

  // 軸の見出し
  ctx.fillStyle = rgba(palette.cream, 0.45);
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  // 軸名は目盛りと重ならない位置に置く。横軸は右下の外、縦軸は軸の中ほど
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("想定", padL + plotW, h - 2);
  ctx.save();
  ctx.translate(11, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("実績", 0, 0);
  ctx.restore();
}

// ============================================================
// 確信度の目盛り
// ============================================================
// バーではなく、計測器の刻みとして描く。
// 「どれくらい確からしいか」を、満タン/空という印象から引き離すため。

export function paintConfidence(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; value: number; palette: Palette }
) {
  const { width: w, height: h, palette } = o;
  ctx.clearRect(0, 0, w, h);
  const n = 20;
  const gap = w / n;
  const filled = Math.round(Math.max(0, Math.min(1, o.value)) * n);
  for (let i = 0; i < n; i++) {
    const x = gap * i + gap / 2;
    const major = i % 5 === 0;
    const len = major ? h : h * 0.55;
    ctx.strokeStyle = i < filled ? rgba(palette.accent, 0.9) : rgba(palette.cream, 0.16);
    ctx.lineWidth = i < filled ? 1.8 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x, h - len);
    ctx.stroke();
  }
}

// ============================================================
// 一日の律動(時間帯ごとの着手)
// ============================================================
// 24時間を1本の帯にして、その時間帯に着手した実績の密度を高さで示す。
// 折れ線にしないのは、時刻は連続量というより「その時間帯にいたかどうか」だから。

export function rhythmHeight(): number {
  return 78;
}

export function paintRhythm(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; hours: number[]; palette: Palette; nowHour: number | null }
) {
  const { width: w, height: h, palette } = o;
  ctx.clearRect(0, 0, w, h);
  const padL = 6;
  const padR = 6;
  const padB = 18;
  const plotW = w - padL - padR;
  const plotH = h - padB - 6;
  const max = Math.max(1, ...o.hours);
  const bw = plotW / 24;

  for (let i = 0; i < 24; i++) {
    const v = o.hours[i] ?? 0;
    const bh = (v / max) * plotH;
    const x = padL + bw * i;
    // 地の目盛り
    ctx.fillStyle = rgba(palette.cream, 0.05);
    ctx.fillRect(x + 1, 6, bw - 2, plotH);
    if (bh > 0) {
      const g = ctx.createLinearGradient(0, 6 + plotH - bh, 0, 6 + plotH);
      g.addColorStop(0, rgba(palette.accent, 0.85));
      g.addColorStop(1, rgba(palette.accent, 0.45));
      ctx.fillStyle = g;
      roundRect(ctx, x + 1, 6 + plotH - bh, bw - 2, bh, Math.min(2, (bw - 2) / 2));
      ctx.fill();
    }
    if (i === o.nowHour) {
      ctx.strokeStyle = rgba(palette.accent, 0.75);
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x + bw / 2, 4);
      ctx.lineTo(x + bw / 2, 6 + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.fillStyle = rgba(palette.cream, 0.38);
  ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "top";
  for (const hr of [0, 6, 12, 18]) {
    ctx.textAlign = hr === 0 ? "left" : "center";
    ctx.fillText(`${hr}:00`, padL + bw * hr + (hr === 0 ? 0 : bw / 2), 6 + plotH + 5);
  }
  ctx.textAlign = "right";
  ctx.fillText("24:00", w - padR, 6 + plotH + 5);
}

// ============================================================
// 小さな折れ線(見出しの脇に置く)
// ============================================================

export function paintSpark(
  ctx: CanvasRenderingContext2D,
  o: { width: number; height: number; values: number[]; palette: Palette }
) {
  const { width: w, height: h, palette } = o;
  ctx.clearRect(0, 0, w, h);
  if (o.values.length < 2) return;
  const max = Math.max(...o.values);
  const min = Math.min(...o.values);
  const span = max - min || 1;
  const px = (i: number) => (i / (o.values.length - 1)) * (w - 2) + 1;
  const py = (v: number) => h - 2 - ((v - min) / span) * (h - 4);

  // 面
  ctx.beginPath();
  ctx.moveTo(px(0), h);
  o.values.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.lineTo(px(o.values.length - 1), h);
  ctx.closePath();
  ctx.fillStyle = rgba(palette.accent, 0.12);
  ctx.fill();
  // 線
  ctx.beginPath();
  o.values.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
  ctx.strokeStyle = rgba(palette.accent, 0.85);
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.stroke();
  // 終端
  ctx.beginPath();
  ctx.arc(px(o.values.length - 1), py(o.values[o.values.length - 1]), 2.2, 0, Math.PI * 2);
  ctx.fillStyle = rgb(palette.accent);
  ctx.fill();
}
