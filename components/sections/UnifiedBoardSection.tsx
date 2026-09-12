"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatClock, formatMsClock, todayStr } from "@/lib/time";
import { computePredictedSecondsByTaskId, computeRemainingEstimatedSeconds, segmentsAccumulatedMs, finishDailyTask } from "@/lib/tasks";
import { completeTodoTask, DEFAULT_TAG_PRESETS, parsePresetList } from "@/lib/todo";
import { getRiskTier, useVisualMode } from "@/lib/theme";
import {
  BOARD_BACKGROUND_KINDS,
  BOARD_BACKGROUND_LABELS,
  BOARD_SHAPE_DEFAULT_SIZE,
  BOARD_STAMP_HEIGHT,
  BOARD_STAMP_MAX_HEIGHT,
  BOARD_STAMP_MAX_WIDTH,
  BOARD_STAMP_MIN_HEIGHT,
  BOARD_STAMP_MIN_WIDTH,
  BOARD_STAMP_WIDTH,
  BOARD_STAMP_Z_BASE,
  boardBackgroundCss,
  clampMemoZoom,
  DEFAULT_BOARD_BACKGROUND,
  DEFAULT_BOARD_SHAPE_OPACITY,
  DEFAULT_BOARD_STAMP_COLOR,
  DEFAULT_MEMO_NOTE_COLOR,
  DEFAULT_MEMO_NOTE_TEXT_COLOR,
  DEFAULT_MEMO_PEN_COLOR,
  DEFAULT_MEMO_PEN_WIDTH,
  estimateAutoChecklistNoteWidth,
  estimateAutoTextNoteSize,
  estimateChecklistNoteHeight,
  MEMO_BOARD_HEIGHT,
  MEMO_BOARD_WIDTH,
  memoChecklistItemFont,
  memoNoteTextFont,
  MEMO_NOTE_COLORS,
  MEMO_NOTE_TEXT_COLORS,
  MEMO_PEN_COLORS,
  memoNoteZIndex,
  TAG_BADGE_Z_BASE,
  type BoardBackgroundKind,
} from "@/lib/memo";
import { computeProjectProgress, isStageDone, toggleProjectStage } from "@/lib/projectStage";
import { exportElementToPng } from "@/lib/pdfExport";
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import StrokeLayer from "@/components/memo/StrokeLayer";
import RadialTimer from "@/components/ui/RadialTimer";
import type { BoardShape, BoardShapeType, BoardStamp, DailyTask, MasterTask, MemoNote, MemoStroke, ProjectItem, TodoTask } from "@/lib/types";

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
// 案件カードは残っている段階の数に応じて縦に伸びる(スクロールで探すより、
// できるだけそのまま全部見える方を優先する)。ただし段階が非常に多い案件が
// 盤面を占領しすぎないよう、上限を超えた分はこれまで通りカード内スクロールになる
const PROJECT_CARD_MIN_HEIGHT = 132;
const PROJECT_CARD_MAX_HEIGHT = 480;
// ヘッダー・期日・進捗バーなど、段階以外の固定分(要素間のgapを含む)。
// 足りないと最後の段階が1行分だけ見切れてしまう
const PROJECT_CARD_CHROME_HEIGHT = 102;
const PROJECT_CARD_STAGE_ROW_HEIGHT = 22;
function computeProjectCardHeight(project: ProjectItem): number {
  const remaining = (project.stages ?? []).filter((st) => !isStageDone(st)).length;
  const fit = PROJECT_CARD_CHROME_HEIGHT + remaining * PROJECT_CARD_STAGE_ROW_HEIGHT;
  return Math.max(PROJECT_CARD_MIN_HEIGHT, Math.min(PROJECT_CARD_MAX_HEIGHT, fit));
}
// ToDoカードも案件カードと同じように、抱えているサブタスクの数だけ縦に伸ばす。
// 件数だけを「サブタスク 2/4」と書いていた頃と違い、中身をその場で見て潰せるようにする
const TODO_CARD_SUBTASK_ROW_HEIGHT = 22;
const TODO_CARD_MAX_HEIGHT = 420;
function computeTodoCardHeight(subtaskCount: number): number {
  if (subtaskCount === 0) return TODO_CARD_HEIGHT;
  return Math.min(TODO_CARD_MAX_HEIGHT, TODO_CARD_HEIGHT + subtaskCount * TODO_CARD_SUBTASK_ROW_HEIGHT);
}
const PLACEMENT_GRID = 30;
const PLACEMENT_MARGIN = 10;
const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = Math.round((MINIMAP_WIDTH * MEMO_BOARD_HEIGHT) / MEMO_BOARD_WIDTH);

// ハブモード専用の時間軸モード。所定労働時間の帯を盤面の横幅いっぱいに描き、
// 右端に「時刻がわからない作業」を集める帯を別途確保する
const TIME_AXIS_HEIGHT = 28;
const TIME_AXIS_LEFT_MARGIN = 20;
const TIME_AXIS_UNSCHEDULED_WIDTH = 240;
const TIME_AXIS_LANE_GAP = 20;

function parseHM(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ToDoをどこまで自動でボードに出すかの条件。既定は従来通り「マイデイ」だけだが、
// チェックボックスで重要・期日あり・期限切れも足せるようにする。手動で置いたもの
// (boardX有り)は条件に関わらず常に出す(これまで通り)
const TODO_AUTO_SHOW_OPTIONS = [
  { key: "myday", label: "マイデイ" },
  { key: "important", label: "重要" },
  { key: "planned", label: "期日あり" },
  { key: "overdue", label: "期限切れ" },
] as const;
type TodoAutoShowKey = (typeof TODO_AUTO_SHOW_OPTIONS)[number]["key"];
const TODO_AUTO_SHOW_KEYS = TODO_AUTO_SHOW_OPTIONS.map((o) => o.key);
const DEFAULT_TODO_AUTO_SHOW: TodoAutoShowKey[] = ["myday"];

function parseTodoAutoShow(json: string): TodoAutoShowKey[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((k): k is TodoAutoShowKey => (TODO_AUTO_SHOW_KEYS as string[]).includes(k));
      if (valid.length > 0) return valid;
    }
  } catch {
    // 壊れた設定値は既定にフォールバック
  }
  return DEFAULT_TODO_AUTO_SHOW;
}

function matchesTodoAutoShow(todo: TodoTask, criteria: TodoAutoShowKey[], today: string): boolean {
  if (criteria.includes("myday") && todo.myDayDate === today) return true;
  if (criteria.includes("important") && todo.important) return true;
  if (criteria.includes("planned") && !!todo.dueDate) return true;
  if (criteria.includes("overdue") && !!todo.dueDate && todo.dueDate < today) return true;
  return false;
}

// スタンプ・対応状況バッジ共通の「ゴム印っぽさ」用ヘルパー。同じ文字列からは常に同じ
// 傾き・色になるようにし(押すたびに向きが揃わない実際の判子のばらつきの再現と、
// 同じ対応状況なら常に同じ色になる分かりやすさを両立する)
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(hash);
}
function stampRotationForKey(key: string): number {
  return ((hashString(key) % 9) - 4) * 0.9;
}
const STAMP_COLOR_KEYS = Object.keys(MEMO_NOTE_COLORS);
function stampColorForText(text: string): string {
  return STAMP_COLOR_KEYS[hashString(text) % STAMP_COLOR_KEYS.length];
}

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
  // ハブモード専用の進化版機能(進捗リング・負荷ヒートマップ・自動連結線・時間軸モード)は
  // このフラグでのみ出し分ける。統合ボードタブ自体は他のテーマでも共通の見た目のまま
  const { hubMode } = useVisualMode();
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
  const stamps = useLiveQuery(
    () => (selectedBoardId ? db.boardStamps.where("boardId").equals(selectedBoardId).toArray() : Promise.resolve([] as BoardStamp[])),
    [selectedBoardId]
  );
  // スタンプの対応状況プリセットは、ToDoの「対応状況」設定タブでカスタマイズしている
  // ものをそのまま流用する(スタンプ専用の設定を別途持つと二重管理になるため)
  const [tagPresetsStr] = useSetting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS));
  const stampPresets = parsePresetList(tagPresetsStr);
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
  // ハブモードの進捗リング・負荷ヒートマップ用。全マスタを見て「予測」(マスタの平均想定時間)を
  // 求める(TodaySectionの予測ロジックと同じcomputePredictedSecondsByTaskIdを流用する)
  const allMasterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);

  const tasks = (dailyTasks ?? []).filter((t) => !t.isProvisional && t.status !== "done");
  // 未完了の親タスクだけを対象にする(サブタスクはカードにしない)
  const openTodos = (todoTasks ?? []).filter((t) => !t.completed && !t.parentTaskId);
  // ボードに自動で出すToDoの条件(マイデイ/重要/期日あり/期限切れをチェックボックスで選べる)。
  // どれにも当てはまらなくても、手動で「一覧から置く」で置いたものは常に出す
  const [todoAutoShowStr, setTodoAutoShowStr] = useSetting("board.todoAutoShow", JSON.stringify(DEFAULT_TODO_AUTO_SHOW));
  const todoAutoShow = parseTodoAutoShow(todoAutoShowStr);
  function toggleTodoAutoShow(key: TodoAutoShowKey) {
    const next = todoAutoShow.includes(key) ? todoAutoShow.filter((k) => k !== key) : [...todoAutoShow, key];
    setTodoAutoShowStr(JSON.stringify(next.length > 0 ? next : []));
  }
  // boardHiddenが立っているもの(✕で明示的に下げたもの)は、条件に当てはまっていても
  // 自動では出さない。再度出すには「一覧から置く」で改めて置く必要がある
  const isTodoAutoShown = (t: TodoTask) => !t.boardHidden && matchesTodoAutoShow(t, todoAutoShow, today);
  const todos = openTodos.filter((t) => t.boardX !== undefined || isTodoAutoShown(t));
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

  // 親タスクごとのサブタスク本体。カードの中に「直下」で並べて、対応状況と完了を
  // その場で見られるようにするために使う(ToDoタブを開かずに盤面だけで潰せるように)
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const t of todoTasks ?? []) {
      if (!t.parentTaskId) continue;
      const list = map.get(t.parentTaskId) ?? [];
      list.push(t);
      map.set(t.parentTaskId, list);
    }
    for (const list of map.values()) {
      // 未完了を先に、その中では一覧と同じ並び順(order)で出す
      list.sort((a, b) => Number(a.completed) - Number(b.completed) || a.order - b.order);
    }
    return map;
  }, [todoTasks]);

  const todoCardHeight = useCallback(
    (todoId: string) => computeTodoCardHeight((subtasksByParent.get(todoId) ?? []).length),
    [subtasksByParent]
  );

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
      ...projects.map((p) => ({ x: p.boardX as number, y: p.boardY as number, width: CARD_WIDTH, height: computeProjectCardHeight(p) })),
      ...tasks
        .filter((t) => t.boardX !== undefined && t.boardY !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TASK_CARD_HEIGHT })),
      ...todos
        .filter((t) => t.boardX !== undefined && t.boardY !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: todoCardHeight(t.id) })),
    ];

    (async () => {
      for (const t of unpositionedTasks) {
        const pos = findFreeSlot(occupied, CARD_WIDTH, TASK_CARD_HEIGHT);
        occupied.push({ ...pos, width: CARD_WIDTH, height: TASK_CARD_HEIGHT });
        await db.dailyTasks.update(t.id, { boardX: pos.x, boardY: pos.y });
      }
      for (const t of unpositionedTodos) {
        const h = todoCardHeight(t.id);
        const pos = findFreeSlot(occupied, CARD_WIDTH, h);
        occupied.push({ ...pos, width: CARD_WIDTH, height: h });
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

  // ハブモード専用。「予測」(マスタの平均想定時間から、その日の各作業の残り想定を
  // 求めたもの)を、進捗リングの残り時間表示と負荷ヒートマップの両方で使う
  const predictedSecondsByTaskId = useMemo(() => {
    if (!hubMode || !dailyTasks) return new Map<string, number>();
    return computePredictedSecondsByTaskId(
      dailyTasks.filter((t) => !t.isProvisional),
      allMasterTasks ?? [],
      now
    );
  }, [hubMode, dailyTasks, allMasterTasks, now]);

  // 負荷ヒートマップ用。計測中かつ予測を超過している作業だけを対象に、超過度合いの
  // 階級(0=順調〜4=要再編成)を求める。カード自体の色温度をこの階級で強調する
  const riskLevelByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    if (!hubMode) return map;
    for (const t of tasks) {
      if (t.status !== "running") continue;
      const predSec = predictedSecondsByTaskId.get(t.id) ?? 0;
      if (predSec <= 0) continue;
      const elapsedMs = segmentsAccumulatedMs(t, now);
      const predMs = predSec * 1000;
      if (elapsedMs <= predMs) continue;
      map.set(t.id, getRiskTier(elapsedMs / predMs, "hub").level);
    }
    return map;
  }, [hubMode, tasks, predictedSecondsByTaskId, now]);

  // 進捗リング・時間軸モード共通。所定労働時間の開始/終了(本日の作業タブの設定と同じ)
  const [standardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [standardWorkEnd] = useSetting("today.standardWorkEnd", "17:00");
  const progressStats = useMemo(() => {
    const today = (dailyTasks ?? []).filter((t) => !t.isProvisional);
    const doneCount = today.filter((t) => t.status === "done").length;
    const totalCount = today.length;
    const overrunCount = tasks.filter((t) => riskLevelByTaskId.has(t.id)).length;
    const [h, m] = standardWorkEnd.split(":").map(Number);
    const workEndAt = new Date();
    workEndAt.setHours(h, m, 0, 0);
    const remainingMs = Math.max(0, workEndAt.getTime() - now);
    return { doneCount, totalCount, overrunCount, remainingMs };
  }, [dailyTasks, tasks, riskLevelByTaskId, standardWorkEnd, now]);

  // ハブモード専用。ミッションコントロールHUDの総合ステータス表示用。計測中タスクの中で
  // 最も超過している比率をもとに、盤面全体の「今の状況」をハブモードの階級(順調〜要再編成)
  // 一言に要約する。計測中の超過が無ければ「順調」のまま
  const overallStatus = useMemo(() => {
    if (!hubMode) return null;
    let maxRatio = 1;
    for (const t of tasks) {
      if (t.status !== "running") continue;
      const predSec = predictedSecondsByTaskId.get(t.id) ?? 0;
      if (predSec <= 0) continue;
      const ratio = segmentsAccumulatedMs(t, now) / (predSec * 1000);
      if (ratio > maxRatio) maxRatio = ratio;
    }
    return getRiskTier(maxRatio, "hub");
  }, [hubMode, tasks, predictedSecondsByTaskId, now]);
  // ミッションコントロールHUDの内訳表示用(進行中/待機中)。todaysStatsは完了/総数/超過を
  // 既に持っているので、そこから引き算するだけで済む
  const runningCount = tasks.filter((t) => t.status === "running").length;
  const waitingCount = Math.max(0, progressStats.totalCount - progressStats.doneCount - runningCount);

  // ハブモード専用。HUDはこれまで「本日の作業」の進み具合しか映しておらず、同じ盤面に
  // 出ているToDo・案件の状況が読み取れなかった。盤面に出ている分の期限と残作業をまとめる
  const boardStats = useMemo(() => {
    if (!hubMode) return null;
    const todoOverdue = todos.filter((t) => !!t.dueDate && t.dueDate < today).length;
    const todoDueToday = todos.filter((t) => t.dueDate === today).length;
    let openSubtasks = 0;
    for (const t of todos) {
      const stat = subtaskStats.get(t.id);
      if (stat) openSubtasks += stat.total - stat.done;
    }
    const projectOverdue = projects.filter((p) => p.dueDate < today).length;
    let openStages = 0;
    for (const p of projects) openStages += (p.stages ?? []).filter((st) => !isStageDone(st)).length;
    // 対応状況(tag)ごとの件数。何が滞留しているのかが件数で分かるようにする
    const tagCounts = new Map<string, number>();
    for (const t of todos) {
      if (!t.tag) continue;
      tagCounts.set(t.tag, (tagCounts.get(t.tag) ?? 0) + 1);
    }
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      todoCount: todos.length,
      todoOverdue,
      todoDueToday,
      openSubtasks,
      projectCount: projects.length,
      projectOverdue,
      openStages,
      topTags,
    };
  }, [hubMode, todos, projects, today, subtaskStats]);

  // 付箋/本日の作業/ToDoカードを掴んだ際、他のカードの下に隠れたままにならないよう
  // 最前面に持ってくる。付箋・タスク・ToDoを1つの重なり順で扱うため、種類を問わず
  // 共通のカウンタで管理する(このボード上だけの見た目上の重なり順で、保存はしない)
  const zCounterRef = useRef(1);
  const [zIndexById, setZIndexById] = useState<Record<string, number>>({});
  function bringToFront(id: string) {
    zCounterRef.current += 1;
    setZIndexById((prev) => ({ ...prev, [id]: zCounterRef.current }));
  }

  // ボードの幅(MEMO_BOARD_WIDTH)は狭い画面には収まらない。初期値を空にしておき、まだ倍率を
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
  async function resizeNote(id: string, width: number, height: number) {
    await db.memoNotes.update(id, { width, height, updatedAt: Date.now() });
  }
  async function commitNoteText(note: MemoNote, text: string) {
    if (text === note.text) return;
    await db.memoNotes.update(note.id, { text, updatedAt: Date.now() });
  }
  async function setNoteColor(id: string, color: string) {
    await db.memoNotes.update(id, { color });
  }
  async function setNoteTextColor(id: string, textColor: string) {
    await db.memoNotes.update(id, { textColor });
  }
  async function toggleNoteAutoSize(note: MemoNote) {
    const autoSize = !note.autoSize;
    if (!autoSize) {
      await db.memoNotes.update(note.id, { autoSize });
      return;
    }
    if (note.isChecklist) {
      const height = estimateChecklistNoteHeight((note.checklistItems ?? []).length);
      const width = estimateAutoChecklistNoteWidth(note.checklistItems ?? [], memoChecklistItemFont());
      await db.memoNotes.update(note.id, { autoSize, width, height });
      return;
    }
    const { width, height } = estimateAutoTextNoteSize(note.text, memoNoteTextFont());
    await db.memoNotes.update(note.id, { autoSize, width, height });
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
  // カードの中のサブタスクは1タップで切り替える。親タスクの完了と違って取り消しが
  // 効く(もう一度押せば戻る)ため、いちいち確認は挟まない
  async function toggleSubtask(sub: TodoTask) {
    if (sub.completed) {
      await db.todoTasks.update(sub.id, { completed: false, completedAt: undefined });
      return;
    }
    await completeTodoTask(sub, today);
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
    // 自動サイズは新規付箋では既定でONにする(切り替えはいつでも可能)。
    // 幅もここで内容(空文字)に合わせて決めておくことで、作成直後に自動サイズの
    // useEffectでいきなりサイズが変わって見える「ガタつき」を防ぐ
    const { width, height } = estimateAutoTextNoteSize("", memoNoteTextFont());
    const occupied: BoardRect[] = [
      ...(notes ?? []).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
      ...tasks
        .filter((t) => t.boardX !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: TASK_CARD_HEIGHT })),
      ...todos
        .filter((t) => t.boardX !== undefined)
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: todoCardHeight(t.id) })),
      ...projects.map((p) => ({ x: p.boardX as number, y: p.boardY as number, width: CARD_WIDTH, height: computeProjectCardHeight(p) })),
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
      autoSize: true,
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
        .map((t) => ({ x: t.boardX as number, y: t.boardY as number, width: CARD_WIDTH, height: todoCardHeight(t.id) })),
      ...projects.map((p) => ({ x: p.boardX as number, y: p.boardY as number, width: CARD_WIDTH, height: computeProjectCardHeight(p) })),
    ];
  }
  async function placeTodo(todo: TodoTask) {
    const pos = findFreeSlot(occupiedRects(), CARD_WIDTH, todoCardHeight(todo.id));
    await db.todoTasks.update(todo.id, { boardX: pos.x, boardY: pos.y, boardHidden: false });
    // 置いた直後は最前面にする。他のカードが既に手前へ来ていると、
    // 置いたばかりのカードがその下に隠れて見えなくなっていたため
    bringToFront(todo.id);
  }
  async function placeProject(project: ProjectItem) {
    const pos = findFreeSlot(occupiedRects(), CARD_WIDTH, computeProjectCardHeight(project));
    await db.projects.update(project.id, { boardX: pos.x, boardY: pos.y });
    bringToFront(project.id);
  }
  // ToDoを下げるときはマイデイからも外し、boardHiddenを立てる。myDayDateだけ外しても
  // 「重要」等の自動表示条件に該当していると自動配置がすぐ置き直してしまうため、
  // 明示的に「下げた」状態を覚えておく(再度「一覧から置く」で置くとクリアされる)
  async function removeTodo(todo: TodoTask, skipConfirm = false) {
    if (!skipConfirm && !confirm(`「${todo.title}」をボードから下げますか?(マイデイからも外れます。ToDo自体は消えません)`)) return;
    await db.todoTasks.update(todo.id, { boardX: undefined, boardY: undefined, myDayDate: undefined, boardHidden: true });
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
      items.push({ kind: "todo", id: t.id, x: t.boardX, y: t.boardY, width: CARD_WIDTH, height: todoCardHeight(t.id), label: t.title, locked: !!t.boardLocked });
    }
    for (const p of projects) {
      if (p.boardX === undefined || p.boardY === undefined) continue;
      items.push({ kind: "project", id: p.id, x: p.boardX, y: p.boardY, width: CARD_WIDTH, height: computeProjectCardHeight(p), label: p.title, locked: !!p.boardLocked });
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

  // ハブモード専用。案件→ToDo→作業のうち、両端が盤面に置かれているものどうしを
  // 自動で線でつなぐための中心点ペア。作業がToDo経由で案件ともつながっている場合、
  // 案件への直線は重ねて表示しない(ToDo経由の線だけで関係が辿れるため)
  const autoConnectors = useMemo(() => {
    if (!hubMode) return [] as { key: string; x1: number; y1: number; x2: number; y2: number }[];
    const byKey = new Map(boardItems.map((it) => [`${it.kind}:${it.id}`, it]));
    function center(it: BoardItem) {
      return { x: it.x + it.width / 2, y: it.y + it.height / 2 };
    }
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const t of todos) {
      if (!t.projectId) continue;
      const from = byKey.get(`todo:${t.id}`);
      const to = byKey.get(`project:${t.projectId}`);
      if (!from || !to) continue;
      const c1 = center(from);
      const c2 = center(to);
      lines.push({ key: `todo-project:${t.id}`, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y });
    }
    for (const t of tasks) {
      const from = byKey.get(`task:${t.id}`);
      if (!from) continue;
      if (t.todoTaskId) {
        const to = byKey.get(`todo:${t.todoTaskId}`);
        if (to) {
          const c1 = center(from);
          const c2 = center(to);
          lines.push({ key: `task-todo:${t.id}`, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y });
          continue;
        }
      }
      if (t.projectId) {
        const to = byKey.get(`project:${t.projectId}`);
        if (to) {
          const c1 = center(from);
          const c2 = center(to);
          lines.push({ key: `task-project:${t.id}`, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y });
        }
      }
    }
    return lines;
  }, [hubMode, boardItems, todos, tasks]);

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
  // 最前面固定。付箋はメモタブと共有しているpinnedフィールド、それ以外(本日の作業・
  // ToDo・案件・図形)はこのボード専用のboardPinnedフィールドを使う
  async function toggleBoardPin(kind: BoardItemKind, id: string, currentlyPinned: boolean) {
    const pin = !currentlyPinned;
    if (kind === "note") await db.memoNotes.update(id, { pinned: pin });
    else if (kind === "task") await db.dailyTasks.update(id, { boardPinned: pin });
    else if (kind === "todo") await db.todoTasks.update(id, { boardPinned: pin });
    else if (kind === "project") await db.projects.update(id, { boardPinned: pin });
    else await db.boardShapes.update(id, { boardPinned: pin });
    if (pin) bringToFront(id);
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
  // スタンプ(対応状況などの一言を付箋・ToDo・案件・本日の作業・図形にくっ付ける)
  // 位置はMemoConnectorと同じ考え方で、くっ付けている間は対象の現在位置+相対オフセット
  // から毎回その場で計算する(固定のx/yを保存しないので、対象を動かすと自動で追従する)
  // ------------------------------------------------------------
  function stampTargetPosition(stamp: BoardStamp): { x: number; y: number } {
    if (stamp.attachedToKind && stamp.attachedToId) {
      const target = boardItems.find((it) => it.kind === stamp.attachedToKind && it.id === stamp.attachedToId);
      if (target) return { x: target.x + (stamp.attachedDx ?? 0), y: target.y + (stamp.attachedDy ?? 0) };
    }
    return { x: stamp.x, y: stamp.y };
  }
  // ドラッグを離した位置が他のアイテムと重なっていれば、一番重なりが大きいものに
  // くっ付ける。重ならなければくっ付けを外し、その場所を素の位置として覚える。
  // サイズ変更できるようになったので、固定サイズではなくそのスタンプの実サイズで判定する
  function stampOverlapTarget(x: number, y: number, width: number, height: number): BoardItem | null {
    let best: BoardItem | null = null;
    let bestArea = 0;
    for (const it of boardItems) {
      const ox = Math.min(x + width, it.x + it.width) - Math.max(x, it.x);
      const oy = Math.min(y + height, it.y + it.height) - Math.max(y, it.y);
      if (ox > 0 && oy > 0) {
        const area = ox * oy;
        if (area > bestArea) {
          bestArea = area;
          best = it;
        }
      }
    }
    return best;
  }
  const maxStampOrderRef = useRef(0);
  useEffect(() => {
    maxStampOrderRef.current = (stamps ?? []).reduce((m, s) => Math.max(m, s.order), 0);
  }, [stamps]);
  async function addStamp(text: string) {
    if (!selectedBoardId || !text.trim()) return;
    maxStampOrderRef.current += 1;
    const pos = findFreeSlot(occupiedRects(), BOARD_STAMP_WIDTH, BOARD_STAMP_HEIGHT);
    const id = uid();
    await db.boardStamps.add({
      id,
      boardId: selectedBoardId,
      text: text.trim(),
      color: DEFAULT_BOARD_STAMP_COLOR,
      x: pos.x,
      y: pos.y,
      width: BOARD_STAMP_WIDTH,
      height: BOARD_STAMP_HEIGHT,
      order: maxStampOrderRef.current,
      createdAt: Date.now(),
    });
    bringToFront(id);
    setShowStampMenu(false);
    setCustomStampText("");
  }
  async function moveStamp(id: string, x: number, y: number, width: number, height: number) {
    const target = stampOverlapTarget(x, y, width, height);
    if (target) {
      await db.boardStamps.update(id, {
        attachedToKind: target.kind,
        attachedToId: target.id,
        attachedDx: x - target.x,
        attachedDy: y - target.y,
        x,
        y,
      });
    } else {
      await db.boardStamps.update(id, {
        attachedToKind: undefined,
        attachedToId: undefined,
        attachedDx: undefined,
        attachedDy: undefined,
        x,
        y,
      });
    }
  }
  async function removeStamp(id: string, skipConfirm = false) {
    if (!skipConfirm && !confirm("このスタンプを削除します。よろしいですか?")) return;
    await db.boardStamps.delete(id);
  }
  async function setStampColor(id: string, color: string) {
    await db.boardStamps.update(id, { color });
  }
  async function setStampText(id: string, text: string) {
    await db.boardStamps.update(id, { text });
  }
  async function resizeStamp(id: string, width: number, height: number) {
    await db.boardStamps.update(id, { width, height });
  }
  async function toggleStampLock(id: string, currentlyLocked: boolean) {
    await db.boardStamps.update(id, { boardLocked: !currentlyLocked });
  }
  const [showStampMenu, setShowStampMenu] = useState(false);
  const [customStampText, setCustomStampText] = useState("");

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
  // ハブモード専用。時間軸モード。盤面の上に所定労働時間の目盛りを表示し、
  // 「時間軸で並べる」で作業カードを実際の開始時刻(計測中/一時停止中/完了済みは
  // 最初の区間の開始時刻、未着手は予定時刻scheduledTimeがあればそれ)に沿って
  // 横に並べ直す。時刻が分からない未着手の作業は右端の「未定」帯にまとめる
  // ------------------------------------------------------------
  const [timeAxisMode, setTimeAxisMode] = useState(false);
  const timeAxisTicks = useMemo(() => {
    if (!hubMode) return [] as { minutes: number; x: number; label: string }[];
    const axisStart = parseHM(standardWorkStart);
    const axisEnd = parseHM(standardWorkEnd);
    const axisMinutes = Math.max(1, axisEnd - axisStart);
    const axisWidth = MEMO_BOARD_WIDTH - TIME_AXIS_LEFT_MARGIN * 2 - TIME_AXIS_UNSCHEDULED_WIDTH;
    const ticks: { minutes: number; x: number; label: string }[] = [];
    for (let h = Math.ceil(axisStart / 60); h <= Math.floor(axisEnd / 60); h++) {
      const minutes = h * 60;
      const x = TIME_AXIS_LEFT_MARGIN + ((minutes - axisStart) / axisMinutes) * axisWidth;
      ticks.push({ minutes, x, label: `${h}:00` });
    }
    return ticks;
  }, [hubMode, standardWorkStart, standardWorkEnd]);
  async function arrangeByTimeAxis() {
    setTimeAxisMode(true);
    const axisStart = parseHM(standardWorkStart);
    const axisEnd = parseHM(standardWorkEnd);
    const axisMinutes = Math.max(1, axisEnd - axisStart);
    const axisWidth = MEMO_BOARD_WIDTH - TIME_AXIS_LEFT_MARGIN * 2 - TIME_AXIS_UNSCHEDULED_WIDTH;
    const unscheduledX = MEMO_BOARD_WIDTH - TIME_AXIS_UNSCHEDULED_WIDTH + 10;
    const placed = tasks
      .filter((t) => !t.boardLocked)
      .map((t) => {
        let minutes: number | null = null;
        if (t.segments[0]?.start !== undefined) {
          const d = new Date(t.segments[0].start);
          minutes = d.getHours() * 60 + d.getMinutes();
        } else if (t.scheduledTime) {
          minutes = parseHM(t.scheduledTime);
        }
        const x =
          minutes === null
            ? unscheduledX
            : TIME_AXIS_LEFT_MARGIN + Math.max(0, Math.min(1, (minutes - axisStart) / axisMinutes)) * axisWidth;
        return { id: t.id, x };
      })
      .sort((a, b) => a.x - b.x);
    // 時間帯が重なるカードは、区間が空いている最初のレーンへ縦に振り分ける簡易な貪欲法
    const laneEndX: number[] = [];
    for (const p of placed) {
      let lane = laneEndX.findIndex((endX) => endX + TIME_AXIS_LANE_GAP <= p.x);
      if (lane === -1) {
        lane = laneEndX.length;
        laneEndX.push(0);
      }
      laneEndX[lane] = p.x + CARD_WIDTH;
      await moveTask(p.id, Math.round(p.x), TIME_AXIS_HEIGHT + 20 + lane * (TASK_CARD_HEIGHT + TIME_AXIS_LANE_GAP));
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
  const unplacedTodos = openTodos.filter((t) => t.boardX === undefined && !isTodoAutoShown(t));
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
        <div className="relative">
          <button
            className={showStampMenu ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowStampMenu((v) => !v)}
            title="対応状況などの一言スタンプを、付箋やToDo・案件などに重ねてくっ付けられます"
          >
            ＋ スタンプ
          </button>
          {showStampMenu && (
            <div className="absolute left-0 top-full z-10 mt-1 w-60 rounded-lg border border-cream/20 bg-ink p-2 shadow-lg">
              {stampPresets.length > 0 && (
                <>
                  <p className="mb-1 text-[10px] text-cream/40">対応状況から選ぶ</p>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {stampPresets.map((preset) => (
                      <button key={preset} className="btn-pill-outline whitespace-nowrap text-xs" onClick={() => addStamp(preset)}>
                        {preset}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="mb-1 text-[10px] text-cream/40">自由入力</p>
              <div className="flex gap-1">
                <input
                  value={customStampText}
                  onChange={(e) => setCustomStampText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addStamp(customStampText);
                  }}
                  placeholder="一言を入力"
                  className="w-full rounded-lg border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
                />
                <button className="btn-pill-outline shrink-0 text-xs" onClick={() => addStamp(customStampText)}>
                  追加
                </button>
              </div>
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
        {hubMode && (
          <>
            <button
              className={timeAxisMode ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setTimeAxisMode((v) => !v)}
              title="所定労働時間の目盛りを盤面に表示します"
            >
              🕐 時間軸: {timeAxisMode ? "ON" : "OFF"}
            </button>
            <button
              className="btn-pill-outline text-xs"
              onClick={arrangeByTimeAxis}
              title="作業カードを開始時刻(未着手は予定時刻)に沿って横に並べ直します(ロック中は動きません)"
            >
              📐 時間軸で並べる
            </button>
          </>
        )}
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
            <h4 className="mb-1.5 text-xs font-bold text-cream/70">ToDoを自動でボードに出す条件</h4>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {TODO_AUTO_SHOW_OPTIONS.map((opt) => (
                <label key={opt.key} className="flex items-center gap-1.5 text-xs text-cream/70">
                  <input
                    type="checkbox"
                    checked={todoAutoShow.includes(opt.key)}
                    onChange={() => toggleTodoAutoShow(opt.key)}
                    className="h-3.5 w-3.5 rounded border-cream/30 bg-ink accent-cream"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-cream/40">
              いずれかに当てはまるToDoが自動で盤面に並びます。手動で置いたものは条件に関わらず出続けます。
            </p>
          </div>
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
          付箋と手書きはメモタブと同じものです（どちらで書いても両方に出ます）。ToDoは「一覧から置く」内で選んだ条件（既定はマイデイ）に当てはまるものが自動で並び、それ以外と案件は同じく「一覧から置く」から置きます。カードの
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
      {/* ハブモードのHUD枠(コーナー・スキャンライン・時計)は盤面のスクロール/ズームに
          追従させたくないので、スクロールするビューポート(boardViewportRef)の外側・
          このrelativeラッパーの中に兄弟として重ねる */}
      <div className={fullscreen ? "relative min-h-0 min-w-0 flex-1" : "relative min-w-0 flex-1"}>
      <div
        ref={boardViewportRef}
        className="panel h-full w-full overflow-auto p-0"
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
            {/* ハブモードの時間軸モード。所定労働時間の目盛りと縦の目安線を盤面全体の
                一番奥に敷く(見た目だけの参照線で、カードの位置を縛るものではない) */}
            {hubMode && timeAxisMode && (
              <div className="pointer-events-none absolute left-0 top-0" style={{ width: MEMO_BOARD_WIDTH, height: MEMO_BOARD_HEIGHT }}>
                {timeAxisTicks.map((t) => (
                  <div
                    key={t.minutes}
                    className="absolute top-0 border-l border-cream/10"
                    style={{ left: t.x, height: MEMO_BOARD_HEIGHT }}
                  />
                ))}
                <div
                  className="absolute border-l border-dashed border-cream/20"
                  style={{ left: MEMO_BOARD_WIDTH - TIME_AXIS_UNSCHEDULED_WIDTH, top: 0, height: MEMO_BOARD_HEIGHT }}
                />
                <div
                  className="absolute left-0 top-0 border-b border-cream/15 bg-ink/50"
                  style={{ width: MEMO_BOARD_WIDTH, height: TIME_AXIS_HEIGHT }}
                >
                  {timeAxisTicks.map((t) => (
                    <span key={t.minutes} className="absolute top-1.5 text-[10px] tabular-nums text-cream/50" style={{ left: t.x + 3 }}>
                      {t.label}
                    </span>
                  ))}
                  <span
                    className="absolute top-1.5 text-[10px] text-cream/40"
                    style={{ left: MEMO_BOARD_WIDTH - TIME_AXIS_UNSCHEDULED_WIDTH + 10 }}
                  >
                    未定
                  </span>
                </div>
              </div>
            )}
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
            {/* ハブモード専用。案件⇔ToDo⇔作業のうち盤面に置かれているものどうしを、
                手動のスタンプ/連結線とは別に自動で線でつなぐ。あくまで関係性を示す
                飾りなので、保存はせず毎回boardItemsから作り直す・操作対象にもしない。
                線の上を流れる小さな光点は「データが行き来している」演出で、線の長さから
                速度を揃え(距離が長いほど周期も長く)、キーから決めた開始位置のずれで
                全部の線が同時に脈動しないようにしている */}
            {hubMode && autoConnectors.length > 0 && (
              <svg
                className="absolute left-0 top-0"
                width={MEMO_BOARD_WIDTH}
                height={MEMO_BOARD_HEIGHT}
                style={{ pointerEvents: "none" }}
              >
                {autoConnectors.map((c) => {
                  const length = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
                  const dur = Math.max(1.4, length / 140);
                  let hash = 0;
                  for (let i = 0; i < c.key.length; i++) hash = (hash * 31 + c.key.charCodeAt(i)) | 0;
                  const begin = ((Math.abs(hash) % 100) / 100) * dur;
                  return (
                    <g key={c.key}>
                      <line
                        x1={c.x1}
                        y1={c.y1}
                        x2={c.x2}
                        y2={c.y2}
                        stroke="rgb(var(--accent-rgb) / 0.35)"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                      <circle r={2.5} fill="rgb(var(--accent-rgb) / 0.9)">
                        <animateMotion
                          dur={`${dur}s`}
                          begin={`${begin}s`}
                          repeatCount="indefinite"
                          path={`M${c.x1},${c.y1} L${c.x2},${c.y2}`}
                        />
                      </circle>
                    </g>
                  );
                })}
              </svg>
            )}
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
                zIndex={memoNoteZIndex(shape.boardPinned, zIndexById[shape.id] ?? 1)}
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
                onTogglePin={() => toggleBoardPin("shape", shape.id, !!shape.boardPinned)}
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
                onResize={resizeNote}
                onColorChange={setNoteColor}
                onTextColorChange={setNoteTextColor}
                onToggleAutoSize={() => toggleNoteAutoSize(note)}
                onTogglePin={() => toggleBoardPin("note", note.id, !!note.pinned)}
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
                riskLevel={riskLevelByTaskId.get(task.id) ?? null}
                zIndex={memoNoteZIndex(task.boardPinned, zIndexById[task.id] ?? 1)}
                selected={selectedIds.has(task.id)}
                matched={matchingIds?.has(task.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(task.id) ?? false)}
                onSelect={(additive) => selectItem(task.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("task", id, x, y)}
                onStart={() => startTask(task)}
                onPause={() => pauseTask(task)}
                onComplete={() => completeTask(task)}
                onToggleLock={() => toggleBoardLock("task", task.id, !!task.boardLocked)}
                onTogglePin={() => toggleBoardPin("task", task.id, !!task.boardPinned)}
                onFocus={() => bringToFront(task.id)}
              />
            ))}
            {todos.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                today={today}
                subtaskStat={subtaskStats.get(todo.id) ?? null}
                subtasks={subtasksByParent.get(todo.id) ?? []}
                zoom={zoom}
                zIndex={memoNoteZIndex(todo.boardPinned, zIndexById[todo.id] ?? 1)}
                selected={selectedIds.has(todo.id)}
                matched={matchingIds?.has(todo.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(todo.id) ?? false)}
                hubAlert={hubMode && !!todo.dueDate && todo.dueDate < today}
                onSelect={(additive) => selectItem(todo.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("todo", id, x, y)}
                onComplete={() => completeTodo(todo)}
                onToggleSubtask={toggleSubtask}
                onRemove={() => removeTodo(todo)}
                onToggleLock={() => toggleBoardLock("todo", todo.id, !!todo.boardLocked)}
                onTogglePin={() => toggleBoardPin("todo", todo.id, !!todo.boardPinned)}
                onFocus={() => bringToFront(todo.id)}
                onOpenDetail={onOpenTodoDetail ? () => onOpenTodoDetail(todo.id) : undefined}
              />
            ))}
            {/* ToDoの「対応状況」(tag)が設定されていれば、手で貼らなくても自動でスタンプ風の
                バッジをカードの左上に出す。手動のスタンプ(BoardStamp)とは別物で、DBには
                保存せずtodoの現在値からその都度作るだけなので、対応状況を変えれば即座に
                追従し、消せば自動で消える */}
            {todos
              .filter((todo): todo is TodoTask & { tag: string } => !!todo.tag)
              .map((todo) => (
                <TagStatusBadge
                  key={`tagbadge:${todo.id}`}
                  text={todo.tag}
                  x={todo.boardX ?? 40}
                  y={todo.boardY ?? 40}
                  zIndex={TAG_BADGE_Z_BASE + (zIndexById[todo.id] ?? 1)}
                />
              ))}
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                today={today}
                zoom={zoom}
                zIndex={memoNoteZIndex(project.boardPinned, zIndexById[project.id] ?? 1)}
                selected={selectedIds.has(project.id)}
                matched={matchingIds?.has(project.id) ?? false}
                dimmed={boardSearchActive && !(matchingIds?.has(project.id) ?? false)}
                hubAlert={hubMode && project.dueDate < today}
                onSelect={(additive) => selectItem(project.id, additive)}
                onDragEnd={(id, x, y) => handleItemDragEnd("project", id, x, y)}
                onToggleStage={(stageId) => toggleProjectStage(project, stageId)}
                onRemove={() => removeProject(project)}
                onToggleLock={() => toggleBoardLock("project", project.id, !!project.boardLocked)}
                onTogglePin={() => toggleBoardPin("project", project.id, !!project.boardPinned)}
                onFocus={() => bringToFront(project.id)}
                onOpenDetail={onOpenProjectEdit ? () => onOpenProjectEdit(project.id) : undefined}
              />
            ))}
            {/* スタンプは付箋やカードに重ねてくっ付けるものなので、DOM上でも一番手前(最後)に描く */}
            {(stamps ?? []).map((stamp) => {
              const pos = stampTargetPosition(stamp);
              return (
                <StampElement
                  key={stamp.id}
                  stamp={stamp}
                  x={pos.x}
                  y={pos.y}
                  zoom={zoom}
                  zIndex={BOARD_STAMP_Z_BASE + (zIndexById[stamp.id] ?? 1)}
                  onDragEnd={(id, dx, dy) => moveStamp(id, dx, dy, stamp.width, stamp.height)}
                  onResize={(id, width, height) => resizeStamp(id, width, height)}
                  onRemove={() => removeStamp(stamp.id)}
                  onColorChange={(color) => setStampColor(stamp.id, color)}
                  onTextChange={(text) => setStampText(stamp.id, text)}
                  onToggleLock={() => toggleStampLock(stamp.id, !!stamp.boardLocked)}
                  onFocus={() => bringToFront(stamp.id)}
                />
              );
            })}
          </div>
        </div>
      </div>
      {hubMode && <HubHudFrame now={now} />}
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

      {/* ハブモード専用。「ミッションコントロール」HUD。本日の完了率をリングで、
          総合ステータス・進行中/超過中/待機中の内訳・所定労働時間の残りを常駐表示する。
          盤面を見渡すだけで今の状況が一目でわかるようにする */}
      {hubMode && (
        <div className="panel hidden shrink-0 self-start p-2 sm:block" style={{ width: MINIMAP_WIDTH + 16 }}>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-[0.2em] text-cream/50">MISSION CONTROL</p>
            <span className="hub-rec-dot h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: "rgb(var(--accent-rgb))" }} />
          </div>
          {overallStatus && (
            <p
              className="mb-1.5 rounded border px-1.5 py-1 text-center text-[11px] font-bold tracking-wide"
              style={{
                borderColor: `rgb(var(--accent-rgb) / ${0.3 + overallStatus.level * 0.15})`,
                color: "rgb(var(--accent-rgb))",
                backgroundColor: `rgb(var(--accent-rgb) / ${0.06 + overallStatus.level * 0.05})`,
              }}
            >
              状況: {overallStatus.name}
            </p>
          )}
          <div className="relative flex items-center justify-center" style={{ width: MINIMAP_WIDTH }}>
            <RadialTimer
              progressPct={progressStats.totalCount > 0 ? (progressStats.doneCount / progressStats.totalCount) * 100 : 0}
              overEstimate={progressStats.overrunCount > 0}
              size={96}
            />
            <div className="absolute flex flex-col items-center">
              <span className="font-display text-lg font-bold tabular-nums text-cream">
                {progressStats.doneCount}/{progressStats.totalCount}
              </span>
              <span className="text-[9px] text-cream/50">完了</span>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10px] tabular-nums text-cream/60">
            {standardWorkEnd}まで残り {formatMsClock(progressStats.remainingMs)}
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[10px] tabular-nums">
            <div className="rounded bg-cream/5 py-1">
              <p className="text-cream/40">進行中</p>
              <p className="font-bold text-cream">{runningCount}</p>
            </div>
            <div className="rounded bg-cream/5 py-1">
              <p className="text-cream/40">超過中</p>
              <p className={`font-bold ${progressStats.overrunCount > 0 ? "text-alert" : "text-cream"}`}>
                {progressStats.overrunCount}
              </p>
            </div>
            <div className="rounded bg-cream/5 py-1">
              <p className="text-cream/40">待機中</p>
              <p className="font-bold text-cream">{waitingCount}</p>
            </div>
          </div>
          {/* 同じ盤面に出ているToDo・案件の状況。作業(上のリング)だけでは
              「期限が迫っているものが他に無いか」が分からなかった */}
          {boardStats && (
            <div className="mt-2 space-y-1.5 border-t border-cream/10 pt-2">
              <div>
                <div className="flex items-baseline justify-between">
                  <p className="text-[9px] font-bold tracking-[0.15em] text-cream/40">TODO</p>
                  <span className="text-[10px] tabular-nums text-cream/50">盤面 {boardStats.todoCount}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] tabular-nums">
                  <span className={`rounded px-1 py-0.5 ${boardStats.todoOverdue > 0 ? "bg-alert/15 font-bold text-alert" : "bg-cream/5 text-cream/50"}`}>
                    期限切れ {boardStats.todoOverdue}
                  </span>
                  <span className="rounded bg-cream/5 px-1 py-0.5 text-cream/60">本日 {boardStats.todoDueToday}</span>
                  <span className="rounded bg-cream/5 px-1 py-0.5 text-cream/60">残サブ {boardStats.openSubtasks}</span>
                </div>
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <p className="text-[9px] font-bold tracking-[0.15em] text-cream/40">案件</p>
                  <span className="text-[10px] tabular-nums text-cream/50">盤面 {boardStats.projectCount}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] tabular-nums">
                  <span className={`rounded px-1 py-0.5 ${boardStats.projectOverdue > 0 ? "bg-alert/15 font-bold text-alert" : "bg-cream/5 text-cream/50"}`}>
                    超過 {boardStats.projectOverdue}
                  </span>
                  <span className="rounded bg-cream/5 px-1 py-0.5 text-cream/60">残段階 {boardStats.openStages}</span>
                </div>
              </div>
              {boardStats.topTags.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold tracking-[0.15em] text-cream/40">対応状況</p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {boardStats.topTags.map(([tag, count]) => (
                      <span key={tag} className="flex items-center gap-0.5">
                        <InlineStamp text={tag} />
                        <span className="text-[10px] tabular-nums text-cream/50">{count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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

// ハブモード専用。統合ボードのビューポートに重ねる「ミッションコントロール」風のHUD枠。
// 四隅のコーナーマーク・上から下へ流れるスキャンライン・右上の稼働中インジケーター(時計)を
// 出すだけの飾りで、操作対象にはしない(pointer-events-none)。盤面のスクロール/ズームに
// 追従してほしくないため、呼び出し側でスクロールするビューポートの外側(兄弟)に置いている
function HubHudFrame({ now }: { now: number }) {
  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  const cornerBase = "absolute h-5 w-5 border-[rgb(var(--accent-rgb)/0.55)]";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
      <div className={`${cornerBase} left-1.5 top-1.5 border-l-2 border-t-2`} />
      <div className={`${cornerBase} right-1.5 top-1.5 border-r-2 border-t-2`} />
      <div className={`${cornerBase} bottom-1.5 left-1.5 border-b-2 border-l-2`} />
      <div className={`${cornerBase} bottom-1.5 right-1.5 border-b-2 border-r-2`} />
      <div
        className="hub-hud-scanline absolute left-0 h-px w-full"
        style={{ background: "linear-gradient(90deg, transparent, rgb(var(--accent-rgb) / 0.9), transparent)" }}
      />
      <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded bg-ink/70 px-1.5 py-0.5">
        <span className="hub-rec-dot h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "rgb(var(--accent-rgb))" }} />
        <span className="font-display text-[10px] tabular-nums tracking-wider text-cream/70">{clock}</span>
      </div>
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
  onTogglePin,
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
  onTogglePin: () => void;
  onFocus: () => void;
}) {
  const locked = !!shape.boardLocked;
  const pinned = !!shape.boardPinned;
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
        <button
          onClick={onTogglePin}
          className={`text-[11px] leading-none ${pinned ? "text-cream" : "text-cream/60 hover:text-cream"}`}
          title={pinned ? "最前面固定を解除する" : "最前面に固定する"}
          aria-pressed={pinned}
        >
          📌
        </button>
        <button onClick={onRemove} className="text-[11px] leading-none text-cream/60 hover:text-cream" title="図形を削除">
          ✕
        </button>
      </div>
    </div>
  );
}

// スタンプ(対応状況などの一言)。小さな丸ラベルで、ドラッグして他のアイテムに
// 重ねるとくっ付き(以後は対象にくっついて追従する)、何もない場所に離すと外れる。
// 図形と違って囲み用の飾りではなく、対象そのものに添える一言なので、ピン留め(最前面
// 固定)や向き変更・不透明度は持たない(対象が前面に来ればスタンプも自然に追従する)
function StampElement({
  stamp,
  x,
  y,
  zoom,
  zIndex,
  onDragEnd,
  onResize,
  onRemove,
  onColorChange,
  onTextChange,
  onToggleLock,
  onFocus,
}: {
  stamp: BoardStamp;
  x: number;
  y: number;
  zoom: number;
  zIndex: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onRemove: () => void;
  onColorChange: (color: string) => void;
  onTextChange: (text: string) => void;
  onToggleLock: () => void;
  onFocus: () => void;
}) {
  const locked = !!stamp.boardLocked;
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    stamp.width,
    stamp.height,
    zoom,
    (nx, ny) => onDragEnd(stamp.id, nx, ny),
    locked
  );
  const colors = MEMO_NOTE_COLORS[stamp.color] ?? MEMO_NOTE_COLORS[DEFAULT_BOARD_STAMP_COLOR];

  // 角のハンドルをドラッグしてサイズ変更できるようにする。移動と同じく、確定は
  // 離した時だけ行い(pointerup)、ドラッグ中はローカルのdeltaだけで見た目を動かす
  const [resizeDelta, setResizeDelta] = useState<{ dw: number; dh: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number } | null>(null);
  function clampStampWidth(w: number) {
    return Math.max(BOARD_STAMP_MIN_WIDTH, Math.min(BOARD_STAMP_MAX_WIDTH, w));
  }
  function clampStampHeight(h: number) {
    return Math.max(BOARD_STAMP_MIN_HEIGHT, Math.min(BOARD_STAMP_MAX_HEIGHT, h));
  }
  function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStartRef.current = { x: e.clientX, y: e.clientY };
    setResizeDelta({ dw: 0, dh: 0 });
  }
  function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    setResizeDelta({ dw: (e.clientX - start.x) / zoom, dh: (e.clientY - start.y) / zoom });
  }
  function handleResizePointerUp() {
    const start = resizeStartRef.current;
    resizeStartRef.current = null;
    if (start && resizeDelta) {
      onResize(stamp.id, clampStampWidth(stamp.width + resizeDelta.dw), clampStampHeight(stamp.height + resizeDelta.dh));
    }
    setResizeDelta(null);
  }
  const liveWidth = resizeDelta ? clampStampWidth(stamp.width + resizeDelta.dw) : stamp.width;
  const liveHeight = resizeDelta ? clampStampHeight(stamp.height + resizeDelta.dh) : stamp.height;
  // スタンプが大きいほど文字も大きく見せる(小さいままだと余白ばかりで間延びするため)
  const fontSizePx = Math.max(11, Math.min(34, Math.round(liveHeight * 0.34)));
  const rotationDeg = useMemo(() => stampRotationForKey(stamp.id), [stamp.id]);

  const [text, setText] = useState(stamp.text);
  const idRef = useRef(stamp.id);
  useEffect(() => {
    if (idRef.current !== stamp.id) {
      idRef.current = stamp.id;
      setText(stamp.text);
    }
  }, [stamp.id, stamp.text]);

  // 色・ロック・削除の操作パネルを常時出しっぱなしにすると、スタンプはくっ付け先の
  // 付箋やカードに重ねて使うものなので、その掴み手など他の操作と重なって邪魔になる。
  // そのため、ほとんど動かさずに離した(=タップした)時だけ開閉するようにする。
  // また、開いたままボードの他の場所を操作すると邪魔なままになってしまうため、
  // スタンプの外側をポインターダウンしたら自動で閉じる
  const [controlsOpen, setControlsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controlsOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setControlsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [controlsOpen]);

  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    tapStartRef.current = { x: e.clientX, y: e.clientY };
    onPointerDown(e);
  }
  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const start = tapStartRef.current;
    tapStartRef.current = null;
    onPointerUp();
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) {
      setControlsOpen((v) => !v);
    }
  }
  function handlePointerCancel() {
    tapStartRef.current = null;
    onPointerUp();
  }

  // つかんで動かす場所は、文字入力欄と誤操作しないよう左右の細い帯にする
  // (文字入力欄をタップ/クリックした時は編集だけを行い、ドラッグは始めない)
  const grabHandleClassName = locked
    ? "flex w-3 shrink-0 cursor-not-allowed items-center justify-center"
    : "flex w-3 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing";
  const grabHandleTitle = locked
    ? "ロック中です(タップして🔒で解除できます)"
    : "ドラッグして付箋やToDo・案件などに重ねるとくっ付きます(タップで色・ロック・削除)";
  const grabHandleProps = {
    className: grabHandleClassName,
    style: { touchAction: "none" as const },
    title: grabHandleTitle,
    onPointerDown: handlePointerDown,
    onPointerMove: onPointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
  };

  return (
    <div
      ref={wrapperRef}
      className="absolute"
      style={{ left, top, width: liveWidth, height: liveHeight, zIndex }}
      onPointerDownCapture={onFocus}
    >
      <div
        className="h-full w-full rounded-md border-[4px] border-double shadow-[0_1px_3px_rgba(0,0,0,0.4),0_0_7px_var(--stamp-glow),inset_0_0_5px_rgba(0,0,0,0.12)]"
        style={
          {
            borderColor: colors.border,
            backgroundColor: `${colors.border}40`,
            transform: `rotate(${rotationDeg}deg)`,
            "--stamp-glow": `${colors.border}66`,
          } as CSSProperties
        }
      >
        <div className="flex h-full w-full items-stretch overflow-hidden rounded-sm">
          <div {...grabHandleProps}>
            <span className="text-[9px] leading-none" style={{ color: colors.border, opacity: 0.7 }}>
              ⠿
            </span>
          </div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text !== stamp.text) onTextChange(text);
            }}
            className="w-0 flex-1 bg-transparent text-center font-bold uppercase leading-none tracking-wide outline-none"
            style={{ color: colors.border, fontSize: fontSizePx, textShadow: "0 1px 1px rgba(0,0,0,0.45)" }}
          />
          <div {...grabHandleProps}>
            <span className="text-[9px] leading-none" style={{ color: colors.border, opacity: 0.7 }}>
              ⠿
            </span>
          </div>
        </div>
      </div>
      {/* 右下の角をドラッグしてサイズ変更。ロック中は動かせないのと同様に無効化する */}
      {!locked && (
        <div
          className="absolute -bottom-1 -right-1 h-4 w-4 cursor-nwse-resize touch-none"
          style={{ touchAction: "none" }}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
          title="ドラッグでサイズ変更"
        >
          <svg width={12} height={12} viewBox="0 0 12 12" className="absolute bottom-0 right-0">
            <path d="M11 1 L1 11 M11 5 L5 11 M11 9 L9 11" stroke={colors.border} strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </div>
      )}
      {controlsOpen && (
        <div className="absolute -top-6 left-0 flex items-center gap-1 whitespace-nowrap rounded bg-ink/85 px-1 py-0.5">
          {Object.entries(MEMO_NOTE_COLORS).map(([key, c]) => (
            <button
              key={key}
              onClick={() => onColorChange(key)}
              className="h-3 w-3 shrink-0 rounded-full border"
              style={{ backgroundColor: c.border, borderColor: stamp.color === key ? "#f2f2f0" : "transparent" }}
              aria-label={`色を${key}にする`}
            />
          ))}
          <button
            onClick={onToggleLock}
            className={`text-[11px] leading-none ${locked ? "text-cream" : "text-cream/60 hover:text-cream"}`}
            title={locked ? "ロックを解除する" : "ロックする(くっ付けの解除・ドラッグを防ぐ)"}
          >
            {locked ? "🔒" : "🔓"}
          </button>
          <button onClick={onRemove} className="text-[11px] leading-none text-cream/60 hover:text-cream" title="スタンプを削除">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ToDoの「対応状況」(tag)を、手で貼らなくても自動でスタンプ風に可視化するための読み取り専用
// バッジ。手動のスタンプ(StampElement/BoardStamp)と見た目を揃えつつ、ドラッグ・色変更・
// 削除などの操作対象にはしない(対応状況そのものはToDoタブ側で変える)。カードの左上の角に
// 少しはみ出すように重ねて出す
function TagStatusBadge({ text, x, y, zIndex }: { text: string; x: number; y: number; zIndex: number }) {
  const colors = MEMO_NOTE_COLORS[stampColorForText(text)];
  const rotationDeg = stampRotationForKey(text);
  return (
    <div className="pointer-events-none absolute" style={{ left: x - 10, top: y - 10, zIndex }}>
      <div
        className="whitespace-nowrap rounded-md border-[4px] border-double px-2 py-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.4),0_0_7px_var(--stamp-glow),inset_0_0_5px_rgba(0,0,0,0.12)]"
        style={
          {
            borderColor: colors.border,
            backgroundColor: `${colors.border}40`,
            transform: `rotate(${rotationDeg}deg)`,
            "--stamp-glow": `${colors.border}66`,
          } as CSSProperties
        }
      >
        <span
          className="text-[11px] font-bold uppercase leading-none tracking-wide"
          style={{ color: colors.border, textShadow: "0 1px 1px rgba(0,0,0,0.45)" }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

// カードの行の中に置く小さなスタンプ。盤面に浮かぶTagStatusBadgeと同じ
// 「押した判子」の見た目(二重枠・文字色と同系の下地・わずかな傾き)を、
// 行内に収まるサイズで再現する。対応状況・完了のどちらにも使う
function InlineStamp({ text, tone }: { text: string; tone?: "done" }) {
  const colors = MEMO_NOTE_COLORS[stampColorForText(text)];
  // 完了は作業が終わった印なので、対応状況のような色分けをせず常に同じ見た目にする
  const color = tone === "done" ? "rgb(var(--cream-rgb) / 0.55)" : colors.border;
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-[3px] border-2 border-double px-1 text-[8px] font-bold uppercase leading-[1.4] tracking-wide"
      style={{
        borderColor: color,
        color,
        backgroundColor: tone === "done" ? "transparent" : `${colors.border}33`,
        transform: `rotate(${stampRotationForKey(text) / 2}deg)`,
      }}
    >
      {text}
    </span>
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
  onResize,
  onColorChange,
  onTextColorChange,
  onToggleAutoSize,
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
  onResize: (id: string, width: number, height: number) => void;
  onColorChange: (id: string, color: string) => void;
  onTextColorChange: (id: string, color: string) => void;
  onToggleAutoSize: () => void;
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
  // 自動サイズON中は、文字量(チェックリストなら項目数)が変わるたびに幅・高さを
  // 実際の中身に合わせて増減させる。OFF中は従来通り(はみ出した時だけ自動拡大)のまま
  useEffect(() => {
    if (!note.autoSize) return;
    let targetWidth: number;
    let targetHeight: number;
    if (note.isChecklist) {
      targetWidth = estimateAutoChecklistNoteWidth(note.checklistItems ?? [], memoChecklistItemFont());
      targetHeight = estimateChecklistNoteHeight((note.checklistItems ?? []).length);
    } else {
      const size = estimateAutoTextNoteSize(text, memoNoteTextFont());
      targetWidth = size.width;
      targetHeight = size.height;
    }
    if (Math.abs(targetWidth - note.width) > 1 || Math.abs(targetHeight - note.height) > 1) {
      onResize(note.id, targetWidth, targetHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.autoSize, note.isChecklist, note.checklistItems, text, note.width]);
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
      <div className="flex shrink-0 flex-wrap items-center gap-1 px-1.5 pb-1 pt-1">
        {Object.keys(MEMO_NOTE_COLORS).map((c) => (
          <button
            key={c}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onColorChange(note.id, c);
            }}
            className={`h-3 w-3 shrink-0 rounded-full border ${note.color === c ? "border-ink" : "border-ink/20"}`}
            style={{ backgroundColor: MEMO_NOTE_COLORS[c].bg }}
            aria-label={`付箋の色を${c}にする`}
          />
        ))}
        <span className="mx-0.5 h-3 w-px bg-ink/20" />
        {Object.keys(MEMO_NOTE_TEXT_COLORS).map((c) => (
          <button
            key={c}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onTextColorChange(note.id, c);
            }}
            className={`h-3 w-3 shrink-0 rounded-full border ${
              (note.textColor ?? DEFAULT_MEMO_NOTE_TEXT_COLOR) === c ? "border-ink" : "border-ink/20"
            }`}
            style={{ backgroundColor: MEMO_NOTE_TEXT_COLORS[c] }}
            aria-label={`文字色を${c}にする`}
          />
        ))}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleAutoSize();
          }}
          className={`ml-auto text-[9px] leading-none ${note.autoSize ? "font-bold text-ink" : "text-ink/40 hover:text-ink/70"}`}
          title={note.autoSize ? "自動サイズ調整をやめる(手動で高さを調整できるようにする)" : "文字量に応じて高さを自動で合わせる"}
          aria-pressed={!!note.autoSize}
        >
          ↕自動
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // 自動サイズON中は上のuseEffectが高さを合わせるので、ここでは何もしない。
          // OFF中は従来通り、入力中の文章がはみ出した分だけ自動で高さを広げる
          if (note.autoSize) return;
          const ta = e.target;
          const overflow = ta.scrollHeight - ta.clientHeight;
          if (overflow > 2) {
            onGrow(note.id, Math.min(MEMO_BOARD_HEIGHT - note.y, note.height + overflow));
          }
        }}
        onBlur={() => onCommitText(note, text)}
        style={{ color: MEMO_NOTE_TEXT_COLORS[note.textColor ?? DEFAULT_MEMO_NOTE_TEXT_COLOR] }}
        className="min-h-0 flex-1 resize-none bg-transparent px-2 pb-2 text-sm outline-none"
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
  riskLevel,
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
  onTogglePin,
  onFocus,
}: {
  task: DailyTask;
  now: number;
  zoom: number;
  /** ハブモードの負荷ヒートマップ用。超過度合いの階級(0=順調〜4=要再編成)。対象外はnull */
  riskLevel: number | null;
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
  onTogglePin: () => void;
  onFocus: () => void;
}) {
  const locked = !!task.boardLocked;
  const pinned = !!task.boardPinned;
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

  // ハブモード専用。超過度合いが「押され気味」以上(レベル3〜4)まで来たタスクだけ、
  // 地色の負荷ヒートマップに加えてパルスする縁取りで強調し、盤面を一目見ただけで
  // 「今すぐ見るべきカード」が分かるようにする
  const criticalAlert = riskLevel !== null && riskLevel >= 3;
  return (
    <div
      className={`absolute flex flex-col gap-1 rounded-md border-2 bg-ink/90 p-2 shadow-md ${
        running ? "border-alert" : "border-cream/20"
      } ${criticalAlert ? "hub-card-alert" : ""}`}
      style={{ left, top, width: CARD_WIDTH, height: TASK_CARD_HEIGHT, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
      onPointerDownCapture={onFocus}
      onClick={(e) => onSelect(e.shiftKey)}
    >
      {/* ハブモードの負荷ヒートマップ。超過度合いが大きいほど濃い赤に近づく色温度で
          強調する。負のz-indexで、カード自体の地色の上・中身の文字の下に敷く */}
      {riskLevel !== null && (
        <div
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{ zIndex: -1, backgroundColor: `rgba(var(--accent-rgb), ${0.1 + riskLevel * 0.09})` }}
          title={`超過度合い: レベル${riskLevel}`}
        />
      )}
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
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          className={`text-[11px] leading-none ${pinned ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
          title={pinned ? "最前面固定を解除する" : "最前面に固定する"}
          aria-pressed={pinned}
        >
          📌
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
  subtasks,
  zoom,
  zIndex,
  selected,
  matched,
  dimmed,
  hubAlert,
  onSelect,
  onDragEnd,
  onComplete,
  onToggleSubtask,
  onRemove,
  onToggleLock,
  onTogglePin,
  onFocus,
  onOpenDetail,
}: {
  todo: TodoTask;
  today: string;
  /** サブタスクを持つ場合の完了/全体件数。持たない単発のタスクならnull */
  subtaskStat: { done: number; total: number } | null;
  /** このタスクのサブタスク(未完了が先)。カードの中に直下で並べる */
  subtasks: TodoTask[];
  zoom: number;
  zIndex: number;
  selected: boolean;
  matched: boolean;
  dimmed: boolean;
  /** ハブモード専用。期限切れの時だけtrueになり、縁取りをパルスさせる */
  hubAlert: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onComplete: () => void;
  onToggleSubtask: (sub: TodoTask) => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onTogglePin: () => void;
  onFocus: () => void;
  /** 件名を押した時に、ToDoタブでこの項目の詳細を開く。未指定なら件名はただの文字のまま */
  onOpenDetail?: () => void;
}) {
  const locked = !!todo.boardLocked;
  const pinned = !!todo.boardPinned;
  // 実際の位置は自動配置useEffectがboardX/boardYへ即座に割り当てるため、
  // ここでの初期値は割り当てが反映されるまでの一瞬だけ使われる仮の位置
  const x = todo.boardX ?? 40;
  const y = todo.boardY ?? 40;
  const cardHeight = computeTodoCardHeight(subtasks.length);
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    CARD_WIDTH,
    cardHeight,
    zoom,
    (nx, ny) => onDragEnd(todo.id, nx, ny),
    locked
  );
  const overdue = !!todo.dueDate && todo.dueDate < today;

  return (
    // ToDoは「チェックして潰していく紙片」。角を大きめに丸め、左端に細い帯を通して、
    // 角ばった書類然とした案件カード(下のProjectCard)とひと目で見分けられるようにする
    <div
      className={`absolute flex flex-col gap-1 overflow-hidden rounded-xl border-2 border-l-[6px] bg-ink/90 p-2 pl-2.5 shadow-md ${
        overdue ? "border-alert/70" : "border-cream/20 border-l-cream/45"
      } ${hubAlert ? "hub-card-alert" : ""}`}
      style={{ left, top, width: CARD_WIDTH, height: cardHeight, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
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
        className={`absolute right-11 top-0.5 text-[11px] leading-none ${locked ? "text-cream" : "text-cream/35 hover:text-cream"}`}
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
        className={`absolute right-6 top-0.5 text-[11px] leading-none ${pinned ? "text-cream" : "text-cream/35 hover:text-cream"}`}
        title={pinned ? "最前面固定を解除する" : "最前面に固定する"}
        aria-pressed={pinned}
      >
        📌
      </button>
      <BoardRemoveButton onRemove={onRemove} title="ボードから下げる（マイデイからも外れます。ToDo自体は消えません）" />
      <div className={`flex items-start gap-2 ${subtasks.length > 0 ? "shrink-0" : "flex-1"}`}>
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
        <div className="flex shrink-0 flex-wrap items-center gap-x-1.5 text-[10px]">
          {todo.dueDate && (
            <span className={overdue ? "font-bold text-alert" : "text-cream/40"}>
              期日 {todo.dueDate}
              {overdue && "（超過）"}
            </span>
          )}
          {subtaskStat && (
            <span className="ml-auto shrink-0 tabular-nums text-cream/50">
              {subtaskStat.done}/{subtaskStat.total}
            </span>
          )}
        </div>
      )}
      {/* サブタスクを直下に並べる。案件カードの段階と同じく、その場で押して完了に
          できるようにし、対応状況(tag)と完了はスタンプで示す */}
      {subtasks.length > 0 && (
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {subtasks.map((sub) => (
            <button
              key={sub.id}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSubtask(sub);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-left hover:bg-cream/10"
              title={sub.completed ? "未完了に戻す" : "このサブタスクを完了にする"}
            >
              <span
                className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border text-[8px] leading-none ${
                  sub.completed ? "border-cream/40 bg-cream/25 text-cream/70" : "border-cream/40"
                }`}
              >
                {sub.completed ? "✓" : ""}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-[11px] ${
                  sub.completed ? "text-cream/35 line-through" : "text-cream/80"
                }`}
              >
                {sub.title}
              </span>
              {sub.completed ? <InlineStamp text="済" tone="done" /> : sub.tag ? <InlineStamp text={sub.tag} /> : null}
            </button>
          ))}
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
  hubAlert,
  onSelect,
  onDragEnd,
  onToggleStage,
  onRemove,
  onToggleLock,
  onTogglePin,
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
  /** ハブモード専用。期日超過の時だけtrueになり、縁取りをパルスさせる */
  hubAlert: boolean;
  onSelect: (additive: boolean) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onToggleStage: (stageId: string) => void;
  onRemove: () => void;
  onToggleLock: () => void;
  onTogglePin: () => void;
  onFocus: () => void;
  /** 件名を押した時に、案件タブでこの案件の編集を開く。未指定なら件名はただの文字のまま */
  onOpenDetail?: () => void;
}) {
  const locked = !!project.boardLocked;
  const pinned = !!project.boardPinned;
  const x = project.boardX ?? 40;
  const y = project.boardY ?? 40;
  const stages = project.stages ?? [];
  // 残っている段階の数に応じて、カード自体の高さを伸ばす(できるだけスクロールせず
  // 全部見えるようにする)。段階が非常に多い場合のみ、上限を超えた分がカード内
  // スクロールになる(computeProjectCardHeightの上限を参照)
  const cardHeight = computeProjectCardHeight(project);
  const { left, top, onPointerDown, onPointerMove, onPointerUp } = useBoardDrag(
    x,
    y,
    CARD_WIDTH,
    cardHeight,
    zoom,
    (nx, ny) => onDragEnd(project.id, nx, ny),
    locked
  );
  const doneCount = stages.filter(isStageDone).length;
  const progress = computeProjectProgress(stages);
  const overdue = project.dueDate < today;
  const nextStages = stages.filter((st) => !isStageDone(st));

  return (
    // 案件は「期日まで段階を踏んでいく書類」。角を立て、上辺にアクセント色の見出し帯を
    // 通して、角丸で左に帯が入るToDoカードとひと目で見分けられるようにする
    <div
      className={`absolute flex flex-col gap-1 overflow-hidden rounded-sm border-2 border-t-[5px] bg-ink/90 p-2 shadow-md ${
        overdue ? "border-alert/70" : "border-cream/20 border-t-[rgb(var(--accent-rgb)/0.65)]"
      } ${hubAlert ? "hub-card-alert" : ""}`}
      style={{ left, top, width: CARD_WIDTH, height: cardHeight, zIndex, ...boardItemVisualStyle(selected, matched, dimmed) }}
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
        className={`absolute right-11 top-0.5 text-[11px] leading-none ${locked ? "text-cream" : "text-cream/35 hover:text-cream"}`}
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
        className={`absolute right-6 top-0.5 text-[11px] leading-none ${pinned ? "text-cream" : "text-cream/35 hover:text-cream"}`}
        title={pinned ? "最前面固定を解除する" : "最前面に固定する"}
        aria-pressed={pinned}
      >
        📌
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
