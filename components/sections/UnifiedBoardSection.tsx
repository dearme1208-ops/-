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
  BOARD_BACKGROUND_KINDS,
  BOARD_BACKGROUND_LABELS,
  BOARD_SHAPE_DEFAULT_SIZE,
  boardBackgroundCss,
  clampMemoZoom,
  DEFAULT_BOARD_BACKGROUND,
  DEFAULT_BOARD_SHAPE_OPACITY,
  DEFAULT_MEMO_NOTE_COLOR,
  DEFAULT_MEMO_PEN_COLOR,
  DEFAULT_MEMO_PEN_WIDTH,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  MEMO_NOTE_COLORS,
  MEMO_PEN_COLORS,
  memoNoteZIndex,
  type BoardBackgroundKind,
} from "@/lib/memo";
import { computeProjectProgress, isStageDone, toggleProjectStage } from "@/lib/projectStage";
import { exportElementToPng } from "@/lib/pdfExport";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import StrokeLayer from "@/components/memo/StrokeLayer";
import type { BoardShape, BoardShapeType, DailyTask, MasterTask, MemoNote, MemoStroke, ProjectItem, TodoTask } from "@/lib/types";

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
const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = Math.round((MINIMAP_WIDTH * MEMO_BOARD_HEIGHT) / MEMO_BOARD_WIDTH);

interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 種類をまたいでボード上のアイテムを扱うための共通の形。整列・検索・複数選択・
// 矢印キー移動・削除キーなど、カードの種類を問わない操作の土台にする
type BoardItemKind = "task" | "todo" | "project" | "note" | "shape";
interface BoardItem extends BoardRect {
  kind: BoardItemKind;
  id: string;
  label: string; // 検索対象の文字列。無ければ空文字
  locked: boolean;
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
  /** ToDoカードの件名を押した時に、ToDoタブへ切り替えつつその項目に絞り込んだ一覧を見せる */
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
  const shapes = useLiveQuery(
    () => (selectedBoardId ? db.boardShapes.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as BoardShape[])),
    [selectedBoardId]
  );
  // ボードの地の模様(無地/方眼紙/ドット/罫線/チェック)。データではなく見た目だけの
  // 設定なので演出テーマとは独立してユーザー設定として持つ。メモ帳(ボード)ごとに
  // 使い分けたいことがある(例: 作業用は方眼紙、日記用は罫線)ため、選択中のボードID
  // をキーに含めて保存する
  const [backgroundStr, setBackgroundStr] = useSetting(
    `board.background.${selectedBoardId || "default"}`,
    DEFAULT_BOARD_BACKGROUND as string
  );
  const background: BoardBackgroundKind = (BOARD_BACKGROUND_KINDS as readonly string[]).includes(backgroundStr)
    ? (backgroundStr as BoardBackgroundKind)
    : DEFAULT_BOARD_BACKGROUND;
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
  const [zoomStr, setZoomStr] = useSetting(`board.zoom.${selectedBoardId || "default"}`, "");
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const boardCanvasRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  useEffect(() => {
    const el = boardViewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewportWidth(el.clientWidth);
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  // ミニマップに「今どこを見ているか」の枠を出すため、スクロール位置も追う
  const [scrollPos, setScrollPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const el = boardViewportRef.current;
    if (!el) return;
    const onScroll = () => setScrollPos({ left: el.scrollLeft, top: el.scrollTop });
    el.addEventListener("scroll", onScroll);
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  // 何も置いていない右側の余白まで含めて縮めると字が読めない大きさになるので、
  // 実際に付箋・カードが置かれている範囲の右端までが収まればよいことにする。
  // 拡大方向には自動で動かさず(上限100%)、読めなくなる縮小も避ける(下限40%)
  const contentRight = Math.max(
    360,
    ...(notes ?? []).map((n) => n.x + n.width),
    ...(shapes ?? []).map((s) => s.x + s.width),
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
  async function completeTask(task: DailyTask, skipConfirm = false) {
    if (!skipConfirm && !confirm(`「${task.category} / ${task.name}」を完了にしますか?`)) return;
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
  async function completeTodo(task: TodoTask, skipConfirm = false) {
    if (!skipConfirm && !confirm(`「${task.title}」を完了にしますか?`)) return;
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
  // 図形を足す(四角・円・線・矢印。囲み線やグルーピング用の飾りで、文字は持たない)
  // ------------------------------------------------------------
  const maxShapeOrderRef = useRef(0);
  useEffect(() => {
    maxShapeOrderRef.current = (shapes ?? []).reduce((m, s) => Math.max(m, s.order), 0);
  }, [shapes]);
  const [showShapeMenu, setShowShapeMenu] = useState(false);
  async function addShape(type: BoardShapeType) {
    if (!selectedBoardId) return;
    maxShapeOrderRef.current += 1;
    const { width, height } = BOARD_SHAPE_DEFAULT_SIZE[type];
    const pos = findFreeSlot(occupiedRects(), width, height);
    const id = uid();
    await db.boardShapes.add({
      id,
      boardId: selectedBoardId,
      type,
      x: pos.x,
      y: pos.y,
      width,
      height,
      color: DEFAULT_MEMO_NOTE_COLOR,
      order: maxShapeOrderRef.current,
      createdAt: Date.now(),
    });
    // 置いたばかりの図形が他のカードの下に隠れないようにする
    bringToFront(id);
    setShowShapeMenu(false);
  }
  async function moveShape(id: string, x: number, y: number) {
    await db.boardShapes.update(id, { x, y });
  }
  async function removeShape(id: string, skipConfirm = false) {
    if (!skipConfirm && !confirm("この図形を削除します。よろしいですか?")) return;
    await db.boardShapes.delete(id);
  }
  async function setShapeColor(id: string, color: string) {
    await db.boardShapes.update(id, { color });
  }
  async function setShapeOpacity(id: string, opacity: number) {
    await db.boardShapes.update(id, { opacity });
  }
  async function setShapeLabel(id: string, label: string) {
    await db.boardShapes.update(id, { label });
  }
  // 線・矢印だけ、伸縮の代わりに向き(横⇔縦)をワンタップで切り替えられるようにする
  async function rotateShape(shape: BoardShape) {
    await db.boardShapes.update(shape.id, { width: shape.height, height: shape.width });
  }

  // ------------------------------------------------------------
  // 一覧からボードへ置く / ボードから外す
  // ------------------------------------------------------------
  // いま盤面が使っている場所。置き場所を探すときに毎回組み立てる
  function occupiedRects(): BoardRect[] {
    return [
      ...(notes ?? []).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
      ...(shapes ?? []).map((s) => ({ x: s.x, y: s.y, width: s.width, height: s.height })),
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
    // 置いた直後は最前面にする。他のカードが既に手前へ来ていると、
    // 置いたばかりのカードがその下に隠れて見えなくなっていたため
    bringToFront(todo.id);
  }
  async function placeProject(project: ProjectItem) {
    const pos = findFreeSlot(occupiedRects(), CARD_WIDTH, PROJECT_CARD_HEIGHT);
    await db.projects.update(project.id, { boardX: pos.x, boardY: pos.y });
    bringToFront(project.id);
  }
  // ToDoを下げるときはマイデイからも外す。そうしないと、マイデイのものは
  // 自動配置がすぐ置き直してしまい、下げたつもりが戻ってくる
  async function removeTodo(todo: TodoTask, skipConfirm = false) {
    if (!skipConfirm && !confirm(`「${todo.title}」をボードから下げますか?(マイデイからも外れます。ToDo自体は消えません)`)) return;
    await db.todoTasks.update(todo.id, { boardX: undefined, boardY: undefined, myDayDate: undefined });
  }
  async function removeProject(project: ProjectItem, skipConfirm = false) {
    if (!skipConfirm && !confirm(`「${project.title}」をボードから下げますか?(案件自体は消えません)`)) return;
    await db.projects.update(project.id, { boardX: undefined, boardY: undefined });
  }

  // ------------------------------------------------------------
  // ボード上の全アイテムを種類を問わず横断的に扱う一覧。
  // 整列・検索・複数選択・矢印キー移動・削除キーの土台になる
  // ------------------------------------------------------------
  const boardItems: BoardItem[] = useMemo(() => {
    const items: BoardItem[] = [];
    for (const t of tasks) {
      if (t.boardX === undefined || t.boardY === undefined) continue;
      items.push({
        kind: "task",
        id: t.id,
        x: t.boardX,
        y: t.boardY,
        width: CARD_WIDTH,
        height: TASK_CARD_HEIGHT,
        label: `${t.category} ${t.name}`,
        locked: !!t.boardLocked,
      });
    }
    for (const t of todos) {
      if (t.boardX === undefined || t.boardY === undefined) continue;
      items.push({ kind: "todo", id: t.id, x: t.boardX, y: t.boardY, width: CARD_WIDTH, height: TODO_CARD_HEIGHT, label: t.title, locked: !!t.boardLocked });
    }
    for (const p of projects) {
      if (p.boardX === undefined || p.boardY === undefined) continue;
      items.push({ kind: "project", id: p.id, x: p.boardX, y: p.boardY, width: CARD_WIDTH, height: PROJECT_CARD_HEIGHT, label: p.title, locked: !!p.boardLocked });
    }
    for (const n of notes ?? []) {
      const label = n.isChecklist ? (n.checklistItems ?? []).map((i) => i.text).join(" ") : n.text;
      items.push({ kind: "note", id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, label, locked: !!n.boardLocked });
    }
    for (const s of shapes ?? []) {
      items.push({ kind: "shape", id: s.id, x: s.x, y: s.y, width: s.width, height: s.height, label: s.label ?? "", locked: !!s.boardLocked });
    }
    return items;
  }, [tasks, todos, projects, notes, shapes]);

  function moveBoardItemByKind(kind: BoardItemKind, id: string, x: number, y: number) {
    if (kind === "task") return moveTask(id, x, y);
    if (kind === "todo") return moveTodo(id, x, y);
    if (kind === "project") return moveProject(id, x, y);
    if (kind === "note") return moveNote(id, x, y);
    return moveShape(id, x, y);
  }
  async function toggleBoardLock(kind: BoardItemKind, id: string, currentlyLocked: boolean) {
    const boardLocked = !currentlyLocked;
    if (kind === "task") await db.dailyTasks.update(id, { boardLocked });
    else if (kind === "todo") await db.todoTasks.update(id, { boardLocked });
    else if (kind === "project") await db.projects.update(id, { boardLocked });
    else if (kind === "note") await db.memoNotes.update(id, { boardLocked });
    else await db.boardShapes.update(id, { boardLocked });
  }
  // 複数選択している状態で、そのうちの1枚をドラッグしたら他の選択中アイテムも
  // 同じ分だけまとめて動かす。ドラッグ中に追従はさせず(各カードは独立した状態を
  // 持つため)、離した瞬間にまとめて反映する簡略化した仕組み
  function handleItemDragEnd(kind: BoardItemKind, id: string, newX: number, newY: number) {
    const item = boardItems.find((it) => it.id === id);
    if (!item) return;
    const dx = newX - item.x;
    const dy = newY - item.y;
    moveBoardItemByKind(kind, id, newX, newY);
    if (selectedIds.has(id) && selectedIds.size > 1) {
      for (const other of boardItems) {
        if (other.id === id || other.locked || !selectedIds.has(other.id)) continue;
        const nx = Math.max(0, Math.min(MEMO_BOARD_WIDTH - other.width, other.x + dx));
        const ny = Math.max(0, Math.min(MEMO_BOARD_HEIGHT - other.height, other.y + dy));
        moveBoardItemByKind(other.kind, other.id, nx, ny);
      }
    }
  }

  // ------------------------------------------------------------
  // 複数選択(クリック・Shift+クリック・ラバーバンド範囲選択)
  // ------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  function selectItem(id: string, additive: boolean) {
    setSelectedIds((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  }
  const [selectionBox, setSelectionBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  function onCanvasPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (penMode || eraseMode) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    setSelectionBox({ x0: x, y0: y, x1: x, y1: y });
    if (!e.shiftKey) setSelectedIds(new Set());
  }
  function onCanvasPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionBox) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    setSelectionBox((b) => (b ? { ...b, x1: x, y1: y } : null));
  }
  function onCanvasPointerUp() {
    if (!selectionBox) return;
    const minX = Math.min(selectionBox.x0, selectionBox.x1);
    const maxX = Math.max(selectionBox.x0, selectionBox.x1);
    const minY = Math.min(selectionBox.y0, selectionBox.y1);
    const maxY = Math.max(selectionBox.y0, selectionBox.y1);
    const hits = boardItems.filter((it) => it.x < maxX && it.x + it.width > minX && it.y < maxY && it.y + it.height > minY);
    if (hits.length > 0) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        hits.forEach((h) => next.add(h.id));
        return next;
      });
    }
    setSelectionBox(null);
  }

  // ------------------------------------------------------------
  // 検索・ハイライト。件名/本文/ラベルに一致するものだけ目立たせ、他は薄くする
  // ------------------------------------------------------------
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const boardSearchActive = boardSearchQuery.trim() !== "";
  const matchingIds = useMemo(() => {
    if (!boardSearchActive) return null;
    const q = boardSearchQuery.trim().toLowerCase();
    return new Set(boardItems.filter((it) => it.label.toLowerCase().includes(q)).map((it) => it.id));
  }, [boardSearchActive, boardSearchQuery, boardItems]);

  // ------------------------------------------------------------
  // 整列。ドラッグで散らかった配置を、現在の並び(上から左から)を保ったまま
  // グリッド状に並べ直す。ロック中のカードは動かさない
  // ------------------------------------------------------------
  async function alignBoardItems() {
    const sorted = boardItems.filter((it) => !it.locked).sort((a, b) => a.y - b.y || a.x - b.x);
    const cols = Math.max(1, Math.floor((MEMO_BOARD_WIDTH - PLACEMENT_MARGIN) / (CARD_WIDTH + PLACEMENT_MARGIN)));
    let x = 20;
    let y = 20;
    let col = 0;
    let rowHeight = 0;
    for (const it of sorted) {
      if (col >= cols) {
        col = 0;
        x = 20;
        y += rowHeight + PLACEMENT_MARGIN;
        rowHeight = 0;
      }
      await moveBoardItemByKind(it.kind, it.id, x, y);
      rowHeight = Math.max(rowHeight, it.height);
      x += it.width + PLACEMENT_MARGIN;
      col++;
    }
  }

  // ------------------------------------------------------------
  // キーボード操作。矢印キーで選択中アイテムを移動、Deleteで盤面から下げる/消す。
  // 入力欄にフォーカスしている間は文字入力を邪魔しないよう何もしない
  // ------------------------------------------------------------
  useEffect(() => {
    function isTypingTarget(el: Element | null): boolean {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (selectedIds.size === 0) return;
      if (isTypingTarget(document.activeElement)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        for (const it of boardItems) {
          if (!selectedIds.has(it.id) || it.locked) continue;
          const nx = Math.max(0, Math.min(MEMO_BOARD_WIDTH - it.width, it.x + dx));
          const ny = Math.max(0, Math.min(MEMO_BOARD_HEIGHT - it.height, it.y + dy));
          moveBoardItemByKind(it.kind, it.id, nx, ny);
        }
      } else if (e.key === "Delete") {
        e.preventDefault();
        // ToDo/案件は「盤面から下げる」までで、項目自体は消さない(カードの✕ボタンと同じ扱い)。
        // 本日の作業・付箋はこの一覧からの削除に対応する個別操作が無いため、対象から外す
        const targets = boardItems.filter(
          (it) => selectedIds.has(it.id) && !it.locked && (it.kind === "todo" || it.kind === "project" || it.kind === "shape")
        );
        if (targets.length === 0) return;
        // 複数選択している場合、1件ずつ確認すると煩雑なのでまとめて1回だけ確認する
        if (!confirm(`選択中の${targets.length}件をボードから下げる/削除します。よろしいですか?`)) return;
        for (const it of targets) {
          if (it.kind === "todo") {
            const todo = todos.find((t) => t.id === it.id);
            if (todo) removeTodo(todo, true);
          } else if (it.kind === "project") {
            const project = projects.find((p) => p.id === it.id);
            if (project) removeProject(project, true);
          } else if (it.kind === "shape") {
            removeShape(it.id, true);
          }
        }
        setSelectedIds(new Set());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds, boardItems, todos, projects]);

  // ------------------------------------------------------------
  // ミニマップ。拡大しているときに盤面のどこを見ているか分かるようにし、
  // クリック/ドラッグでそこへ表示位置を移動できるようにする
  // ------------------------------------------------------------
  const minimapScale = MINIMAP_WIDTH / MEMO_BOARD_WIDTH;
  function panToMinimapPoint(clientX: number, clientY: number, el: HTMLDivElement) {
    const vp = boardViewportRef.current;
    if (!vp) return;
    const rect = el.getBoundingClientRect();
    const boardX = (clientX - rect.left) / minimapScale;
    const boardY = (clientY - rect.top) / minimapScale;
    vp.scrollLeft = Math.max(0, boardX * zoom - vp.clientWidth / 2);
    vp.scrollTop = Math.max(0, boardY * zoom - vp.clientHeight / 2);
  }
  const [minimapDragging, setMinimapDragging] = useState(false);

  // ------------------------------------------------------------
  // 画像として書き出し(共有・記録用)。今の拡大率に関わらず、盤面全体を等倍で書き出す
  // ------------------------------------------------------------
  const [exportingImage, setExportingImage] = useState(false);
  async function exportBoardImage() {
    if (!boardCanvasRef.current || exportingImage) return;
    setExportingImage(true);
    try {
      const boardTitle = (boards ?? []).find((b) => b.id === selectedBoardId)?.title ?? "board";
      await exportElementToPng(boardCanvasRef.current, `board_${boardTitle}_${today}.png`, {
        width: MEMO_BOARD_WIDTH,
        height: MEMO_BOARD_HEIGHT,
      });
    } finally {
      setExportingImage(false);
    }
  }

  // 全画面表示。ページのヘッダーやタブ列も含めて画面いっぱいに広げ、盤面をできるだけ
  // 大きく使えるようにする(CSSでの上乗せ表示。ブラウザのFullscreen APIは
  // PWA/一部環境で使えないことがあるため、それに依存しない作りにしてある)
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const [showPalette, setShowPalette] = useState(false);
  const unplacedTodos = openTodos.filter((t) => t.myDayDate !== today && t.boardX === undefined);
  const unplacedProjects = openProjects.filter((p) => p.boardX === undefined);

  return (
    <div className={fullscreen ? "fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto bg-ink p-3" : "space-y-3"}>
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
          <button
            className={fullscreen ? "btn-pill px-2 py-1 text-xs" : "btn-pill-outline px-2 py-1 text-xs"}
            onClick={() => setFullscreen((v) => !v)}
            title={fullscreen ? "全画面表示を終了します(Escでも終了できます)" : "タブ列などを隠し、盤面を画面いっぱいに表示します"}
          >
            {fullscreen ? "✕ 全画面終了" : "⛶ 全画面"}
          </button>
        </div>
      </div>
      {/* ボードの地の模様。見た目だけの切り替えで、カードの位置や重なりには影響しない */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs text-cream/50">背景:</span>
        {BOARD_BACKGROUND_KINDS.map((kind) => (
          <button
            key={kind}
            className={background === kind ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setBackgroundStr(kind)}
          >
            {BOARD_BACKGROUND_LABELS[kind]}
          </button>
        ))}
      </div>
      {/* 書き込みの道具。付箋・図形・手書き・消しゴムをこの1列にまとめる */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button className="btn-pill-outline text-xs" onClick={addNote}>
          ＋ 付箋
        </button>
        <div className="relative">
          <button
            className={showShapeMenu ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowShapeMenu((v) => !v)}
          >
            ＋ 図形
          </button>
          {showShapeMenu && (
            <div className="absolute left-0 top-full z-10 mt-1 flex gap-1 rounded-lg border border-cream/20 bg-ink p-1.5 shadow-lg">
              <button className="btn-pill-outline whitespace-nowrap text-xs" onClick={() => addShape("rect")}>
                ▭ 四角
              </button>
              <button className="btn-pill-outline whitespace-nowrap text-xs" onClick={() => addShape("circle")}>
                ○ 円
              </button>
              <button className="btn-pill-outline whitespace-nowrap text-xs" onClick={() => addShape("line")}>
                ─ 線
              </button>
              <button className="btn-pill-outline whitespace-nowrap text-xs" onClick={() => addShape("arrow")}>
                → 矢印
              </button>
            </div>
          )}
        </div>
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

      {/* 検索・整列・選択操作。件名/本文/ラベルで探して目立たせたり、散らかった配置を
          グリッド状に並べ直したりする。複数選択はカードをShift+クリック、または
          何もない盤面をドラッグして範囲選択する */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <input
          value={boardSearchQuery}
          onChange={(e) => setBoardSearchQuery(e.target.value)}
          placeholder="🔍 件名・本文・ラベルで検索"
          className="w-56 rounded-lg border border-cream/20 bg-ink px-3 py-1.5 text-xs text-cream"
        />
        {boardSearchActive && (
          <>
            <span className="text-xs text-cream/50">{matchingIds?.size ?? 0}件ヒット</span>
            <button className="btn-pill-outline text-xs" onClick={() => setBoardSearchQuery("")}>
              クリア
            </button>
          </>
        )}
        <button className="btn-pill-outline text-xs" onClick={alignBoardItems} title="散らかった配置をグリッド状に並べ直します(ロック中は動きません)">
          🧹 整列
        </button>
        <button className="btn-pill-outline text-xs" onClick={exportBoardImage} disabled={exportingImage} title="盤面全体を画像(.png)として保存します">
          {exportingImage ? "書き出し中…" : "📷 画像として保存"}
        </button>
        {selectedIds.size > 0 && (
          <span className="ml-auto flex items-center gap-2 text-xs text-cream/60">
            {selectedIds.size}件選択中(矢印キーで移動・Deleteで下げる/消す)
            <button className="btn-pill-outline text-xs" onClick={() => setSelectedIds(new Set())}>
              選択解除
            </button>
          </span>
        )}
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

      {!fullscreen && (
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
      )}

      {!fullscreen && (
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
      )}

      <div className={fullscreen ? "flex min-h-0 flex-1 items-start gap-2" : "flex items-start gap-2"}>
      <div
        ref={boardViewportRef}
        className={fullscreen ? "panel min-h-0 min-w-0 flex-1 overflow-auto p-0" : "panel min-w-0 flex-1 overflow-auto p-0"}
        style={fullscreen ? undefined : { height: "70vh" }}
      >
        <div style={{ width: MEMO_BOARD_WIDTH * zoom, height: MEMO_BOARD_HEIGHT * zoom }}>
          <div
            ref={boardCanvasRef}
            className="relative"
            style={{
              width: MEMO_BOARD_WIDTH,
              height: MEMO_BOARD_HEIGHT,
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
              ...boardBackgroundCss(background),
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
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
            {/* ラバーバンド範囲選択中の枠 */}
            {selectionBox && (
              <div
                className="pointer-events-none absolute border border-dashed border-cream/70 bg-cream/10"
                style={{
                  left: Math.min(selectionBox.x0, selectionBox.x1),
                  top: Math.min(selectionBox.y0, selectionBox.y1),
                  width: Math.abs(selectionBox.x1 - selectionBox.x0),
                  height: Math.abs(selectionBox.y1 - selectionBox.y0),
                }}
              />
            )}
            {/* 図形はグルーピング・囲み用の飾りなので、付箋やカードより下(DOM上で先)に描く */}
            {(shapes ?? []).map((shape) => (
              <ShapeElement
                key={shape.id}
                shape={shape}
                zoom={zoom}
                zIndex={zIndexById[shape.id] ?? 1}
                selected={selectedIds.has(shape.id)}
                matched={matchingIds?.has(shape.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(shape.id) ?? false)}
                onSelect={(additive) => selectItem(shape.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("shape", id, x, y)}
                onRemove={() => removeShape(shape.id)}
                onColorChange={(color) => setShapeColor(shape.id, color)}
                onOpacityChange={(opacity) => setShapeOpacity(shape.id, opacity)}
                onLabelChange={(label) => setShapeLabel(shape.id, label)}
                onRotate={() => rotateShape(shape)}
                onToggleLock={() => toggleBoardLock("shape", shape.id, !!shape.boardLocked)}
                onFocus={() => bringToFront(shape.id)}
              />
            ))}
            {(notes ?? []).map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                zoom={zoom}
                zIndex={memoNoteZIndex(note.pinned, zIndexById[note.id] ?? 1)}
                selected={selectedIds.has(note.id)}
                matched={matchingIds?.has(note.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(note.id) ?? false)}
                onSelect={(additive) => selectItem(note.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("note", id, x, y)}
                onCommitText={commitNoteText}
                onGrow={growNote}
                onTogglePin={() => togglePin(note)}
                onToggleLock={() => toggleBoardLock("note", note.id, !!note.boardLocked)}
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
                selected={selectedIds.has(task.id)}
                matched={matchingIds?.has(task.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(task.id) ?? false)}
                onSelect={(additive) => selectItem(task.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("task", id, x, y)}
                onStart={() => startTask(task)}
                onPause={() => pauseTask(task)}
                onComplete={() => completeTask(task)}
                onToggleLock={() => toggleBoardLock("task", task.id, !!task.boardLocked)}
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
                selected={selectedIds.has(todo.id)}
                matched={matchingIds?.has(todo.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(todo.id) ?? false)}
                onSelect={(additive) => selectItem(todo.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("todo", id, x, y)}
                onComplete={() => completeTodo(todo)}
                onRemove={() => removeTodo(todo)}
                onToggleLock={() => toggleBoardLock("todo", todo.id, !!todo.boardLocked)}
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
                selected={selectedIds.has(project.id)}
                matched={matchingIds?.has(project.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(project.id) ?? false)}
                onSelect={(additive) => selectItem(project.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("project", id, x, y)}
                onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
                onRemove={() => removeProject(project)}
                onToggleLock={() => toggleBoardLock("project", project.id, !!project.boardLocked)}
                onFocus={() => bringToFront(project.id)}
                onOpenDetail={onOpenProjectEdit ? () => onOpenProjectEdit(project.id) : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ミニマップ。拡大しているときに今どこを見ているか分かるようにし、クリック/
          ドラッグでそこへ移動できる。狭い画面では場所を取りすぎるため隠す */}
      <div className="panel hidden shrink-0 self-start p-2 sm:block">
        <p className="mb-1 text-[10px] text-cream/40">ミニマップ</p>
        <div
          className="relative cursor-pointer overflow-hidden rounded bg-black/30"
          style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, touchAction: "none" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setMinimapDragging(true);
            panToMinimapPoint(e.clientX, e.clientY, e.currentTarget);
          }}
          onPointerMove={(e) => {
            if (minimapDragging) panToMinimapPoint(e.clientX, e.clientY, e.currentTarget);
          }}
          onPointerUp={() => setMinimapDragging(false)}
          onPointerCancel={() => setMinimapDragging(false)}
        >
          {boardItems.map((it) => (
            <div
              key={it.id}
              className="absolute rounded-sm bg-cream/50"
              style={{
                left: it.x * minimapScale,
                top: it.y * minimapScale,
                width: Math.max(2, it.width * minimapScale),
                height: Math.max(2, it.height * minimapScale),
              }}
            />
          ))}
          {/* 今見えている範囲の枠 */}
          <div
            className="pointer-events-none absolute border border-cream/70"
            style={{
              left: (scrollPos.left / zoom) * minimapScale,
              top: (scrollPos.top / zoom) * minimapScale,
              width: Math.min(MINIMAP_WIDTH, (viewportWidth / zoom) * minimapScale),
              height: Math.min(MINIMAP_HEIGHT, (viewportHeight / zoom) * minimapScale),
            }}
          />
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
// pointerup時のみ行い、ドラッグ中はローカルのoffsetだけで見た目を動かす(付箋のドラッグと同じ方式)。
// ロックしたカードは掴んでも動かないようにする(呼び出し側で条件分岐せずに済むよう、
// ここで一括してno-opにする)。またドラッグ開始をstopPropagationし、盤面の空き地への
// pointerdownで始まる範囲選択(ラバーバンド)と競合しないようにする
function useBoardDrag(
  x: number,
  y: number,
  width: number,
  height: number,
  zoom: number,
  onDragEnd: (x: number, y: number) => void,
  locked?: boolean
) {
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // dragOffsetの最新値をrefでも持つ。pointerup時にstateのクロージャを読むと、
  // 直前のpointermoveのsetDragOffsetがまだ描画に反映されていない場合に古い値を
  // つかんでしまう(結果、移動量0で確定してしまう)ことがあるため、常に同期的に
  // 最新の値を読めるrefの方を確定処理に使う
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragOffsetRef.current = { dx: 0, dy: 0 };
    setDragOffset({ dx: 0, dy: 0 });
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    const next = { dx: (e.clientX - dragStartRef.current.x) / zoom, dy: (e.clientY - dragStartRef.current.y) / zoom };
    dragOffsetRef.current = next;
    setDragOffset(next);
  }
  function onPointerUp() {
    const offset = dragOffsetRef.current;
    if (!dragStartRef.current || !offset) {
      dragStartRef.current = null;
      dragOffsetRef.current = null;
      setDragOffset(null);
      return;
    }
    const newX = Math.max(0, Math.min(MEMO_BOARD_WIDTH - width, x + offset.dx));
    const newY = Math.max(0, Math.min(MEMO_BOARD_HEIGHT - height, y + offset.dy));
    onDragEnd(newX, newY);
    dragStartRef.current = null;
    dragOffsetRef.current = null;
    setDragOffset(null);
  }

  const left = x + (dragOffset?.dx ?? 0);
  const top = y + (dragOffset?.dy ?? 0);
  return { left, top, onPointerDown, onPointerMove, onPointerUp };
}

// 選択中/検索一致・不一致の見た目(枠線と不透明度)をカード種別を問わず共通にする
function boardItemVisualStyle(selected: boolean, matched: boolean, dimmed: boolean): { outline?: string; outlineOffset?: string; opacity?: number } {
  return {
    outline: matched ? "2px solid #fbbf24" : selected ? "2px solid #7dd3fc" : undefined,
    outlineOffset: matched || selected ? "2px" : undefined,
    opacity: dimmed ? 0.25 : 1,
  };
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

// 囲み線・グルーピング用の単純な図形。付箋と違って本文は持たないが、短いラベルと
// 塗りの濃さは変えられる。位置のドラッグ・色変更・削除(・線/矢印だけ向きの変更)ができる
function ShapeElement({
  shape,
  zoom,
  zIndex,
  selected,
  matched,
  dimmed,
  onSelect,
  onDragEnd,
  onRemove,
  onColorChange,
  onOpacityChange,
  onLabelChange,
  onRotate,
  onToggleLock,
  onFocus,
}: {
  shape: BoardShape;
  zoom: number;
  zIndex: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onRemove: () => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  onLabelChange: (label: string) => void;
  onRotate: () => void;
  onToggleLock: () => void;
  onFocus: () => void;
}) {
  const locked = !!shape.boardLocked;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    shape.x,
    shape.y,
    shape.width,
    shape.height,
    zoom,
    (x, y) => onDragEnd(shape.id, x, y),
    locked
  );
  const colors = MEMO_NOTE_COLORS[shape.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];
  const isLineLike = shape.type === "line" || shape.type === "arrow";
  const arrowMarkerId = `board-shape-arrow-${shape.id}`;
  const opacity = shape.opacity ?? DEFAULT_BOARD_SHAPE_OPACITY;
  const fillAlphaHex = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");

  const [label, setLabel] = useState(shape.label ?? "");
  const idRef = useRef(shape.id);
  useEffect(() => {
    if (idRef.current !== shape.id) {
      idRef.current = shape.id;
      setLabel(shape.label ?? "");
    }
  }, [shape.id, shape.label]);

  const labelInput = (
    <input
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      onBlur={() => {
        if (label !== (shape.label ?? "")) onLabelChange(label);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      placeholder="ラベル"
      className="w-full bg-transparent text-center text-xs text-ink/70 outline-none placeholder:text-ink/30"
    />
  );

  return (
    <div
      className="absolute"
      style={{ left, top, width: shape.width, height: shape.height, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
      onPointerDownCapture={onFocus}
    >
      {/* 図形本体全体が掴んで動かせる領域。操作ボタンは外に浮かせてあるので重ならない。
          ロック中はカーソルで分かるようにし、ドラッグはuseBoardDrag側でno-opになる */}
      <div
        className={locked ? "absolute inset-0 cursor-not-allowed" : "absolute inset-0 cursor-grab active:cursor-grabbing"}
        style={{ touchAction: "none" }}
        title={locked ? "ロック中です(🔒で解除できます)" : "ドラッグで移動できます"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => onSelect(e.shiftKey)}
      >
        {shape.type === "rect" && (
          <div
            className="flex h-full w-full items-center justify-center rounded-md border-2 px-2"
            style={{ borderColor: colors.border, backgroundColor: `${colors.bg}${fillAlphaHex}` }}
          >
            {labelInput}
          </div>
        )}
        {shape.type === "circle" && (
          <div
            className="flex h-full w-full items-center justify-center rounded-full border-2 px-4"
            style={{ borderColor: colors.border, backgroundColor: `${colors.bg}${fillAlphaHex}` }}
          >
            {labelInput}
          </div>
        )}
        {isLineLike && (
          <>
            <svg width={shape.width} height={shape.height} className="h-full w-full overflow-visible">
              <defs>
                <marker id={arrowMarkerId} markerWidth={8} markerHeight={8} refX={6} refY={4} orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill={colors.border} />
                </marker>
              </defs>
              {shape.width >= shape.height ? (
                <line
                  x1={6}
                  y1={shape.height / 2}
                  x2={Math.max(6, shape.width - 6)}
                  y2={shape.height / 2}
                  stroke={colors.border}
                  strokeWidth={3}
                  markerEnd={shape.type === "arrow" ? `url(#${arrowMarkerId})` : undefined}
                />
              ) : (
                <line
                  x1={shape.width / 2}
                  y1={6}
                  x2={shape.width / 2}
                  y2={Math.max(6, shape.height - 6)}
                  stroke={colors.border}
                  strokeWidth={3}
                  markerEnd={shape.type === "arrow" ? `url(#${arrowMarkerId})` : undefined}
                />
              )}
            </svg>
            {/* 線・矢印はSVGの上に重ねてラベルを置く(中央寄せの帯) */}
            <div className="absolute inset-x-1 top-1/2 -translate-y-1/2">{labelInput}</div>
          </>
        )}
      </div>
      {/* 操作(色・濃さ・向き・削除)は図形の上に小さく浮かせる。図形本体とは重ならないので
          ドラッグの当たり判定と競合しない */}
      <div className="absolute -top-6 left-0 flex flex-wrap items-center gap-1 whitespace-nowrap rounded bg-ink/85 px-1 py-0.5">
        {isLineLike && (
          <button onClick={onRotate} className="text-[11px] leading-none text-cream/70 hover:text-cream" title="向きを変える(横⇔縦)">
            ⟳
          </button>
        )}
        {Object.entries(MEMO_NOTE_COLORS).map(([key, c]) => (
          <button
            key={key}
            onClick={() => onColorChange(key)}
            className="h-3 w-3 shrink-0 rounded-full border"
            style={{ backgroundColor: c.border, borderColor: shape.color === key ? "#f2f2f0" : "transparent" }}
            aria-label={`色を${key}にする`}
          />
        ))}
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.1}
          value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-3 w-10"
          title="塗りの濃さ"
          aria-label="塗りの濃さ"
        />
        <button
          onClick={onToggleLock}
          className={`text-[11px] leading-none ${locked ? "text-cream" : "text-cream/60 hover:text-cream"}`}
          title={locked ? "ロックを解除する" : "ロックする(ドラッグ・矢印キー移動を防ぐ)"}
        >
          {locked ? "🔒" : "🔓"}
        </button>
        <button onClick={onRemove} className="text-[11px] leading-none text-cream/60 hover:text-cream" title="図形を削除">
          ✕
        </button>
      </div>
    </div>
  );
}

function NoteCard({
  note,
  zoom,
  zIndex,
  selected,
  matched,
  dimmed,
  onSelect,
  onDragEnd,
  onCommitText,
  onFocus,
  onGrow,
  onTogglePin,
  onToggleLock,
}: {
  note: MemoNote;
  zoom: number;
  zIndex: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onCommitText: (note: MemoNote, text: string) => void;
  onFocus: () => void;
  onGrow: (id: string, height: number) => void;
  onTogglePin: () => void;
  onToggleLock: () => void;
}) {
  const locked = !!note.boardLocked;
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
    (x, y) => onDragEnd(note.id, x, y),
    locked
  );
  const colors = MEMO_NOTE_COLORS[note.color] ?? MEMO_NOTE_COLORS[DEFAULT_MEMO_NOTE_COLOR];

  return (
    <div
      className="absolute flex flex-col rounded-md border-2 shadow-md"
      style={{
        left,
        top,
        width: note.width,
        height: note.height,
        backgroundColor: colors.bg,
        borderColor: colors.border,
        zIndex,
        ...boardItemVisualStyle(selected, matched, dimmed),
      }}
      onPointerDownCapture={onFocus}
      onClick={(e) => onSelect(e.shiftKey)}
    >
      <DragHandle tone="light" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      {/* ロック・最前面固定。掴む帯の上に重ねるので、ドラッグ用のpointerdownは止めておく */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className={`absolute right-8 top-0.5 text-[11px] leading-none ${locked ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
        title={locked ? "ロックを解除する" : "ロックする(ドラッグ・矢印キー移動を防ぐ)"}
      >
        {locked ? "🔒" : "🔓"}
      </button>
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
  selected,
  matched,
  dimmed,
  onSelect,
  onDragEnd,
  onStart,
  onPause,
  onComplete,
  onToggleLock,
  onFocus,
}: {
  task: DailyTask;
  now: number;
  zoom: number;
  zIndex: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onStart: () => void;
  onPause: () => void;
  onComplete: () => void;
  onToggleLock: () => void;
  onFocus: () => void;
}) {
  const locked = !!task.boardLocked;
  // 実際の位置は自動配置useEffectがboardX/boardYへ即座に割り当てるため、
  // ここでの初期値は割り当てが反映されるまでの一瞬だけ使われる仮の位置
  const x = task.boardX ?? 40;
  const y = task.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    CARD_WIDTH,
    TASK_CARD_HEIGHT,
    zoom,
    (nx, ny) => onDragEnd(task.id, nx, ny),
    locked
  );
  const elapsedMs = segmentsAccumulatedMs(task, now);
  const running = task.status === "running";

  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${running ? "border-alert" : "border-cream/20"}`}
      style={{ left, top, width: CARD_WIDTH, height: TASK_CARD_HEIGHT, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
      onPointerDownCapture={onFocus}
      onClick={(e) => onSelect(e.shiftKey)}
    >
      <div
        className={`-mx-2 -mt-2 mb-1 flex shrink-0 items-center justify-between rounded-t bg-cream/10 px-2 py-1 ${
          locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"
        }`}
        style={{ touchAction: "none" }}
        title={locked ? "ロック中です(🔒で解除できます)" : "ドラッグで移動できます"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="text-[10px] text-cream/50">{running ? "🔴 計測中" : task.status === "paused" ? "一時停止中" : "未着手"}</span>
        <span className="font-display text-xs font-bold tabular-nums text-cream/80">{formatMsClock(elapsedMs)}</span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          className={`text-[11px] leading-none ${locked ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
          title={locked ? "ロックを解除する" : "ロックする(ドラッグ・矢印キー移動を防ぐ)"}
        >
          {locked ? "🔒" : "🔓"}
        </button>
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
  selected,
  matched,
  dimmed,
  onSelect,
  onDragEnd,
  onComplete,
  onRemove,
  onToggleLock,
  onFocus,
  onOpenDetail,
}: {
  todo: TodoTask;
  today: string;
  /** サブタスクを持つ場合の完了/全体件数。持たない単発のタスクならnull */
  subtaskStat: { done: number; total: number } | null;
  zoom: number;
  zIndex: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onComplete: () => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onFocus: () => void;
  /** 件名を押した時に、ToDoタブでこの項目の詳細を開く。未指定なら件名はただの文字のまま */
  onOpenDetail?: () => void;
}) {
  const locked = !!todo.boardLocked;
  // 実際の位置は自動配置useEffectがboardX/boardYへ即座に割り当てるため、
  // ここでの初期値は割り当てが反映されるまでの一瞬だけ使われる仮の位置
  const x = todo.boardX ?? 40;
  const y = todo.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    CARD_WIDTH,
    TODO_CARD_HEIGHT,
    zoom,
    (nx, ny) => onDragEnd(todo.id, nx, ny),
    locked
  );
  const overdue = !!todo.dueDate && todo.dueDate < today;

  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${
        overdue ? "border-alert/70" : "border-cream/20"
      }`}
      style={{ left, top, width: CARD_WIDTH, height: TODO_CARD_HEIGHT, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
      onPointerDownCapture={onFocus}
      onClick={(e) => onSelect(e.shiftKey)}
    >
      <DragHandle
        tone="dark"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className={`absolute right-6 top-0.5 text-[11px] leading-none ${locked ? "text-cream" : "text-cream/35 hover:text-cream"}`}
        title={locked ? "ロックを解除する" : "ロックする(ドラッグ・矢印キー移動を防ぐ)"}
      >
        {locked ? "🔒" : "🔓"}
      </button>
      <BoardRemoveButton onRemove={onRemove} title="ボードから下げる（マイデイからも外れます。ToDo自体は消えません）" />
      <div className="flex flex-1 items-start gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onComplete();
          }}
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
  selected,
  matched,
  dimmed,
  onSelect,
  onDragEnd,
  onToggleStage,
  onRemove,
  onToggleLock,
  onFocus,
  onOpenDetail,
}: {
  project: ProjectItem;
  today: string;
  zoom: number;
  zIndex: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onToggleStage: (stageId: string) => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onFocus: () => void;
  /** 件名を押した時に、案件タブでこの案件の編集を開く。未指定なら件名はただの文字のまま */
  onOpenDetail?: () => void;
}) {
  const locked = !!project.boardLocked;
  const x = project.boardX ?? 40;
  const y = project.boardY ?? 40;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    CARD_WIDTH,
    PROJECT_CARD_HEIGHT,
    zoom,
    (nx, ny) => onDragEnd(project.id, nx, ny),
    locked
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
      style={{ left, top, width: CARD_WIDTH, height: PROJECT_CARD_HEIGHT, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
      onPointerDownCapture={onFocus}
      onClick={(e) => onSelect(e.shiftKey)}
    >
      <DragHandle tone="dark" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        className={`absolute right-6 top-0.5 text-[11px] leading-none ${locked ? "text-cream" : "text-cream/35 hover:text-cream"}`}
        title={locked ? "ロックを解除する" : "ロックする(ドラッグ・矢印キー移動を防ぐ)"}
      >
        {locked ? "🔒" : "🔓"}
      </button>
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
