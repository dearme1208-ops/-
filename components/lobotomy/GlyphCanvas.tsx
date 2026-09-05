"use client";

import { useEffect, useRef } from "react";
import {
  paintEnergyMeter,
  paintOrdealSigil,
  paintRiskSeal,
  paintVirtueChart,
  paintWorkGlyph,
  readAccentRgb,
  readCreamRgb,
} from "@/lib/lobotomyArt";
import type { OrdealKind, RiskLevel, WorkType } from "@/lib/lobotomy";

// 小さな図版はどれも「サイズと数個の値を渡して1回描くだけ」なので、
// 個別のコンポーネントを並べるより1ファイルにまとめたほうが読みやすい

function useSquareCanvas(size: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
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
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, ...deps]);
  return ref;
}

export function RiskSeal({ level, size, className }: { level: RiskLevel; size: number; className?: string }) {
  const ref = useSquareCanvas(
    size,
    (ctx) => paintRiskSeal(ctx, { level, size, accent: readAccentRgb(), cream: readCreamRgb() }),
    [level]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

export function WorkGlyph({
  type,
  size,
  active,
  className,
}: {
  type: WorkType;
  size: number;
  active: boolean;
  className?: string;
}) {
  const ref = useSquareCanvas(
    size,
    (ctx) => paintWorkGlyph(ctx, { type, size, active, accent: readAccentRgb(), cream: readCreamRgb() }),
    [type, active]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

export function OrdealSigil({ kind, size, className }: { kind: OrdealKind; size: number; className?: string }) {
  const ref = useSquareCanvas(
    size,
    (ctx) => paintOrdealSigil(ctx, { kind, size, accent: readAccentRgb(), cream: readCreamRgb() }),
    [kind]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

export function VirtueChart({
  values,
  labels,
  size,
  className,
}: {
  values: number[];
  labels: string[];
  size: number;
  className?: string;
}) {
  const ref = useSquareCanvas(
    size,
    (ctx) => paintVirtueChart(ctx, { values, labels, size, accent: readAccentRgb(), cream: readCreamRgb() }),
    [values.join(","), labels.join(",")]
  );
  return <canvas ref={ref} className={className} aria-hidden />;
}

// エネルギー計だけは横長なので、幅を測って追従させる
export function EnergyMeter({
  percent,
  segments,
  height,
  className,
}: {
  percent: number;
  segments: number;
  height: number;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const widthRef = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;
    let raf = 0;
    let pulse = 0;
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const render = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (widthRef.current !== w) {
        widthRef.current = w;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${height}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintEnergyMeter(ctx, {
        percent,
        segments,
        width: w,
        height,
        accent: readAccentRgb(),
        cream: readCreamRgb(),
        pulse,
      });
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(el);

    if (!reduce) {
      const start = performance.now();
      const tick = (t: number) => {
        pulse = ((t - start) / 1600) % 1;
        render();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [percent, segments, height]);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" aria-hidden />
    </div>
  );
}
