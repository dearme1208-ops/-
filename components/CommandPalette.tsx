"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { TabDef } from "@/components/TabNav";

interface CommandItem {
  id: string;
  label: string;
  sub: string;
  onSelect: () => void;
}

// Ctrl/Cmd+Kで開く全体検索。タブ切り替えと、ToDo/案件のタイトル検索からのジャンプをまとめて行える
export default function CommandPalette({
  tabs,
  onChangeTab,
  onOpenTodoDetail,
  onOpenProjectEdit,
}: {
  tabs: TabDef[];
  onChangeTab: (key: string) => void;
  onOpenTodoDetail: (id: string) => void;
  onOpenProjectEdit: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const items = useMemo<CommandItem[]>(() => {
    const q = query.trim().toLowerCase();
    const tabItems: CommandItem[] = tabs.map((t) => ({
      id: `tab-${t.key}`,
      label: t.label,
      sub: "タブへ移動",
      onSelect: () => {
        onChangeTab(t.key);
        setOpen(false);
      },
    }));
    const todoItems: CommandItem[] = (todoTasks ?? [])
      .filter((t) => !t.completed)
      .map((t) => ({
        id: `todo-${t.id}`,
        label: t.title,
        sub: "ToDo",
        onSelect: () => {
          onOpenTodoDetail(t.id);
          setOpen(false);
        },
      }));
    const projectItems: CommandItem[] = (projects ?? [])
      .filter((p) => !p.completedAt)
      .map((p) => ({
        id: `project-${p.id}`,
        label: p.title,
        sub: "案件",
        onSelect: () => {
          onOpenProjectEdit(p.id);
          setOpen(false);
        },
      }));
    const all = [...tabItems, ...todoItems, ...projectItems];
    if (!q) return all.slice(0, 20);
    return all.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 30);
  }, [query, tabs, todoTasks, projects, onChangeTab, onOpenTodoDetail, onOpenProjectEdit]);

  useEffect(() => setSelectedIndex(0), [items.length, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="panel w-full max-w-lg overflow-hidden rounded-2xl shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              items[selectedIndex]?.onSelect();
            }
          }}
          placeholder="タブ・ToDo・案件を検索... (Escで閉じる)"
          className="w-full border-b border-cream/10 bg-transparent px-4 py-3 text-sm text-cream outline-none placeholder:text-cream/40"
        />
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-cream/40">該当する項目がありません</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={item.onSelect}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                i === selectedIndex ? "bg-cream/10 text-cream" : "text-cream/70"
              }`}
            >
              <span className="truncate">{item.label}</span>
              <span className="ml-2 shrink-0 text-[10px] text-cream/40">{item.sub}</span>
            </button>
          ))}
        </div>
        <p className="border-t border-cream/10 px-4 py-2 text-[10px] text-cream/30">
          ↑↓ で選択 / Enter で決定 / Ctrl(⌘)+K でいつでも開閉
        </p>
      </div>
    </div>
  );
}
