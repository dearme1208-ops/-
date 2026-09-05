"use client";

import { useEffect, useRef, useState } from "react";
import {
  paintAbilityHex,
  paintCardBase,
  paintGauge,
  paintLineScore,
  paintPennantBar,
  paintPracticeIcon,
  paintRankEmblem,
  paintScoutBust,
  paintStadium,
  lineScoreHeight,
  pennantBarHeight,
  readPalette,
  EXP_COLOR,
  type LineScoreCell,
  type Rgb,
  type SkyPhase,
} from "@/lib/powerproArt";
import type { ExpKind, MotivationLevel, PracticeKind } from "@/lib/powerpro";

// アクセント色は設定でユーザーが自由に変えられ、インラインstyleで<html>に入る。
// 図版はreadPalette()経由でそれを拾うので、DOM側のボタンや見出しも同じ色に揃えないと
// 「球場は赤いのにボタンだけ青い」といった食い違いが起きる。そのための共有フック
export function useAccentRgb(): Rgb {
  const [accent, setAccent] = useState<Rgb>([32, 108, 214]);
  useEffect(() => {
    const read = () => setAccent(readPalette().accent);
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-visual-mode"] });
    return () => mo.disconnect();
  }, []);
  return accent;
}

/** アクセント色の縦グラデーション。光沢のあるボタン面をDOM側で作るときに使う */
export function accentPlateStyle(accent: Rgb, from = 1.12, to = 0.78): React.CSSProperties {
  const shade = (k: number) =>
    `rgb(${Math.min(255, Math.round(accent[0] * k))}, ${Math.min(255, Math.round(accent[1] * k))}, ${Math.min(
      255,
      Math.round(accent[2] * k)
    )})`;
  return { background: `linear-gradient(to bottom, ${shade(from)}, ${shade(to)})` };
}

// 幅を測って追従する共通の器。図版はどれも横幅いっぱいに敷くので、
// 個別に同じResizeObserverを書かずに済むようここへ寄せた(図書館モードと同じ作り)
function useMeasuredCanvas(
  heightFor: (width: number) => number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  deps: unknown[]
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const height = heightFor(width);
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, width, height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, ...deps]);

  return { wrapRef, canvasRef, width };
}

/** 幅も高さも固定の小さな図版用。アイコンや記章のように寸法が決まっているもの */
function useFixedCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  deps: unknown[]
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ...deps]);
  return canvasRef;
}

// ---- 球場(見出しの一枚絵) ----
export function Stadium({
  phase,
  motivation,
  running,
  injured,
  hot,
  fever,
  doneCount,
  totalCount,
  seed,
  className,
}: {
  phase: SkyPhase;
  motivation: MotivationLevel;
  running: boolean;
  injured: boolean;
  hot: number;
  fever: boolean;
  doneCount: number;
  totalCount: number;
  seed: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => Math.round(Math.max(180, Math.min(260, w * 0.58))),
    (ctx, width, height) =>
      paintStadium(ctx, {
        width,
        height,
        phase,
        motivation,
        running,
        injured,
        hot,
        fever,
        doneCount,
        totalCount,
        seed,
        palette: readPalette(),
      }),
    [phase, motivation, running, injured, Math.round(hot * 20), fever, doneCount, totalCount, seed]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="球場" />
    </div>
  );
}

// ---- 練習コマンドのアイコン ----
export function PracticeIcon({
  kind,
  expKind,
  size = 40,
  dim = false,
  className,
}: {
  kind: PracticeKind;
  expKind: ExpKind;
  size?: number;
  dim?: boolean;
  className?: string;
}) {
  const ref = useFixedCanvas(
    size,
    (ctx) => paintPracticeIcon(ctx, { size, kind, color: EXP_COLOR[expKind], dim }),
    [kind, expKind, dim]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

// ---- 光沢ゲージ ----
export function Gauge({
  value,
  color,
  segments = 0,
  danger = false,
  height = 12,
  className,
}: {
  value: number;
  color: Rgb;
  segments?: number;
  danger?: boolean;
  height?: number;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => height,
    (ctx, width, h) => paintGauge(ctx, { width, height: h, value, color, segments, danger }),
    [Math.round(value * 200), color.join(","), segments, danger, height]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" aria-hidden />
    </div>
  );
}

// ---- 能力値の六角形 ----
export function AbilityHex({
  values,
  labels,
  className,
}: {
  values: number[];
  labels: string[];
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => Math.round(Math.max(160, Math.min(220, w * 0.8))),
    (ctx, width, height) => {
      const p = readPalette();
      paintAbilityHex(ctx, { width, height, values, labels, accent: p.accent, ink: p.cream });
    },
    [values.join(","), labels.join(",")]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="能力値" />
    </div>
  );
}

// ---- ランクの記章 ----
export function RankEmblem({ rank, size = 44, className }: { rank: string; size?: number; className?: string }) {
  const ref = useFixedCanvas(size, (ctx) => paintRankEmblem(ctx, { size, rank }), [rank]);
  return <canvas ref={ref} className={className} role="img" aria-label={`ランク${rank}`} />;
}

// ---- スカウト候補の胸像(ToDo一覧) ----
export function ScoutBust({
  seed,
  urgency,
  done,
  size = 44,
  className,
}: {
  seed: string;
  urgency: number;
  done: boolean;
  size?: number;
  className?: string;
}) {
  const ref = useFixedCanvas(
    size,
    (ctx) => paintScoutBust(ctx, { size, seed, urgency, done, accent: readPalette().accent }),
    [seed, Math.round(urgency * 20), done]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

// ---- ペナントレースの勝敗バー(案件一覧) ----
export function PennantBar({
  cells,
  label,
  className,
}: {
  cells: ("win" | "loss" | "rest")[];
  label: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => pennantBarHeight(),
    (ctx, width, height) => {
      const p = readPalette();
      paintPennantBar(ctx, { width, height, cells, label, accent: p.accent, ink: p.cream });
    },
    [cells.join(""), label]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label={label} />
    </div>
  );
}

// ---- 選手カードの地。上に本文をDOMで重ねて使う ----
export function CardBase({
  rank,
  seed,
  className,
}: {
  rank: string;
  seed: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const render = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintCardBase(ctx, { width: w, height: h, accent: readPalette().accent, rank, seed });
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(host);
    return () => ro.disconnect();
  }, [rank, seed]);

  return (
    <div ref={hostRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

// ---- スコアボード(練習日誌タブの見出し) ----
export function LineScore({
  cells,
  totalMinutes,
  errors,
  labels,
  className,
}: {
  cells: LineScoreCell[];
  totalMinutes: number;
  errors: number;
  labels: { inning: string; runs: string; total: string; errors: string };
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => lineScoreHeight(),
    (ctx, width, height) => paintLineScore(ctx, { width, height, cells, totalMinutes, errors, labels }),
    [
      cells.map((c) => `${Math.round(c.minutes)}${c.over ? "!" : ""}${c.running ? "*" : ""}`).join(","),
      Math.round(totalMinutes),
      errors,
      labels.inning,
    ]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label={labels.inning} />
    </div>
  );
}
