import { formatDateJp, formatHms } from "./time";
import type { WorkRecord } from "./types";

export interface LifeArtData {
  appTitle: string;
  records: WorkRecord[];
}

function themeColor(varName: string, fallback: [number, number, number]): [number, number, number] {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  const parts = raw.split(/\s+/).map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  return [parts[0], parts[1], parts[2]];
}

function rgb([r, g, b]: [number, number, number], alpha = 1): string {
  return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 大項目名から安定したハッシュ値(色相)を作る。同じ大項目は常に同じ色になる
function categoryHue(category: string): number {
  let h = 0;
  for (let i = 0; i < category.length; i++) {
    h = (h * 31 + category.charCodeAt(i)) % 360;
  }
  return h;
}

const SIZE = 900;

// 全期間の実績1件1件を星として配置する。角度=1日のうちの開始時刻(0時=真上、時計回り)、
// 半径=最初の記録からの経過時間(古いほど中心に近く、新しいほど外側)。同じ時間帯に働く
// 習慣があるほど、渦が「腕」のようにまとまって見える。星の大きさ=その記録の作業時間、
// 色=大項目ごとに安定したハッシュ色相。日をまたがない連続した記録は淡い糸で結び、
// 星座のように見せる
export function renderLifeArt(canvas: HTMLCanvasElement, data: LifeArtData) {
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ink = themeColor("--ink-rgb", [11, 11, 12]);
  const panel = themeColor("--panel-rgb", [21, 21, 23]);
  const cream = themeColor("--cream-rgb", [233, 230, 189]);
  const accent = themeColor("--accent-rgb", [194, 59, 59]);

  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // 背景: 中心がわずかに明るいグラデーション
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE * 0.75);
  bg.addColorStop(0, rgb(panel));
  bg.addColorStop(1, rgb(ink));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const records = data.records
    .filter((r) => !r.excludedFromStats)
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt);

  if (records.length === 0) return;

  const firstTime = records[0].startedAt;
  const lastTime = records[records.length - 1].startedAt;
  const span = Math.max(1, lastTime - firstTime);
  const minR = 36;
  const maxR = SIZE * 0.44;
  const maxSeconds = Math.max(...records.map((r) => r.seconds), 1);

  function position(r: WorkRecord): { x: number; y: number } {
    const d = new Date(r.startedAt);
    const hourFrac = (d.getHours() + d.getMinutes() / 60) / 24;
    const angle = hourFrac * Math.PI * 2 - Math.PI / 2;
    const progress = (r.startedAt - firstTime) / span;
    const radius = minR + progress * (maxR - minR);
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  }

  // ほのかな環状の目盛り(0時/6時/12時/18時の方向を示す薄い放射線)
  ctx.strokeStyle = rgb(cream, 0.06);
  ctx.lineWidth = 1;
  for (let h = 0; h < 4; h++) {
    const angle = (h / 4) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + maxR * Math.cos(angle), cy + maxR * Math.sin(angle));
    ctx.stroke();
  }

  // 同じ日に連続する記録を淡い糸でつなぐ(星座のような連なり)
  ctx.strokeStyle = rgb(cream, 0.1);
  ctx.lineWidth = 1;
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1];
    const cur = records[i];
    if (prev.date !== cur.date) continue;
    const p1 = position(prev);
    const p2 = position(cur);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // 星本体
  for (const r of records) {
    const { x, y } = position(r);
    const hue = categoryHue(r.category);
    const sizeT = Math.sqrt(r.seconds / maxSeconds);
    const radius = 1.6 + sizeT * 6.5;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.6);
    glow.addColorStop(0, `hsla(${hue}, 70%, 72%, 0.9)`);
    glow.addColorStop(1, `hsla(${hue}, 70%, 60%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsla(${hue}, 75%, 82%, 0.95)`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // 中心の光点(最初の記録=すべての起点)
  const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
  coreGlow.addColorStop(0, rgb(accent, 0.9));
  coreGlow.addColorStop(1, rgb(accent, 0));
  ctx.fillStyle = coreGlow;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fill();

  // 上位カテゴリの凡例(左上、控えめに)
  const totals = new Map<string, number>();
  for (const r of records) totals.set(r.category, (totals.get(r.category) ?? 0) + r.seconds);
  const topCategories = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  ctx.textAlign = "left";
  ctx.font = "500 13px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  let legendY = 34;
  for (const [category] of topCategories) {
    const hue = categoryHue(category);
    ctx.fillStyle = `hsla(${hue}, 75%, 72%, 0.95)`;
    ctx.beginPath();
    ctx.arc(30, legendY - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(cream, 0.6);
    ctx.fillText(category, 42, legendY);
    legendY += 20;
  }

  // タイトル・期間・合計時間(下部、控えめなキャプション)
  const totalSeconds = records.reduce((s, r) => s + r.seconds, 0);
  ctx.textAlign = "center";
  ctx.fillStyle = rgb(cream, 0.85);
  ctx.font = "700 20px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(`${data.appTitle} 全期間の軌跡`, cx, SIZE - 56);
  ctx.fillStyle = rgb(cream, 0.5);
  ctx.font = "500 14px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(
    `${formatDateJp(records[0].date)} 〜 ${formatDateJp(records[records.length - 1].date)}　合計 ${formatHms(totalSeconds)}`,
    cx,
    SIZE - 32
  );
}
