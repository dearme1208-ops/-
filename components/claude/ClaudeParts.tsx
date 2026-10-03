"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dueLabel, parseCompose, type ComposeResult } from "@/lib/claudeCompose";
import type { Memory, MemoryNote } from "@/lib/claudeMemory";
import type { ClaudeWords } from "@/lib/claudeWords";

// Claudeモードのワークスペースを組み立てる部品。
// 本家Claudeの画面の作法(時刻の挨拶と放射状のスパーク、話しかけるような入力欄、
// 作業中の「✻ 考え中…」、会話をまたいで覚えている事柄)を、時間の記録とタスク管理に置き換えている

/** Claudeのロゴを思わせる放射状のスパーク。長短の光線を交互に並べる */
export function SparkMark({ className = "", spin = false }: { className?: string; spin?: boolean }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg viewBox="-50 -50 100 100" className={`${className} ${spin ? "claude-spark-mark" : ""}`} aria-hidden="true">
      {rays.map((deg, i) => (
        <rect
          key={deg}
          x={-4}
          y={i % 2 ? -36 : -48}
          width="8"
          height={i % 2 ? 30 : 42}
          rx="4"
          fill="rgb(var(--accent-rgb))"
          transform={`rotate(${deg})`}
        />
      ))}
    </svg>
  );
}

const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** 作業中の目印。Claude Codeの「✻ 考え中…」のように、記号が瞬きながら言葉が数秒ごとに入れ替わる */
export function WorkingLine({ verbs, seed }: { verbs: string[]; seed: number }) {
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), 140);
    return () => clearInterval(id);
  }, [reduced]);
  const glyph = reduced ? "✻" : SPINNER[tick % SPINNER.length];
  const verb = verbs[(Math.floor((tick * 140) / 7000) + seed) % verbs.length];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-[rgb(var(--accent-rgb))]">
      <span className="inline-block w-3 text-center font-mono" aria-hidden="true">
        {glyph}
      </span>
      <span>{verb}…</span>
    </span>
  );
}

/**
 * 話しかけるように書ける入力欄。書いている間に「こう受け取りました」を見せ、
 * 送る(↑)とタスク、またはプロジェクトとして登録する
 */
export function Composer({
  today,
  words,
  recentTags,
  onSubmit,
}: {
  today: string;
  words: ClaudeWords;
  recentTags: string[];
  onSubmit: (parsed: ComposeResult, asProject: boolean) => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [asProject, setAsProject] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const parsed = useMemo(() => parseCompose(text, today), [text, today]);
  const canSend = !!parsed.title;

  // 入力に合わせて高さを伸ばす(最大6行ほど)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  async function send() {
    if (!canSend) return;
    await onSubmit(parsed, asProject);
    setText("");
    setAsProject(false);
  }

  function insertTag(tag: string) {
    const without = text.replace(/\s*[@＠]\S+/, "").trimEnd();
    setText(without ? `${without} @${tag}` : `@${tag} `);
    ref.current?.focus();
  }

  const chips: string[] = [];
  if (text.trim()) {
    if (parsed.dueDate) chips.push(`${asProject ? "期日" : "期限"} ${dueLabel(parsed.dueDate, today)}`);
    if (parsed.estimateMin) chips.push(`見込み ${parsed.estimateMin}分`);
    if (parsed.category) chips.push(`@${parsed.category}`);
    if (parsed.important) chips.push("重要");
  }

  return (
    <div className="claude-composer" data-testid="claude-composer">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // 日本語の変換確定のEnterでは送らない
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={words.capturePlaceholder}
        aria-label={words.captureLabel}
        className="block w-full resize-none bg-transparent px-1 pt-1 text-[15px] leading-relaxed text-cream placeholder:text-cream/40 focus:outline-none"
      />
      {text.trim() && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[12px]" data-testid="claude-understood">
          <span className="text-cream/45">{words.understood}:</span>
          <span className="font-medium text-cream">{parsed.title || "（件名がありません）"}</span>
          {chips.map((c) => (
            <span key={c} className="claude-chip">
              {c}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {recentTags.map((tag) => (
            <button key={tag} type="button" className="claude-chip claude-chip-button shrink-0" onClick={() => insertTag(tag)}>
              @{tag}
            </button>
          ))}
          <button
            type="button"
            className={`claude-chip claude-chip-button shrink-0 ${asProject ? "claude-chip-on" : ""}`}
            onClick={() => setAsProject((v) => !v)}
            aria-pressed={asProject}
            title="段階と期日で進めたい大きな仕事は、プロジェクトとして登録します"
          >
            {asProject ? "✓ プロジェクト" : "プロジェクトにする"}
          </button>
        </div>
        <button
          type="button"
          className="claude-send"
          onClick={send}
          disabled={!canSend}
          aria-label={asProject ? "プロジェクトとして登録" : "タスクとして追加"}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

/** 期限の表示。押すと日付を選べる(未設定なら「期限なし」) */
export function DueEditor({
  value,
  today,
  onChange,
}: {
  value?: string;
  today: string;
  onChange: (v: string) => void;
}) {
  const overdue = !!value && value < today;
  return (
    <label className={`relative inline-flex cursor-pointer items-center text-[12px] ${overdue ? "font-medium text-alert" : "text-cream/45"}`}>
      {value ? `${overdue ? "期限切れ " : ""}${dueLabel(value, today)}` : "期限なし"}
      <input
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label="期限"
      />
    </label>
  );
}

export function MemoryPanel({
  words,
  memories,
  notes,
  onForget,
  onAddNote,
  onRemoveNote,
  forgottenCount,
  onRestoreAll,
}: {
  words: ClaudeWords;
  memories: Memory[];
  notes: MemoryNote[];
  onForget: (id: string) => void;
  onAddNote: (text: string) => void;
  onRemoveNote: (id: string) => void;
  forgottenCount: number;
  onRestoreAll: () => void;
}) {
  const [draft, setDraft] = useState("");
  const total = memories.length + notes.length;
  return (
    <details className="claude-card group" data-testid="claude-memory">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className="claude-eyebrow">{words.memoryTitle}</span>
        <span className="text-[12px] text-cream/45">{total}件</span>
        <span className="ml-auto text-[12px] text-cream/40 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[13px] leading-relaxed text-cream/60">{words.memoryLead}</p>
        {memories.length === 0 && <p className="text-[13px] text-cream/45">{words.memoryEmpty}</p>}
        <ul className="divide-y divide-cream/10">
          {memories.map((m) => (
            <li key={m.id} className="flex items-start gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-snug text-cream">{m.text}</p>
                <p className="mt-0.5 text-[11px] text-cream/40">{m.basis}</p>
              </div>
              <button className="shrink-0 px-1 py-1 text-[12px] text-cream/45 underline decoration-dotted hover:text-cream" onClick={() => onForget(m.id)}>
                {words.memoryForget}
              </button>
            </li>
          ))}
        </ul>
        {forgottenCount > 0 && (
          <button className="text-[12px] text-cream/45 underline decoration-dotted" onClick={onRestoreAll}>
            忘れた{forgottenCount}件を思い出す
          </button>
        )}
        <div className="space-y-1.5 border-t border-cream/10 pt-3">
          <p className="text-[12px] font-medium text-cream/60">{words.memoryNotesTitle}</p>
          {notes.map((n) => (
            <div key={n.id} className="flex items-start gap-3">
              <p className="min-w-0 flex-1 text-[14px] text-cream">{n.text}</p>
              <button className="shrink-0 px-1 text-[12px] text-cream/45 hover:text-cream" onClick={() => onRemoveNote(n.id)} aria-label={`「${n.text}」を消す`}>
                ✕
              </button>
            </div>
          ))}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              onAddNote(draft.trim());
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={words.memoryNotePlaceholder}
              className="claude-input min-w-0 flex-1"
            />
            <button type="submit" className="btn-pill-outline shrink-0 text-xs" disabled={!draft.trim()}>
              覚えておく
            </button>
          </form>
        </div>
      </div>
    </details>
  );
}
