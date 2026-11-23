"use client";

import { useEffect, useRef, useState } from "react";
import { useVisualMode } from "@/lib/theme";
import { mulberry32 } from "@/lib/forestScene";
import { createFrameGate, getForestPerfProfile } from "@/lib/forestPerf";

interface Spore {
  x: number;
  y: number;
  r: number;
  /** 上昇速度(px/秒)。綿毛なので下からゆっくり昇る */
  vy: number;
  /** 横揺れの振幅と速さ */
  ax: number;
  as: number;
  phase: number;
  alpha: number;
  /** 手前(1)か奥(0)か。スクロールに対する動きの大きさを変えて奥行きを出す */
  depth: number;
}

// 画面全体にうっすら漂う胞子(綿毛)。ヘッダーの林から風が抜けてきた、という見立てで
// 本文の上に極薄のアルファで重ねる。他テーマの透かし(.nat-watermark等)と同じ
// 「fixed + z-index:0 + pointer-events:none」の作法に合わせてあるので操作は妨げない。
export default function ForestAmbience() {
  const { homeMode } = useVisualMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // ページの終わりに近づいたか。近づいたら下端から林床がせり上がる
  const [nearBottom, setNearBottom] = useState(false);

  useEffect(() => {
    if (!homeMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const perf = getForestPerfProfile();
    let spores: Spore[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    // 描くのは奇数フレーム(ヘッダーの林 ForestCanvas は偶数)。lib/forestPerf.ts の説明
    const shouldDraw = createFrameGate(perf.ambienceFps, 1);

    // 綿毛1粒の光。以前は毎フレーム粒ごとに放射グラデーションを作っていたので、
    // 中心の不透明度を1にした1枚を焼いておき、描く時は大きさと globalAlpha だけを変える
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const sctx = sprite.getContext("2d");
    if (sctx) {
      const g = sctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, "rgba(214,255,190,1)");
      g.addColorStop(0.45, "rgba(150,220,130,0.35)");
      g.addColorStop(1, "rgba(150,220,130,0)");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 32, 32);
    }

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      // 本文の背後に敷く、輪郭のないぼんやりした光の層なので、解像度は1倍(軽量モードは0.75倍)で
      // 頭打ちにして負荷を抑える。画面全体の大きさがあるため、描くたびの転送量がそのまま効く
      const dpr = Math.min(perf.ambienceDprCap, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const rand = mulberry32(7717);
      const count = Math.round(Math.min(30, Math.max(10, (w * h) / 46000)) * (perf.lite ? 0.6 : 1));
      spores = Array.from({ length: count }, () => ({
        x: rand() * w,
        y: rand() * h,
        r: 0.7 + rand() * 1.9,
        vy: 5 + rand() * 11,
        ax: 8 + rand() * 26,
        as: 0.12 + rand() * 0.28,
        phase: rand() * Math.PI * 2,
        alpha: 0.1 + rand() * 0.2,
        depth: rand(),
      }));
    };

    // スクロール量。下へ進むほど手前の綿毛を大きく流し、奥はゆっくり動かすことで
    // 「森の中を下りていく」奥行きを出す(rAFの中で読むと毎フレームのレイアウト
    // 読み取りになるので、scrollイベント側で控えておく)
    let scrollY = window.scrollY;
    const onScroll = () => {
      scrollY = window.scrollY;
    };

    const start = performance.now();
    const loop = (now: number) => {
      raf = window.requestAnimationFrame(loop);
      if (!shouldDraw(now)) return;
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const s of spores) {
        // 上昇しつづけ、画面上端を抜けたら下から出し直す(剰余で位置を巻き戻す)。
        // スクロール量を足すことで、下へ進むほど手前の綿毛が速く後ろへ流れる
        const parallax = scrollY * (0.05 + s.depth * 0.25);
        const y = h + s.r * 4 - ((s.y + t * s.vy + parallax) % (h + s.r * 8));
        const x = s.x + Math.sin(t * s.as + s.phase) * s.ax;
        const pulse = 0.65 + 0.35 * Math.sin(t * s.as * 2.3 + s.phase);
        const R = s.r * 4;
        ctx.globalAlpha = s.alpha * pulse;
        ctx.drawImage(sprite, x - R, y - R, R * 2, R * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const play = () => {
      if (!raf) raf = window.requestAnimationFrame(loop);
    };
    const onVisibility = () => (document.hidden ? stop() : play());

    resize();
    play();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [homeMode]);

  // 林床のせり上がりはCanvasと別に持つ。動きを止める設定でもここは単純なフェードなので、
  // 「いちばん下まで来た」ことは同じように見せる
  useEffect(() => {
    if (!homeMode) return;
    const update = () => {
      const doc = document.documentElement;
      // そもそもスクロールしない短いページでは「下りてきた」演出にならないので出さない
      const scrollable = doc.scrollHeight > window.innerHeight + 240;
      const remaining = doc.scrollHeight - (window.scrollY + window.innerHeight);
      setNearBottom(scrollable && remaining < 140);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [homeMode]);

  if (!homeMode) return null;

  return (
    <>
      <canvas ref={canvasRef} className="forest-ambience" aria-hidden="true" />
      <div className="forest-floor" data-near={nearBottom ? "true" : "false"} aria-hidden="true" />
    </>
  );
}
