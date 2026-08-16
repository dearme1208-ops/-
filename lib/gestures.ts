import { useEffect, type RefObject } from "react";

// 2本指のタッチ間の距離を測り、直前の距離との比(拡大縮小の倍率)をコールバックする。
// ページ全体のブラウザ標準ピンチズーム/スクロールと競合しないよう、2本指のtouchmove時のみ
// preventDefaultする(1本指のスクロール操作は妨げない)
export function usePinchZoom(ref: RefObject<HTMLElement | null>, onPinch: (scaleFactor: number) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastDist: number | null = null;

    function distance(touches: TouchList): number {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) lastDist = distance(e.touches);
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const d = distance(e.touches);
      if (lastDist !== null && lastDist > 0) onPinch(d / lastDist);
      lastDist = d;
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) lastDist = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [ref, onPinch]);
}

export interface SwipeNavigateOptions {
  onSwipeLeft: () => void; // 左スワイプ = 次へ(未来方向)
  onSwipeRight: () => void; // 右スワイプ = 前へ(過去方向)
  threshold?: number; // pxこれ以上動いたらスワイプとみなす
  // trueの場合、要素が横スクロール可能な時は「スクロールが端まで到達している時だけ」発火する
  // (横スクロールで時間軸をパンしている途中の操作を、日付送りと誤認しないようにするため)
  edgeAware?: boolean;
}

export function useSwipeNavigate(ref: RefObject<HTMLElement | null>, opts: SwipeNavigateOptions) {
  const { onSwipeLeft, onSwipeRight, threshold = 60, edgeAware = false } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let touching = false;
    let startX = 0;
    let startY = 0;
    let startAtLeftEdge = true;
    let startAtRightEdge = true;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) {
        touching = false;
        return;
      }
      touching = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startAtLeftEdge = el!.scrollLeft <= 2;
      startAtRightEdge = el!.scrollLeft >= el!.scrollWidth - el!.clientWidth - 2;
    }
    function onTouchEnd(e: TouchEvent) {
      if (!touching) return;
      touching = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) {
        if (!edgeAware || startAtRightEdge) onSwipeLeft();
      } else {
        if (!edgeAware || startAtLeftEdge) onSwipeRight();
      }
    }
    function onTouchCancel() {
      touching = false;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [ref, onSwipeLeft, onSwipeRight, threshold, edgeAware]);
}
