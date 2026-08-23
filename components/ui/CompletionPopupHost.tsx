"use client";

import { useEffect, useState } from "react";
import { subscribeCompletionPopup, type CompletionInfo } from "@/lib/completionPopup";
import { formatHms } from "@/lib/time";
import { completionLabel, useVisualMode } from "@/lib/theme";

const DISPLAY_MS = 4500;

// 作業を完了するたびに、「何を・どれだけ完了したか」を右上にカード状のポップアップで
// 可視化する。トースト(toast.ts/ToastHost)が「元に戻す」向けの細いピルなのに対し、
// こちらは完了を実感できる情報量(作業名・区分・実績時間・予定との比較)を持たせた
// カードにする。複数件がほぼ同時に完了した場合(一括完了など)は下に積み重ねて表示する
export default function CompletionPopupHost() {
  const [items, setItems] = useState<CompletionInfo[]>([]);
  const { wordingThemedMode } = useVisualMode();

  useEffect(
    () =>
      subscribeCompletionPopup((info) => {
        setItems((prev) => [...prev, info]);
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== info.id));
        }, DISPLAY_MS);
      }),
    []
  );

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-2 sm:right-6 sm:top-6">
      {items.map((item) => (
        <CompletionCard key={item.id} item={item} mode={wordingThemedMode} onClose={() => setItems((prev) => prev.filter((i) => i.id !== item.id))} />
      ))}
    </div>
  );
}

function CompletionCard({
  item,
  mode,
  onClose,
}: {
  item: CompletionInfo;
  mode: Parameters<typeof completionLabel>[0];
  onClose: () => void;
}) {
  const hasEstimate = item.estimatedSeconds > 0;
  const overSeconds = item.seconds - item.estimatedSeconds;
  const compareLabel = !hasEstimate ? null : overSeconds > 0 ? `予定より ${formatHms(overSeconds)} オーバー` : "予定内で完了";

  return (
    <div className="completion-popup-card panel pointer-events-auto flex items-start gap-3 p-3.5 shadow-panel">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-alert/15 text-sm text-alert">✓</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-alert">{completionLabel(mode)}</div>
        <div className="truncate text-sm font-bold text-cream">{item.name}</div>
        <div className="truncate text-xs text-cream/50">[{item.category}]</div>
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="tabular-nums text-cream/70">実績 {formatHms(item.seconds)}</span>
          {compareLabel && (
            <span className={`tabular-nums ${overSeconds > 0 ? "text-alert" : "text-cream/50"}`}>{compareLabel}</span>
          )}
        </div>
      </div>
      <button className="shrink-0 text-cream/40 hover:text-cream" onClick={onClose} aria-label="閉じる">
        ×
      </button>
    </div>
  );
}
