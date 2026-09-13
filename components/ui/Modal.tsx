"use client";

import { ReactNode } from "react";

export default function Modal({
  title,
  children,
  onClose,
  size = "md",
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
  // "lg"は編集項目が多く1行に収まりきらないダイアログ(案件編集の段階一覧など)向け。
  // "xl"はガントチャートなど横に広い表を持つダイアログ(WBS)向け。
  // 画面が広い時だけ横幅を使い、狭い画面ではmax-w-mdと同じくビューポート幅いっぱいになる
  size?: "md" | "lg" | "xl";
}) {
  const maxWidthClass = size === "xl" ? "max-w-6xl" : size === "lg" ? "max-w-2xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className={`panel flex max-h-[90vh] w-full ${maxWidthClass} flex-col p-5`}>
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="font-display text-lg font-bold text-cream">{title}</h3>
          {onClose && (
            <button onClick={onClose} className="text-cream/60 hover:text-cream" aria-label="閉じる">
              ✕
            </button>
          )}
        </div>
        {/* 内容が画面より長くなっても下部(保存ボタン等)まで必ずスクロールして到達できるようにする */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}
