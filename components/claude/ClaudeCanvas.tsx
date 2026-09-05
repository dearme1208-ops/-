"use client";

import { useEffect, useRef, useState } from "react";
import {
  calibrationHeight,
  paintCalibration,
  paintConfidence,
  paintPaper,
  paintRhythm,
  paintSpark,
  paintThreadRow,
  readPalette,
  rhythmHeight,
  type CalibrationDot,
} from "@/lib/claudeArt";

// 幅を測って追従する共通の器。
// このモードだけはOSのライト/ダーク設定に追従するため、配色が変わったら
// 描き直す必要がある。他モードのラッパと違い、prefers-color-schemeの変化も見ている
function useMeasuredCanvas(
  heightFor: (width: number) => number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  deps: unknown[]
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [scheme, setScheme] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setScheme((v) => v + 1);
    mq.addEventListener("change", onScheme);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onScheme);
    };
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
  }, [width, scheme, ...deps]);

  return { wrapRef, canvasRef, width };
}

// ---- 思考の系(1行分) ----
// 行の高さは本文で決まるので、親の実寸に追従させる。
// こうしておくと、節が必ず本文の1行目の高さに並ぶ
export function ThreadRail({
  lit,
  first,
  last,
  seed,
}: {
  lit: boolean;
  first: boolean;
  last: boolean;
  seed: string;
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
      paintThreadRow(ctx, {
        width: w,
        height: h,
        seed,
        palette: readPalette(),
        lit,
        first,
        last,
        nodeY: 10, // 本文1行目の中心に合わせた位置
      });
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(host);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", render);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", render);
    };
  }, [lit, first, last, seed]);

  return (
    <div ref={hostRef} className="w-6 shrink-0 self-stretch" aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

// ---- 較正図 ----
export function Calibration({ dots, className }: { dots: CalibrationDot[]; className?: string }) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => calibrationHeight(w),
    (ctx, width, height) =>
      paintCalibration(ctx, { width, height, dots, palette: readPalette(), highlight: null }),
    [dots.length, dots.filter((d) => d.over).length]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="想定と実績の散布図" />
    </div>
  );
}

// ---- 確信度の目盛り ----
export function ConfidenceScale({ value, className }: { value: number; className?: string }) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => 14,
    (ctx, width, height) => paintConfidence(ctx, { width, height, value, palette: readPalette() }),
    [Math.round(value * 100)]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" aria-hidden />
    </div>
  );
}

// ---- 一日の律動 ----
export function Rhythm({
  hours,
  nowHour,
  className,
}: {
  hours: number[];
  nowHour: number | null;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => rhythmHeight(),
    (ctx, width, height) => paintRhythm(ctx, { width, height, hours, palette: readPalette(), nowHour }),
    [hours.join(","), nowHour]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="時間帯ごとの着手" />
    </div>
  );
}

// ---- 小さな折れ線 ----
export function Spark({ values, className }: { values: number[]; className?: string }) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    () => 26,
    (ctx, width, height) => paintSpark(ctx, { width, height, values, palette: readPalette() }),
    [values.join(",")]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" aria-hidden />
    </div>
  );
}

// ---- 紙の地。上に本文をDOMで重ねて使う ----
export function Paper({ seed, className }: { seed: string; className?: string }) {
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
      paintPaper(ctx, { width: w, height: h, seed, palette: readPalette() });
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(host);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", render);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", render);
    };
  }, [seed]);

  return (
    <div ref={hostRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
