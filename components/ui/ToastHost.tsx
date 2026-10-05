"use client";

import { useEffect, useState } from "react";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    // 画面下には打刻ボタン・計測中の帯・本日の作業の切り替えなど、モードによって高さの違う
    // 固定の操作が並び、どの高さに出しても何かに重なっていた。画面の上に出す
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="panel toast-in pointer-events-auto flex max-w-full items-center gap-3 rounded-full px-4 py-2 text-sm shadow-panel"
        >
          <span className="text-cream/80">{t.message}</span>
          {t.onUndo && (
            <button
              className="btn-pill-outline text-xs"
              onClick={() => {
                t.onUndo?.();
                dismissToast(t.id);
              }}
            >
              元に戻す
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
