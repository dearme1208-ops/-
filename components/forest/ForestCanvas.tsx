"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildForestScene,
  computeForestTimeBand,
  drawForestScene,
  type ForestScene,
  type ForestTimeBand,
} from "@/lib/forestScene";

// 森モードのヘッダー。他テーマはSVGの静止画だが、ここだけはCanvasで毎フレーム描く。
// 木のシルエットは重いのでリサイズ時に一度だけオフスクリーンへ焼き込み(buildForestScene)、
// 毎フレームは転写+動くものだけを描く。モバイルのPWAで常時表示される帯なので、
// ・devicePixelRatioは2で頭打ち
// ・タブが背面のときはrAFを止める
// ・prefers-reduced-motionなら1枚だけ描いて止める
// の3点でバッテリーを食わないようにしてある。
export default function ForestCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [band, setBand] = useState<ForestTimeBand>(() => computeForestTimeBand(new Date().getHours()));

  // 時間帯(暁・昼・夕・夜)。日をまたいで開きっぱなしでも景色が変わるよう定期的に見直す
  useEffect(() => {
    const tick = () => setBand(computeForestTimeBand(new Date().getHours()));
    tick();
    const id = window.setInterval(tick, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let scene: ForestScene | null = null;
    let raf = 0;
    let cssW = 0;
    let cssH = 0;

    // ポインタ視差。触れられるまでは、ゆっくり左右に振って「風でカメラが揺れる」動きにする
    let pointerSeen = false;
    let px = 0.5;
    let py = 0.5;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === cssW && h === cssH && scene) return;
      cssW = w;
      cssH = h;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene = buildForestScene(w, h, dpr, band);
    };

    const render = (t: number) => {
      if (!scene) return;
      const ax = pointerSeen ? px : 0.5 + Math.sin(t * 0.07) * 0.34;
      const ay = pointerSeen ? py : 0.5 + Math.sin(t * 0.045 + 1.2) * 0.18;
      drawForestScene(ctx, scene, t, { px: ax, py: ay, still: reduced });
    };

    const start = performance.now();
    const loop = (now: number) => {
      render((now - start) / 1000);
      raf = window.requestAnimationFrame(loop);
    };

    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const play = () => {
      if (raf || reduced) return;
      raf = window.requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else play();
    };

    const onPointer = (e: PointerEvent) => {
      pointerSeen = true;
      px = e.clientX / Math.max(1, window.innerWidth);
      py = e.clientY / Math.max(1, window.innerHeight);
    };

    resize();
    if (reduced) {
      // 動きを止める設定のときは、夜霧と蛍がいちばん映える時刻の1枚を描いて終わり
      render(6.5);
    } else {
      play();
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) render(6.5);
    });
    ro.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
    };
  }, [band]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-24 w-full sm:h-28"
      role="img"
      aria-label="時間帯とともに移ろう針葉樹林のイラスト"
    />
  );
}
