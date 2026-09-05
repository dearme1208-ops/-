"use client";

import { useEffect, useRef } from "react";
import { paintAbnormality, readAccentRgb, readCreamRgb, type BusinessIcon } from "@/lib/lobotomyArt";
import type { RiskLevel } from "@/lib/lobotomy";

// 個体の肖像。種は作業名なので、同じ作業には毎回同じ姿が出る。
// businessIconを渡すと(文言オフのとき)怪物ではなく、その作業を表す図になる
export default function AbnormalityPortrait({
  seed,
  size,
  riskLevel,
  breached,
  businessIcon,
  className,
}: {
  seed: string;
  size: number;
  riskLevel: RiskLevel;
  breached: boolean;
  businessIcon?: BusinessIcon | null;
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
    paintAbnormality(ctx, {
      seed,
      size,
      riskLevel,
      breached,
      businessIcon: businessIcon ?? null,
      accent: readAccentRgb(),
      cream: readCreamRgb(),
    });
  }, [seed, size, riskLevel, breached, businessIcon]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
