"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// 横スクロールできる表・グリッドの右端が画面外に隠れていると、そこに続きが
// あると気づいてもらえないことがあるため、まだ右にスクロールできる間だけ右端を
// 薄くフェードさせて「まだ続きがある」ことを示す(最後まで見ると自然に消える)
export default function ScrollFadeHint({
  children,
  className = "panel overflow-x-auto p-4",
  fadeClassName = "rounded-r-2xl",
}: {
  children: ReactNode;
  /** スクロールするコンテナ自身に付けるクラス。呼び出し元の見た目(panel有無・余白)に合わせて上書きする */
  className?: string;
  /** 右端フェードの角丸をスクロールコンテナに合わせるためのクラス */
  fadeClassName?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      setCanScrollRight(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    }
    update();
    el.addEventListener("scroll", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="relative">
      <div ref={scrollRef} className={className}>
        {children}
      </div>
      {canScrollRight && (
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel to-transparent ${fadeClassName}`}
        />
      )}
    </div>
  );
}
