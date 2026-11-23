"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildForestScene,
  computeForestSeason,
  computeForestTimeBand,
  drawForestScene,
  forestArtSmall,
  loadForestArt,
  peekForestArt,
  type ForestArt,
  type ForestScene,
  type ForestSeason,
  type ForestTimeBand,
} from "@/lib/forestScene";
import { createFrameGate, getForestPerfProfile } from "@/lib/forestPerf";

// 森モードのヘッダー。他テーマはSVGの静止画だが、ここだけはCanvasで毎フレーム描く。
// 木のシルエットは重いのでリサイズ時に一度だけオフスクリーンへ焼き込み(buildForestScene)、
// 毎フレームは転写+動くものだけを描く。モバイルのPWAで常時表示される帯なので、
// ・devicePixelRatioは1.5で頭打ち(軽量モードは1。lib/forestPerf.ts)
// ・描き直すのは30fps(軽量モードは20fps)で、胞子(ForestAmbience)とは1フレームずつ交互。rAFは回し続けるが、描かないフレームは何もしない
// ・タブが背面のとき・ヘッダーが画面外へスクロールしたときはrAFを止める
// ・prefers-reduced-motionなら1枚だけ描いて止める
// の点でバッテリーとフレームの余裕を食わないようにしてある。
// 木立は挿絵(public/art/forest-*.webp)を裏で読み、読めたら1度だけ焼き直して差し替える(lib/forestScene.ts の説明)。
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
  // 挿絵(public/art/forest-*.webp)。読み終わるまで・読めなかった時は null で、手続き生成の木立を描く
  const artRef = useRef<ForestArt | null>(null);
  // artRef がどちらの組か(true=-sm)。null はまだ幅が決まらず選んでいない
  const artSmallRef = useRef<boolean | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    reducedRef.current = reduced;
    const perf = getForestPerfProfile();

    let raf = 0;
    // 描くのは偶数フレーム(胞子 ForestAmbience は奇数)。lib/forestPerf.ts の説明
    const shouldDraw = createFrameGate(perf.sceneFps, 0);
    // ヘッダーが画面に見えているか(見えない間は描かない)
    let onScreen = true;

    // ポインタ視差。触れられるまでは、ゆっくり左右に振って「風でカメラが揺れる」動きにする
    let pointerSeen = false;
    let px = 0.5;
    let py = 0.5;

    let disposed = false;
    const start = performance.now();

    const rebuild = () => {
      const { w, h, dpr } = dimsRef.current;
      if (w <= 0 || h <= 0) return;
      sceneRef.current = buildForestScene(w, h, dpr, bandRef.current, seasonRef.current, undefined, {
        lite: perf.lite,
        art: artRef.current,
      });
    };

    // 挿絵の組(-sm か原寸か)を今の幅で選び直す。違う組が要るときは裏で読み、
    // 読めるまでは今の絵のまま(差し替えは次の描画で一度に行われ、ちらつかない)。組ごとの読み込みは lib 側で共有
    let artWant: boolean | null = null;
    const syncArt = () => {
      const w = dimsRef.current.w;
      if (disposed || w <= 1) return; // 幅0でマウントされた時は、実際の幅が分かるまで選ばない
      const want = forestArtSmall(w, perf.lite);
      if (want === artWant) return;
      artWant = want;
      const ready = peekForestArt(want);
      if (ready) {
        if (artSmallRef.current === want && artRef.current === ready) return;
        artRef.current = ready;
        artSmallRef.current = want;
        rebuild();
        return;
      }
      loadForestArt(want).then((art) => {
        // 待つ間にまた閾値をまたいだら捨てる(読んだ組は lib にキャッシュされ、戻った時は即座に使える)
        if (disposed || !art || artWant !== want) return;
        artRef.current = art;
        artSmallRef.current = want;
        rebuild();
        // 再生中は次の描く枠で反映される。止めている設定のときだけその場で描く
        if (reduced) redraw();
      });
    };
    // 窓のドラッグ中に何度も読みに行かないよう、組の選び直しは落ち着いてから
    let artTimer = 0;
    const syncArtSoon = () => {
      if (artTimer) window.clearTimeout(artTimer);
      artTimer = window.setTimeout(() => {
        artTimer = 0;
        syncArt();
      }, 300);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(perf.sceneDprCap, window.devicePixelRatio || 1);
      const dims = dimsRef.current;
      if (w === dims.w && h === dims.h && dpr === dims.dpr && sceneRef.current) return;
      dimsRef.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // まだ組を選んでいなければ今すぐ選ぶ(読み終えた挿絵があれば最初からそれで組み、再マウントで手続き生成が一瞬見えないように)。
      // 選んだ後の閾値またぎは間引いて選び直す
      if (artWant === null) syncArt();
      else syncArtSoon();
      rebuild();
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
    // その場で1枚描き直す(大きさを変えるとキャンバスは消える。動きを止める設定では再生ループが回っていない)
    function redraw() {
      render(reduced ? 6.5 : (performance.now() - start) / 1000);
    }

    const loop = (now: number) => {
      raf = window.requestAnimationFrame(loop);
      if (!shouldDraw(now)) return;
      render((now - start) / 1000);
    };

    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const play = () => {
      if (raf || reduced || !onScreen || document.hidden) return;
      raf = window.requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else play();
    };

    // ヘッダーが画面外へスクロールしたら止め、戻ってきたら再開する
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
            if (onScreen) play();
            else stop();
          })
        : null;

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
      // 最初のrAFを待たずに1枚描いておく(空のキャンバスが1フレーム見えないように)
      render(0);
      play();
    }

    const ro = new ResizeObserver(() => {
      resize();
      // 大きさを変えるとキャンバスは消えるので、次の描く枠を待たずにその場で描き直す
      redraw();
    });
    ro.observe(canvas);
    io?.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onPointer, { passive: true });

    // 画面の倍率だけが変わった時(別モニタへ移動・ズーム)は ResizeObserver が鳴らないので、
    // 今の倍率に一致するメディアクエリを張り、外れたら焼き直して新しい倍率で張り直す
    let dprMq: MediaQueryList | null = null;
    const onDpr = () => {
      watchDpr();
      resize(); // 上限(sceneDprCap)で丸めた値が同じなら何もしない
      redraw();
    };
    function watchDpr() {
      dprMq?.removeEventListener("change", onDpr);
      dprMq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
      dprMq?.addEventListener?.("change", onDpr);
    }
    watchDpr();

    // 挿絵は resize 内の syncArt で裏読みし、読めたらシーンを1度だけ焼き直す。
    // 差し替えは次の描画で一度に行われるので、空白やちらつき・レイアウトのずれは出ない

    return () => {
      disposed = true;
      stop();
      if (artTimer) window.clearTimeout(artTimer);
      dprMq?.removeEventListener("change", onDpr);
      ro.disconnect();
      io?.disconnect();
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
    sceneRef.current = buildForestScene(w, h, dpr, band, season, undefined, {
      lite: getForestPerfProfile().lite,
      art: artRef.current,
    });
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
