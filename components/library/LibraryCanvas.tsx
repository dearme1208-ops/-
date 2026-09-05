"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  dateSlipHeight,
  layoutSpines,
  paintCardStock,
  paintDateSlip,
  paintOpenBook,
  paintReadingRoom,
  paintShelf,
  readPalette,
  shelfHeightFor,
  type Spine,
} from "@/lib/libraryArt";
import type { RoomPhase } from "@/lib/library";

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

// ---- 閲覧室(見出しの一枚絵) ----
export function ReadingRoom({
  phase,
  lampsLit,
  overdue,
  seed,
  className,
}: {
  phase: RoomPhase;
  lampsLit: number;
  overdue: number;
  seed: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => Math.round(Math.max(150, Math.min(230, w * 0.52))),
    (ctx, width, height) =>
      paintReadingRoom(ctx, { width, height, phase, lampsLit, overdue, seed, palette: readPalette() }),
    [phase, lampsLit, overdue, seed]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="閲覧室" />
    </div>
  );
}

// ---- 書架(本日の貸出棚) ----
export function Shelf({
  spines,
  onSelect,
  className,
}: {
  spines: Spine[];
  onSelect: (id: string) => void;
  className?: string;
}) {
  const { wrapRef, canvasRef, width } = useMeasuredCanvas(
    (w) => shelfHeightFor(spines, w),
    (ctx, w, h) => paintShelf(ctx, { spines, width: w, height: h, palette: readPalette() }),
    [spines]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = layoutSpines(spines, width).rects.find(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
      );
      if (hit) onSelect(hit.id);
    },
    [spines, width, onSelect, canvasRef]
  );

  return (
    <div ref={wrapRef} className={className}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="block w-full cursor-pointer"
        role="img"
        aria-label="本日の貸出棚"
      />
    </div>
  );
}

// ---- 書見台(いま開いている本) ----
export function OpenBook({
  title,
  progress,
  overdue,
  idle,
  seed,
  className,
}: {
  title: string;
  progress: number;
  overdue: boolean;
  idle: boolean;
  seed: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => Math.round(Math.max(140, Math.min(210, w * 0.46))),
    (ctx, width, height) =>
      paintOpenBook(ctx, { width, height, title, progress, overdue, idle, seed, palette: readPalette() }),
    [title, Math.round(progress * 100), overdue, idle, seed]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="書見台" />
    </div>
  );
}

// ---- 返却期限票(実績の日付印) ----
export function DateSlip({
  stamps,
  title,
  className,
}: {
  stamps: { date: string; overdue: boolean }[];
  title: string;
  className?: string;
}) {
  const { wrapRef, canvasRef } = useMeasuredCanvas(
    (w) => dateSlipHeight(stamps.length, w),
    (ctx, width, height) => paintDateSlip(ctx, { width, height, stamps, title, palette: readPalette() }),
    [stamps.map((s) => `${s.date}${s.overdue ? "!" : ""}`).join(","), title]
  );
  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label={title} />
    </div>
  );
}

// ---- 目録カードの地。上に本文をDOMで重ねて使う ----
// 高さは重ねる本文側で決まるので、他の図版と違い親要素の実寸に追従させる
export function CardStock({ seed, className }: { seed: string; className?: string }) {
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
      paintCardStock(ctx, { width: w, height: h, seed, palette: readPalette() });
    };
    render();
    const ro = new ResizeObserver(render);
    ro.observe(host);
    return () => ro.disconnect();
  }, [seed]);

  return (
    <div ref={hostRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
