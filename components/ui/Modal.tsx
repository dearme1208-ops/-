"use client";

import { ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

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
  const titleId = useId();
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // ダイアログらしい振る舞い: Escで閉じる(重なっている時は一番手前だけ)、開いている間は後ろの画面を
  // スクロールさせない、開いたらダイアログへ・閉じたら元の場所へフォーカスを戻す
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      // 日本語入力の変換を取り消す Esc では閉じない(isComposing が立たないブラウザ向けに keyCode 229 も見る)
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      // さがす(Ctrl+K)の窓が手前に開いている時は、そちらだけが閉じる
      if (document.querySelector("[data-command-palette]")) return;
      const scrims = document.querySelectorAll(".modal-scrim");
      if (scrims[scrims.length - 1] !== scrimRef.current) return;
      if (!onCloseRef.current) return;
      e.preventDefault();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // ほかのダイアログがまだ開いていれば、スクロールの固定は続ける
      // (この時点で自分の枠はもう画面から外れている。残っていれば、ほかのダイアログが開いている)
      if (document.querySelectorAll(".modal-scrim").length === 0) document.body.style.overflow = prevOverflow === "hidden" ? "" : prevOverflow;
      // 別のダイアログへ切り替わった時などに、そちらの入力欄からフォーカスを奪わない
      const active = document.activeElement;
      if (prevFocus && document.contains(prevFocus) && (!active || active === document.body)) prevFocus.focus({ preventScroll: true });
    };
  }, []);
  const maxWidthClass = size === "xl" ? "max-w-6xl" : size === "lg" ? "max-w-2xl" : "max-w-md";
  // 本日の作業は他のタブを見ている間も裏で動き続け(app/page.tsx)、予定の時刻などで
  // 確認のダイアログを出す。裏に隠した画面の中にあっても見えるよう、ダイアログは画面の直下に出す
  const node = (
    <div ref={scrimRef} className="modal-scrim fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`panel flex max-h-[90vh] w-full ${maxWidthClass} flex-col p-5 outline-none`}
      >
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 id={titleId} className="font-display text-lg font-bold text-cream">{title}</h3>
          {onClose && (
            <button onClick={onClose} className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-cream/70 hover:bg-cream/10 hover:text-cream" aria-label="閉じる">
              ✕
            </button>
          )}
        </div>
        {/* 内容が画面より長くなっても下部(保存ボタン等)まで必ずスクロールして到達できるようにする */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}
