"use client";

import { useMemo, useState } from "react";
import Modal from "@/components/ui/Modal";
import { canBeParent } from "@/lib/todo";
import { isSubmitEnter } from "@/lib/keyboard";
import type { TodoList, TodoTask } from "@/lib/types";

// 親タスクを選ぶ窓。親にできるのは未完了・アーカイブしていない通常のタスクだけ(サブタスクは1段まで)。
// 既定は指定したリストの中から探し、「全リスト」で全部のリストから探せる
export default function ParentTaskPicker({
  tasks,
  lists,
  defaultListId,
  excludeTaskIds = [],
  currentParentId,
  title = "親タスクを選ぶ",
  note,
  onPick,
  onClose,
}: {
  tasks: TodoTask[];
  lists: TodoList[];
  /** 最初に探すリスト(未指定なら全リスト) */
  defaultListId?: string;
  /** 候補から外すタスク(自分自身など) */
  excludeTaskIds?: string[];
  /** 今の親。候補には出すが選べない */
  currentParentId?: string;
  title?: string;
  /** 見出しの下に添える説明 */
  note?: string;
  onPick: (parent: TodoTask) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [allLists, setAllLists] = useState(!defaultListId);
  const listTitleById = useMemo(() => new Map(lists.map((l) => [l.id, l.title])), [lists]);
  const listOrder = useMemo(() => new Map(lists.map((l, i) => [l.id, i])), [lists]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const excluded = new Set(excludeTaskIds);
    return tasks
      .filter((t) => canBeParent(t) && !excluded.has(t.id))
      .filter((t) => allLists || t.listId === defaultListId)
      .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.customer ?? "").toLowerCase().includes(q))
      .sort((a, b) => (listOrder.get(a.listId) ?? 0) - (listOrder.get(b.listId) ?? 0) || a.order - b.order);
  }, [tasks, query, allLists, defaultListId, excludeTaskIds, listOrder]);

  const pickable = candidates.filter((t) => t.id !== currentParentId);
  const shown = candidates.slice(0, 60);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-2" data-testid="parent-task-picker">
        {note && <p className="caption text-xs text-cream/60">{note}</p>}
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // 候補が1件に絞れていれば、Enterでそのまま選ぶ
              if (isSubmitEnter(e) && pickable.length === 1) {
                e.preventDefault();
                onPick(pickable[0]);
              }
            }}
            placeholder="親タスクの名前で検索"
            aria-label="親タスクを検索"
            className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          {defaultListId && lists.length > 1 && (
            <button
              type="button"
              className={allLists ? "btn-pill shrink-0 text-xs" : "btn-pill-outline shrink-0 text-xs"}
              aria-pressed={allLists}
              onClick={() => setAllLists((v) => !v)}
              title="ほかのリストのタスクも候補に出します"
            >
              全リスト
            </button>
          )}
        </div>
        {!allLists && defaultListId && (
          <p className="text-[11px] text-cream/45">「{listTitleById.get(defaultListId) ?? ""}」の中から探しています</p>
        )}
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {shown.map((t) => {
            const isCurrent = t.id === currentParentId;
            const otherList = t.listId !== defaultListId;
            return (
              <button
                key={t.id}
                type="button"
                disabled={isCurrent}
                onClick={() => onPick(t)}
                className="list-row flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-cream hover:bg-cream/10 disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {isCurrent && <span className="chip shrink-0">今の親</span>}
                {(allLists || otherList) && <span className="chip shrink-0">{listTitleById.get(t.listId) ?? ""}</span>}
              </button>
            );
          })}
          {candidates.length > shown.length && (
            <p className="text-[11px] text-cream/45">ほか{candidates.length - shown.length}件。名前で絞り込んでください</p>
          )}
          {candidates.length === 0 && (
            <div className="empty-state">
              <p>親にできるタスクが見つかりません。</p>
              {!allLists && defaultListId && lists.length > 1 && (
                <button type="button" className="btn-pill-outline mt-2 text-xs" onClick={() => setAllLists(true)}>
                  全リストから探す
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-cream/40">
          完了・アーカイブ済みのタスクとサブタスクは親にできません。ほかのリストの親を選ぶと、そのリストへ移ります。
        </p>
      </div>
    </Modal>
  );
}
