"use client";

import type { DailyTask } from "@/lib/types";
import { formatMsClock } from "@/lib/time";

// 図書館モードの「完了」タブ専用。完了した作業を通常の一覧ではなく、書架に並ぶ
// 本の背表紙として見せる。カテゴリ名から色を、作業時間から背表紙の太さを決めることで、
// 1日の終わりに「今日はこれだけ読了(完了)した」という積み上がりを視覚的に残す
const SPINE_COLORS = ["#7b4b32", "#5c6b73", "#8a6d3b", "#4b5d67", "#6b4226", "#5a4632", "#3f5765", "#79553d", "#6d3f4a", "#4a6b4f"];

function colorForCategory(category: string): string {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return SPINE_COLORS[hash % SPINE_COLORS.length];
}

function heightForCategory(category: string): number {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 17 + category.charCodeAt(i)) >>> 0;
  return 118 + (hash % 3) * 12;
}

export default function LibraryBookshelf({ tasks }: { tasks: DailyTask[] }) {
  if (tasks.length === 0) {
    return <p className="panel p-4 text-center text-sm text-cream/50">まだ書架に並んだ作業はありません</p>;
  }
  return (
    <div className="panel space-y-2 p-4">
      <p className="text-xs text-cream/50">本日読了(完了)した作業: {tasks.length}件</p>
      <div className="flex items-end gap-1 overflow-x-auto rounded-md bg-ink/20 p-3" style={{ minHeight: 160 }}>
        {tasks.map((t) => {
          const widthPx = Math.min(56, Math.max(20, Math.round(t.accumulatedMs / 60000) + 16));
          const heightPx = heightForCategory(t.category);
          return (
            <div
              key={t.id}
              title={`${t.category} / ${t.name}\n所要時間: ${formatMsClock(t.accumulatedMs)}`}
              className="flex shrink-0 items-end justify-center rounded-t-sm pb-1.5 text-[10px] font-bold text-white/90 shadow-md"
              style={{
                width: widthPx,
                height: heightPx,
                background: colorForCategory(t.category),
                writingMode: "vertical-rl",
              }}
            >
              <span className="max-h-full truncate">{t.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
