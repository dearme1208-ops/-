"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dueLabel, parseCompose } from "@/lib/claudeCompose";
import { commitCapture, QUICK_CAPTURE_EVENT, suggestDest, type CaptureDest } from "@/lib/quickCapture";
import { showUndoToast } from "@/lib/toast";
import { todayStr } from "@/lib/time";
import Modal from "@/components/ui/Modal";

// 「ひとこと入力」の画面。どのモード・どのタブからでも開ける(道具・本日の作業の操作列・
// キーボードの「/」・他のアプリの「共有」)。書いた内容をその場で読み取って見せ、
// 行き先は候補を先に選んだ状態にしておくので、たいていは Enter か1タップで済む

const DESTS: { key: CaptureDest; icon: string; label: string; hint: string }[] = [
  { key: "todo", icon: "📌", label: "ToDo", hint: "あとでやること" },
  { key: "now", icon: "▶", label: "今やる", hint: "すぐ計測を始める" },
  { key: "today", icon: "🗓", label: "今日の予定", hint: "本日の作業に入れる" },
  { key: "memo", icon: "📝", label: "メモ", hint: "控えとして残す" },
  { key: "project", icon: "📁", label: "案件", hint: "段階と期日で進める" },
];

export default function QuickCaptureHost() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [dest, setDest] = useState<CaptureDest | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const today = todayStr();
  const parsed = useMemo(() => parseCompose(text, today), [text, today]);
  const suggested = suggestDest(text, parsed);
  const chosen = dest ?? suggested;

  // 開く合図(道具・操作列など)と、他のアプリの「共有」(?share=1&title=&text=&url=)
  useEffect(() => {
    const onOpen = (e: Event) => {
      setText((e as CustomEvent<string>).detail ?? "");
      setDest(null);
      setOpen(true);
    };
    window.addEventListener(QUICK_CAPTURE_EVENT, onOpen);
    const params = new URLSearchParams(window.location.search);
    if (params.get("share") === "1") {
      const shared = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n");
      window.history.replaceState({}, "", window.location.pathname);
      setText(shared);
      setOpen(true);
    }
    // キーボードの「/」で開く(入力欄にいる時は除く)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setText("");
        setDest(null);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(QUICK_CAPTURE_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  async function commit(d: CaptureDest) {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const msg = await commitCapture(d, text, parsed, today);
      showUndoToast(msg);
      setOpen(false);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  const chips: string[] = [];
  if (parsed.dueDate) chips.push(`期限 ${dueLabel(parsed.dueDate, today)}`);
  if (parsed.estimateMin) chips.push(`見込み ${parsed.estimateMin}分`);
  if (parsed.category) chips.push(`@${parsed.category}`);
  if (parsed.important) chips.push("重要");

  return (
    <Modal title="✏️ ひとこと入力" onClose={() => setOpen(false)}>
      <div className="space-y-3" data-testid="quick-capture">
        <textarea
          ref={ref}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void commit(chosen);
            }
          }}
          placeholder="例: 明日までに見積書を送る 30分 @営業 !"
          aria-label="ひとこと"
          className="block w-full resize-none rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream placeholder:text-cream/35"
        />
        {text.trim() && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-cream/45">受け取った内容:</span>
            <span className="font-bold text-cream">{parsed.title || text.trim().split("\n")[0]}</span>
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-cream/10 px-2 py-0.5 text-cream/75">
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {DESTS.map((d) => (
            <button
              key={d.key}
              className={`${chosen === d.key ? "btn-pill" : "btn-pill-outline"} flex flex-col items-center gap-0 px-2 py-2 text-sm`}
              disabled={!text.trim() || busy}
              onClick={() => {
                setDest(d.key);
                void commit(d.key);
              }}
              aria-pressed={chosen === d.key}
            >
              <span>
                {d.icon} {d.label}
              </span>
              <span className="text-[10px] font-normal opacity-70">{d.hint}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-cream/45">
          期限は「明日」「金曜」「10/12まで」、時間は「30分」、分類は「@営業」、重要は「!」で書けます。
          色の付いた行き先が候補です。Enter でそこに入ります。
        </p>
      </div>
    </Modal>
  );
}
