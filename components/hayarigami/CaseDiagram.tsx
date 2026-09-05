"use client";

import { useEffect, useRef, useState } from "react";
import { paintDiagram, readAccentRgb, type DiagramNode } from "@/lib/hayarigamiArt";

// 捜査本部の壁に貼られた相関図を模した図。ノードは本日の作業そのもので、
// 糸(線)の色と太さがその作業の危険度を表す
export default function CaseDiagram({
  nodes,
  centerLabel,
  seed,
  className,
  height = 190,
}: {
  nodes: DiagramNode[];
  centerLabel: string;
  seed: string;
  className?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ノードの中身が変わった時だけ描き直す(1秒ごとの再描画を避ける)
  const signature = nodes.map((n) => `${n.label}:${n.level}:${n.done ? 1 : 0}`).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.5);
    const cssW = Math.min(width, 900);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintDiagram(ctx, {
      width: cssW,
      height,
      centerLabel,
      nodes,
      accent: readAccentRgb(),
      seed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, centerLabel, seed, signature]);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" aria-hidden />
    </div>
  );
}
