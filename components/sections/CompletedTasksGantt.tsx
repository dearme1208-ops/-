"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { formatClock, formatHms } from "@/lib/time";
import type { DailyTask } from "@/lib/types";

const DEFAULT_PX_PER_MIN = 4;
const MIN_PX_PER_MIN = 0.5;
const MAX_PX_PER_MIN = 30;
const ROW_H = 44;
const BAR_H = 22;
const MIN_BAR_MIN = 1; // これより短くはできない(分)

// 完了した作業だけを対象に、開始/終了をドラッグで直接調整できる簡易ガントチャート。
// 通常のGanttSection(表示専用・全ステータス対象)とは別に、「完了タブで時間を
// 振り分けやすくしたい」という要望に応え、ドラッグで大まかに合わせてタップで
// 既存の編集ダイアログ(数値入力)を開く、という組み合わせにしている
export default function CompletedTasksGantt({
  tasks,
  onCommitTimes,
  onOpenEdit,
}: {
  tasks: DailyTask[];
  onCommitTimes: (task: DailyTask, startedAt: number, endedAt: number) => void;
  onOpenEdit: (task: DailyTask) => void;
}) {
  const [pxPerMin, setPxPerMin] = useState(DEFAULT_PX_PER_MIN);
  const scrollRef = useRef<HTMLDivElement>(null);

  const doneTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "done" && !t.isProvisional && t.startedAt != null && t.endedAt != null)
        .sort((a, b) => a.order - b.order),
    [tasks]
  );

  const timelineBase = useMemo(() => {
    if (doneTasks.length === 0) return Date.now();
    const minStart = Math.min(...doneTasks.map((t) => t.startedAt!));
    const d = new Date(minStart);
    d.setMinutes(0, 0, 0);
    return d.getTime();
  }, [doneTasks]);

  const totalMinutes = useMemo(() => {
    if (doneTasks.length === 0) return 60;
    const maxEnd = Math.max(...doneTasks.map((t) => t.endedAt!));
    return Math.max(60, Math.ceil((maxEnd - timelineBase) / 60000) + 15);
  }, [doneTasks, timelineBase]);

  function zoomIn() {
    setPxPerMin((v) => Math.min(MAX_PX_PER_MIN, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerMin((v) => Math.max(MIN_PX_PER_MIN, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const width = scrollRef.current?.clientWidth ?? 0;
    if (width <= 0 || totalMinutes <= 0) return;
    const fit = Math.max(0, width - 20) / totalMinutes;
    setPxPerMin(Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, +fit.toFixed(3))));
  }

  const hourMarks = Array.from({ length: Math.ceil(totalMinutes / 60) + 1 }, (_, i) => i);

  if (doneTasks.length === 0) return null;

  return (
    <div className="panel space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-cream/70">完了した作業のタイムライン</p>
        <div className="flex items-center gap-1">
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={zoomOut} aria-label="縮小">
            －
          </button>
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={zoomIn} aria-label="拡大">
            ＋
          </button>
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={fitToView}>
            全体表示
          </button>
        </div>
      </div>
      <p className="text-[10px] text-cream/40">
        バーの端をドラッグで開始/終了を調整、バー本体のドラッグで全体を前後に移動できます。軽くタップすると詳細な時刻編集を開きます。
      </p>
      <div className="flex">
        <div className="w-24 shrink-0 pr-2 sm:w-36">
          <div className="mb-1 h-5 border-b border-cream/20" />
          {doneTasks.map((task) => (
            <div key={task.id} className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70" style={{ height: ROW_H }}>
              <span className="truncate text-cream/50">{task.category}</span>
              <span className="truncate">{task.name}</span>
            </div>
          ))}
        </div>
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: totalMinutes * pxPerMin + 20 }}>
            <div className="relative mb-1 h-5 border-b border-cream/20 text-[10px] text-cream/50">
              {hourMarks.map((h) => (
                <div key={h} className="absolute top-0 border-l border-cream/10 pl-1" style={{ left: h * 60 * pxPerMin }}>
                  {formatClock(timelineBase + h * 60 * 60000)}
                </div>
              ))}
            </div>
            <div className="relative" style={{ height: doneTasks.length * ROW_H }}>
              {hourMarks.map((h) => (
                <div key={h} className="absolute top-0 bottom-0 border-l border-cream/5" style={{ left: h * 60 * pxPerMin }} />
              ))}
              {doneTasks.map((task, idx) => {
                const prev = doneTasks[idx - 1];
                const next = doneTasks[idx + 1];
                return (
                  <CompletedBar
                    key={task.id}
                    task={task}
                    top={idx * ROW_H}
                    pxPerMin={pxPerMin}
                    timelineBase={timelineBase}
                    prevEnd={prev?.endedAt ?? null}
                    nextStart={next?.startedAt ?? null}
                    onCommit={onCommitTimes}
                    onOpenEdit={onOpenEdit}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompletedBar({
  task,
  top,
  pxPerMin,
  timelineBase,
  prevEnd,
  nextStart,
  onCommit,
  onOpenEdit,
}: {
  task: DailyTask;
  top: number;
  pxPerMin: number;
  timelineBase: number;
  prevEnd: number | null;
  nextStart: number | null;
  onCommit: (task: DailyTask, startedAt: number, endedAt: number) => void;
  onOpenEdit: (task: DailyTask) => void;
}) {
  const origStart = task.startedAt!;
  const origEnd = task.endedAt!;

  // ドラッグ中はローカルの分数オフセットだけを更新して見た目に即反映し、DBへの書き込みは
  // pointerup時に一度だけ行う(付箋のドラッグ/リサイズと同じ「離した時に確定」の方針)
  const [drag, setDrag] = useState<{ mode: "move" | "left" | "right" } | null>(null);
  const [deltaMin, setDeltaMin] = useState(0);
  const dragStartXRef = useRef(0);
  const movedRef = useRef(false);

  function beginDrag(mode: "move" | "left" | "right") {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartXRef.current = e.clientX;
      movedRef.current = false;
      setDrag({ mode });
      setDeltaMin(0);
    };
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const dxPx = e.clientX - dragStartXRef.current;
    if (Math.abs(dxPx) > 3) movedRef.current = true;
    setDeltaMin(Math.round(dxPx / pxPerMin));
  }
  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const mode = drag.mode;
    const wasMoved = movedRef.current;
    setDrag(null);
    if (!wasMoved) {
      setDeltaMin(0);
      onOpenEdit(task);
      return;
    }
    const deltaMs = deltaMin * 60000;
    let newStart = origStart;
    let newEnd = origEnd;
    if (mode === "move") {
      newStart = origStart + deltaMs;
      newEnd = origEnd + deltaMs;
    } else if (mode === "left") {
      newStart = Math.min(origStart + deltaMs, origEnd - MIN_BAR_MIN * 60000);
    } else {
      newEnd = Math.max(origEnd + deltaMs, origStart + MIN_BAR_MIN * 60000);
    }
    setDeltaMin(0);
    if (newStart === origStart && newEnd === origEnd) return;
    // ドラッグでの変更は誤操作の可能性もあるため、確定前に一度確認する。
    // キャンセルした場合はdragがnullに戻っているのでプレビューも自動的に元の位置に戻る
    const confirmed = confirm(
      `「${task.name}」の時刻を変更します。\n${formatClock(origStart)}〜${formatClock(origEnd)} → ${formatClock(newStart)}〜${formatClock(newEnd)}\n\nよろしいですか?`
    );
    if (!confirmed) return;
    onCommit(task, newStart, newEnd);
  }

  const previewStart = drag && (drag.mode === "move" || drag.mode === "left") ? origStart + deltaMin * 60000 : origStart;
  const previewEndRaw = drag && (drag.mode === "move" || drag.mode === "right") ? origEnd + deltaMin * 60000 : origEnd;
  const clampedStart = drag?.mode === "left" ? Math.min(previewStart, origEnd - MIN_BAR_MIN * 60000) : previewStart;
  const clampedEnd = drag?.mode === "right" ? Math.max(previewEndRaw, origStart + MIN_BAR_MIN * 60000) : previewEndRaw;

  const left = ((clampedStart - timelineBase) / 60000) * pxPerMin;
  const width = Math.max(((clampedEnd - clampedStart) / 60000) * pxPerMin, 4);
  const overlapsPrev = prevEnd != null && clampedStart < prevEnd;
  const overlapsNext = nextStart != null && clampedEnd > nextStart;
  const overlapping = overlapsPrev || overlapsNext;

  const barTop = (ROW_H - BAR_H) / 2;

  // 一時停止を挟んだ作業は複数のsegmentsを持つ。ドラッグ中でなければ、全体を覆う1本の
  // バーではなく実働区間(segments)ごとに個別のバーを描き、一時停止していた間は
  // バーが途切れて見えるようにする(区間が無い/不明な古いデータは従来通り1本にフォールバック)
  const rawSegments = task.segments.length > 0 ? task.segments : [{ start: origStart, end: origEnd }];

  return (
    <div className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
      {/* バーが細いと内側に時刻を書いても見えなくなるため、開始時刻はバーの手前(左)、
          終了時刻はバーの後ろ(右)に、バーの長さに関わらず常に読める位置で表示する */}
      <div
        className="pointer-events-none absolute whitespace-nowrap text-[10px] tabular-nums text-cream/70"
        style={{ left, top: barTop, height: BAR_H, lineHeight: `${BAR_H}px`, transform: "translateX(calc(-100% - 4px))" }}
      >
        {formatClock(clampedStart)}
      </div>
      <div
        className={`group absolute cursor-grab rounded active:cursor-grabbing ${overlapping ? "ring-2 ring-alert" : ""} ${
          drag ? (overlapping ? "bg-alert" : "bg-cream") : ""
        }`}
        style={{ left, width, top: barTop, height: BAR_H }}
        onPointerDown={beginDrag("move")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {!drag &&
          rawSegments.map((seg, i) => {
            const segEnd = seg.end ?? origEnd;
            const segLeft = ((seg.start - timelineBase) / 60000) * pxPerMin;
            const segWidth = Math.max(((segEnd - seg.start) / 60000) * pxPerMin, 2);
            return (
              <div
                key={i}
                className={`pointer-events-none absolute rounded ${overlapping ? "bg-alert" : "bg-cream"}`}
                style={{ left: segLeft - left, width: segWidth, top: 0, height: BAR_H }}
              />
            );
          })}
        <div
          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l bg-ink/20 hover:bg-ink/40"
          onPointerDown={beginDrag("left")}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        <div
          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-ink/20 hover:bg-ink/40"
          onPointerDown={beginDrag("right")}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
      <div
        className="pointer-events-none absolute whitespace-nowrap text-[10px] tabular-nums text-cream/70"
        style={{ left: left + width + 4, top: barTop, height: BAR_H, lineHeight: `${BAR_H}px` }}
      >
        {formatClock(clampedEnd)}
      </div>
      {drag && (
        <div
          className={`pointer-events-none absolute whitespace-nowrap text-[10px] ${overlapping ? "text-alert" : "text-cream/70"}`}
          style={{ left, top: ROW_H }}
        >
          {overlapping ? "⚠ 前後の作業と重なっています " : ""}
          実績 {formatHms(Math.max(0, (clampedEnd - clampedStart) / 1000))}
        </div>
      )}
    </div>
  );
}
