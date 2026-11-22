"use client";

import { useEffect, useState } from "react";
import { subscribeToasts, dismissToast, type ToastItem } from "@/lib/toast";
import { openHistory } from "@/lib/globalPanels";
import CompletionPopupHost from "./CompletionPopupHost";

export default function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  return (
    // 画面下には打刻ボタン・計測中の帯・本日の作業の切り替えなど、モードによって高さの違う
    // 固定の操作が並び、どの高さに出しても何かに重なっていた。画面の上に出す。
    // ダイアログ(z-50)を開いたまま出た知らせの「元に戻す」も押せるよう、ダイアログより手前に置く
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      role="status"
      aria-live="polite"
    >
      {/* 完了のお知らせ(元に戻す付き)を先頭に、その下に通知を積む */}
      <CompletionPopupHost />
      {/* toast: 操作が効いたことに気づけるよう、地を濃く・縁をアクセント色に灯す(globals.css) */}
      {items.map((t) => (
        <div
          key={t.id}
          className="toast panel toast-in pointer-events-auto flex max-w-full items-center gap-3 px-4 py-2.5 text-sm"
        >
          <span className="text-cream">{t.message}</span>
          {t.onUndo && (
            <button
              className="btn-pill-outline shrink-0 whitespace-nowrap text-xs"
              onClick={() => {
                t.onUndo?.();
                dismissToast(t.id);
              }}
            >
              元に戻す
            </button>
          )}
          {/* トーストは数秒で消えるが、操作の履歴からは後でも戻せる。その入口が本日の作業の
              操作の列にしか無く、ほかのタブでは気づけないので、取り消せる知らせの横にも置く */}
          {t.onUndo && (
            <button
              className="shrink-0 whitespace-nowrap text-xs text-cream/60 underline-offset-2 hover:text-cream hover:underline"
              onClick={() => {
                openHistory();
                dismissToast(t.id);
              }}
              title="操作の履歴を開く(さっきの操作を一覧から戻せます)"
            >
              履歴
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
