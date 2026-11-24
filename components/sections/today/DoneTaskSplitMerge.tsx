"use client";

import { useMemo, useState } from "react";
import { clockOnDate, defaultSplitAt } from "@/lib/provisionalSplit";
import { formatClock, formatHms } from "@/lib/time";
import { isSubmitEnter } from "@/lib/keyboard";
import type { DailyTask, MasterTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 完了した作業の「分ける…」「まとめる…」(⋯ の中から開く)。書き込みは lib/provisionalSplit.ts

type SaveResult = { ok: true } | { ok: false; message: string };

/** "HH:MM" を、作業の開始〜終了の間に入るよう日付を合わせて ms にする(0時をまたいだ作業向け) */
function hmWithin(task: DailyTask, hm: string): number {
  const at = clockOnDate(task.date, hm);
  const start = task.startedAt ?? task.segments[0]?.start ?? at;
  return at < start ? at + 24 * 3600_000 : at;
}

export function SplitDoneTaskDialog({
  task,
  masters,
  onSplit,
  onClose,
}: {
  task: DailyTask;
  masters: MasterTask[];
  onSplit: (atMs: number, second?: { category: string; name: string; masterTaskId?: string }) => Promise<SaveResult>;
  onClose: () => void;
}) {
  const start = task.startedAt ?? task.segments[0]?.start ?? 0;
  const end = task.endedAt ?? task.segments[task.segments.length - 1]?.end ?? start;
  const [hm, setHm] = useState(() => formatClock(defaultSplitAt(start, end)));
  const [rename, setRename] = useState(false);
  const [category, setCategory] = useState(task.category);
  const [name, setName] = useState(task.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = `split-masters-${task.id}`;
  const activeMasters = useMemo(() => masters.filter((m) => !m.archived), [masters]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    const at = hmWithin(task, hm);
    const master = rename ? activeMasters.find((m) => m.category === category.trim() && m.name === name.trim()) : undefined;
    const r = await onSplit(at, rename ? { category, name, masterTaskId: master?.id } : undefined);
    setBusy(false);
    if (!r.ok) setError(r.message);
  }

  const at = hm ? hmWithin(task, hm) : NaN;
  const firstMs = Number.isFinite(at) ? Math.max(0, at - start) : 0;
  const secondMs = Number.isFinite(at) ? Math.max(0, end - at) : 0;
  return (
    <Modal title="作業を分ける" onClose={onClose}>
      <p className="mb-3 text-xs text-cream/60">
        「{task.name}」（{formatClock(start)}〜{formatClock(end)}）を、選んだ時刻で前と後の2つに分けます。
      </p>
      <label className="flex items-center gap-2 text-sm text-cream">
        <span className="shrink-0">分ける時刻</span>
        <input
          type="time"
          value={hm}
          onChange={(e) => {
            setHm(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (isSubmitEnter(e)) {
              e.preventDefault();
              void submit();
            }
          }}
          aria-label="分ける時刻"
          className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
        />
      </label>
      <p className="caption mt-1 num">
        前 {formatClock(start)}〜{hm}（約{formatHms(Math.round(firstMs / 1000))}） / 後 {hm}〜{formatClock(end)}（約{formatHms(Math.round(secondMs / 1000))}）
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm text-cream/80">
        <input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />
        後ろの分を別の作業にする
      </label>
      {rename && (
        <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
          <span className="text-cream/60">区分</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="後ろの分の区分"
            className="min-w-0 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
          />
          <span className="text-cream/60">作業名</span>
          <input
            value={name}
            onChange={(e) => {
              const v = e.target.value;
              setName(v);
              // 候補から選んだら区分も合わせる
              const hit = activeMasters.find((m) => `${m.name}（${m.category}）` === v);
              if (hit) {
                setName(hit.name);
                setCategory(hit.category);
              }
            }}
            list={listId}
            aria-label="後ろの分の作業名"
            className="min-w-0 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
          />
          <datalist id={listId}>
            {activeMasters.map((m) => (
              <option key={m.id} value={`${m.name}（${m.category}）`} />
            ))}
          </datalist>
          <p className="caption col-span-2">後ろの分の時間は、その作業の実績へ移します。</p>
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm text-alert" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={onClose}>
          やめる
        </button>
        <button className="btn-pill text-sm" disabled={busy || !hm} onClick={() => void submit()}>
          この時刻で分ける
        </button>
      </div>
    </Modal>
  );
}

export function MergeDoneTaskDialog({
  task,
  candidates,
  workLabel,
  onMerge,
  onClose,
}: {
  task: DailyTask;
  /** 同じ日の、ほかの完了した作業 */
  candidates: DailyTask[];
  workLabel: (t: DailyTask) => string;
  onMerge: (otherId: string, nameFrom: "keep" | "other") => Promise<SaveResult>;
  onClose: () => void;
}) {
  const sameKey = (t: DailyTask) => (t.masterTaskId && task.masterTaskId ? t.masterTaskId === task.masterTaskId : t.category === task.category && t.name === task.name);
  // 同じ作業を先に、その中は時刻順
  const sorted = useMemo(
    () => [...candidates].sort((a, b) => Number(sameKey(b)) - Number(sameKey(a)) || (a.startedAt ?? 0) - (b.startedAt ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, task]
  );
  const [otherId, setOtherId] = useState<string | null>(sorted.find(sameKey)?.id ?? null);
  const [nameFrom, setNameFrom] = useState<"keep" | "other">("keep");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const other = sorted.find((t) => t.id === otherId);
  const differs = !!other && !sameKey(other);
  const range = (t: DailyTask) => (t.startedAt && t.endedAt ? `${formatClock(t.startedAt)}〜${formatClock(t.endedAt)}` : "");

  async function submit() {
    if (!otherId || busy) return;
    setBusy(true);
    const r = await onMerge(otherId, differs ? nameFrom : "keep");
    setBusy(false);
    if (!r.ok) setError(r.message);
  }

  return (
    <Modal title="作業をまとめる" onClose={onClose}>
      <p className="mb-3 text-xs text-cream/60">
        「{workLabel(task)}」（{range(task)}）と1つにまとめる作業を選んでください。時間は足し合わせます。
      </p>
      {sorted.length === 0 ? (
        <p className="empty-state">この日にまとめられる完了した作業はありません</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label="まとめる相手">
          {sorted.map((t) => (
            <label key={t.id} className="list-row flex cursor-pointer items-center gap-2 rounded-lg bg-ink/50 px-3 py-2 text-sm text-cream/85">
              <input
                type="radio"
                name={`merge-${task.id}`}
                checked={otherId === t.id}
                onChange={() => {
                  setOtherId(t.id);
                  setError(null);
                }}
              />
              <span className="min-w-0 flex-1 truncate">
                {t.category} / {workLabel(t)}
              </span>
              <span className="num shrink-0 text-xs text-cream/60">{range(t)}</span>
              {!sameKey(t) && <span className="chip shrink-0" data-tone="caution">別の作業</span>}
            </label>
          ))}
        </div>
      )}
      {differs && other && (
        <fieldset className="mt-3 space-y-1 text-sm text-cream/80">
          <legend className="mb-1 text-xs text-cream/60">どちらの名前にしますか（もう一方の時間はこちらの実績へ移します）</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name={`merge-name-${task.id}`} checked={nameFrom === "keep"} onChange={() => setNameFrom("keep")} />
            {task.category} / {workLabel(task)}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name={`merge-name-${task.id}`} checked={nameFrom === "other"} onChange={() => setNameFrom("other")} />
            {other.category} / {workLabel(other)}
          </label>
        </fieldset>
      )}
      {error && (
        <p className="mt-3 text-sm text-alert" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={onClose}>
          やめる
        </button>
        <button className="btn-pill text-sm" disabled={busy || !otherId} onClick={() => void submit()}>
          1つにまとめる
        </button>
      </div>
    </Modal>
  );
}
