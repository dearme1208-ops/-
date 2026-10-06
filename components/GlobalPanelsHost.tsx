"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { HISTORY_EVENT, SEARCH_EVENT } from "@/lib/globalPanels";
import { formatClock, formatHms } from "@/lib/time";
import { subscribeHistory, undoHistory, type HistoryItem } from "@/lib/toast";
import Modal from "@/components/ui/Modal";

// どの画面からでも開ける「🔍 さがす」と「🕘 操作の履歴」。

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

export default function GlobalPanelsHost({
  onOpenTodo,
  onOpenProject,
  onOpenTab,
}: {
  onOpenTodo: (id: string) => void;
  onOpenProject: (id: string) => void;
  onOpenTab: (tab: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    const s = () => setSearchOpen(true);
    const h = () => setHistoryOpen(true);
    window.addEventListener(SEARCH_EVENT, s);
    window.addEventListener(HISTORY_EVENT, h);
    // Ctrl/⌘+K でも開く
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(SEARCH_EVENT, s);
      window.removeEventListener(HISTORY_EVENT, h);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <>
      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onOpenTodo={(id) => {
            setSearchOpen(false);
            onOpenTodo(id);
          }}
          onOpenProject={(id) => {
            setSearchOpen(false);
            onOpenProject(id);
          }}
          onOpenTab={(tab) => {
            setSearchOpen(false);
            onOpenTab(tab);
          }}
        />
      )}
      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

// ---- さがす ----
// ToDo・案件(段階を含む)・実績(作業ごとにまとめて合計時間)・メモを、1つの言葉で横断して探す
function SearchModal({
  onClose,
  onOpenTodo,
  onOpenProject,
  onOpenTab,
}: {
  onClose: () => void;
  onOpenTodo: (id: string) => void;
  onOpenProject: (id: string) => void;
  onOpenTab: (tab: string) => void;
}) {
  const [q, setQ] = useState("");
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const notes = useLiveQuery(() => db.memoNotes.toArray(), []);
  const key = norm(q.trim());

  const result = useMemo(() => {
    if (!key) return null;
    const hit = (...xs: (string | undefined)[]) => xs.some((x) => x && norm(x).includes(key));
    const todoHits = (todos ?? [])
      .filter((t) => !t.archived && hit(t.title, t.notes, t.category, t.tag))
      .sort((a, b) => Number(a.completed) - Number(b.completed))
      .slice(0, 8);
    const projectHits = (projects ?? [])
      .filter((p) => !p.archived && hit(p.title, p.category, p.workName, p.groupName, ...(p.stages ?? []).map((s) => s.title)))
      .slice(0, 6);
    const workMap = new Map<string, { label: string; seconds: number; last: string; count: number }>();
    for (const r of records ?? []) {
      if (!hit(r.name, r.category, r.method)) continue;
      const k = `${r.category}/${r.name}`;
      const cur = workMap.get(k) ?? { label: `${r.category} / ${r.name}`, seconds: 0, last: "", count: 0 };
      cur.seconds += r.seconds;
      cur.count += 1;
      if (r.date > cur.last) cur.last = r.date;
      workMap.set(k, cur);
    }
    const workHits = [...workMap.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, 6);
    const noteHits = (notes ?? [])
      .filter((n) => hit(n.text, ...(n.checklistItems ?? []).map((c) => c.text)))
      .slice(0, 6);
    return { todoHits, projectHits, workHits, noteHits };
  }, [key, todos, projects, records, notes]);

  const total = result ? result.todoHits.length + result.projectHits.length + result.workHits.length + result.noteHits.length : 0;
  const row = "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-cream/10";

  return (
    <Modal title="🔍 さがす" onClose={onClose}>
      <div className="space-y-3" data-testid="global-search">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="例: A社、見積、請求書"
          aria-label="さがす言葉"
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        {result && total === 0 && <p className="text-center text-sm text-cream/55">見つかりませんでした</p>}
        {result && result.projectHits.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold tracking-wider text-cream/50">案件</h4>
            {result.projectHits.map((p) => (
              <button key={p.id} className={row} onClick={() => onOpenProject(p.id)}>
                <span className={`min-w-0 truncate ${p.completedAt ? "text-cream/45 line-through" : "text-cream"}`}>📁 {p.title}</span>
                <span className="shrink-0 text-[11px] text-cream/50">{p.completedAt ? "完了" : `期日 ${p.dueDate}`}</span>
              </button>
            ))}
          </section>
        )}
        {result && result.todoHits.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold tracking-wider text-cream/50">ToDo</h4>
            {result.todoHits.map((t) => (
              <button key={t.id} className={row} onClick={() => onOpenTodo(t.parentTaskId ?? t.id)}>
                <span className={`min-w-0 truncate ${t.completed ? "text-cream/45 line-through" : "text-cream"}`}>📌 {t.title}</span>
                <span className="shrink-0 text-[11px] text-cream/50">{t.completed ? "完了" : t.dueDate ? `期限 ${t.dueDate}` : ""}</span>
              </button>
            ))}
          </section>
        )}
        {result && result.workHits.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold tracking-wider text-cream/50">これまでの実績</h4>
            {result.workHits.map((w) => (
              <button key={w.label} className={row} onClick={() => onOpenTab("records")}>
                <span className="min-w-0 truncate text-cream">⏱ {w.label}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-cream/55">
                  {w.count}回・計{formatHms(w.seconds)}・最後 {w.last.slice(5)}
                </span>
              </button>
            ))}
          </section>
        )}
        {result && result.noteHits.length > 0 && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold tracking-wider text-cream/50">メモ</h4>
            {result.noteHits.map((n) => (
              <button key={n.id} className={row} onClick={() => onOpenTab("memo")}>
                <span className="min-w-0 truncate text-cream">📝 {(n.text || n.checklistItems?.map((c) => c.text).join("・") || "").slice(0, 60)}</span>
              </button>
            ))}
          </section>
        )}
        {!result && <p className="text-[11px] text-cream/45">ToDo・案件(段階も)・これまでの実績・メモをまとめて探します。Ctrl+K でも開けます。</p>}
      </div>
    </Modal>
  );
}

// ---- 操作の履歴 ----
function HistoryModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  useEffect(() => subscribeHistory(setItems), []);
  return (
    <Modal title="🕘 操作の履歴" onClose={onClose}>
      <div className="space-y-2" data-testid="history">
        <p className="text-[11px] text-cream/50">
          この画面を開いてからの、取り消せる操作(完了・削除など)です。新しい順に並び、どれでも1回だけ戻せます。アプリを開き直すと消えます。
        </p>
        {items.length === 0 && <p className="py-4 text-center text-sm text-cream/55">まだ操作はありません</p>}
        {items.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-cream/10 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className={`truncate ${h.undone ? "text-cream/40 line-through" : "text-cream"}`}>{h.message}</div>
              <div className="text-[11px] tabular-nums text-cream/45">{formatClock(h.at)}</div>
            </div>
            {h.undone ? (
              <span className="shrink-0 text-xs text-cream/45">戻しました</span>
            ) : (
              <button className="btn-pill-outline shrink-0 px-3 py-1 text-xs" onClick={() => undoHistory(h.id)}>
                ↩ 戻す
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
