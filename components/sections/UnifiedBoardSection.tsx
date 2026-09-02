"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatMsClock, todayStr } from "@/lib/time";
import { computeRemainingEstimatedSeconds, segmentsAccumulatedMs, finishDailyTask } from "@/lib/tasks";
import { completeTodoTask } from "@/lib/todo";
import {
  clampMemoZoom,
  DEFAULT_MEMO_NOTE_COLOR,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_NOTE_COLORS,
} from "@/lib/memo";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import type { DailyTask, MasterTask, MemoNote, TodoTask } from "@/lib/types";

// 「メモ・ToDo(マイデイ)・本日の作業」を1つの自由配置キャンバスにまとめて表示し、
// その場で作業の開始/一時停止/完了やToDoの完了ができるようにしたビュー。
// 付箋はメモタブと同じdb.memoNotes/db.memoBoardsをそのまま共有するため、
// どちらのタブで開いても同じ付箋が見える。本日の作業・ToDoは付箋のような
// x/y座標を持たないため、この画面専用のboardX/boardYフィールドに位置を保存する
// (本日の作業は日付が変われば入れ替わるため、位置も自然にリセットされる)
const CARD_WIDTH = 220;
const TASK_CARD_HEIGHT = 110;
const TODO_CARD_HEIGHT = 90;
const PLACEMENT_GRID = 30;
const PLACEMENT_MARGIN = 10;

interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsOverlap(a: BoardRect, b: BoardRect): boolean {
  return !(
    a.x + a.width + PLACEMENT_MARGIN <= b.x ||
    b.x + b.width + PLACEMENT_MARGIN <= a.x ||
    a.y + a.height + PLACEMENT_MARGIN <= b.y ||
    b.y + b.height + PLACEMENT_MARGIN <= a.y
  );
}

// 既存のカード(付箋・本日の作業・ToDo)と重ならない置き場所を、盤面を左上から
// 走査して探す。手動でドラッグして重ねるのは自由なままにしたいので、この関数は
// 「まだ位置が決まっていない新規カード」の初期配置にだけ使う
function findFreeSlot(occupied: BoardRect[], width: number, height: number): { x: number; y: number } {
  for (let y = 20; y <= MEMO_BOARD_HEIGHT - height; y += PLACEMENT_GRID) {
    for (let x = 20; x <= MEMO_BOARD_WIDTH - width; x += PLACEMENT_GRID) {
      const candidate: BoardRect = { x, y, width, height };
      if (!occupied.some((r) => rectsOverlap(candidate, r))) return { x, y };
    }
  }
  // 盤面が埋まりきっている場合(通常はまず起きない)は右下に寄せて返す
  return { x: MEMO_BOARD_WIDTH - width, y: MEMO_BOARD_HEIGHT - height };
}

export default function UnifiedBoardSection({ onOpenTodo }: { onOpenTodo?: () => void }) {
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
  const favorites = useLiveQuery(() => db.masterTasks.filter((m) => m.isFavorite && !m.archived).toArray(), []);

  const tasks = (dailyTasks ?? []).filter((t) => !t.isProvisional && t.status !== "done");
  const todos = (todoTasks ?? []).filter((t) => !t.completed);

  // 新しく現れた(まだboardX/boardYを持たない)作業・ToDoカードに、既存の付箋/カードと
  // 重ならない位置を1回だけ自動で割り当てる。手動でドラッグして重ねるのはユーザーの
  // 意図なので、ここでは「位置が未確定の新規カード」だけを対象にする
  useEffect(() => {
    // notes/dailyTasks/todoTasksがまだuseLiveQueryから読み込み中(undefined)の間や、
    // selectedBoardIdがまだ実際のメモ帳に確定していない(初期値の""のままなど)間に
    // 実行すると、後から届く付箋を避けられずに重なって配置されてしまうため、
    // すべて確定してから行う
    if (notes === undefined || dailyTasks === undefined || todoTasks === undefined) return;
    if (!selectedBoardId || !boards || !boards.some((b) => b.id === selectedBoardId)) return;
    const unpositionedTasks = tasks.filter((t) => t.boardX === undefined || t.boardY === undefined);
    const unpositionedTodos = todos.filter((t) => t.boardX === undefined || t.boardY === undefined);
    if (unpositionedTasks.length === 0 && unpositionedTodos.length === 0) return;

    const occupied: BoardRect[] = [
      ...(notes ?? []).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
      ...tasks
        .filter((t) => t.boardX !== undefined && t.boardY !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TASK_CARD_HEIGHT })),
      ...todos
        .filter((t) => t.boardX !== undefined && t.boardY !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TODO_CARD_HEIGHT })),
    ];

    (async () => {
      for (const t of unpositionedTasks) {
        const pos = findFreeSlot(occupied, CARD_WIDTH, TASK_CARD_HEIGHT);
        occupied.push({ ...pos, width: CARD_WIDTH, height: TASK_CARD_HEIGHT });
        await db.dailyTasks.update(t.id, { boardX: pos.x, boardY: pos.y });
      }
      for (const t of unpositionedTodos) {
        const pos = findFreeSlot(occupied, CARD_WIDTH, TODO_CARD_HEIGHT);
        occupied.push({ ...pos, width: CARD_WIDTH, height: TODO_CARD_HEIGHT });
        await db.todoTasks.update(t.id, { boardX: pos.x, boardY: pos.y });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, todos, notes, selectedBoardId, boards]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 付箋/本日の作業/ToDoカードを掴んだ際、他のカードの下に隠れたままにならないよう
  // 最前面に持ってくる。付箋・タスク・ToDoを1つの重なり順で扱うため、種類を問わず
  // 共通のカウンタで管理する(このボード上だけの見た目上の重なり順で、保存はしない)
  const zCounterRef = useRef(1);
  const [zIndexById, setZIndexById] = useState<Record<string, number>>({});
  function bringToFront(id: string) {
    zCounterRef.current += 1;
    setZIndexById((prev) => ({ ...prev, [id]: zCounterRef.current }));
  }

  const [zoomStr, setZoomStr] = useSetting("board.zoom", "1");
  const zoom = clampMemoZoom(Number(zoomStr) || 1);
  function setZoom(z: number) {
    setZoomStr(String(clampMemoZoom(z)));
  }

  async function moveNote(id: string, x: number, y: number) {
    await db.memoNotes.update(id, { x, y, updatedAt: Date.now() });
  }
  async function growNote(id: string, height: number) {
    await db.memoNotes.update(id, { height, updatedAt: Date.now() });
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

  // お気に入り/マスタから、その場で新しい作業を開始する。既に計測中の作業があれば
  // 一時停止してから開始する(startTaskの「既存タスクを再開」と同じ考え方)
  async function startFromMaster(master: MasterTask) {
    const running = tasks.find((t) => t.status === "running");
    if (running) await pauseTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, master.category, master.name, master.estimatedSeconds);
    const count = (dailyTasks ?? []).length;
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: count,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
  }

  const [showMasterPicker, setShowMasterPicker] = useState(false);
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);

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
      <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-cream/50">
        付箋はメモタブと同じものが表示されます。ToDoは「マイデイ」に入れたものだけをカード化しています。
        {onOpenTodo && (
          <button className="text-cream underline decoration-dotted underline-offset-2 hover:text-cream/70" onClick={onOpenTodo}>
            ToDoタブへ →
          </button>
        )}
      </p>

      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs text-cream/50">作業を開始:</span>
        {(favorites ?? []).map((f) => (
          <button key={f.id} className="btn-pill-outline text-xs" onClick={() => startFromMaster(f)}>
            ★ {f.category} / {f.name}
          </button>
        ))}
        <button className="btn-pill-outline text-xs" onClick={() => setShowMasterPicker(true)}>
          ＋ マスタから選択
        </button>
      </div>

      <div className="panel overflow-auto p-0" style={{ height: "70vh" }}>
        <div style={{ width: MEMO_BOARD_WIDTH * zoom, height: MEMO_BOARD_HEIGHT * zoom }}>
          <div
            className="relative"
            style={{ width: MEMO_BOARD_WIDTH, height: MEMO_BOARD_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {(notes ?? []).map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                zoom={zoom}
                zIndex={zIndexById[note.id] ?? 1}
                onDragEnd={moveNote}
                onCommitText={commitNoteText}
                onGrow={growNote}
                onFocus={() => bringToFront(note.id)}
              />
            ))}
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                now={now}
                zoom={zoom}
                zIndex={zIndexById[task.id] ?? 1}
                onDragEnd={moveTask}
                onStart={() => startTask(task)}
                onPause={() => pauseTask(task)}
                onComplete={() => completeTask(task)}
                onFocus={() => bringToFront(task.id)}
              />
            ))}
            {todos.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                zoom={zoom}
                zIndex={zIndexById[todo.id] ?? 1}
                onDragEnd={moveTodo}
                onComplete={() => completeTodo(todo)}
                onFocus={() => bringToFront(todo.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {showMasterPicker && (
        <Modal
          title="マスタから作業を開始"
          onClose={() => {
            setShowMasterPicker(false);
            setPickedMaster(null);
          }}
        >
          <div className="space-y-3">
            <MasterTaskPicker selectedId={pickedMaster?.id} onSelect={setPickedMaster} />
            <div className="flex justify-end">
              <button
                className="btn-pill text-sm"
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await startFromMaster(pickedMaster);
                  setPickedMaster(null);
                  setShowMasterPicker(false);
                }}
              >
                この作業を開始する
              </button>
            </div>
          </div>
        </Modal>
      )}
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

// カード上部の「掴む場所」。暗い背景でも見失わないよう、カード本体より一段
// 明るい/暗いバンドを敷いた上でグリップ用の点を並べる(色付きの付箋には濃色、
// 暗いカードには淡色のバンド+ドットを使い、どちらの背景でも視認できるようにする)
function DragHandle({
  tone,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  tone: "light" | "dark";
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`flex h-5 shrink-0 cursor-grab items-center justify-center rounded-t active:cursor-grabbing ${
        tone === "light" ? "bg-black/10" : "bg-cream/10"
      }`}
      style={{ touchAction: "none" }}
      title="ドラッグで移動できます"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className={`text-[11px] leading-none tracking-widest ${tone === "light" ? "text-ink/50" : "text-cream/50"}`}>
        ⠿ ⠿ ⠿
      </span>
    </div>
  );
}

function NoteCard({
  note,
  zoom,
  zIndex,
  onDragEnd,
  onCommitText,
  onFocus,
  onGrow,
}: {
  note: MemoNote;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onCommitText: (note: MemoNote, text: string) => void;
  onFocus: () => void;
  onGrow: (id: string, height: number) => void;
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
      style={{ left, top, width: note.width, height: note.height, backgroundColor: colors.bg, borderColor: colors.border, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <DragHandle tone="light" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // 入力中の文章がこの付箋の高さに収まらなくなったら、はみ出した分だけ自動で広げる
          const ta = e.target;
          const overflow = ta.scrollHeight - ta.clientHeight;
          if (overflow > 2) {
            onGrow(note.id, Math.min(MEMO_BOARD_HEIGHT - note.y, note.height + overflow));
          }
        }}
        onBlur={() => onCommitText(note, text)}
        className="min-h-0 flex-1 resize-none bg-transparent px-2 pb-2 text-sm text-ink outline-none"
        placeholder="付箋のメモ..."
      />
      {note.mailFileDataUrl && (
        <a
          href={note.mailFileDataUrl}
          download={note.mailFileName || "mail.msg"}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          title="ダウンロードして元のメールを開きます(既定のメールアプリに渡されます)"
          className="mx-2 mb-1.5 flex shrink-0 items-center gap-1 rounded bg-black/10 px-2 py-1 text-[11px] text-ink/70 hover:bg-black/20"
        >
          📧 元のメールを開く
        </a>
      )}
    </div>
  );
}

function TaskCard({
  task,
  now,
  zoom,
  zIndex,
  onDragEnd,
  onStart,
  onPause,
  onComplete,
  onFocus,
}: {
  task: DailyTask;
  now: number;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  onFocus: () => void;
}) {
  // 実際の位置は自動配置useEffectがboardX/boardYへ即座に割り当てるため、
  // ここでの初期値は割り当てが反映されるまでの一瞬だけ使われる仮の位置
  const x = task.boardX ?? 40;
  const y = task.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(x, y, CARD_WIDTH, TASK_CARD_HEIGHT, zoom, (nx, ny) =>
    onDragEnd(task.id, nx, ny)
  );
  const elapsedMs = segmentsAccumulatedMs(task, now);
  const running = task.status === "running";

  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${running ? "border-alert" : "border-cream/20"}`}
      style={{ left, top, width: CARD_WIDTH, height: TASK_CARD_HEIGHT, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <div
        className="-mx-2 -mt-2 mb-1 flex shrink-0 cursor-grab items-center justify-between rounded-t bg-cream/10 px-2 py-1 active:cursor-grabbing"
        style={{ touchAction: "none" }}
        title="ドラッグで移動できます"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="text-[10px] text-cream/50">{running ? "🔴 計測中" : task.status === "paused" ? "一時停止中" : "未着手"}</span>
        <span className="font-display text-xs font-bold tabular-nums text-cream/80">{formatMsClock(elapsedMs)}</span>
        <span className="text-[10px] leading-none tracking-widest text-cream/30">⠿</span>
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
  zoom,
  zIndex,
  onDragEnd,
  onComplete,
  onFocus,
}: {
  todo: TodoTask;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onComplete: () => void;
  onFocus: () => void;
}) {
  // 実際の位置は自動配置useEffectがboardX/boardYへ即座に割り当てるため、
  // ここでの初期値は割り当てが反映されるまでの一瞬だけ使われる仮の位置
  const x = todo.boardX ?? 40;
  const y = todo.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(x, y, CARD_WIDTH, TODO_CARD_HEIGHT, zoom, (nx, ny) =>
    onDragEnd(todo.id, nx, ny)
  );

  return (
    <div
      className="absolute flex flex-col gap-1 rounded-md border-2 border-cream/20 bg-ink/90 p-2 shadow-md"
      style={{ left, top, width: CARD_WIDTH, height: TODO_CARD_HEIGHT, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <DragHandle tone="dark" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
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
