"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  DEFAULT_MEMO_PEN_COLOR,
  DEFAULT_MEMO_PEN_WIDTH,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_NOTE_COLORS,
  MEMO_PEN_COLORS,
  memoNoteZIndex,
} from "@/lib/memo";
import { computeProjectProgress, isStageDone, toggleProjectStage } from "@/lib/projectStage";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import StrokeLayer from "@/components/memo/StrokeLayer";
import type { DailyTask, MasterTask, MemoNote, MemoStroke, ProjectItem, TodoTask } from "@/lib/types";

// 「メモ・ToDo・案件・本日の作業」を1つの自由配置キャンバスにまとめて表示し、
// その場で作業の開始/一時停止/完了、ToDoの完了、案件の段階の通過までできるようにしたビュー。
// 付箋を足したり、カードの周りに手書きで書き込んだりもここで完結する。
// 付箋はメモタブと同じdb.memoNotes/db.memoBoardsをそのまま共有するため、
// どちらのタブで開いても同じ付箋が見える。本日の作業・ToDoは付箋のような
// x/y座標を持たないため、この画面専用のboardX/boardYフィールドに位置を保存する
// (本日の作業は日付が変われば入れ替わるため、位置も自然にリセットされる)
const CARD_WIDTH = 220;
const TASK_CARD_HEIGHT = 110;
const TODO_CARD_HEIGHT = 90;
const PROJECT_CARD_HEIGHT = 132;
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

export default function UnifiedBoardSection({
  onOpenTodo,
  onOpenTodoDetail,
  onOpenProjectEdit,
}: {
  onOpenTodo?: () => void;
  /** ToDoカードの件名を押した時に、ToDoタブへ切り替えつつその項目の詳細を開く */
  onOpenTodoDetail?: (taskId: string) => void;
  /** 案件カードの件名を押した時に、案件タブへ切り替えつつその案件の編集を開く */
  onOpenProjectEdit?: (projectId: string) => void;
}) {
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
  const strokes = useLiveQuery(
    () => (selectedBoardId ? db.memoStrokes.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as MemoStroke[])),
    [selectedBoardId]
  );
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  // ボードに置く分だけでなく、下の一覧から選んで置けるようにするため未完了は全件見る
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projectItems = useLiveQuery(() => db.projects.toArray(), []);
  const favorites = useLiveQuery(() => db.masterTasks.filter((m) => m.isFavorite && !m.archived).toArray(), []);

  const tasks = (dailyTasks ?? []).filter((t) => !t.isProvisional && t.status !== "done");
  // 未完了の親タスクだけを対象にする(サブタスクはカードにしない)
  const openTodos = (todoTasks ?? []).filter((t) => !t.completed && !t.parentTaskId);
  // ボードに出すのは「マイデイに入れたもの」と「一覧から置いたもの」
  const todos = openTodos.filter((t) => t.myDayDate === today || t.boardX !== undefined);
  const openProjects = (projectItems ?? []).filter((p) => !p.completedAt);
  // 案件は数が多くなりがちなので、自動では置かず、置いたものだけを出す
  const projects = openProjects.filter((p) => p.boardX !== undefined);

  // 親タスクごとのサブタスク件数(完了/全体)。カード自体はサブタスクを置かないため、
  // 「これはサブタスク持ちの親タスクだ」と分かるように、一覧のボタンとカードの両方に添える。
  // これが無いと、サブタスクをいくつも抱えたタスクと単発のタスクが見た目上まったく
  // 区別できなかった(タイトルの文字列だけが頼りになってしまう)
  const subtaskStats = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const t of todoTasks ?? []) {
      if (!t.parentTaskId) continue;
      const stat = map.get(t.parentTaskId) ?? { done: 0, total: 0 };
      stat.total += 1;
      if (t.completed) stat.done += 1;
      map.set(t.parentTaskId, stat);
    }
    return map;
  }, [todoTasks]);

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
      ...projects.map((p) => ({ x: p.boardX as number, y: p.boardY as number, width: CARD_WIDTH, height: PROJECT_CARD_HEIGHT })),
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
  }, [tasks, todos, projects, notes, selectedBoardId, boards]);

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

  // ボードの幅(1400px)は狭い画面には収まらない。初期値を空にしておき、まだ倍率を
  // 選んでいない間は画面幅に収まる倍率を自動で当てる(横スクロールしないと付箋の
  // 右半分が見えない、という初見の詰まりを無くすため)。-/+や「幅に合わせる」を
  // 押した時点でその値が保存され、以後は自動調整しない
  const [zoomStr, setZoomStr] = useSetting("board.zoom", "");
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const el = boardViewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // 何も置いていない右側の余白まで含めて縮めると字が読めない大きさになるので、
  // 実際に付箋・カードが置かれている範囲の右端までが収まればよいことにする。
  // 拡大方向には自動で動かさず(上限100%)、読めなくなる縮小も避ける(下限40%)
  const contentRight = Math.max(
    360,
    ...(notes ?? []).map((n) => n.x + n.width),
    ...(tasks ?? []).map((t) => (t.boardX ?? 0) + CARD_WIDTH),
    ...(todos ?? []).map((t) => (t.boardX ?? 0) + CARD_WIDTH),
    ...projects.map((p) => (p.boardX ?? 0) + CARD_WIDTH)
  );
  const fitZoom =
    viewportWidth > 0 ? Math.min(1, Math.max(0.4, clampMemoZoom(viewportWidth / (contentRight + 24)))) : 1;
  const zoom = zoomStr === "" ? fitZoom : clampMemoZoom(Number(zoomStr) || 1);
  function setZoom(z: number) {
    setZoomStr(String(clampMemoZoom(z)));
  }

  async function moveNote(id: string, x: number, y: number) {
    await db.memoNotes.update(id, { x, y, updatedAt: Date.now() });
  }
  async function growNote(id: string, height: number) {
    await db.memoNotes.update(id, { height, updatedAt: Date.now() });
  }
  // 最前面固定。メモタブと同じ付箋を見ているので、どちらで固定してもどちらにも効く
  async function togglePin(note: MemoNote) {
    await db.memoNotes.update(note.id, { pinned: !note.pinned });
    if (!note.pinned) bringToFront(note.id);
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
  async function moveProject(id: string, x: number, y: number) {
    await db.projects.update(id, { boardX: x, boardY: y });
  }

  // ------------------------------------------------------------
  // 手書き
  // ------------------------------------------------------------
  const [penMode, setPenMode] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  const [penColor, setPenColor] = useState(DEFAULT_MEMO_PEN_COLOR);
  const [penWidth, setPenWidth] = useState(DEFAULT_MEMO_PEN_WIDTH);
  function togglePen() {
    setPenMode((v) => !v);
    setEraseMode(false);
  }
  function toggleErase() {
    setEraseMode((v) => !v);
    setPenMode(false);
  }
  async function clearStrokes() {
    if (!selectedBoardId || !strokes || strokes.length === 0) return;
    if (!confirm("このボードの手書きをすべて消去します。よろしいですか?")) return;
    await db.memoStrokes.where("boardId").equals(selectedBoardId).delete();
  }

  // ------------------------------------------------------------
  // 付箋を足す
  // ------------------------------------------------------------
  // 重なり順は付箋のorderで持っているので、いま一番手前の値を控えておく
  const maxNoteOrderRef = useRef(0);
  useEffect(() => {
    maxNoteOrderRef.current = (notes ?? []).reduce((m, n) => Math.max(m, n.order), 0);
  }, [notes]);
  async function addNote() {
    if (!selectedBoardId) return;
    maxNoteOrderRef.current += 1;
    const width = 180;
    const height = 140;
    const occupied: BoardRect[] = [
      ...(notes ?? []).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
      ...tasks
        .filter((t) => t.boardX !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TASK_CARD_HEIGHT })),
      ...todos
        .filter((t) => t.boardX !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TODO_CARD_HEIGHT })),
      ...projects.map((p) => ({ x: p.boardX as number, y: p.boardY as number, width: CARD_WIDTH, height: PROJECT_CARD_HEIGHT })),
    ];
    const pos = findFreeSlot(occupied, width, height);
    await db.memoNotes.add({
      id: uid(),
      boardId: selectedBoardId,
      x: pos.x,
      y: pos.y,
      width,
      height,
      color: DEFAULT_MEMO_NOTE_COLOR,
      text: "",
      order: maxNoteOrderRef.current,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  // ------------------------------------------------------------
  // 一覧からボードへ置く / ボードから外す
  // ------------------------------------------------------------
  // いま盤面が使っている場所。置き場所を探すときに毎回組み立てる
  function occupiedRects(): BoardRect[] {
    return [
      ...(notes ?? []).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
      ...tasks
        .filter((t) => t.boardX !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TASK_CARD_HEIGHT })),
      ...todos
        .filter((t) => t.boardX !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TODO_CARD_HEIGHT })),
      ...projects.map((p) => ({ x: p.boardX as number, y: p.boardY as number, width: CARD_WIDTH, height: PROJECT_CARD_HEIGHT })),
    ];
  }
  async function placeTodo(todo: TodoTask) {
    const pos = findFreeSlot(occupiedRects(), CARD_WIDTH, TODO_CARD_HEIGHT);
    await db.todoTasks.update(todo.id, { boardX: pos.x, boardY: pos.y });
  }
  async function placeProject(project: ProjectItem) {
    const pos = findFreeSlot(occupiedRects(), CARD_WIDTH, PROJECT_CARD_HEIGHT);
    await db.projects.update(project.id, { boardX: pos.x, boardY: pos.y });
  }
  // ToDoを下げるときはマイデイからも外す。そうしないと、マイデイのものは
  // 自動配置がすぐ置き直してしまい、下げたつもりが戻ってくる
  async function removeTodo(todo: TodoTask) {
    await db.todoTasks.update(todo.id, { boardX: undefined, boardY: undefined, myDayDate: undefined });
  }
  async function removeProject(project: ProjectItem) {
    await db.projects.update(project.id, { boardX: undefined, boardY: undefined });
  }

  const [showPalette, setShowPalette] = useState(false);
  const unplacedTodos = openTodos.filter((t) => t.myDayDate !== today && t.boardX === undefined);
  const unplacedProjects = openProjects.filter((p) => p.boardX === undefined);

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
          <button
            className="btn-pill-outline px-2 py-1 text-xs"
            onClick={() => setZoomStr(String(fitZoom))}
            title={`ボード全体の幅(${MEMO_BOARD_WIDTH}px)を画面に収める倍率にします`}
          >
            幅に合わせる
          </button>
        </div>
      </div>
      {/* 書き込みの道具。付箋・手書き・消しゴムをこの1列にまとめる */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button className="btn-pill-outline text-xs" onClick={addNote}>
          ＋ 付箋
        </button>
        <button className={penMode ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={togglePen}>
          ✏️ 手書き: {penMode ? "ON" : "OFF"}
        </button>
        <button className={eraseMode ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={toggleErase}>
          🧹 消しゴム: {eraseMode ? "ON" : "OFF"}
        </button>
        {penMode && (
          <>
            {MEMO_PEN_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setPenColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${penColor === c ? "border-cream" : "border-transparent"}`}
                style={{ backgroundColor: c }}
                aria-label={`ペンの色を${c}にする`}
              />
            ))}
            <input
              type="range"
              min={1}
              max={12}
              value={penWidth}
              onChange={(e) => setPenWidth(Number(e.target.value))}
              className="w-24"
              aria-label="ペンの太さ"
            />
            <span className="text-xs tabular-nums text-cream/50">{penWidth}px</span>
          </>
        )}
        {(strokes ?? []).length > 0 && (
          <button className="btn-pill-outline text-xs text-alert" onClick={clearStrokes}>
            手書きを全消去
          </button>
        )}
        <button
          className={showPalette ? "btn-pill ml-auto text-xs" : "btn-pill-outline ml-auto text-xs"}
          onClick={() => setShowPalette((v) => !v)}
        >
          🗂 一覧から置く（ToDo {unplacedTodos.length} / 案件 {unplacedProjects.length}）
        </button>
      </div>

      {/* 一覧。まだ盤面に無いToDoと案件を並べ、押した順に空いている場所へ置いていく */}
      {showPalette && (
        <div className="panel space-y-3 p-3">
          <div>
            <h4 className="mb-1.5 text-xs font-bold text-cream/70">ToDo（未完了で、まだ置いていないもの）</h4>
            {unplacedTodos.length === 0 ? (
              <p className="text-xs text-cream/40">置けるToDoはありません。</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unplacedTodos.map((t) => {
                  const stat = subtaskStats.get(t.id);
                  return (
                    <button key={t.id} className="btn-pill-outline text-xs" onClick={() => placeTodo(t)} title="ボードに置く">
                      ＋ {t.title}
                      {/* サブタスクを持つ親タスクだと分かるようにする。単発のタスクとの
                          唯一の見分け方がタイトルの文字列だけ、という状態を無くすため */}
                      {stat && (
                        <span className="ml-1 text-cream/40">
                          （サブタスク {stat.done}/{stat.total}）
                        </span>
                      )}
                      {t.dueDate && <span className={t.dueDate < today ? "ml-1 text-alert" : "ml-1 text-cream/40"}>{t.dueDate}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-bold text-cream/70">案件（進行中で、まだ置いていないもの）</h4>
            {unplacedProjects.length === 0 ? (
              <p className="text-xs text-cream/40">置ける案件はありません。</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unplacedProjects.map((p) => (
                  <button key={p.id} className="btn-pill-outline text-xs" onClick={() => placeProject(p)} title="ボードに置く">
                    ＋ {p.title}
                    <span className={p.dueDate < today ? "ml-1 text-alert" : "ml-1 text-cream/40"}>{p.dueDate}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-2 px-1 text-xs text-cream/50">
        付箋と手書きはメモタブと同じものです（どちらで書いても両方に出ます）。ToDoは「マイデイ」に入れたものが自動で並び、それ以外と案件は上の「一覧から置く」から置きます。カードの
        <span className="text-cream">✕</span>
        でボードから下げられます（ToDoはマイデイからも外れます。項目自体は消えません）。
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

      <div ref={boardViewportRef} className="panel overflow-auto p-0" style={{ height: "70vh" }}>
        <div style={{ width: MEMO_BOARD_WIDTH * zoom, height: MEMO_BOARD_HEIGHT * zoom }}>
          <div
            className="relative"
            style={{ width: MEMO_BOARD_WIDTH, height: MEMO_BOARD_HEIGHT, transform: `scale(${zoom})`, transformOrigin: "0 0" }}
          >
            {/* 手書きはカードの下に敷く。手書き/消しゴムがOFFの間は当たり判定を切ってあるので、
                カードのドラッグや操作は今までどおりできる */}
            <StrokeLayer
              boardId={selectedBoardId}
              strokes={strokes}
              zoom={zoom}
              penMode={penMode}
              eraseMode={eraseMode}
              penColor={penColor}
              penWidth={penWidth}
            />
            {(notes ?? []).map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                zoom={zoom}
                zIndex={memoNoteZIndex(note.pinned, zIndexById[note.id] ?? 1)}
                onDragEnd={moveNote}
                onCommitText={commitNoteText}
                onGrow={growNote}
                onTogglePin={() => togglePin(note)}
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
                today={today}
                subtaskStat={subtaskStats.get(todo.id) ?? null}
                zoom={zoom}
                zIndex={zIndexById[todo.id] ?? 1}
                onDragEnd={moveTodo}
                onComplete={() => completeTodo(todo)}
                onRemove={() => removeTodo(todo)}
                onFocus={() => bringToFront(todo.id)}
                onOpenDetail={onOpenTodoDetail ? () => onOpenTodoDetail(todo.id) : undefined}
              />
            ))}
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                today={today}
                zoom={zoom}
                zIndex={zIndexById[project.id] ?? 1}
                onDragEnd={moveProject}
                onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
                onRemove={() => removeProject(project)}
                onFocus={() => bringToFront(project.id)}
                onOpenDetail={onOpenProjectEdit ? () => onOpenProjectEdit(project.id) : undefined}
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
  onTogglePin,
}: {
  note: MemoNote;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onCommitText: (note: MemoNote, text: string) => void;
  onFocus: () => void;
  onGrow: (id: string, height: number) => void;
  onTogglePin: () => void;
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
      {/* 最前面固定。掴む帯の上に重ねるので、ドラッグ用のpointerdownは止めておく */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        // 絵文字は文字色を変えても色が変わらないので、状態は濃さ(opacity)で示す
        className={`absolute right-1 top-0.5 text-[11px] leading-none ${
          note.pinned ? "opacity-100" : "opacity-40 hover:opacity-100"
        }`}
        title={note.pinned ? "最前面固定を解除する" : "最前面に固定する"}
        aria-label={note.pinned ? "最前面固定を解除する" : "最前面に固定する"}
        aria-pressed={!!note.pinned}
      >
        📌
      </button>
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
  today,
  subtaskStat,
  zoom,
  zIndex,
  onDragEnd,
  onComplete,
  onRemove,
  onFocus,
  onOpenDetail,
}: {
  todo: TodoTask;
  today: string;
  /** サブタスクを持つ場合の完了/全体件数。持たない単発のタスクならnull */
  subtaskStat: { done: number; total: number } | null;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onComplete: () => void;
  onRemove: () => void;
  onFocus: () => void;
  /** 件名を押した時に、ToDoタブでこの項目の詳細を開く。未指定なら件名はただの文字のまま */
  onOpenDetail?: () => void;
}) {
  // 実際の位置は自動配置useEffectがboardX/boardYへ即座に割り当てるため、
  // ここでの初期値は割り当てが反映されるまでの一瞬だけ使われる仮の位置
  const x = todo.boardX ?? 40;
  const y = todo.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(x, y, CARD_WIDTH, TODO_CARD_HEIGHT, zoom, (nx, ny) =>
    onDragEnd(todo.id, nx, ny)
  );
  const overdue = !!todo.dueDate && todo.dueDate < today;

  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${
        overdue ? "border-alert/70" : "border-cream/20"
      }`}
      style={{ left, top, width: CARD_WIDTH, height: TODO_CARD_HEIGHT, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <DragHandle tone="dark" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      <BoardRemoveButton onRemove={onRemove} title="ボードから下げる（マイデイからも外れます。ToDo自体は消えません）" />
      <div className="flex flex-1 items-start gap-2">
        <button
          onClick={onComplete}
          aria-label="完了"
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-cream/40"
        />
        {onOpenDetail ? (
          <button
            onClick={onOpenDetail}
            onPointerDown={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate text-left text-sm text-cream hover:underline"
            title="ToDoタブでこの項目を開く"
          >
            {todo.title}
          </button>
        ) : (
          <p className="min-w-0 flex-1 text-sm text-cream">{todo.title}</p>
        )}
      </div>
      {(todo.dueDate || subtaskStat) && (
        <div className="flex flex-wrap items-center gap-x-1.5 text-[10px]">
          {todo.dueDate && (
            <span className={overdue ? "font-bold text-alert" : "text-cream/40"}>
              期日 {todo.dueDate}
              {overdue && "（超過）"}
            </span>
          )}
          {/* サブタスクを持つ親タスクだと分かるようにする。カード自体はサブタスクを
              置かないため、これが無いと単発のタスクと見た目上まったく区別できなかった */}
          {subtaskStat && (
            <span className="text-cream/40">
              サブタスク {subtaskStat.done}/{subtaskStat.total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// 案件のカード。件名と期日に加えて、段階(マイルストーン)の進み具合と、
// 次に通す段階をその場でチェックできるようにしてある。
// 案件タブを開かずにボードの上だけで進捗を動かせるのが、このモードの狙いのひとつ
function ProjectCard({
  project,
  today,
  zoom,
  zIndex,
  onDragEnd,
  onToggleStage,
  onRemove,
  onFocus,
  onOpenDetail,
}: {
  project: ProjectItem;
  today: string;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onToggleStage: (stageId: string) => void;
  onRemove: () => void;
  onFocus: () => void;
  /** 件名を押した時に、案件タブでこの案件の編集を開く。未指定なら件名はただの文字のまま */
  onOpenDetail?: () => void;
}) {
  const x = project.boardX ?? 40;
  const y = project.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    CARD_WIDTH,
    PROJECT_CARD_HEIGHT,
    zoom,
    (nx, ny) => onDragEnd(project.id, nx, ny)
  );
  const stages = project.stages ?? [];
  const doneCount = stages.filter(isStageDone).length;
  const progress = computeProjectProgress(stages);
  const overdue = project.dueDate < today;
  // 残っている段階のうち、上から3つだけ出す(カードの高さに収まる分)
  const nextStages = stages.filter((st) => !isStageDone(st)).slice(0, 3);

  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${
        overdue ? "border-alert/70" : "border-cream/20"
      }`}
      style={{ left, top, width: CARD_WIDTH, height: PROJECT_CARD_HEIGHT, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <DragHandle tone="dark" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      <BoardRemoveButton onRemove={onRemove} title="ボードから下げる（案件自体は消えません）" />
      <div className="flex items-baseline gap-1">
        <span className="shrink-0 text-[9px] uppercase tracking-wider text-cream/35">案件</span>
        {onOpenDetail ? (
          <button
            onClick={onOpenDetail}
            onPointerDown={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate text-left text-sm font-bold text-cream hover:underline"
            title="案件タブでこの案件を開く"
          >
            {project.title}
          </button>
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-cream" title={project.title}>
            {project.title}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 text-[10px]">
        <span className={overdue ? "font-bold text-alert" : "text-cream/40"}>
          期日 {project.dueDate}
          {overdue && "（超過）"}
        </span>
        {stages.length > 0 && (
          <span className="ml-auto shrink-0 tabular-nums text-cream/50">
            {doneCount}/{stages.length}
          </span>
        )}
      </div>
      {progress !== null && (
        <div className="h-1 w-full shrink-0 overflow-hidden rounded-full bg-cream/10">
          <div className="h-full rounded-full bg-cream/50" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {nextStages.length === 0 ? (
          <p className="text-[10px] text-cream/30">{stages.length === 0 ? "段階は未設定です" : "残っている段階はありません"}</p>
        ) : (
          nextStages.map((st) => (
            <button
              key={st.id}
              onClick={() => onToggleStage(st.id)}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-cream/10"
              title="この段階を通過にする"
            >
              <span className="h-3 w-3 shrink-0 rounded-sm border border-cream/40" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-cream/80">{st.title}</span>
              {st.dueDate && (
                <span className={`shrink-0 text-[9px] ${st.dueDate < today ? "text-alert" : "text-cream/35"}`}>{st.dueDate}</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// カードをボードから下げるボタン。掴む帯の上に重ねるので、ドラッグ用の
// pointerdownは止めておく(付箋の最前面固定ボタンと同じ扱い)
function BoardRemoveButton({ onRemove, title }: { onRemove: () => void; title: string }) {
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="absolute right-1 top-0.5 text-[11px] leading-none text-cream/35 hover:text-cream"
      title={title}
      aria-label={title}
    >
      ✕
    </button>
  );
}
