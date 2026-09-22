"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredMasterTasks } from "@/lib/homeMode";
import { findOrCreateMasterTask } from "@/lib/master";
import type { MasterTask } from "@/lib/types";

export default function MasterTaskPicker({
  onSelect,
  selectedId,
}: {
  onSelect: (task: MasterTask) => void;
  selectedId?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  // 検索しても一致するマスタが無い時、その場で新規マスタとして登録して選べるようにする欄
  const [newCategory, setNewCategory] = useState("");
  const [creating, setCreating] = useState(false);

  const allTasksRaw = useLiveQuery(() => db.masterTasks.toArray(), []);
  const allTasks = useHomeFilteredMasterTasks(allTasksRaw);

  const categories = useMemo(() => {
    if (!allTasks) return [];
    return [...new Set(allTasks.map((t) => t.category))].sort((a, b) => a.localeCompare(b, "ja"));
  }, [allTasks]);

  const grouped = useMemo(() => {
    if (!allTasks) return [];
    const filtered = allTasks.filter((t) => {
      if (t.archived) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (search.trim() === "") return true;
      return t.category.includes(search) || t.name.includes(search);
    });
    const map = new Map<string, MasterTask[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ja"))
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name, "ja")),
      }));
  }, [allTasks, search, categoryFilter]);

  // カテゴリ絞り込み中なら、新規登録の業務区分もそれを初期値にして再入力を省く
  const newCategoryValue = newCategory || categoryFilter || "";

  async function createFromSearch() {
    const name = search.trim();
    const category = newCategoryValue.trim();
    if (!name || !category || creating) return;
    setCreating(true);
    try {
      const task = await findOrCreateMasterTask(category, name, 0);
      onSelect(task);
      setSearch("");
      setNewCategory("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        placeholder="検索..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
      />
      {categories.length > 1 && (
        <div className="flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter((cur) => (cur === c ? null : c))}
              className={
                categoryFilter === c
                  ? "rounded-full bg-cream px-3 py-1 text-xs font-bold text-ink"
                  : "rounded-full border border-cream/30 px-3 py-1 text-xs text-cream/80 hover:bg-cream/10"
              }
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {grouped.map(({ category, items }) => (
          <div key={category}>
            <div className="sticky top-0 z-10 bg-panel/95 px-1 py-1 text-xs font-bold text-cream/50 backdrop-blur-sm">
              {category}
            </div>
            <div className="space-y-1">
              {items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelect(t)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    selectedId === t.id ? "bg-cream text-ink" : "bg-ink/60 text-cream hover:bg-ink"
                  }`}
                >
                  {t.isFavorite ? "★ " : ""}
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        {grouped.length === 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-cream/20 p-3">
            <p className="text-xs text-cream/50">
              {search.trim() ? `「${search}」に一致する作業マスタがありません。` : "該当なし"}
            </p>
            {search.trim() && (
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <input
                  placeholder="業務区分（大項目）"
                  value={newCategoryValue}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                />
                <button
                  className="btn-pill-outline shrink-0 whitespace-nowrap text-xs"
                  disabled={!newCategoryValue.trim() || creating}
                  onClick={createFromSearch}
                >
                  ＋「{search}」をマスタに登録
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
