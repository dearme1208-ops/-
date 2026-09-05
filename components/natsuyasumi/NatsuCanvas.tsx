"use client";

import { useEffect, useRef, useState } from "react";
import {
  diaryPictureHeight,
  paintDiaryPicture,
  paintInsect,
  paintRuledPaper,
  paintScenery,
  paintStampCard,
  sceneryHeight,
  stampCardHeight,
} from "@/lib/natsuyasumiArt";
import type { Phase, Species, Weather } from "@/lib/natsuyasumi";

// 幅を測って追従する共通の器。図版はどれも横幅いっぱいに敷くので、
// 個別に同じResizeObserverを書かずに済むようここへ寄せた
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
    // 一枚絵は最後に画素ごとの粒を乗せるため、倍率を上げすぎると重くなる。
    // 見た目が破綻しない範囲で1.5倍までに留めている
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.5);
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

/** 幅も高さも固定の小さな図版用 */
function useFixedCanvas(size: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
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

// ---- 一枚絵(その日その時間の風景) ----
export function Scenery({
  phase,
  weather,
  blooms,
  growth,
  caught,
  seed,
  className,
}: {
  phase: Phase;
  weather: Weather;
  blooms: number;
  growth: number;
  caught: number;
  seed: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => sceneryHeight(w),
    (ctx, width, height) =>
      paintScenery(ctx, { width, height, phase, weather, blooms, growth, caught, seed }),
    [phase, weather, blooms, Math.round(growth * 20), caught, seed]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="今日の風景" />
    </div>
  );
}

// ---- ラジオ体操カード ----
export function StampCard({
  stamps,
  title,
  seed,
  className,
}: {
  stamps: boolean[];
  title: string;
  seed: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => stampCardHeight(),
    (ctx, width, height) => paintStampCard(ctx, { width, height, stamps, title, seed }),
    [stamps.filter(Boolean).length, stamps.length, title, seed]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label={title} />
    </div>
  );
}

// ---- 虫 ----
export function Insect({
  species,
  scale,
  rarity,
  size = 52,
  dim = false,
  className,
}: {
  species: Species;
  scale: number;
  rarity: number;
  size?: number;
  dim?: boolean;
  className?: string;
}) {
  const ref = useFixedCanvas(
    size,
    (ctx) => paintInsect(ctx, { size, species, scale, rarity, dim }),
    [species, Math.round(scale * 20), rarity, dim]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

// ---- 絵日記の絵 ----
export function DiaryPicture({
  seed,
  phase,
  weather,
  blooms,
  className,
}: {
  seed: string;
  phase: Phase;
  weather: Weather;
  blooms: number;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => diaryPictureHeight(w),
    (ctx, width, height) => paintDiaryPicture(ctx, { width, height, seed, phase, weather, blooms }),
    [seed, phase, weather, blooms]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="きょうの え" />
    </div>
  );
}

// ---- 日記の罫線。上に本文をDOMで重ねて使う ----
export function RuledPaper({ lineHeight = 26, className }: { lineHeight?: number; className?: string }) {
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
      paintRuledPaper(ctx, { width: w, height: h, lineHeight });
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(host);
    return () => ro.disconnect();
  }, [lineHeight]);

  return (
    <div ref={hostRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
