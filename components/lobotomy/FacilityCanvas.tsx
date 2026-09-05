"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  facilityHeightFor,
  layoutCells,
  paintFacility,
  readAccentRgb,
  readCreamRgb,
  type FacilityCell,
} from "@/lib/lobotomyArt";

// 施設の断面図。区画のクリック判定は描画と同じlayoutCells()から引くので、
// 見えている枠と押せる範囲が必ず一致する
export default function FacilityCanvas({
  cells,
  trumpet,
  onSelect,
  className,
}: {
  cells: FacilityCell[];
  trumpet: number;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = facilityHeightFor(cells.length, width || 320);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 警報の明滅と廊下の光。動きは1秒周期で、静止設定の人には止める
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      setPulse(((t - start) / 2000) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFacility(ctx, {
      cells,
      width,
      height,
      accent: readAccentRgb(),
      cream: readCreamRgb(),
      pulse,
      trumpet,
    });
  }, [cells, width, height, pulse, trumpet]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = layoutCells(cells, width, height).find(
        (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
      );
      if (hit) onSelect(hit.id);
    },
    [cells, width, height, onSelect]
  );

  return (
    <div ref={wrapRef} className={className}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="block w-full cursor-pointer"
        role="img"
        aria-label="収容区画の配置図"
      />
    </div>
  );
}
