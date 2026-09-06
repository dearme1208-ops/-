"use client";

import { useEffect, useRef, useState } from "react";
import {
  paintAltimeter,
  paintClimbLog,
  paintPanorama,
  paintProfile,
  paintSignboard,
  paintTopo,
  paintWeatherGlyph,
  profileHeight,
  type SkyPhase,
} from "@/lib/mountainArt";
import type { Weather } from "@/lib/mountain";

// 幅を測って追従する共通の器(他モードの図版と同じ作り)。
// 図版はどれも横幅いっぱいに敷くので、個別に同じResizeObserverを書かずに済ませる
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

  return { wrapRef, canvasRef };
}

function useFixedCanvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, ...deps]);
  return canvasRef;
}

/** 主役の一枚絵。空・連山・主峰・雪渓・樹林帯・ルート・登山者・天候を重ねて描く */
export function Panorama({
  phase,
  seed,
  rugged,
  progress,
  weather,
  summited,
  ratio = 0.52,
  className = "",
}: {
  phase: SkyPhase;
  seed: string;
  rugged: number;
  progress: number;
  weather: Weather;
  summited: boolean;
  ratio?: number;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => Math.round(w * ratio),
    (ctx, w, h) => paintPanorama(ctx, w, h, { phase, seed, rugged, progress, weather, summited }),
    [phase, seed, rugged, progress, weather, summited, ratio]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

/** 1つの山(案件)の高度断面図。通過点・現在標高・崩落箇所が読める */
export function Profile({
  summit,
  current,
  waypoints,
  seed,
  labels,
  compact = false,
  className = "",
}: {
  summit: number;
  current: number;
  waypoints: { title: string; altitude: number; passed: boolean; collapsed: boolean }[];
  seed: string;
  labels: { start: string; summit: string; now: string };
  compact?: boolean;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => profileHeight(compact),
    (ctx, w, h) => paintProfile(ctx, w, h, { summit, current, waypoints, seed, labels }),
    [summit, current, JSON.stringify(waypoints), seed, JSON.stringify(labels), compact]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

/** 円形の計器。獲得標高・行動時間などを1つずつ表す */
export function Altimeter({
  value,
  max,
  unit,
  caption,
  sub,
  size = 128,
}: {
  value: number;
  max: number;
  unit: string;
  caption: string;
  sub: string;
  size?: number;
}) {
  const ref = useFixedCanvas(size, size, (ctx) => paintAltimeter(ctx, size, size, { value, max, unit, caption, sub }), [
    value, max, unit, caption, sub,
  ]);
  return <canvas ref={ref} className="block" />;
}

/** 天気記号。晴/曇/雨/雷を線画で描く */
export function WeatherGlyph({ weather, size = 44 }: { weather: Weather; size?: number }) {
  const ref = useFixedCanvas(size, size, (ctx) => paintWeatherGlyph(ctx, size, size, weather), [weather]);
  return <canvas ref={ref} className="block" />;
}

/** 等高線の地形図。パネルの背景に敷く */
export function Topo({ seed, height = 120, className = "" }: { seed: string; height?: number; className?: string }) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => height,
    (ctx, w, h) => paintTopo(ctx, w, h, seed),
    [seed, height]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

/** 木の山名板。案件1件の見出しに使う */
export function Signboard({
  name,
  altitude,
  grade,
  summited,
  seed,
  height = 76,
  className = "",
}: {
  name: string;
  altitude: number;
  grade: string;
  summited: boolean;
  seed: string;
  height?: number;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => height,
    (ctx, w, h) => paintSignboard(ctx, w, h, { name, altitude, grade, summited, seed }),
    [name, altitude, grade, summited, seed, height]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

/** 直近N日の獲得標高を稜線のように描いたグラフ */
export function ClimbLogChart({
  entries,
  label,
  height = 92,
  className = "",
}: {
  entries: { date: string; meters: number }[];
  label: string;
  height?: number;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => height,
    (ctx, w, h) => paintClimbLog(ctx, w, h, entries, label),
    [JSON.stringify(entries), label, height]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
