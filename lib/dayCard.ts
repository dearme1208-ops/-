import { formatHms } from "./time";

export interface DayCardCategoryTotal {
  category: string;
  seconds: number;
}

export interface DayCardData {
  appTitle: string;
  date: string;
  totalSeconds: number;
  doneCount: number;
  streakDays: number;
  growthIcon: string;
  growthLabel: string;
  categoryTotals: DayCardCategoryTotal[];
  mvpTask?: { category: string; name: string; seconds: number };
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const CARD_W = 720;
const CARD_H = 960;

export function renderDayCard(canvas: HTMLCanvasElement, data: DayCardData) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ink = themeColor("--ink-rgb", [11, 11, 12]);
  const cream = themeColor("--cream-rgb", [233, 230, 189]);
  const panel = themeColor("--panel-rgb", [21, 21, 23]);
  const accent = themeColor("--accent-rgb", [194, 59, 59]);

  // 背景
  ctx.fillStyle = rgb(ink);
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 外枠パネル
  const margin = 32;
  roundRect(ctx, margin, margin, CARD_W - margin * 2, CARD_H - margin * 2, 24);
  ctx.fillStyle = rgb(panel);
  ctx.fill();
  ctx.strokeStyle = rgb(cream, 0.12);
  ctx.lineWidth = 1;
  ctx.stroke();

  const cx = CARD_W / 2;
  let y = margin + 56;

  // ヘッダー: アプリ名 + 日付
  ctx.textAlign = "center";
  ctx.fillStyle = rgb(cream, 0.55);
  ctx.font = "600 20px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(data.appTitle, cx, y);
  y += 34;
  ctx.fillStyle = rgb(cream, 0.9);
  ctx.font = "700 28px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(data.date, cx, y);
  y += 56;

  // 育成アイコン + ラベル
  ctx.font = "64px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(data.growthIcon, cx, y + 8);
  y += 44;
  ctx.fillStyle = rgb(cream, 0.7);
  ctx.font = "600 18px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(data.growthLabel, cx, y);
  y += 48;

  // 合計時間(大きく)
  ctx.fillStyle = rgb(accent);
  ctx.font = "800 64px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText(formatHms(data.totalSeconds), cx, y + 12);
  y += 44;
  ctx.fillStyle = rgb(cream, 0.5);
  ctx.font = "500 15px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillText("本日の合計作業時間", cx, y);
  y += 48;

  // カテゴリ別横棒グラフ(上位5件)
  const bars = data.categoryTotals.slice(0, 5);
  if (bars.length > 0) {
    ctx.textAlign = "left";
    const barAreaX = margin + 40;
    const barAreaW = CARD_W - margin * 2 - 80;
    const maxSeconds = Math.max(...bars.map((b) => b.seconds), 1);
    const barH = 28;
    const barGap = 16;
    for (const b of bars) {
      ctx.fillStyle = rgb(cream, 0.75);
      ctx.font = "600 15px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
      ctx.fillText(b.category, barAreaX, y);
      ctx.textAlign = "right";
      ctx.fillStyle = rgb(cream, 0.55);
      ctx.font = "500 13px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
      ctx.fillText(formatHms(b.seconds), barAreaX + barAreaW, y);
      ctx.textAlign = "left";
      y += 8;
      const w = Math.max(6, (b.seconds / maxSeconds) * barAreaW);
      roundRect(ctx, barAreaX, y, barAreaW, barH, barH / 2);
      ctx.fillStyle = rgb(cream, 0.08);
      ctx.fill();
      roundRect(ctx, barAreaX, y, w, barH, barH / 2);
      ctx.fillStyle = rgb(accent, 0.85);
      ctx.fill();
      y += barH + barGap;
    }
    ctx.textAlign = "center";
    y += 8;
  }

  // MVP作業
  if (data.mvpTask) {
    roundRect(ctx, margin + 40, y, CARD_W - margin * 2 - 80, 72, 16);
    ctx.fillStyle = rgb(accent, 0.12);
    ctx.fill();
    ctx.strokeStyle = rgb(accent, 0.4);
    ctx.stroke();
    ctx.fillStyle = rgb(accent);
    ctx.font = "700 14px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
    ctx.fillText("★ 本日のMVP作業", cx, y + 26);
    ctx.fillStyle = rgb(cream, 0.9);
    ctx.font = "600 18px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
    ctx.fillText(
      `${data.mvpTask.category} / ${data.mvpTask.name}（${formatHms(data.mvpTask.seconds)}）`,
      cx,
      y + 54
    );
    y += 96;
  }

  // フッター統計
  const footerY = CARD_H - margin - 48;
  ctx.font = "600 16px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillStyle = rgb(cream, 0.7);
  const footerParts = [`✅ 完了 ${data.doneCount}件`];
  if (data.streakDays > 0) footerParts.push(`🔥 連続${data.streakDays}日`);
  ctx.fillText(footerParts.join("　"), cx, footerY);

  // ウォーターマーク
  ctx.font = "400 12px system-ui, -apple-system, 'Hiragino Sans', sans-serif";
  ctx.fillStyle = rgb(cream, 0.3);
  ctx.fillText(data.appTitle, cx, CARD_H - margin - 14);
}
