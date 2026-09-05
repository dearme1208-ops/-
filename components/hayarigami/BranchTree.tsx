"use client";

import { useEffect, useRef, useState } from "react";
import { paintBranchTree, readAccentRgb, type BranchNode } from "@/lib/hayarigamiArt";

// 案件の段階(マイルストーン)を、原作の「分岐ツリー」に見立てて描く。
// 幅は親要素に追従させ、高さは固定(段階の丸だけを見せる帯状の図なので十分)
export default function BranchTree({
  nodes,
  seed,
  className,
}: {
  nodes: BranchNode[];
  seed: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const height = 44;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
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
    paintBranchTree(ctx, { width, height, nodes, accent: readAccentRgb(), seed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, seed, nodes.map((n) => `${n.done}${n.current}${n.overdue}`).join(",")]);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block w-full" role="img" aria-label="捜査の進行状況" />
    </div>
  );
}
