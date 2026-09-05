// 怪異調査モードの「絵」をブラウザのCanvasでその場で描くための描画ロジック。
//
// 元ネタのサウンドノベルは実写背景が最大の特徴だが、このアプリは
// バックエンドを持たない100%クライアントサイド構成で、オフラインでも動くことを
// 前提にしている。外部の写真を持ってくると著作権・通信・容量のどれもが問題になるため、
// 「写真そのもの」ではなく「写真のように見える絵」を毎回その場で生成する方針にした。
//
// 種(seed)は作業名や日付といった実データなので、同じ案件を開けば常に同じ景色になる。
// 乱数は見た目のばらつきのためだけに使い、業務データの数値には一切関与しない。

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

// ---- 背景(一枚絵) ----

export type SceneKind =
  | "corridor"
  | "tunnel"
  | "stairs"
  | "street"
  | "torii"
  | "room"
  | "phone"
  | "crossing"
  | "ward"
  | "elevator";

const SCENES: SceneKind[] = [
  "corridor",
  "tunnel",
  "stairs",
  "street",
  "torii",
  "room",
  "phone",
  "crossing",
  "ward",
  "elevator",
];

export const SCENE_LABEL: Record<SceneKind, string> = {
  corridor: "廊下",
  tunnel: "隧道",
  stairs: "階段",
  street: "路地",
  torii: "参道",
  room: "座敷",
  phone: "公衆電話",
  crossing: "踏切",
  ward: "病室",
  elevator: "昇降機",
};

export function pickScene(seed: string): SceneKind {
  const rng = makeRng(`scene:${seed}`);
  return SCENES[Math.floor(rng() * SCENES.length)];
}

export interface ScenePaintOptions {
  kind: SceneKind;
  seed: string;
  width: number;
  height: number;
  intensity: number; // 0〜1。危険度・侵蝕度。高いほど暗く、赤く、粒子が荒れる
  night: boolean;
  accent: [number, number, number];
}

export function paintScene(ctx: CanvasRenderingContext2D, o: ScenePaintOptions): void {
  const { width: w, height: h } = o;
  const rng = makeRng(o.seed);
  const dark = o.night ? 0.72 : 0.55;

  // 下地(奥ほど明るい単一光源。写真らしく彩度は落とす)
  const base = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  base.addColorStop(0, `rgb(${Math.round(118 * (1 - dark * 0.3))}, ${Math.round(115 * (1 - dark * 0.3))}, ${Math.round(112 * (1 - dark * 0.34))})`);
  base.addColorStop(1, `rgb(${Math.round(34 * (1 - dark * 0.25))}, ${Math.round(33 * (1 - dark * 0.25))}, ${Math.round(36 * (1 - dark * 0.25))})`);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  if (o.kind === "corridor") paintCorridor(ctx, o, rng);
  else if (o.kind === "tunnel") paintTunnel(ctx, o, rng);
  else if (o.kind === "stairs") paintStairs(ctx, o, rng);
  else if (o.kind === "street") paintStreet(ctx, o, rng);
  else if (o.kind === "torii") paintTorii(ctx, o, rng);
  else if (o.kind === "phone") paintPhone(ctx, o, rng);
  else if (o.kind === "crossing") paintCrossing(ctx, o, rng);
  else if (o.kind === "ward") paintWard(ctx, o, rng);
  else if (o.kind === "elevator") paintElevator(ctx, o, rng);
  else paintRoom(ctx, o, rng);

  // 危険度が高い時だけ、背景のどこかに「写り込み」が現れる。
  // 心霊写真のように、言われなければ気づかない程度の濃さに留める
  if (o.intensity >= 0.7) paintApparition(ctx, o, rng);

  postProcess(ctx, o, rng);
}

function paintCorridor(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const vx = w * 0.5 + (rng() - 0.5) * w * 0.12;
  const vy = h * 0.52;
  const endW = w * 0.075;
  const endH = h * 0.13;

  // 奥の光
  const glow = ctx.createRadialGradient(vx, vy, 0, vx, vy, w * 0.35);
  glow.addColorStop(0, "rgba(196, 190, 176, 0.5)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // 床
  ctx.fillStyle = "rgba(28, 26, 25, 0.85)";
  quad(ctx, [0, h], [w, h], [vx + endW, vy + endH], [vx - endW, vy + endH]);
  // 天井
  ctx.fillStyle = "rgba(14, 13, 14, 0.9)";
  quad(ctx, [0, 0], [w, 0], [vx + endW, vy - endH], [vx - endW, vy - endH]);

  // 床の目地(奥行き線)
  ctx.strokeStyle = "rgba(150, 145, 135, 0.10)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    ctx.beginPath();
    ctx.moveTo(lerp(0, vx - endW, 0) + (w * t), h);
    ctx.lineTo(lerp(vx - endW, vx + endW, t), vy + endH);
    ctx.stroke();
  }

  // 左右の扉(奥に向かって小さくなる)
  const doors = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < doors; i++) {
    const d0 = 1 - i / doors;
    const d1 = 1 - (i + 0.62) / doors;
    for (const side of [-1, 1]) {
      const x0 = lerp(vx + side * endW, side < 0 ? 0 : w, d0);
      const x1 = lerp(vx + side * endW, side < 0 ? 0 : w, d1);
      const yTop0 = lerp(vy - endH, 0, d0);
      const yTop1 = lerp(vy - endH, 0, d1);
      const yBot0 = lerp(vy + endH, h, d0);
      const yBot1 = lerp(vy + endH, h, d1);
      // 扉は壁の高さの下 7 割
      const t0a = lerp(yTop0, yBot0, 0.3);
      const t1a = lerp(yTop1, yBot1, 0.3);
      ctx.fillStyle = `rgba(10, 9, 10, ${0.55 + 0.3 * d0})`;
      quad(ctx, [x0, t0a], [x1, t1a], [x1, yBot1], [x0, yBot0]);
      ctx.strokeStyle = `rgba(160, 152, 140, ${0.08 + 0.1 * d0})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 天井灯(等間隔に落ちる光)
  for (let i = 0; i < 4; i++) {
    const d = 1 - i / 4;
    const y = lerp(vy - endH, 0, d) + (lerp(vy + endH, h, d) - lerp(vy - endH, 0, d)) * 0.06;
    const x = lerp(vx, vx, d);
    const r = lerp(w * 0.03, w * 0.14, d);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(210, 202, 180, ${0.16 + 0.1 * d})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintTunnel(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const vx = w * 0.5 + (rng() - 0.5) * w * 0.08;
  const vy = h * 0.55;

  ctx.fillStyle = "rgba(10, 10, 11, 0.5)";
  ctx.fillRect(0, 0, w, h);

  // 奥の出口
  const glow = ctx.createRadialGradient(vx, vy, 0, vx, vy, w * 0.22);
  glow.addColorStop(0, "rgba(178, 176, 160, 0.55)");
  glow.addColorStop(0.5, "rgba(60, 60, 58, 0.25)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // 迫り出すアーチ
  const rings = 9;
  for (let i = rings; i >= 1; i--) {
    const d = i / rings;
    const rw = lerp(w * 0.055, w * 0.62, d);
    const rh = lerp(h * 0.09, h * 0.85, d);
    ctx.beginPath();
    ctx.moveTo(vx - rw, vy + rh);
    ctx.lineTo(vx - rw, vy);
    ctx.ellipse(vx, vy, rw, rh * 0.72, 0, Math.PI, 0);
    ctx.lineTo(vx + rw, vy + rh);
    ctx.strokeStyle = `rgba(150, 146, 138, ${0.05 + 0.16 * (1 - d)})`;
    ctx.lineWidth = lerp(1, 3, d);
    ctx.stroke();
  }

  // 路面
  ctx.fillStyle = "rgba(22, 21, 21, 0.9)";
  quad(ctx, [0, h], [w, h], [vx + w * 0.06, vy + h * 0.06], [vx - w * 0.06, vy + h * 0.06]);
  // 中央線
  ctx.strokeStyle = "rgba(190, 185, 165, 0.14)";
  ctx.setLineDash([h * 0.05, h * 0.05]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(vx, h);
  ctx.lineTo(vx, vy + h * 0.07);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintStairs(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const vx = w * (0.42 + rng() * 0.16);

  ctx.fillStyle = "rgba(13, 12, 13, 0.45)";
  ctx.fillRect(0, 0, w, h);

  // 上からの光
  const glow = ctx.createRadialGradient(vx, h * 0.12, 0, vx, h * 0.12, w * 0.45);
  glow.addColorStop(0, "rgba(190, 186, 168, 0.32)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // 段(奥=上ほど狭く)
  const steps = 11;
  for (let i = 0; i < steps; i++) {
    const d = 1 - i / steps;
    const y = lerp(h * 0.3, h, d);
    const halfW = lerp(w * 0.12, w * 0.52, d);
    const thick = lerp(h * 0.014, h * 0.05, d);
    ctx.fillStyle = `rgba(${Math.round(lerp(46, 30, d))}, ${Math.round(lerp(44, 29, d))}, ${Math.round(lerp(42, 28, d))}, 0.95)`;
    ctx.fillRect(vx - halfW, y, halfW * 2, thick);
    ctx.fillStyle = `rgba(8, 8, 9, 0.8)`;
    ctx.fillRect(vx - halfW, y + thick, halfW * 2, thick * 0.55);
  }

  // 手すり
  ctx.strokeStyle = "rgba(160, 155, 145, 0.16)";
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(vx + side * w * 0.52, h * 0.86);
    ctx.lineTo(vx + side * w * 0.12, h * 0.3);
    ctx.stroke();
  }
}

function paintStreet(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const vx = w * 0.5 + (rng() - 0.5) * w * 0.16;
  const vy = h * 0.56;

  // 空
  const sky = ctx.createLinearGradient(0, 0, 0, vy);
  sky.addColorStop(0, "rgba(16, 17, 22, 1)");
  sky.addColorStop(1, "rgba(38, 36, 38, 1)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, vy);

  // 路面
  ctx.fillStyle = "rgba(24, 23, 23, 1)";
  quad(ctx, [0, h], [w, h], [vx + w * 0.05, vy], [vx - w * 0.05, vy]);

  // 両側の建物(黒いシルエット)
  for (const side of [-1, 1]) {
    let d = 1;
    for (let i = 0; i < 5; i++) {
      const d1 = d - 0.18 - rng() * 0.05;
      const x0 = lerp(vx + side * w * 0.05, side < 0 ? 0 : w, d);
      const x1 = lerp(vx + side * w * 0.05, side < 0 ? 0 : w, Math.max(0.02, d1));
      const top = lerp(vy, vy - h * (0.28 + rng() * 0.3), d);
      const top1 = lerp(vy, vy - h * (0.28 + rng() * 0.3), Math.max(0.02, d1));
      ctx.fillStyle = `rgba(${Math.round(lerp(12, 20, d))}, ${Math.round(lerp(12, 19, d))}, ${Math.round(lerp(14, 21, d))}, 1)`;
      quad(ctx, [x0, top], [x1, top1], [x1, h], [x0, h]);
      // 灯った窓
      if (rng() > 0.45) {
        const wx = lerp(x0, x1, 0.4);
        const wy = lerp(top, vy, 0.25 + rng() * 0.3);
        const s = Math.max(2, w * 0.012 * d);
        ctx.fillStyle = `rgba(206, 186, 132, ${0.18 + 0.25 * d})`;
        ctx.fillRect(wx, wy, s, s * 1.3);
      }
      d = Math.max(0.02, d1);
    }
  }

  // 電柱と電線
  const poles = 4;
  for (let i = 0; i < poles; i++) {
    const d = 1 - i / poles;
    for (const side of [-1, 1]) {
      const x = lerp(vx + side * w * 0.06, side < 0 ? -w * 0.05 : w * 1.05, d);
      const top = lerp(vy - h * 0.02, vy - h * 0.42, d);
      ctx.strokeStyle = `rgba(10, 10, 11, ${0.7 + 0.25 * d})`;
      ctx.lineWidth = lerp(1.5, 5, d);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, top);
      ctx.stroke();
      // 腕木
      ctx.lineWidth = lerp(1, 2.5, d);
      ctx.beginPath();
      ctx.moveTo(x - lerp(4, 16, d), top + lerp(3, 10, d));
      ctx.lineTo(x + lerp(4, 16, d), top + lerp(3, 10, d));
      ctx.stroke();
    }
  }
  // たわんだ電線
  ctx.strokeStyle = "rgba(8, 8, 9, 0.75)";
  ctx.lineWidth = 1.4;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.02, vy - h * (0.34 - k * 0.045));
    ctx.quadraticCurveTo(w * 0.5, vy - h * (0.2 - k * 0.05), w * 1.02, vy - h * (0.36 - k * 0.04));
    ctx.stroke();
  }

  // 街灯
  const lx = vx + w * 0.17;
  const ly = vy - h * 0.2;
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, w * 0.3);
  g.addColorStop(0, "rgba(226, 200, 138, 0.4)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function paintTorii(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const vx = w * 0.5 + (rng() - 0.5) * w * 0.06;
  const vy = h * 0.58;

  ctx.fillStyle = "rgba(12, 12, 14, 0.86)";
  ctx.fillRect(0, 0, w, vy);
  // 参道
  ctx.fillStyle = "rgba(26, 25, 24, 1)";
  quad(ctx, [0, h], [w, h], [vx + w * 0.055, vy], [vx - w * 0.055, vy]);

  // 奥の薄明かり
  const glow = ctx.createRadialGradient(vx, vy - h * 0.05, 0, vx, vy - h * 0.05, w * 0.3);
  glow.addColorStop(0, "rgba(150, 150, 140, 0.28)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // 鳥居(手前ほど大きい)
  const gates = 4;
  for (let i = gates - 1; i >= 0; i--) {
    const d = 1 - i / gates;
    const halfW = lerp(w * 0.07, w * 0.42, d);
    const top = lerp(vy - h * 0.05, vy - h * 0.62, d);
    const pillar = lerp(2, 12, d);
    const alpha = 0.55 + 0.4 * d;
    ctx.fillStyle = `rgba(8, 7, 8, ${alpha})`;
    // 柱
    ctx.fillRect(vx - halfW, top, pillar, vy - top + h * 0.02);
    ctx.fillRect(vx + halfW - pillar, top, pillar, vy - top + h * 0.02);
    // 笠木(反り)
    ctx.beginPath();
    ctx.moveTo(vx - halfW * 1.22, top);
    ctx.quadraticCurveTo(vx, top - lerp(2, 14, d), vx + halfW * 1.22, top);
    ctx.lineTo(vx + halfW * 1.22, top + lerp(2, 9, d));
    ctx.quadraticCurveTo(vx, top - lerp(0, 6, d), vx - halfW * 1.22, top + lerp(2, 9, d));
    ctx.closePath();
    ctx.fill();
    // 貫
    ctx.fillRect(vx - halfW * 1.02, top + lerp(6, 26, d), halfW * 2.04, lerp(1.5, 7, d));
  }

  // 石灯籠
  const gx = vx - w * 0.34;
  const gy = h * 0.9;
  ctx.fillStyle = "rgba(9, 9, 10, 0.95)";
  ctx.fillRect(gx - w * 0.02, gy - h * 0.18, w * 0.04, h * 0.18);
  ctx.fillRect(gx - w * 0.035, gy - h * 0.24, w * 0.07, h * 0.06);
  const lg = ctx.createRadialGradient(gx, gy - h * 0.21, 0, gx, gy - h * 0.21, w * 0.12);
  lg.addColorStop(0, "rgba(224, 190, 122, 0.35)");
  lg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, w, h);
}

function paintRoom(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const vx = w * 0.5;
  const vy = h * 0.5;

  ctx.fillStyle = "rgba(15, 14, 14, 0.55)";
  ctx.fillRect(0, 0, w, h);

  // 畳(奥行きのある格子)
  ctx.fillStyle = "rgba(30, 29, 25, 1)";
  quad(ctx, [0, h], [w, h], [vx + w * 0.24, vy + h * 0.06], [vx - w * 0.24, vy + h * 0.06]);
  ctx.strokeStyle = "rgba(150, 143, 120, 0.10)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    ctx.beginPath();
    ctx.moveTo(w * t, h);
    ctx.lineTo(lerp(vx - w * 0.24, vx + w * 0.24, t), vy + h * 0.06);
    ctx.stroke();
  }
  for (let i = 1; i < 4; i++) {
    const d = i / 4;
    const y = lerp(vy + h * 0.06, h, d);
    const half = lerp(w * 0.24, w * 0.5, d);
    ctx.beginPath();
    ctx.moveTo(vx - half, y);
    ctx.lineTo(vx + half, y);
    ctx.stroke();
  }

  // 障子(格子窓)と月明かり
  const winW = w * 0.34;
  const winH = h * 0.3;
  const wx = vx - winW / 2 + (rng() - 0.5) * w * 0.1;
  const wy = vy - winH * 0.9;
  const mg = ctx.createLinearGradient(wx, wy, wx, wy + winH);
  mg.addColorStop(0, "rgba(178, 180, 170, 0.34)");
  mg.addColorStop(1, "rgba(120, 122, 118, 0.16)");
  ctx.fillStyle = mg;
  ctx.fillRect(wx, wy, winW, winH);
  ctx.strokeStyle = "rgba(20, 19, 18, 0.8)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(wx + (winW / 4) * i, wy);
    ctx.lineTo(wx + (winW / 4) * i, wy + winH);
    ctx.stroke();
  }
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(wx, wy + (winH / 3) * i);
    ctx.lineTo(wx + winW, wy + (winH / 3) * i);
    ctx.stroke();
  }
  ctx.strokeRect(wx, wy, winW, winH);

  // 窓明かりの床への落ち込み
  const fg = ctx.createLinearGradient(0, wy + winH, 0, h);
  fg.addColorStop(0, "rgba(170, 172, 160, 0.14)");
  fg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fg;
  quad(ctx, [wx, wy + winH], [wx + winW, wy + winH], [wx + winW * 1.9, h], [wx - winW * 0.9, h]);

  // 吊り下がった裸電球の紐
  ctx.strokeStyle = "rgba(90, 88, 82, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w * 0.78, 0);
  ctx.lineTo(w * 0.78, h * 0.3);
  ctx.stroke();
  const bg2 = ctx.createRadialGradient(w * 0.78, h * 0.31, 0, w * 0.78, h * 0.31, w * 0.16);
  bg2.addColorStop(0, "rgba(228, 198, 138, 0.32)");
  bg2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bg2;
  ctx.fillRect(0, 0, w, h);
}

function paintPhone(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const bx = w * (0.36 + rng() * 0.2);
  const horizon = h * 0.62;

  ctx.fillStyle = "rgba(14, 14, 17, 0.6)";
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = "rgba(24, 23, 23, 0.95)";
  ctx.fillRect(0, horizon, w, h - horizon);

  // 電話ボックスの箱
  const boxW = w * 0.26;
  const boxH = h * 0.52;
  const boxY = horizon - boxH;
  const inner = ctx.createLinearGradient(bx, boxY, bx, boxY + boxH);
  inner.addColorStop(0, "rgba(206, 214, 206, 0.30)");
  inner.addColorStop(1, "rgba(120, 130, 122, 0.16)");
  ctx.fillStyle = inner;
  ctx.fillRect(bx, boxY, boxW, boxH);
  ctx.strokeStyle = "rgba(190, 196, 188, 0.4)";
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, boxY, boxW, boxH);
  // 桟
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(bx + boxW * 0.5, boxY);
  ctx.lineTo(bx + boxW * 0.5, boxY + boxH);
  ctx.moveTo(bx, boxY + boxH * 0.34);
  ctx.lineTo(bx + boxW, boxY + boxH * 0.34);
  ctx.stroke();
  // 中の受話器と光
  const g = ctx.createRadialGradient(bx + boxW * 0.5, boxY + boxH * 0.3, 0, bx + boxW * 0.5, boxY + boxH * 0.3, boxW);
  g.addColorStop(0, "rgba(214, 222, 200, 0.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // アスファルトの反射
  ctx.fillStyle = "rgba(190, 200, 186, 0.06)";
  ctx.fillRect(bx, horizon, boxW, h * 0.2);
}

function paintCrossing(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const horizon = h * 0.58;
  const vx = w * (0.44 + rng() * 0.12);

  ctx.fillStyle = "rgba(15, 15, 19, 0.62)";
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = "rgba(26, 25, 25, 0.95)";
  ctx.fillRect(0, horizon, w, h - horizon);

  // 線路(奥へ収束)
  ctx.strokeStyle = "rgba(170, 168, 158, 0.30)";
  ctx.lineWidth = 2;
  for (const off of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(vx + off * w * 0.02, horizon);
    ctx.lineTo(vx + off * w * 0.42, h);
    ctx.stroke();
  }
  // 枕木
  for (let i = 0; i < 9; i++) {
    const d = i / 9;
    const y = lerp(horizon, h, d * d + 0.05);
    const half = lerp(w * 0.03, w * 0.44, d);
    ctx.strokeStyle = `rgba(150, 146, 138, ${0.08 + 0.14 * d})`;
    ctx.lineWidth = lerp(1, 4, d);
    ctx.beginPath();
    ctx.moveTo(vx - half, y);
    ctx.lineTo(vx + half, y);
    ctx.stroke();
  }

  // 遮断機と警報灯
  for (const side of [-1, 1]) {
    const x = vx + side * w * 0.33;
    ctx.strokeStyle = "rgba(10, 10, 11, 0.9)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.95);
    ctx.lineTo(x, horizon - h * 0.16);
    ctx.stroke();
    // 警報灯
    const ly = horizon - h * 0.16;
    const lg = ctx.createRadialGradient(x, ly, 0, x, ly, w * 0.1);
    lg.addColorStop(0, rgba(o.accent, 0.6));
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(x, ly, w * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  // 遮断桿(斜めに降りている)
  ctx.strokeStyle = "rgba(220, 214, 200, 0.55)";
  ctx.lineWidth = 4;
  ctx.setLineDash([w * 0.035, w * 0.035]);
  ctx.beginPath();
  ctx.moveTo(vx - w * 0.33, horizon - h * 0.04);
  ctx.lineTo(vx + w * 0.16, horizon + h * 0.02);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintWard(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  ctx.fillStyle = "rgba(18, 19, 20, 0.55)";
  ctx.fillRect(0, 0, w, h);

  // 窓からの薄明かり
  const wx = w * (0.58 + rng() * 0.14);
  const wy = h * 0.16;
  const ww = w * 0.3;
  const wh = h * 0.36;
  const mg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
  mg.addColorStop(0, "rgba(186, 192, 188, 0.34)");
  mg.addColorStop(1, "rgba(110, 116, 114, 0.14)");
  ctx.fillStyle = mg;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = "rgba(24, 24, 24, 0.85)";
  ctx.lineWidth = 3;
  ctx.strokeRect(wx, wy, ww, wh);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.stroke();

  // ベッド(シルエット)
  const by = h * 0.66;
  ctx.fillStyle = "rgba(196, 198, 192, 0.20)";
  ctx.fillRect(w * 0.08, by, w * 0.5, h * 0.1);
  ctx.fillStyle = "rgba(10, 10, 11, 0.85)";
  ctx.fillRect(w * 0.08, by + h * 0.1, w * 0.5, h * 0.05);
  // 枕とヘッドボード
  ctx.fillStyle = "rgba(210, 212, 205, 0.26)";
  ctx.fillRect(w * 0.1, by - h * 0.035, w * 0.12, h * 0.04);
  ctx.fillStyle = "rgba(12, 12, 13, 0.9)";
  ctx.fillRect(w * 0.06, by - h * 0.12, w * 0.02, h * 0.14);

  // カーテンレールと点滴スタンド
  ctx.strokeStyle = "rgba(150, 148, 140, 0.28)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.62, by - h * 0.02);
  ctx.lineTo(w * 0.62, h * 0.28);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.62, h * 0.27, w * 0.012, 0, Math.PI * 2);
  ctx.stroke();
}

function paintElevator(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  ctx.fillStyle = "rgba(17, 16, 17, 0.5)";
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.5 + (rng() - 0.5) * w * 0.06;
  const dw = w * 0.46;
  const dh = h * 0.76;
  const dy = h * 0.12;

  // 金属の扉
  const metal = ctx.createLinearGradient(cx - dw / 2, 0, cx + dw / 2, 0);
  metal.addColorStop(0, "rgba(74, 74, 76, 0.9)");
  metal.addColorStop(0.45, "rgba(126, 126, 128, 0.9)");
  metal.addColorStop(0.5, "rgba(30, 30, 32, 1)");
  metal.addColorStop(0.55, "rgba(126, 126, 128, 0.9)");
  metal.addColorStop(1, "rgba(70, 70, 72, 0.9)");
  ctx.fillStyle = metal;
  ctx.fillRect(cx - dw / 2, dy, dw, dh);
  // 縦の筋
  ctx.strokeStyle = "rgba(180, 180, 180, 0.10)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 14; i++) {
    const x = cx - dw / 2 + (dw / 14) * i;
    ctx.beginPath();
    ctx.moveTo(x, dy);
    ctx.lineTo(x, dy + dh);
    ctx.stroke();
  }
  // 階数表示
  ctx.fillStyle = "rgba(8, 8, 9, 0.95)";
  ctx.fillRect(cx - w * 0.09, dy - h * 0.09, w * 0.18, h * 0.07);
  ctx.fillStyle = rgba(o.accent, 0.8);
  ctx.font = `bold ${Math.round(h * 0.05)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(["B1", "4", "13", "7"][Math.floor(rng() * 4)], cx, dy - h * 0.055);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  // 上からの照明
  const g = ctx.createRadialGradient(cx, dy - h * 0.02, 0, cx, dy, w * 0.6);
  g.addColorStop(0, "rgba(200, 198, 180, 0.20)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// 背景への「写り込み」。輪郭をぼかすため、少しずつずらして薄く重ね描きする
function paintApparition(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h } = o;
  const gx = w * (0.12 + rng() * 0.76);
  const scale = 0.28 + rng() * 0.22;
  const headR = h * 0.05 * scale * 2;
  const headY = h * (0.42 + rng() * 0.12);
  const alpha = 0.1 + (o.intensity - 0.7) * 0.4;

  for (let pass = 0; pass < 3; pass++) {
    const off = pass * 1.6;
    ctx.fillStyle = `rgba(6, 5, 7, ${alpha / (pass + 1)})`;
    // 胴
    ctx.beginPath();
    ctx.moveTo(gx - headR * 1.6 - off, headY + headR);
    ctx.quadraticCurveTo(gx - headR * 2.2 - off, headY + h * 0.3 * scale, gx - headR * 1.9 - off, headY + h * 0.42 * scale);
    ctx.lineTo(gx + headR * 1.9 + off, headY + h * 0.42 * scale);
    ctx.quadraticCurveTo(gx + headR * 2.2 + off, headY + h * 0.3 * scale, gx + headR * 1.6 + off, headY + headR);
    ctx.closePath();
    ctx.fill();
    // 頭
    ctx.beginPath();
    ctx.arc(gx, headY, headR + off * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- オカルト / 科学 の紋章 ----
// 二択の見せ場で使う、対になる二つの意匠。どちらも線画で、テーマのアクセント色で光る

export interface EmblemPaintOptions {
  kind: "occult" | "science";
  size: number;
  accent: [number, number, number];
  active: boolean;
}

export function paintEmblem(ctx: CanvasRenderingContext2D, o: EmblemPaintOptions): void {
  const s = o.size;
  const c = s / 2;
  const rng = makeRng(`emblem:${o.kind}`);
  ctx.clearRect(0, 0, s, s);

  // 下地の光
  const bg = ctx.createRadialGradient(c, c, 0, c, c, s * 0.6);
  bg.addColorStop(0, o.active ? rgba(o.accent, 0.3) : "rgba(30, 28, 31, 0.85)");
  bg.addColorStop(1, "rgba(6, 6, 8, 0.95)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);

  const line = o.active ? rgba(o.accent, 0.95) : "rgba(206, 202, 194, 0.55)";
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = Math.max(1.5, s * 0.012);

  if (o.kind === "occult") {
    // 円環 + 鳥居 + 放射する呪符の線
    ctx.beginPath();
    ctx.arc(c, c, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c, c, s * 0.3, 0, Math.PI * 2);
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 放射線
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.globalAlpha = 0.25 + rng() * 0.35;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * s * 0.36, c + Math.sin(a) * s * 0.36);
      ctx.lineTo(c + Math.cos(a) * s * 0.45, c + Math.sin(a) * s * 0.45);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 鳥居
    const tw = s * 0.34;
    const th = s * 0.3;
    const ty = c - th * 0.45;
    ctx.lineWidth = Math.max(2, s * 0.022);
    ctx.beginPath();
    ctx.moveTo(c - tw * 0.62, ty);
    ctx.lineTo(c + tw * 0.62, ty);
    ctx.moveTo(c - tw * 0.5, ty + th * 0.22);
    ctx.lineTo(c + tw * 0.5, ty + th * 0.22);
    ctx.moveTo(c - tw * 0.38, ty);
    ctx.lineTo(c - tw * 0.38, ty + th);
    ctx.moveTo(c + tw * 0.38, ty);
    ctx.lineTo(c + tw * 0.38, ty + th);
    ctx.stroke();
  } else {
    // 円環 + 原子軌道 + 目盛り
    ctx.beginPath();
    ctx.arc(c, c, s * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.2, s * 0.009);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((i / 3) * Math.PI);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.3, s * 0.12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 核
    ctx.beginPath();
    ctx.arc(c, c, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
    // 目盛り
    ctx.lineWidth = Math.max(1, s * 0.008);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const inner = i % 6 === 0 ? s * 0.4 : s * 0.43;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.lineTo(c + Math.cos(a) * s * 0.46, c + Math.sin(a) * s * 0.46);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 粒子
  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 18;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

// 写真らしさ(粒子・走査線・周辺減光・色かぶり)を最後にまとめて乗せる
function postProcess(ctx: CanvasRenderingContext2D, o: ScenePaintOptions, rng: () => number) {
  const { width: w, height: h, intensity } = o;

  // 奥の霧
  const fog = ctx.createLinearGradient(0, h * 0.2, 0, h);
  fog.addColorStop(0, "rgba(140, 138, 130, 0.14)");
  fog.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, w, h);

  // 危険度に応じた赤かぶり
  if (intensity > 0.02) {
    ctx.fillStyle = rgba(o.accent, 0.05 + intensity * 0.22);
    ctx.fillRect(0, 0, w, h);
  }

  // 周辺減光
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, `rgba(0,0,0,${0.46 + intensity * 0.22})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // フィルム粒子
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const amount = 20 + intensity * 34;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);

  // 走査線(ブラウン管越しに見ているような線)
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

  // 侵蝕が強い時だけ、横に走る帯ノイズ
  if (intensity > 0.55) {
    const bands = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < bands; i++) {
      const by = rng() * h;
      const bh = 1 + rng() * 3;
      ctx.fillStyle = rgba(o.accent, 0.14 + rng() * 0.12);
      ctx.fillRect(0, by, w, bh);
    }
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function quad(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number]
) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
  ctx.closePath();
  ctx.fill();
}

// ---- 怪異の姿(名鑑の挿絵) ----
// 心霊写真のように「写っているのかどうかも判然としない」輪郭を、名前を種にして描く。
// 同じ怪異は常に同じ姿になり、危険度が上がるほど輪郭がはっきりしてくる

export interface KaiiPaintOptions {
  seed: string;
  size: number;
  dangerLevel: number; // 0〜4
  accent: [number, number, number];
}

export function paintKaii(ctx: CanvasRenderingContext2D, o: KaiiPaintOptions): void {
  const s = o.size;
  const rng = makeRng(`kaii:${o.seed}`);
  const clarity = 0.28 + o.dangerLevel * 0.16; // 危険度が高い=はっきり写る

  ctx.clearRect(0, 0, s, s);
  // 背景(粗い暗がり)
  const bg = ctx.createRadialGradient(s * 0.5, s * 0.45, 0, s * 0.5, s * 0.5, s * 0.75);
  bg.addColorStop(0, "rgba(38, 36, 38, 1)");
  bg.addColorStop(1, "rgba(9, 8, 10, 1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, s, s);

  const cx = s * (0.42 + rng() * 0.16);
  const headR = s * (0.1 + rng() * 0.04);
  const headY = s * (0.26 + rng() * 0.08);
  const tall = 0.7 + rng() * 0.5;
  const tilt = (rng() - 0.5) * 0.5;
  const floating = rng() > 0.55;
  const hairLen = s * (0.18 + rng() * 0.4);

  ctx.save();
  ctx.translate(cx, headY);
  ctx.rotate(tilt * 0.25);
  ctx.translate(-cx, -headY);

  const body = `rgba(6, 5, 7, ${0.55 + clarity * 0.45})`;

  // 胴(裾は霧のように消える)
  const bodyGrad = ctx.createLinearGradient(0, headY, 0, s * (floating ? 0.86 : 1.0));
  bodyGrad.addColorStop(0, body);
  bodyGrad.addColorStop(floating ? 0.62 : 0.85, body);
  bodyGrad.addColorStop(1, "rgba(6,5,7,0)");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 1.5, headY + headR * 0.9);
  ctx.quadraticCurveTo(cx - headR * 2.4, s * 0.6 * tall + headY, cx - headR * (2.0 + rng()), s);
  ctx.lineTo(cx + headR * (2.0 + rng()), s);
  ctx.quadraticCurveTo(cx + headR * 2.4, s * 0.6 * tall + headY, cx + headR * 1.5, headY + headR * 0.9);
  ctx.closePath();
  ctx.fill();

  // 頭
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  // 長い髪
  ctx.fillStyle = `rgba(4, 3, 5, ${0.6 + clarity * 0.4})`;
  ctx.beginPath();
  ctx.moveTo(cx - headR * 1.05, headY - headR * 0.15);
  ctx.quadraticCurveTo(cx - headR * 1.9, headY + hairLen * 0.6, cx - headR * (0.6 + rng() * 0.8), headY + hairLen);
  ctx.lineTo(cx + headR * (0.6 + rng() * 0.8), headY + hairLen);
  ctx.quadraticCurveTo(cx + headR * 1.9, headY + hairLen * 0.6, cx + headR * 1.05, headY - headR * 0.15);
  ctx.quadraticCurveTo(cx, headY - headR * 1.5, cx - headR * 1.05, headY - headR * 0.15);
  ctx.closePath();
  ctx.fill();

  // 目(危険度が高いほど光る)
  if (o.dangerLevel >= 2) {
    const eyeR = headR * 0.16;
    for (const side of [-1, 1]) {
      const ex = cx + side * headR * 0.38;
      const ey = headY + headR * 0.08;
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, eyeR * 4);
      g.addColorStop(0, rgba(o.accent, 0.85));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  // 粒子と減光(写真らしさ)
  const vig = ctx.createRadialGradient(s * 0.5, s * 0.5, s * 0.15, s * 0.5, s * 0.5, s * 0.72);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.8)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, s, s);

  const img = ctx.getImageData(0, 0, s, s);
  const d = img.data;
  const amount = 30 + (4 - o.dangerLevel) * 8;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n);
  }
  ctx.putImageData(img, 0, 0);
}

// ---- 捜査資料の相関図 ----
// 捜査本部の壁に貼られた、糸で結ばれた相関図を模した図。
// ノードは本日の作業そのもので、線の色が危険度を表す

export interface DiagramNode {
  label: string;
  level: number; // 0〜4
  done: boolean;
}

export interface DiagramPaintOptions {
  width: number;
  height: number;
  centerLabel: string;
  nodes: DiagramNode[];
  accent: [number, number, number];
  seed: string;
}

export function paintDiagram(ctx: CanvasRenderingContext2D, o: DiagramPaintOptions): void {
  const { width: w, height: h } = o;
  const rng = makeRng(`diagram:${o.seed}`);

  // 下地(古い紙・掲示板)
  ctx.fillStyle = "rgba(18, 17, 18, 1)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(120, 116, 110, 0.055)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 22) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const cx = w * 0.5;
  const cy = h * 0.5;
  const n = o.nodes.length;
  // 横は幅、縦は高さを基準にした楕円配置。中央の箱と札が重ならない距離を確保する
  const rx = w * 0.33;
  const ry = h * 0.33;

  // 手描きの震えを持つ線を引く
  const wobblyLine = (x0: number, y0: number, x1: number, y1: number, color: string, width: number) => {
    const steps = 14;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitter = (rng() - 0.5) * 2.4;
      ctx.lineTo(lerp(x0, x1, t) + jitter, lerp(y0, y1, t) + jitter);
    }
    ctx.stroke();
  };

  const positions: { x: number; y: number; node: DiagramNode }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
    positions.push({
      x: cx + Math.cos(a) * rx * (0.92 + rng() * 0.16),
      y: cy + Math.sin(a) * ry * (0.88 + rng() * 0.2),
      node: o.nodes[i],
    });
  }

  // 糸
  for (const p of positions) {
    const alpha = p.node.done ? 0.2 : 0.35 + p.node.level * 0.12;
    const color = p.node.level >= 2 ? rgba(o.accent, alpha) : `rgba(196, 190, 178, ${alpha * 0.7})`;
    wobblyLine(cx, cy, p.x, p.y, color, p.node.level >= 3 ? 1.8 : 1);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 周囲の付箋(作業)
  for (const p of positions) {
    const label = p.node.label.length > 6 ? `${p.node.label.slice(0, 6)}…` : p.node.label;
    ctx.font = `${Math.max(9, Math.round(w * 0.026))}px sans-serif`;
    const tw = Math.max(ctx.measureText(label).width + 12, 34);
    const th = Math.max(16, h * 0.075);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((rng() - 0.5) * 0.16);
    ctx.fillStyle = p.node.done ? "rgba(40, 39, 38, 0.9)" : "rgba(58, 55, 52, 0.95)";
    ctx.fillRect(-tw / 2, -th / 2, tw, th);
    ctx.strokeStyle = p.node.level >= 2 ? rgba(o.accent, 0.6) : "rgba(150, 145, 135, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-tw / 2, -th / 2, tw, th);
    ctx.fillStyle = p.node.done ? "rgba(190, 186, 178, 0.45)" : "rgba(228, 224, 214, 0.9)";
    ctx.fillText(label, 0, 0.5);
    ctx.restore();
    // 画鋲
    ctx.fillStyle = rgba(o.accent, 0.75);
    ctx.beginPath();
    ctx.arc(p.x, p.y - th * 0.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 中心(本日)
  const cw = Math.max(56, w * 0.2);
  const ch = Math.max(22, h * 0.1);
  ctx.fillStyle = "rgba(12, 11, 12, 0.95)";
  ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
  ctx.strokeStyle = rgba(o.accent, 0.8);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - cw / 2, cy - ch / 2, cw, ch);
  ctx.fillStyle = rgba(o.accent, 0.95);
  ctx.font = `bold ${Math.max(10, Math.round(w * 0.03))}px sans-serif`;
  ctx.fillText(o.centerLabel, cx, cy + 0.5);

  // 紙の粒子
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const nz = (rng() - 0.5) * 16;
    d[i] = clamp255(d[i] + nz);
    d[i + 1] = clamp255(d[i + 1] + nz);
    d[i + 2] = clamp255(d[i + 2] + nz);
  }
  ctx.putImageData(img, 0, 0);
}

// ============================================================
// 分岐ツリー(案件の段階を、シナリオの分岐ツリーに見立てて描く)
// ============================================================
// 原作は『流行り神2』以降、シナリオ全体の分岐構造を俯瞰し、既読/未読が
// 一目でわかる「分岐ツリー」を備える。ここでは案件の段階(マイルストーン)を
// 一本道の捜査ルートに見立て、済んだ段階・現在地・これからの段階を並べて描く

export interface BranchNode {
  done: boolean;
  current: boolean;
  overdue: boolean;
}

export interface BranchTreePaintOptions {
  width: number;
  height: number;
  nodes: BranchNode[];
  accent: [number, number, number];
  seed: string;
}

export function paintBranchTree(ctx: CanvasRenderingContext2D, o: BranchTreePaintOptions): void {
  const { width: w, height: h, accent, nodes } = o;
  const rng = makeRng(`branch:${o.seed}`);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(16, 15, 16, 0.9)";
  ctx.fillRect(0, 0, w, h);

  if (nodes.length === 0) return;

  const midY = h * 0.56;
  const marginX = Math.min(18, w * 0.06);
  const step = nodes.length > 1 ? (w - marginX * 2) / (nodes.length - 1) : 0;
  const xs = nodes.map((_, i) => marginX + step * i);

  // 手描きの震えを持つ一本道
  ctx.strokeStyle = "rgba(196, 190, 178, 0.35)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(xs[0], midY);
  for (let i = 1; i < xs.length; i++) {
    const steps = 8;
    const x0 = xs[i - 1];
    const x1 = xs[i];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      ctx.lineTo(lerp(x0, x1, t), midY + (rng() - 0.5) * 2.2);
    }
  }
  ctx.stroke();

  // 済んだ区間だけ、アクセント色の糸を重ねて濃くする(捜査の歩みそのもの)
  const doneUpTo = nodes.reduce((acc, n, i) => (n.done ? i : acc), -1);
  if (doneUpTo > 0) {
    ctx.strokeStyle = rgba(accent, 0.55);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(xs[0], midY);
    ctx.lineTo(xs[doneUpTo], midY);
    ctx.stroke();
  }

  const r = Math.min(7, h * 0.16);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const x = xs[i];

    if (n.overdue) {
      // 延滞している段階だけ、下へ垂れる赤い糸(差し戻し)を足す
      ctx.strokeStyle = rgba(accent, 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, midY + r);
      ctx.lineTo(x + (rng() - 0.5) * 3, midY + r + h * 0.22);
      ctx.stroke();
    }

    if (n.current) {
      // 現在地: 明るい halo と、上から刺さる画鋲
      const halo = ctx.createRadialGradient(x, midY, 0, x, midY, r * 2.4);
      halo.addColorStop(0, rgba(accent, 0.55));
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, midY, r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(x - 4, midY - r - 10);
      ctx.lineTo(x + 4, midY - r - 10);
      ctx.lineTo(x, midY - r - 3);
      ctx.closePath();
      ctx.fillStyle = rgba(accent, 0.95);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, midY, r, 0, Math.PI * 2);
    if (n.done) {
      ctx.fillStyle = rgba(accent, 0.85);
      ctx.fill();
    } else if (n.current) {
      ctx.fillStyle = "rgba(20, 18, 18, 0.95)";
      ctx.fill();
      ctx.strokeStyle = rgba(accent, 1);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(20, 18, 18, 0.9)";
      ctx.fill();
      ctx.strokeStyle = "rgba(196, 190, 178, 0.45)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    ctx.fillStyle = n.done ? "rgba(20, 18, 18, 0.9)" : "rgba(220, 216, 208, 0.8)";
    ctx.font = `${Math.max(8, Math.round(r * 1.15))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), x, midY + 0.5);
  }

  // 紙の粒子
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const nz = (rng() - 0.5) * 10;
    d[i] = clamp255(d[i] + nz);
    d[i + 1] = clamp255(d[i + 1] + nz);
    d[i + 2] = clamp255(d[i + 2] + nz);
  }
  ctx.putImageData(img, 0, 0);
}

// テーマのアクセント色(CSS変数)を読み、Canvasで使えるRGBに変換する
export function readAccentRgb(): [number, number, number] {
  if (typeof window === "undefined") return [176, 26, 38];
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
    return [parts[0], parts[1], parts[2]];
  }
  return [176, 26, 38];
}
