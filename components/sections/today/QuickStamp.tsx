"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredMasterTasks } from "@/lib/homeMode";
import { convertStampToRecord, recentStampNotes, stampSpans, type StampSpan } from "@/lib/quickStamp";
import { formatClock, todayStr } from "@/lib/time";
import type { QuickStamp } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";

// 打刻(📍)の画面部品。
// - QuickStampButton: 下部タブの左に置く、押すだけで今の時刻を残すボタン
// - QuickStampSheet: 打刻した直後に出す一言入力(任意。何もしなければ自然に消える)
// - QuickStampPanel: 今日の打刻を「打刻〜次の打刻」の区間で並べ、実績に変える

export function QuickStampButton({ onStamp }: { onStamp: () => void }) {
  return (
    <button
      className="panel flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 border-2 border-[rgb(var(--accent-rgb)/0.7)] px-1 py-1 text-[11px] font-bold leading-tight text-cream shadow-lg backdrop-blur active:scale-95 sm:w-14"
      onClick={onStamp}
      aria-label="打刻(今の時刻を残す)"
      title="今の時刻を残します。何をしていたかは後で記録に変えられます"
    >
      <span className="text-base leading-none">📍</span>
      打刻
    </button>
  );
}

export function QuickStampSheet({ stamp, onClose }: { stamp: QuickStamp; onClose: () => void }) {
  const [note, setNote] = useState(stamp.note ?? "");
  const [touched, setTouched] = useState(false);
  const recentStamps = useLiveQuery(() => db.quickStamps.orderBy("at").reverse().limit(60).toArray(), []);
  const recentNotes = useMemo(() => recentStampNotes((recentStamps ?? []).filter((s) => s.id !== stamp.id)), [recentStamps, stamp.id]);

  // 触らなければ少しで消える(打刻だけで済ませたい時に、閉じる操作も要らないように)
  useEffect(() => {
    if (touched) return;
    const id = setTimeout(onClose, 12000);
    return () => clearTimeout(id);
  }, [touched, onClose]);

  async function save(value: string) {
    const v = value.trim();
    await db.quickStamps.update(stamp.id, { note: v || undefined });
    onClose();
  }

  async function undo() {
    await db.quickStamps.delete(stamp.id);
    onClose();
  }

  return (
    <div className="panel mb-1.5 space-y-2 p-2.5 shadow-lg backdrop-blur" data-testid="quick-stamp-sheet">
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-bold text-cream">📍 {formatClock(stamp.at)} を打刻しました</span>
        <button className="ml-auto shrink-0 px-1.5 py-1 text-cream/50 underline decoration-dotted" onClick={undo}>
          取り消す
        </button>
        <button className="shrink-0 px-1.5 py-1 text-cream/60" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save(note);
        }}
      >
        <input
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setTouched(true);
          }}
          onFocus={() => setTouched(true)}
          placeholder="ここから何をする?(任意) 例: 資料、昼"
          className="min-w-0 flex-1 rounded-lg border border-cream/20 bg-ink px-2.5 py-1.5 text-sm text-cream"
          aria-label="打刻の一言"
        />
        <button type="submit" className="btn-pill shrink-0 px-3 text-xs">
          残す
        </button>
      </form>
      {recentNotes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recentNotes.map((n) => (
            <button key={n} className="btn-pill-outline px-2.5 py-1 text-xs" onClick={() => save(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function minutesLabel(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}` : `${m}分`;
}

export function QuickStampPanel({ date, now }: { date: string; now: number }) {
  const stamps = useLiveQuery(() => db.quickStamps.where("date").equals(date).toArray(), [date]);
  // その日に計測した区間。打刻の区間の始まり・終わりを、前後の計測に合わせるのに使う。
  // 打刻から作った作業は打刻と同じ区間なので含めない(含めると、実績にした打刻どうしの境目を
  // 「計測が始まった」と取り違える)
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const measured = useMemo(() => {
    const fromStamps = new Set((stamps ?? []).map((s) => s.recordId).filter(Boolean));
    return (tasks ?? [])
      .filter((t) => !t.isProvisional && !fromStamps.has(t.id))
      .flatMap((t) => t.segments.map((seg) => ({ start: seg.start, end: seg.end })));
  }, [tasks, stamps]);
  const [converting, setConverting] = useState<StampSpan | null>(null);
  const spans = useMemo(() => stampSpans(stamps ?? [], measured, now), [stamps, measured, now]);
  if (spans.length === 0) return null;
  const isToday = date === todayStr();
  const pending = spans.filter((s) => !s.stamp.recordId && !s.stamp.skipped).length;

  return (
    <div className="panel space-y-2 p-3" data-testid="quick-stamp-panel">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold text-cream">📍 打刻</span>
        <span className="text-xs text-cream/50">
          {pending > 0 ? `未記録 ${pending}件。落ち着いたら実績にしましょう` : "すべて記録済み"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {spans.map((span) => {
          const { stamp, nextAt } = span;
          const end = nextAt ?? (isToday ? now : undefined);
          const done = !!stamp.recordId;
          return (
            <li
              key={stamp.id}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-2 text-sm ${
                done || stamp.skipped ? "border-cream/10 text-cream/55" : "border-cream/25 text-cream"
              }`}
            >
              <span className="shrink-0 font-bold tabular-nums">
                {formatClock(done ? stamp.at : span.fromAt)}〜{nextAt ? formatClock(nextAt) : isToday ? "今" : ""}
              </span>
              {span.startedFromMeasure && !done && <span className="shrink-0 text-[10px] text-cream/45">(前の作業の終わりから)</span>}
              {span.endedByMeasure && !done && <span className="shrink-0 text-[10px] text-cream/45">(計測開始まで)</span>}
              {end !== undefined && <span className="shrink-0 text-xs tabular-nums text-cream/50">{minutesLabel(end - (done ? stamp.at : span.fromAt))}</span>}
              <span className="min-w-0 flex-1 truncate">
                {done ? `✓ ${stamp.recordLabel ?? "記録済み"}` : stamp.skipped ? "記録しない" : stamp.note || <span className="text-cream/40">(一言なし)</span>}
              </span>
              <span className="flex shrink-0 gap-1.5">
                {!done && !stamp.skipped && (
                  <>
                    <button className="btn-pill px-2.5 py-1 text-xs" onClick={() => setConverting(span)}>
                      実績にする
                    </button>
                    <button
                      className="btn-pill-outline px-2.5 py-1 text-xs"
                      onClick={() => db.quickStamps.update(stamp.id, { skipped: true })}
                      title="休憩・移動など、記録しない時間にします"
                    >
                      記録しない
                    </button>
                  </>
                )}
                {stamp.skipped && (
                  <button className="btn-pill-outline px-2.5 py-1 text-xs" onClick={() => db.quickStamps.update(stamp.id, { skipped: false })}>
                    戻す
                  </button>
                )}
                <button
                  className="px-1.5 py-1 text-xs text-cream/45 hover:text-cream"
                  onClick={() => db.quickStamps.delete(stamp.id)}
                  aria-label={`${formatClock(stamp.at)}の打刻を削除`}
                  title={done ? "打刻だけを消します(作った実績は残ります)" : "打刻を消します"}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {converting && (
        <ConvertStampDialog
          span={converting}
          defaultEnd={converting.nextAt ?? (isToday ? now : converting.stamp.at + 30 * 60000)}
          onClose={() => setConverting(null)}
        />
      )}
    </div>
  );
}

function hmOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function msOf(date: string, hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(y, mo - 1, d, Number(m[1]), Number(m[2]), 0, 0).getTime();
}

function ConvertStampDialog({ span, defaultEnd, onClose }: { span: StampSpan; defaultEnd: number; onClose: () => void }) {
  const { stamp } = span;
  const [start, setStart] = useState(hmOf(span.fromAt));
  const [end, setEnd] = useState(hmOf(defaultEnd));
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const pickedRef = useRef(false);

  const mastersRaw = useLiveQuery(() => db.masterTasks.toArray(), []);
  const masters = useHomeFilteredMasterTasks(mastersRaw);
  const pastStamps = useLiveQuery(() => db.quickStamps.orderBy("at").reverse().limit(300).toArray(), []);

  // 候補: 同じ一言で前回記録した作業 → 一言を含む作業マスタ → お気に入り
  const candidates = useMemo(() => {
    const out: { category: string; name: string; fromNote?: boolean }[] = [];
    const push = (c: string, n: string, fromNote = false) => {
      if (!out.some((o) => o.category === c && o.name === n)) out.push({ category: c, name: n, fromNote });
    };
    const note = stamp.note?.trim();
    if (note) {
      for (const s of pastStamps ?? []) {
        if (s.id !== stamp.id && s.note?.trim() === note && s.recordLabel) {
          const [c, ...rest] = s.recordLabel.split(" / ");
          if (c && rest.length) push(c, rest.join(" / "), true);
        }
      }
      for (const m of masters ?? []) {
        if (m.archived) continue;
        if (m.name.includes(note) || note.includes(m.name) || m.category.includes(note)) push(m.category, m.name, true);
      }
    }
    for (const m of masters ?? []) if (m.isFavorite && !m.archived) push(m.category, m.name);
    return out.slice(0, 8);
  }, [stamp, masters, pastStamps]);

  // 一言から見つかった候補は最初から選んでおく(そのまま「記録する」を押せば済むように)。
  // お気に入りは一言と無関係なので選ばずに並べるだけ
  useEffect(() => {
    if (pickedRef.current || !candidates[0]?.fromNote) return;
    pickedRef.current = true;
    setCategory(candidates[0].category);
    setName(candidates[0].name);
  }, [candidates]);

  // 時刻を触っていなければ、秒まで含めた元の時刻をそのまま使う(分に丸めると、前後の作業との
  // 間に数十秒の隙間や重なりができる)
  const startMs = start === hmOf(span.fromAt) ? span.fromAt : msOf(stamp.date, start);
  const endMs = end === hmOf(defaultEnd) ? defaultEnd : msOf(stamp.date, end);
  const valid = startMs !== null && endMs !== null && endMs > startMs && !!category.trim() && !!name.trim();

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await convertStampToRecord(stamp, category.trim(), name.trim(), startMs!, endMs!);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="打刻を実績にする" onClose={onClose}>
      <div className="space-y-3">
        {stamp.note && <p className="text-sm text-cream/70">一言:「{stamp.note}」</p>}
        <div className="flex items-center gap-2">
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            aria-label="開始時刻"
          />
          <span className="text-cream/50">〜</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            aria-label="終了時刻"
          />
          {startMs !== null && endMs !== null && endMs > startMs && (
            <span className="text-xs tabular-nums text-cream/60">{minutesLabel(endMs - startMs)}</span>
          )}
        </div>
        {startMs !== null && endMs !== null && endMs <= startMs && (
          <p className="text-xs text-alert">終了は開始より後の時刻にしてください</p>
        )}
        {candidates.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-cream/50">何をしていた?</p>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => {
                const on = c.category === category && c.name === name;
                return (
                  <button
                    key={`${c.category}/${c.name}`}
                    className={`${on ? "btn-pill" : "btn-pill-outline"} px-2.5 py-1 text-xs`}
                    onClick={() => {
                      pickedRef.current = true;
                      setCategory(c.category);
                      setName(c.name);
                    }}
                  >
                    {c.category} / {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="業務区分（大項目）"
            value={category}
            onChange={(e) => {
              pickedRef.current = true;
              setCategory(e.target.value);
            }}
            className="min-w-0 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="詳細作業名"
            value={name}
            onChange={(e) => {
              pickedRef.current = true;
              setName(e.target.value);
            }}
            className="min-w-0 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button className="btn-pill-outline text-xs" onClick={() => setPicking(true)}>
            作業マスタから探す
          </button>
          <button className="btn-pill text-sm disabled:opacity-40" disabled={!valid || saving} onClick={save}>
            記録する
          </button>
        </div>
      </div>
      {picking && (
        <CategoryWorkNameDialog
          title="作業マスタから選択"
          initialMode="master"
          confirmLabel="この内容を使う"
          defaultCategory={category}
          defaultWorkName={name}
          onConfirm={(c, n) => {
            pickedRef.current = true;
            setCategory(c);
            setName(n);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Modal>
  );
}
