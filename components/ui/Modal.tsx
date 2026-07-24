"use client";

import { ReactNode } from "react";

export default function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="panel w-full max-w-md p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-cream">{title}</h3>
          {onClose && (
            <button onClick={onClose} className="text-cream/60 hover:text-cream" aria-label="閉じる">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
