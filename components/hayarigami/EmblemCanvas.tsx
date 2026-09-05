"use client";

import { useEffect, useRef } from "react";
import { paintEmblem, readAccentRgb } from "@/lib/hayarigamiArt";

// オカルト / 科学 の二択で使う紋章。押せる選択肢そのものなのでbutton要素の中に置き、
// 選択中(active)は線がアクセント色で光る
export default function EmblemCanvas({
  kind,
  size,
  active,
  className,
}: {
  kind: "occult" | "science";
  size: number;
  active: boolean;
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
    paintEmblem(ctx, { kind, size, active, accent: readAccentRgb() });
  }, [kind, size, active]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
