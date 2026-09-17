import { db } from "./db";
import { todayStr } from "./time";
import { MEMO_BOARD_WIDTH, MEMO_BOARD_HEIGHT } from "./memo";
import { isStageDone } from "./projectStage";
import type { ProjectItem } from "./types";

// 統合ボード上のカードサイズ・空き場所探索。UnifiedBoardSection自身のレイアウトと、
// ToDo/案件タブから「ボードに置く」した際の初期位置決めの両方で使う共通の定義
export const BOARD_CARD_WIDTH = 220;
const BOARD_TASK_CARD_HEIGHT = 110;
const TODO_CARD_HEIGHT = 90;
const PROJECT_CARD_MIN_HEIGHT = 132;
const PROJECT_CARD_MAX_HEIGHT = 480;
const PROJECT_CARD_CHROME_HEIGHT = 102;
const PROJECT_CARD_STAGE_ROW_HEIGHT = 22;
const TODO_CARD_SUBTASK_ROW_HEIGHT = 22;
const TODO_CARD_MAX_HEIGHT = 420;
const TODO_CARD_IMAGE_HEIGHT = 72;
const PLACEMENT_GRID = 30;
export const PLACEMENT_MARGIN = 10;

export function computeProjectCardHeight(project: ProjectItem, showCompletedStages: boolean): number {
  const stages = project.stages ?? [];
  const count = showCompletedStages ? stages.length : stages.filter((st) => !isStageDone(st)).length;
  const fit = PROJECT_CARD_CHROME_HEIGHT + count * PROJECT_CARD_STAGE_ROW_HEIGHT;
  return Math.max(PROJECT_CARD_MIN_HEIGHT, Math.min(PROJECT_CARD_MAX_HEIGHT, fit));
}

export function computeTodoCardHeight(subtaskCount: number, hasImage: boolean): number {
  const base = TODO_CARD_HEIGHT + (hasImage ? TODO_CARD_IMAGE_HEIGHT : 0);
  if (subtaskCount === 0) return base;
  return Math.min(TODO_CARD_MAX_HEIGHT, base + subtaskCount * TODO_CARD_SUBTASK_ROW_HEIGHT);
}

export interface BoardRect {
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

// 既存のカード(付箋・本日の作業・ToDo・案件)と重ならない置き場所を、盤面を左上から
// 走査して探す。手動でドラッグして重ねるのは自由なままにしたいので、この関数は
// 「まだ位置が決まっていない新規カード」の初期配置にだけ使う
export function findFreeSlot(occupied: BoardRect[], width: number, height: number): { x: number; y: number } {
  for (let y = 20; y <= MEMO_BOARD_HEIGHT - height; y += PLACEMENT_GRID) {
    for (let x = 20; x <= MEMO_BOARD_WIDTH - width; x += PLACEMENT_GRID) {
      const candidate: BoardRect = { x, y, width, height };
      if (!occupied.some((r) => rectsOverlap(candidate, r))) return { x, y };
    }
  }
  // 盤面が埋まりきっている場合(通常はまず起きない)は右下に寄せて返す
  return { x: MEMO_BOARD_WIDTH - width, y: MEMO_BOARD_HEIGHT - height };
}

// ToDoタブ・案件タブから「ボードに置く」した時点の盤面の状態を、DBから直接読んで
// 空き場所を探す。UnifiedBoardSectionを開いていなくても(裏で)置けるようにするため、
// useLiveQuery(React hooks)ではなく素の一回読みで組み立てる
async function currentOccupiedRects(): Promise<BoardRect[]> {
  const today = todayStr();
  const [notes, shapes, dailyTasks, todos, projects, showCompletedSetting] = await Promise.all([
    db.memoNotes.toArray(),
    db.boardShapes.toArray(),
    db.dailyTasks.where("date").equals(today).toArray(),
    db.todoTasks.toArray(),
    db.projects.toArray(),
    db.settings.get("projects.showCompletedStages"),
  ]);
  const showCompletedStages = (showCompletedSetting?.value ?? "true") === "true";

  const rects: BoardRect[] = [];
  for (const n of notes) rects.push({ x: n.x, y: n.y, width: n.width, height: n.height });
  for (const s of shapes) rects.push({ x: s.x, y: s.y, width: s.width, height: s.height });
  for (const t of dailyTasks) {
    if (t.isProvisional || t.status === "done") continue;
    if (t.boardX === undefined || t.boardY === undefined) continue;
    rects.push({ x: t.boardX, y: t.boardY, width: BOARD_CARD_WIDTH, height: BOARD_TASK_CARD_HEIGHT });
  }
  const subtaskCountByParent = new Map<string, number>();
  for (const t of todos) {
    if (t.parentTaskId) subtaskCountByParent.set(t.parentTaskId, (subtaskCountByParent.get(t.parentTaskId) ?? 0) + 1);
  }
  for (const t of todos) {
    if (t.boardX === undefined || t.boardY === undefined) continue;
    const subtaskCount = subtaskCountByParent.get(t.id) ?? 0;
    rects.push({
      x: t.boardX,
      y: t.boardY,
      width: BOARD_CARD_WIDTH,
      height: computeTodoCardHeight(subtaskCount, !!t.imageDataUrl),
    });
  }
  for (const p of projects) {
    if (p.boardX === undefined || p.boardY === undefined) continue;
    rects.push({ x: p.boardX, y: p.boardY, width: BOARD_CARD_WIDTH, height: computeProjectCardHeight(p, showCompletedStages) });
  }
  return rects;
}

// ToDoタブ・案件タブから直接呼べる「統合ボードに置く/外す」。ボードを開かなくても
// 使えるよう、位置決め〜DB更新まで単体で完結させている(UnifiedBoardSection側の
// placeTodo/placeProject/removeTodo/removeProjectと同じ考え方)
export async function placeTodoOnBoard(todoId: string): Promise<void> {
  const todo = await db.todoTasks.get(todoId);
  if (!todo) return;
  const subtaskCount = await db.todoTasks.where("parentTaskId").equals(todoId).count();
  const height = computeTodoCardHeight(subtaskCount, !!todo.imageDataUrl);
  const pos = findFreeSlot(await currentOccupiedRects(), BOARD_CARD_WIDTH, height);
  await db.todoTasks.update(todoId, { boardX: pos.x, boardY: pos.y, boardHidden: false });
}

export async function removeTodoFromBoard(todoId: string): Promise<void> {
  await db.todoTasks.update(todoId, { boardX: undefined, boardY: undefined, myDayDate: undefined, boardHidden: true });
}

export async function placeProjectOnBoard(projectId: string): Promise<void> {
  const project = await db.projects.get(projectId);
  if (!project) return;
  const showCompletedSetting = await db.settings.get("projects.showCompletedStages");
  const showCompletedStages = (showCompletedSetting?.value ?? "true") === "true";
  const height = computeProjectCardHeight(project, showCompletedStages);
  const pos = findFreeSlot(await currentOccupiedRects(), BOARD_CARD_WIDTH, height);
  await db.projects.update(projectId, { boardX: pos.x, boardY: pos.y });
}

export async function removeProjectFromBoard(projectId: string): Promise<void> {
  await db.projects.update(projectId, { boardX: undefined, boardY: undefined });
}
