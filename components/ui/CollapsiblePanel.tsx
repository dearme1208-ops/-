"use client";

import type { ReactNode } from "react";

export default function CollapsiblePanel({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="panel p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={onToggle}>
        <h3 className="font-display text-sm font-bold text-cream/80">{title}</h3>
        <span className="shrink-0 text-cream/60">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && <div className="mt-3">{children}</div>}
    </div>
  );
}
