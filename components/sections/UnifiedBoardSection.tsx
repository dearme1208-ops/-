"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatMsClock, todayStr } from "@/lib/time";
import { segmentsAccumulatedMs, finishDailyTask } from "@/lib/tasks";
import { completeTodoTask } from "@/lib/todo";
import {
  clampMemoZoom,
  DEFAULT_MEMO_NOTE_COLOR,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_NOTE_COLORS,
} from "@/lib/memo";
import type { DailyTask, MemoNote, TodoTask } from "@/lib/types";

// 「メモ・ToDo(マイデイ)・本日の作業」を1つの自由配置キャンバスにまとめて表示し、
// その場で作業の開始/一時停止/完了やToDoの完了ができるようにしたビュー。
// 付箋はメモタブと同じdb.memoNotes/db.memoBoardsをそのまま共有するため、
// どちらのタブで開いても同じ付箋が見える。本日の作業・ToDoは付箋のような
// x/y座標を持たないため、この画面専用のboardX/boardYフィールドに位置を保存する
// (本日の作業は日付が変われば入れ替わるため、位置も自然にリセットされる)
const CARD_WIDTH = 220;
const TASK_CARD_HEIGHT = 110;
const TODO_CARD_HEIGHT = 90;

function cascadePosition(index: number, originX: number, originY: number): { x: number; y: number } {
  const offset = (index * 28) % 260;
  return { x: originX + offset, y: originY + offset };
}

export default function UnifiedBoardSection() {
  const today = todayStr();
  const boards = useLiveQuery(() => db.memoBoards.orderBy("order").toArray(), []);
  const [selectedBoardId, setSelectedBoardId] = useSetting("memo.selectedBoardId", "");
  useEffect(() => {
    if (boards && boards.length === 0) {
      db.memoBoards.add({ id: uid(), title: "メモ", order: 0, createdAt: Date.now() });
    }
  }, [boards]);
  useEffect(() => {
    if (boards && boards.length > 0 && !boards.some((b) => b.id === selectedBoardId)) {
      setSelectedBoardId(boards[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boards, selectedBoardId]);

  const notes = useLiveQuery(
    () => (selectedBoardId ? db.memoNotes.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as MemoNote[])),
    [selectedBoardId]
  );
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todoTasks = useLiveQuery(() => db.todoTasks.where("myDayDate").equals(today).toArray(), [today]);

  const tasks = (dailyTasks ?? []).filter((t) => !t.isProvisional && t.status !== "done");
  const todos = (todoTasks ?? []).filter((t) => !t.completed);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [zoomStr, setZoomStr] = useSetting("board.zoom", "1");
  const zoom = clampMemoZoom(Number(zoomStr) || 1);
  function setZoom(z: number) {
    setZoomStr(String(clampMemoZoom(z)));
  }

  async function moveNote(id: string, x: number, y: number) {
    await db.memoNotes.update(id, { x, y, updatedAt: Date.now() });
  }
  async function commitNoteText(note: MemoNote, text: string) {
    if (text === note.text) return;
    await db.memoNotes.update(note.id, { text, updatedAt: Date.now() });
  }

  async function moveTask(id: string, x: number, y: number) {
    await db.dailyTasks.update(id, { boardX: x, boardY: y });
  }
  async function pauseTask(task: DailyTask) {
    const closeAt = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }
  async function startTask(task: DailyTask) {
    const running = tasks.find((t) => t.status === "running" && t.id !== task.id);
    if (running) await pauseTask(running);
    const segments = [...task.segments, { start: Date.now() }];
    await db.dailyTasks.update(task.id, { segments, status: "running" });
  }
  async function completeTask(task: DailyTask) {
    await finishDailyTask(task);
  }

  async function moveTodo(id: string, x: number, y: number) {
    await db.todoTasks.update(id, { boardX: x, boardY: y });
  }
  async function completeTodo(task: TodoTask) {
    await completeTodoTask(task, today);
  }

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs text-cream/50">メモ帳:</span>
        {(boards ?? []).map((b) => (
          <button
            key={b.id}
            className={b.id === selectedBoardId ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setSelectedBoardId(b.id)}
          >
            {b.title}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={() => setZoom(zoom - 0.1)}>
            −
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-cream/60">{Math.round(zoom * 100)}%</span>
          <button className="btn-pill-outline px-2 py-1 text-xs" onClick={() => setZoom(zoom + 0.1)}>
            +
          </button>
        </div>
      </div>
      <p className="px-1 text-xs text-cream/50">
        付箋はメモタブと同じものが表示されます。ToDoは「マイデイ」に入れたものだけをカード化しています。
      </p>

      <div className="panel overflow-auto p-0" style={{ height: "70vh" }}>
        <div style={{ width: MEMO_BOARD_WIDTH * zoom, height: MEMO_BOARD_HEIGHT * zoom }}>
          <div
            className="relative"
            style={{ width: MEMO_BOARD_WIDTH, height: MEMO_BOARD_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {(notes ?? []).map((note) => (
              <NoteCard key={note.id} note={note} zoom={zoom} onDragEnd={moveNote} onCommitText={commitNoteText} />
            ))}
            {tasks.map((task, i) => (
              <TaskCard
                key={task.id}
                task={task}
                index={i}
                now={now}
                zoom={zoom}
                onDragEnd={moveTask}
                onStart={() => startTask(task)}
                onPause={() => pauseTask(task)}
                onComplete={() => completeTask(task)}
              />
            ))}
            {todos.map((todo, i) => (
              <TodoCard key={todo.id} todo={todo} index={i} zoom={zoom} onDragEnd={moveTodo} onComplete={() => completeTodo(todo)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ボード上での自由配置に共通する、ヘッダー部分を掴んでのドラッグ処理。移動確定は
// pointerup時のみ行い、ドラッグ中はローカルのoffsetだけで見た目を動かす(付箋のドラッグと同じ方式)
function useBoardDrag(x: number, y: number, width: number, height: number, zoom: number, onDragEnd: (x: number, y: number) => void) {
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setDragOffset({ dx: 0, dy: 0 });
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    setDragOffset({ dx: (e.clientX - dragStartRef.current.x) / zoom, dy: (e.clientY - dragStartRef.current.y) / zoom });
  }
  function onPointerUp() {
    if (!dragStartRef.current || !dragOffset) {
      dragStartRef.current = null;
      setDragOffset(null);
      return;
    }
    const newX = Math.max(0, Math.min(MEMO_BOARD_WIDTH - width, x + dragOffset.dx));
    const newY = Math.max(0, Math.min(MEMO_BOARD_HEIGHT - height, y + dragOffset.dy));
    onDragEnd(newX, newY);
    dragStartRef.current = null;
    setDragOffset(null);
  }

  const left = x + (dragOffset?.dx ?? 0);
  const top = y + (dragOffset?.dy ?? 0);
  return { left, top, onPointerDown, onPointerMove, onPointerUp };
}

function NoteCard({
  note,
  zoom,
  onDragEnd,
  onCommitText,
}: {
  note: MemoNote;
  zoom: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onCommitText: (note: MemoNote, text: string) => void;
}) {
  const [text, setText] = useState(note.text);
  const idRef = useRef(note.id);
  useEffect(() => {
    if (idRef.current !== note.id) {
      idRef.current = note.id;
      setText(note.text);
    }
  }, [note.id, note.text]);
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    note.x,
    note.y,
    note.width,
    note.height,
    zoom,
    (x, y) => onDragEnd(note.id, x, y)
  );
  const colors = MEMO_NOTE_COLORS[note.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];

  return (
    <div
      className="absolute flex flex-col rounded-md border-2 shadow-md"
      style={{ left, top, width: note.width, height: note.height, backgroundColor: colors.bg, borderColor: colors.border }}
    >
      <div
        className="h-2 shrink-0 cursor-grab rounded-t active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommitText(note, text)}
        className="min-h-0 flex-1 resize-none bg-transparent px-2 pb-2 text-sm text-ink outline-none"
        placeholder="付箋のメモ..."
      />
    </div>
  );
}

function TaskCard({
  task,
  index,
  now,
  zoom,
  onDragEnd,
  onStart,
  onPause,
  onComplete,
}: {
  task: DailyTask;
  index: number;
  now: number;
  zoom: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
}) {
  const defaultPos = cascadePosition(index, MEMO_BOARD_WIDTH - CARD_WIDTH - 480, 40);
  const x = task.boardX ?? defaultPos.x;
  const y = task.boardY ?? defaultPos.y;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(x, y, CARD_WIDTH, TASK_CARD_HEIGHT, zoom, (nx, ny) =>
    onDragEnd(task.id, nx, ny)
  );
  const elapsedMs = segmentsAccumulatedMs(task, now);
  const running = task.status === "running";

  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${running ? "border-alert" : "border-cream/20"}`}
      style={{ left, top, width: CARD_WIDTH, height: TASK_CARD_HEIGHT }}
    >
      <div
        className="flex shrink-0 cursor-grab items-center justify-between active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="text-[10px] text-cream/40">{running ? "🔴 計測中" : task.status === "paused" ? "一時停止中" : "未着手"}</span>
        <span className="font-display text-xs font-bold tabular-nums text-cream/80">{formatMsClock(elapsedMs)}</span>
      </div>
      <p className="min-w-0 flex-1 truncate text-sm text-cream" title={`${task.category} / ${task.name}`}>
        <span className="text-cream/50">{task.category}</span> {task.name}
      </p>
      <div className="flex shrink-0 gap-1">
        {running ? (
          <button className="btn-pill-outline flex-1 py-1 text-[11px]" onClick={onPause}>
            一時停止
          </button>
        ) : (
          <button className="btn-pill flex-1 py-1 text-[11px]" onClick={onStart}>
            開始
          </button>
        )}
        <button className="btn-pill-outline flex-1 py-1 text-[11px]" onClick={onComplete}>
          完了
        </button>
      </div>
    </div>
  );
}

function TodoCard({
  todo,
  index,
  zoom,
  onDragEnd,
  onComplete,
}: {
  todo: TodoTask;
  index: number;
  zoom: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onComplete: () => void;
}) {
  const defaultPos = cascadePosition(index, MEMO_BOARD_WIDTH - CARD_WIDTH - 240, 40);
  const x = todo.boardX ?? defaultPos.x;
  const y = todo.boardY ?? defaultPos.y;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(x, y, CARD_WIDTH, TODO_CARD_HEIGHT, zoom, (nx, ny) =>
    onDragEnd(todo.id, nx, ny)
  );

  return (
    <div
      className="absolute flex flex-col gap-1 rounded-md border-2 border-cream/20 bg-ink/90 p-2 shadow-md"
      style={{ left, top, width: CARD_WIDTH, height: TODO_CARD_HEIGHT }}
    >
      <div
        className="h-2 shrink-0 cursor-grab active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="flex flex-1 items-start gap-2">
        <button
          onClick={onComplete}
          aria-label="完了"
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-cream/40"
        />
        <p className="min-w-0 flex-1 text-sm text-cream">{todo.title}</p>
      </div>
      {todo.dueDate && <span className="text-[10px] text-cream/40">期日 {todo.dueDate}</span>}
    </div>
  );
}
