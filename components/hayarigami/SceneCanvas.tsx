"use client";

import { useEffect, useRef, useState } from "react";
import { paintScene, pickScene, readAccentRgb, SCENE_LABEL, type SceneKind } from "@/lib/hayarigamiArt";

// 怪異調査モードの「一枚絵」。実写背景の代わりに、その場でCanvasに描いた
// 写真風の景色を敷く。seedは作業名など実データなので、同じ案件は毎回同じ景色になる。
// intensityは危険度・侵蝕度(0〜1)で、上がるほど暗く赤く、粒子が荒れる
export default function SceneCanvas({
  seed,
  intensity,
  night,
  className,
}: {
  seed: string;
  intensity: number;
  night: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [kind, setKind] = useState<SceneKind>("corridor");

  useEffect(() => {
    setKind(pickScene(seed));
  }, [seed]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 毎秒の再描画を避けるため、強度は5段階に量子化して依存に使う
  const level = Math.round(Math.max(0, Math.min(1, intensity)) * 4);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 0 || size.h <= 0) return;
    // 端末のピクセル比をそのまま使うと粒子計算が重くなるため上限を設ける
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 1.5);
    const cssW = Math.min(size.w, 900);
    const cssH = Math.min(size.h, 620);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintScene(ctx, {
      kind,
      seed,
      width: cssW,
      height: cssH,
      intensity: level / 4,
      night,
      accent: readAccentRgb(),
    });
  }, [kind, seed, size.w, size.h, level, night]);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
      <span className="sr-only">{SCENE_LABEL[kind]}の情景</span>
    </div>
  );
}
