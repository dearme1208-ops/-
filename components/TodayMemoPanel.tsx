"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { MemoNote } from "@/lib/types";

// メモタブの付箋は、忙しい時にとりあえず書き留めておく雑多な内容が多く、後から
// 見返す機会がメモタブ自体を開く動機と噛み合わないことが多い。そこで「本日の作業」
// タブ側にも中身をそのまま表示し、タブを切り替えなくても内容を確認・チェックできる
// ようにする。ボード(メモの区切り)を問わず、中身のある付箋を全て対象にする
export default function TodayMemoPanel({ onOpenMemo }: { onOpenMemo?: () => void }) {
  const boards = useLiveQuery(() => db.memoBoards.orderBy("order").toArray(), []);
  const notes = useLiveQuery(() => db.memoNotes.toArray(), []);
  const [collapsed, setCollapsed] = useState(false);

  const boardTitleById = new Map((boards ?? []).map((b) => [b.id, b.title]));

  function hasContent(n: MemoNote): boolean {
    if (n.isChecklist) return (n.checklistItems ?? []).some((i) => i.text.trim());
    return n.text.trim().length > 0;
  }

  const visibleNotes = (notes ?? [])
    .filter(hasContent)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  async function toggleItem(note: MemoNote, itemId: string) {
    const items = (note.checklistItems ?? []).map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
    await db.memoNotes.update(note.id, { checklistItems: items, updatedAt: Date.now() });
  }

  if (visibleNotes.length === 0) return null;

  return (
    <div className="panel p-4">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        <h3 className="font-display text-sm font-bold text-cream/80">
          📝 メモ
          <span className="ml-1 font-normal text-cream/40">（{visibleNotes.length}件）</span>
        </h3>
        <span className="text-xs text-cream/40">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visibleNotes.map((n) => (
              <div key={n.id} className="rounded-lg border border-cream/15 bg-ink/40 p-2.5">
                {boards && boards.length > 1 && (
                  <div className="mb-1 text-[10px] text-cream/40">{boardTitleById.get(n.boardId) ?? "メモ"}</div>
                )}
                {n.isChecklist ? (
                  <div className="space-y-1">
                    {(n.checklistItems ?? [])
                      .filter((i) => i.text.trim())
                      .map((i) => (
                        <label key={i.id} className="flex items-start gap-1.5 text-xs text-cream/80">
                          <input
                            type="checkbox"
                            checked={i.done}
                            onChange={() => toggleItem(n, i.id)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-cream/30 bg-ink accent-cream"
                          />
                          <span className={i.done ? "text-cream/40 line-through" : ""}>{i.text}</span>
                        </label>
                      ))}
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-xs text-cream/80">{n.text}</p>
                )}
              </div>
            ))}
          </div>
          {onOpenMemo && (
            <button className="mt-2 text-xs text-cream/50 underline hover:text-cream" onClick={onOpenMemo}>
              → メモタブを開く
            </button>
          )}
        </>
      )}
    </div>
  );
}
