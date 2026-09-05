"use client";

import { useEffect, useRef } from "react";
import { paintKaii, readAccentRgb } from "@/lib/hayarigamiArt";

// 名鑑に載せる怪異の「姿」。心霊写真のように判然としない輪郭を、
// 怪異名を種にして描く。危険度が上がるほど輪郭がはっきりしてくる
export default function KaiiSilhouette({
  seed,
  size,
  dangerLevel,
  className,
}: {
  seed: string;
  size: number;
  dangerLevel: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintKaii(ctx, { seed, size, dangerLevel, accent: readAccentRgb() });
  }, [seed, size, dangerLevel]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
