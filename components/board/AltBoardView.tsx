import { useMemo } from "react";
import { buildBoardViewItems, type BoardViewItem } from "@/lib/boardViewItems";
import type { BoardViewMode } from "@/lib/boardViewModes";
import type { DailyTask, ProjectItem, TodoTask } from "@/lib/types";
import { EmptyBoardState } from "./views/shared";
import IslandsView from "./views/IslandsView";
import StarsView from "./views/StarsView";
import ShelfView from "./views/ShelfView";
import IcebergView from "./views/IcebergView";
import TreemapView from "./views/TreemapView";
import TicketsView from "./views/TicketsView";
import MetroView from "./views/MetroView";
import MosaicView from "./views/MosaicView";
import GardenView from "./views/GardenView";
import CityView from "./views/CityView";

// 統合ボードの「ボード」以外の表示切替タブ本体。同じ(ボードに置いた)ToDo・案件・
// 本日の作業を、モードごとに全く違う見た目で並べ直すだけの読み取り+詳細オープン専用ビュー。
// ドラッグ配置・付箋/図形の編集は既存の「ボード」表示のときだけ行う
export default function AltBoardView({
  mode,
  todos,
  projects,
  boardTasks,
  subtaskStats,
  subtasksByParent,
  tagOptions,
  today,
  onOpenTodo,
  onOpenProject,
}: {
  mode: Exclude<BoardViewMode, "board">;
  todos: TodoTask[];
  projects: ProjectItem[];
  boardTasks: DailyTask[];
  subtaskStats: Map<string, { done: number; total: number }>;
  subtasksByParent: Map<string, TodoTask[]>;
  tagOptions: string[];
  today: string;
  onOpenTodo: (id: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const items = useMemo(
    () => buildBoardViewItems({ todos, projects, boardTasks, subtaskStats, subtasksByParent, tagOptions, today }),
    [todos, projects, boardTasks, subtaskStats, subtasksByParent, tagOptions, today]
  );

  function onOpen(item: BoardViewItem) {
    if (item.kind === "todo" && item.todo) onOpenTodo(item.todo.id);
    else if (item.kind === "project" && item.project) onOpenProject(item.project.id);
  }

  if (items.length === 0) return <EmptyBoardState />;

  const props = { items, onOpen, today };
  switch (mode) {
    case "islands":
      return <IslandsView {...props} />;
    case "stars":
      return <StarsView {...props} />;
    case "shelf":
      return <ShelfView {...props} />;
    case "iceberg":
      return <IcebergView {...props} />;
    case "treemap":
      return <TreemapView {...props} />;
    case "tickets":
      return <TicketsView {...props} />;
    case "metro":
      return <MetroView {...props} />;
    case "mosaic":
      return <MosaicView {...props} />;
    case "garden":
      return <GardenView {...props} />;
    case "city":
      return <CityView {...props} />;
    default:
      return null;
  }
}
