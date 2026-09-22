"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildForestScene,
  computeForestSeason,
  computeForestTimeBand,
  drawForestScene,
  type ForestScene,
  type ForestSeason,
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
  const [season, setSeason] = useState<ForestSeason>(() => computeForestSeason(new Date().getMonth() + 1));

  // 時間帯(暁・昼・夕・夜)と季節。日をまたいで開きっぱなしでも景色が変わるよう定期的に見直す
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setBand(computeForestTimeBand(now.getHours()));
      setSeason(computeForestSeason(now.getMonth() + 1));
    };
    tick();
    const id = window.setInterval(tick, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // キャンバスの確保・リサイズ監視・再生ループ・入力監視はマウント時に1度だけ組み立て、
  // band/season の最新値はrefで参照する。以前はband/seasonをuseEffectの依存に入れて
  // このセットアップごと毎回作り直していたが、その一瞬だけ再生ループが止まりキャンバスが
  // 空になる隙間ができ、時間帯が切り替わった瞬間だけヘッダーが乱れる不具合の原因になっていた
  const bandRef = useRef(band);
  const seasonRef = useRef(season);
  const sceneRef = useRef<ForestScene | null>(null);
  const dimsRef = useRef({ w: 0, h: 0, dpr: 1 });
  const renderRef = useRef<((t: number) => void) | null>(null);
  const reducedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    reducedRef.current = reduced;

    let raf = 0;

    // ポインタ視差。触れられるまでは、ゆっくり左右に振って「風でカメラが揺れる」動きにする
    let pointerSeen = false;
    let px = 0.5;
    let py = 0.5;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const dims = dimsRef.current;
      if (w === dims.w && h === dims.h && dpr === dims.dpr && sceneRef.current) return;
      dimsRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sceneRef.current = buildForestScene(w, h, dpr, bandRef.current, seasonRef.current);
    };

    const render = (t: number) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const ax = pointerSeen ? px : 0.5 + Math.sin(t * 0.07) * 0.34;
      const ay = pointerSeen ? py : 0.5 + Math.sin(t * 0.045 + 1.2) * 0.18;
      // 下へスクロールするほど視点が沈み、手前の木立がせり上がる。
      // ヘッダーが画面から抜けるまでの短い間だけ効かせたいので、自身の高さで頭打ちにする
      const scrolled = Math.min(1, window.scrollY / Math.max(1, dimsRef.current.h));
      drawForestScene(ctx, scene, t, { px: ax, py: Math.min(1, ay + scrolled * 0.55), still: reduced });
    };
    renderRef.current = render;

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
      renderRef.current = null;
    };
  }, []);

  // band/season が変わった時は、再生ループやリスナーには触れず、既に確保済みの
  // 大きさでシーンだけをその場で焼き直す(まだ初回のresizeが済んでいなければ何もしない)
  useEffect(() => {
    bandRef.current = band;
    seasonRef.current = season;
    const { w, h, dpr } = dimsRef.current;
    if (w <= 0 || h <= 0) return;
    sceneRef.current = buildForestScene(w, h, dpr, band, season);
    // 動きを止める設定の間は再生ループが回っていないため、焼き直した内容をここで即描画する
    if (reducedRef.current) renderRef.current?.(6.5);
  }, [band, season]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-24 w-full sm:h-28"
      role="img"
      aria-label="時間帯とともに移ろう針葉樹林のイラスト"
    />
  );
}
