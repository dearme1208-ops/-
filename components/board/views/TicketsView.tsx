import { useMemo } from "react";
import type { BoardViewItem } from "@/lib/boardViewItems";
import { AltViewProps, kindIcon, kindLabel } from "./shared";

// 喫茶店の厨房にある伝票レールのイメージ。期限切れ→期日が近い順→期日なしの順に
// クリップで吊るして並べ、上から順に捌いていく感覚を出す
export default function TicketsView({ items, onOpen }: AltViewProps) {
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const da = a.dueDate ?? "9999-99-99";
      const db = b.dueDate ?? "9999-99-99";
      if (da !== db) return da < db ? -1 : 1;
      return b.important === a.important ? 0 : b.important ? 1 : -1;
    });
  }, [items]);

  return (
    <div className="panel p-4">
      <h3 className="mb-3 font-display text-base font-bold">☕ 伝票レール</h3>
      <p className="mb-4 text-xs text-cream/50">期日が近い順に、厨房の伝票のようにレールへ吊るしています。</p>
      <div className="relative overflow-x-auto pb-4">
        <div className="h-1 min-w-[900px] rounded bg-cream/20" />
        <div className="flex min-w-[900px] gap-3 pt-1">
          {sorted.map((it) => (
            <button
              key={it.id}
              onClick={() => onOpen(it)}
              className="relative flex w-40 shrink-0 flex-col gap-1 border border-cream/15 bg-[#f3ead9] p-2.5 text-left text-ink shadow-md"
              style={{ clipPath: "polygon(0 0,100% 0,100% 92%,92% 100%,8% 100%,0 92%)" }}
            >
              <span className="absolute -top-2 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-[#888] shadow" />
              <span className="text-[9px] font-bold uppercase tracking-wide text-ink/50">{kindLabel(it.kind)}</span>
              <span className="text-xs font-bold leading-snug">{it.title}</span>
              {it.category && <span className="text-[10px] text-ink/60">{it.category}</span>}
              <span
                className={`mt-1 inline-block w-fit rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  it.overdue ? "bg-red-600 text-white" : it.dueToday ? "bg-amber-500 text-white" : "bg-ink/10 text-ink/70"
                }`}
              >
                {it.dueDate ? (it.overdue ? `期限切れ (${it.dueDate})` : it.dueDate) : "期日なし"}
              </span>
              {it.subtaskTotal > 0 && (
                <span className="text-[10px] text-ink/50">
                  {kindIcon(it.kind)} {it.subtaskDone}/{it.subtaskTotal}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {sorted.length === 0 && <p className="text-sm text-cream/50">レールに吊るす伝票がありません。</p>}
    </div>
  );
}
