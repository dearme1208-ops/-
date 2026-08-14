"use client";

import { useEffect, useState } from "react";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          className="panel pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2 text-sm shadow-panel"
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
