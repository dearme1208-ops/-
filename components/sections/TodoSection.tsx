"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { db, uid } from "@/lib/db";
import {
  completeTodoTask,
  computeDateOrderedPosition,
  DEFAULT_TAG_PRESETS,
  effectiveDueDate,
  parsePresetList,
  upsertTodoFromCsv,
} from "@/lib/todo";
import { todoTasksToCsv, todoCsvTemplate, parseTodoCsv } from "@/lib/todoCsv";
import { downloadTextFile } from "@/lib/report";
import { useSetting } from "@/lib/settings";
import { cardOverrunClass, emphasisTextClass, useVisualMode } from "@/lib/theme";
import {
  daysBetweenDateStrs,
  todayStr,
  formatDateJp,
  formatDateTimeJp,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/time";
import { findOrCreateMasterTask } from "@/lib/master";
import { computeRemainingEstimatedSeconds } from "@/lib/tasks";
import type { DailyTask, MemoNote, ProjectItem, RecurrenceRule, RecurrenceType, TodoList, TodoTask } from "@/lib/types";
import { RECURRENCE_TYPE_LABELS, WEEKDAY_JP, ORDINAL_LABELS } from "@/lib/types";
import { DEFAULT_MEMO_NOTE_COLOR, estimateChecklistNoteHeight, estimateTextNoteHeight } from "@/lib/memo";
import Modal from "@/components/ui/Modal";
import TodoCalendarView from "@/components/sections/TodoCalendarView";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";
import type { TreeNode, TreeNodeBadge } from "@/components/ui/TreeView";
import PedigreeTable from "@/components/ui/PedigreeTable";
import { showUndoToast } from "@/lib/toast";
import BottomTabBar, { type TabBarStyle } from "@/components/ui/BottomTabBar";

const DEFAULT_LIST_TITLE = "タスク";
const CUSTOM_TAG_VALUE = "__custom__";
const NO_TAG_VALUE = "";
const CUSTOM_CATEGORY_VALUE = "__custom__";
const NO_CATEGORY_VALUE = "";
const CUSTOM_CUSTOMER_VALUE = "__custom__";
const NO_CUSTOMER_VALUE = "";
const KANBAN_UNSET = "__unset__";

const DEFAULT_PX_PER_DAY = 28;
const MIN_PX_PER_DAY = 0.3;
const MAX_PX_PER_DAY = 80;
const ROW_H = 40;
const MIN_LABEL_SPACING_PX = 50;

type ViewKey = "myday" | "important" | "planned" | "overdue" | `list:${string}`;
type DisplayMode = "list" | "gantt" | "calendar" | "kanban" | "tree";

// リスト内の並び替え。「手動」はドラッグ&ドロップで決めたorder順、それ以外は
// 選んだ項目でその都度並べ替える(手動の並び順自体は保持され、いつでも「手動」に戻せる)
type TodoSortMode = "manual" | "category" | "title" | "customer" | "dueDate" | "important" | "status";

const TODO_SORT_MODE_LABELS: Record<TodoSortMode, string> = {
  manual: "手動(ドラッグ&ドロップ)",
  category: "分類名順",
  title: "タスク名順",
  customer: "客先名順",
  dueDate: "期日順",
  important: "重要度順",
  status: "対応状況順",
};

// 日本語のロケール比較。空欄は常に末尾に回す
function compareJaOrBlankLast(a: string | undefined, b: string | undefined): number {
  const av = a?.trim() || null;
  const bv = b?.trim() || null;
  if (av === bv) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return av.localeCompare(bv, "ja");
}

// 対応状況(tag)は設定タブで並び替え可能なプリセット(社内確認中→客先確認中→…)を持つため、
// 名前順ではなくそのプリセットの並び順で比較する。プリセットに無いカスタム値は末尾側(名前順)、
// 未設定は常に最後
function compareStatusTag(a: string | undefined, b: string | undefined, statusOrder: string[]): number {
  const av = a?.trim() || null;
  const bv = b?.trim() || null;
  if (av === bv) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const ai = statusOrder.indexOf(av);
  const bi = statusOrder.indexOf(bv);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return av.localeCompare(bv, "ja");
}

function compareTodoTasksBySortMode(a: TodoTask, b: TodoTask, mode: TodoSortMode, statusOrder: string[]): number {
  switch (mode) {
    case "category":
      return compareJaOrBlankLast(a.category, b.category);
    case "title":
      return compareJaOrBlankLast(a.title, b.title);
    case "customer":
      return compareJaOrBlankLast(a.customer, b.customer);
    case "dueDate":
      return compareJaOrBlankLast(a.dueDate, b.dueDate);
    case "important":
      return Number(b.important) - Number(a.important);
    case "status":
      return compareStatusTag(a.tag, b.tag, statusOrder);
    default:
      return 0;
  }
}

interface SavedTodoView {
  id: string;
  name: string;
  filterTag: string;
  filterCategory: string;
  filterCustomer: string;
  // 対応状況を複数指定してOR条件で絞り込みたい場合に使う(単一のfilterTagでは表せない)。
  // 指定がある場合はfilterTagより優先される
  filterTags?: string[];
}
type KanbanAxis = "tag" | "category";

// 「対応中・客先確認中・社内確認中」だけを自動抽出するビューを、初回起動時に一度だけ
// 自動生成しておく。以後ユーザーが削除しても復活しないよう、生成済みかどうかは
// 別のフラグ(todo.autoStatusViewSeeded)で管理する
const AUTO_STATUS_VIEW_TAGS = ["対応中", "客先確認中", "社内確認中"];
const AUTO_STATUS_VIEW_NAME = "対応中・確認中";

// スキームなしで貼られたURL（例: example.com）もリンクボタンから開けるよう補う
function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export default function TodoSection({
  initialDetailTaskId,
  onInitialDetailConsumed,
}: {
  // 他タブ(期日リマインダーポップアップ等)から「このタスクの詳細を開いた状態でToDoタブを表示したい」
  // という要求を受け取るための初期値。consumeされたら親側でnullに戻してもらう
  initialDetailTaskId?: string | null;
  onInitialDetailConsumed?: () => void;
} = {}) {
  const [view, setView] = useState<ViewKey>("myday");
  const [bottomViewBarStr] = useSetting("todo.bottomViewBar", "false");
  const bottomViewBar = bottomViewBarStr === "true";
  const [tabBarStyle] = useSetting("ui.bottomTabBarStyle", "pill");
  const [tabBarAdaptiveEmphasisStr] = useSetting("ui.bottomTabBarAdaptiveEmphasis", "false");
  const tabBarAdaptiveEmphasis = tabBarAdaptiveEmphasisStr === "true";
  const [displayMode, setDisplayMode] = useState<DisplayMode>("list");
  const [showNewList, setShowNewList] = useState(false);
  const [newListTitle, setNewListTitle] = useState("");
  // タスク追加フォームは既定で畳んでおき、「+ タスクを追加」ボタンで必要な入力欄を
  // まとめて開く(常時表示だと入力欄が多く、狭い画面では特に圧迫感があったため)
  const [showAddTaskForm, setShowAddTaskForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  // タスク追加欄でどのリストに追加するかを選べるようにする。閲覧中のビューが特定の
  // リストに紐付いていない(マイデイ・重要・期日・期限切れ・検索結果)場合、既定では
  // 先頭のリストに入ってしまうため、明示的に選び直せるようにしておく
  const [newTaskListId, setNewTaskListId] = useState("");
  const [newTaskAction, setNewTaskAction] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskTagMode, setNewTaskTagMode] = useState<string>(NO_TAG_VALUE);
  const [newTaskCustomTag, setNewTaskCustomTag] = useState("");
  const [newTaskCategoryMode, setNewTaskCategoryMode] = useState<string>(NO_CATEGORY_VALUE);
  const [newTaskCustomCategory, setNewTaskCustomCategory] = useState("");
  const [newTaskCustomerMode, setNewTaskCustomerMode] = useState<string>(NO_CUSTOMER_VALUE);
  const [newTaskCustomCustomer, setNewTaskCustomCustomer] = useState("");
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTag, setFilterTag] = useState("");
  // 対応状況を複数選んでOR条件で絞り込むビュー(保存済みビューから適用された場合のみ使う)。
  // 単一選択のfilterTagとは独立して持ち、どちらか一方だけが有効になる
  const [filterTagsMulti, setFilterTagsMulti] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterCustomer, setFilterCustomer] = useState("");
  // 対応状況・分類・客先の組み合わせに名前を付けて保存し、1タップで呼び出せるようにする
  const [savedViewsJson, setSavedViewsJson] = useSetting("todo.savedViews", "[]");
  const savedViews: SavedTodoView[] = useMemo(() => {
    try {
      const parsed = JSON.parse(savedViewsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [savedViewsJson]);
  function saveCurrentAsView() {
    const name = prompt("この条件に名前を付けて保存します");
    if (!name || !name.trim()) return;
    const view: SavedTodoView =
      filterTagsMulti.length > 0
        ? { id: uid(), name: name.trim(), filterTag: "", filterCategory, filterCustomer, filterTags: filterTagsMulti }
        : { id: uid(), name: name.trim(), filterTag, filterCategory, filterCustomer };
    setSavedViewsJson(JSON.stringify([...savedViews, view]));
  }
  function applySavedView(view: SavedTodoView) {
    if (view.filterTags && view.filterTags.length > 0) {
      setFilterTagsMulti(view.filterTags);
      setFilterTag("");
    } else {
      setFilterTagsMulti([]);
      setFilterTag(view.filterTag);
    }
    setFilterCategory(view.filterCategory);
    setFilterCustomer(view.filterCustomer);
  }
  function deleteSavedView(id: string) {
    setSavedViewsJson(JSON.stringify(savedViews.filter((v) => v.id !== id)));
  }

  // 初回起動時のみ、「対応中・客先確認中・社内確認中」を自動抽出する保存済みビューを
  // 1つ用意しておく。生成済みフラグを見ているので、ユーザーが後で削除しても復活しない。
  // db.settings.get()はキー未設定時もundefinedを返すため、useLiveQueryの戻り値だけでは
  // 「読み込み中」と「未設定」を区別できない。1回限りのasync effectでawaitの完了そのものを
  // 「読み込み終わった」の合図として使う
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seededRow = await db.settings.get("todo.autoStatusViewSeeded");
      if (cancelled || seededRow?.value === "true") return;
      await db.settings.put({ key: "todo.autoStatusViewSeeded", value: "true" });
      const savedRow = await db.settings.get("todo.savedViews");
      let parsed: SavedTodoView[] = [];
      try {
        const p = JSON.parse(savedRow?.value ?? "[]");
        if (Array.isArray(p)) parsed = p;
      } catch {
        parsed = [];
      }
      const alreadyExists = parsed.some(
        (v) =>
          v.filterTags && v.filterTags.length === AUTO_STATUS_VIEW_TAGS.length && AUTO_STATUS_VIEW_TAGS.every((t) => v.filterTags!.includes(t))
      );
      if (alreadyExists || cancelled) return;
      const autoView: SavedTodoView = {
        id: uid(),
        name: AUTO_STATUS_VIEW_NAME,
        filterTag: "",
        filterCategory: "",
        filterCustomer: "",
        filterTags: AUTO_STATUS_VIEW_TAGS,
      };
      await db.settings.put({ key: "todo.savedViews", value: JSON.stringify([...parsed, autoView]) });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const [kanbanAxis, setKanbanAxis] = useState<KanbanAxis>("tag");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // このタグが選択されたタスクは自動的に重要にする（設定タブで変更可能。空なら無効）
  const [autoImportantTag] = useSetting("todo.autoImportantTag", "対応中");
  // ガントチャートを開いた際の初期表示位置。「今日」を基準にするか、登録されている
  // 一番古い期日（開始日/作成日）を基準にするかを選べるようにする
  const [ganttAnchor, setGanttAnchor] = useSetting("todo.ganttAnchor", "today");

  const today = todayStr();

  const lists = useLiveQuery(() => db.todoLists.orderBy("order").toArray(), []);
  const allTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  // 「本日の作業に追加」ダイアログの初期値(大項目)に、紐づく案件があればその件名を出すための参照
  const projectTitleById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.title])), [projects]);

  // 本日すでに「本日の作業」へ追加済みのTodoタスクID一覧。詳細ダイアログの
  // 「本日の作業に追加」ボタンの二重追加防止・状態表示に使う
  const todayDailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const addedTodoTaskIdsToday = useMemo(
    () => new Set((todayDailyTasks ?? []).filter((t) => !!t.todoTaskId).map((t) => t.todoTaskId!)),
    [todayDailyTasks]
  );

  // 初回は既定のリストを1つ用意しておく
  useEffect(() => {
    if (lists && lists.length === 0) {
      db.todoLists.add({ id: uid(), title: DEFAULT_LIST_TITLE, order: 0, createdAt: Date.now() });
    }
  }, [lists]);

  // 期日リマインダーポップアップ等から「このタスクの詳細を開いた状態で」遷移してきた場合、
  // 詳細ダイアログを自動的に開く。開いたら親側の保持値を消費済みにしてもらう(再遷移時の再発火防止)
  useEffect(() => {
    if (!initialDetailTaskId) return;
    setDetailTaskId(initialDetailTaskId);
    onInitialDetailConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDetailTaskId]);

  useEffect(() => {
    if (view.startsWith("list:") && lists && lists.length > 0) {
      const listId = view.slice(5);
      if (!lists.some((l) => l.id === listId)) {
        setView("myday");
      }
    }
  }, [view, lists]);

  // 対応状況・分類の選択肢は設定タブで管理する（分類は既定値を持たず、設定したものだけが選択肢になる）
  const [tagPresetsJson] = useSetting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS));
  const tagOptions = useMemo(() => parsePresetList(tagPresetsJson), [tagPresetsJson]);
  const [categoryPresetsJson] = useSetting("todo.categoryPresets", "[]");
  const categoryOptions = useMemo(() => parsePresetList(categoryPresetsJson), [categoryPresetsJson]);

  const customerOptions = useMemo(() => {
    const used = new Set<string>();
    for (const t of allTasks ?? []) {
      if (t.customer) used.add(t.customer);
    }
    return [...used].sort();
  }, [allTasks]);

  const listTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lists ?? []) map.set(l.id, l.title);
    return map;
  }, [lists]);

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const t of allTasks ?? []) {
      if (!t.parentTaskId) continue;
      if (!map.has(t.parentTaskId)) map.set(t.parentTaskId, []);
      map.get(t.parentTaskId)!.push(t);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
    return map;
  }, [allTasks]);

  const topLevelTasks = useMemo(() => (allTasks ?? []).filter((t) => !t.parentTaskId), [allTasks]);

  // 期限切れ: 未完了かつ自分自身の期日が本日より前のタスク・サブタスク。
  // 親タスク本体の期日だけでなく、サブタスク自身の期日が過ぎている場合はサブタスクを
  // そのまま個別の項目として含める（親だけをリスケジュールしてもサブタスク自身の期日は
  // 変わらず期限切れが解消されないため、サブタスクを直接選んでリスケジュールできるようにする）
  const overdueTasks = useMemo(() => {
    const items: TodoTask[] = [];
    for (const t of topLevelTasks) {
      if (!t.completed && !!t.dueDate && t.dueDate < today) items.push(t);
      for (const s of subtasksByParent.get(t.id) ?? []) {
        if (!s.completed && !!s.dueDate && s.dueDate < today) items.push(s);
      }
    }
    return items;
  }, [topLevelTasks, subtasksByParent, today]);
  const parentTitleById = useMemo(() => new Map(topLevelTasks.map((t) => [t.id, t.title])), [topLevelTasks]);
  // 一覧表示(通常view)でのタスク複数選択+一括操作。期限超過ビューの一括操作とは別の独立した仕組み
  const [bulkSelectionMode, setBulkSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  function toggleTaskSelect(id: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [selectedOverdueIds, setSelectedOverdueIds] = useState<Set<string>>(new Set());
  const [bulkRescheduleDate, setBulkRescheduleDate] = useState(() =>
    todayStr(new Date(Date.now() + 86400000))
  );

  // 期限切れから外れた（完了・期日変更等）タスクは選択状態からも自動的に外す
  useEffect(() => {
    setSelectedOverdueIds((prev) => {
      const overdueIds = new Set(overdueTasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => overdueIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [overdueTasks]);

  function toggleOverdueSelect(id: string) {
    setSelectedOverdueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllOverdue() {
    setSelectedOverdueIds(new Set(overdueTasks.map((t) => t.id)));
  }
  function clearOverdueSelection() {
    setSelectedOverdueIds(new Set());
  }

  // 選択中のタスクの期日を、指定した日付にまとめて変更する（一括/選択どちらもこの1つの仕組みで対応）
  async function applyBulkReschedule(newDate: string) {
    if (!newDate || selectedOverdueIds.size === 0) return;
    const ids = [...selectedOverdueIds];
    await db.transaction("rw", db.todoTasks, async () => {
      for (const id of ids) {
        await db.todoTasks.update(id, { dueDate: newDate });
      }
    });
    setSelectedOverdueIds(new Set());
  }

  // 期日（サブタスクの期日を含む）が本日になったタスクは、繰り返しの有無に関わらず自動的にマイデイへ反映する
  useEffect(() => {
    if (!allTasks) return;
    const toAdd = topLevelTasks.filter(
      (t) => !t.completed && t.myDayDate !== today && effectiveDueDate(t, subtasksByParent.get(t.id) ?? []) === today
    );
    if (toAdd.length === 0) return;
    db.transaction("rw", db.todoTasks, async () => {
      for (const t of toAdd) {
        await db.todoTasks.update(t.id, { myDayDate: today });
      }
    });
  }, [allTasks, topLevelTasks, subtasksByParent, today]);

  const currentListId = view.startsWith("list:") ? view.slice(5) : null;
  // 並び替えはリストごとに独立して覚える(あるリストを分類名順にしても他のリストには影響しない)
  const [sortModeStr, setSortModeStr] = useSetting(`todo.sortMode.${currentListId ?? "__none__"}`, "manual");
  const sortMode = (sortModeStr as TodoSortMode) || "manual";

  // ビューを切り替えたら、タスク追加欄の「追加先リスト」選択は一旦既定(閲覧中のリスト)に
  // 戻す。空文字は「未選択=既定を使う」を表す
  useEffect(() => {
    setNewTaskListId("");
  }, [view]);

  const searchActive =
    searchQuery.trim() !== "" || filterTag !== "" || filterTagsMulti.length > 0 || filterCategory !== "" || filterCustomer !== "";

  const visibleTasks = useMemo(() => {
    let filtered: TodoTask[];
    if (searchActive) {
      filtered = topLevelTasks;
    } else if (view === "myday") {
      filtered = topLevelTasks.filter((t) => t.myDayDate === today);
    } else if (view === "important") {
      filtered = topLevelTasks.filter((t) => t.important);
    } else if (view === "planned") {
      filtered = topLevelTasks.filter((t) => !!effectiveDueDate(t, subtasksByParent.get(t.id) ?? []));
    } else if (view === "overdue") {
      filtered = overdueTasks;
    } else if (currentListId) {
      filtered = topLevelTasks.filter((t) => t.listId === currentListId);
    } else {
      filtered = [];
    }
    if (searchActive) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((t) => {
        if (
          q &&
          !t.title.toLowerCase().includes(q) &&
          !(t.action ?? "").toLowerCase().includes(q) &&
          !(t.notes ?? "").toLowerCase().includes(q)
        )
          return false;
        if (filterTagsMulti.length > 0) {
          if (!filterTagsMulti.includes(t.tag ?? "")) return false;
        } else if (filterTag && t.tag !== filterTag) {
          return false;
        }
        if (filterCategory && t.category !== filterCategory) return false;
        if (filterCustomer && t.customer !== filterCustomer) return false;
        return true;
      });
    }
    return [...filtered].sort((a, b) => {
      const doneDiff = Number(a.completed) - Number(b.completed);
      if (doneDiff !== 0) return doneDiff;
      // 完了済み同士は、完了した順(直近に完了したものが一番上)に並べる
      if (a.completed && b.completed) {
        return (b.completedAt ?? 0) - (a.completedAt ?? 0);
      }
      if ((view === "planned" || view === "overdue") && !searchActive) {
        const dueA = effectiveDueDate(a, subtasksByParent.get(a.id) ?? []) ?? "9999-99-99";
        const dueB = effectiveDueDate(b, subtasksByParent.get(b.id) ?? []) ?? "9999-99-99";
        return dueA.localeCompare(dueB);
      }
      if (currentListId && !searchActive && sortMode !== "manual") {
        const cmp = compareTodoTasksBySortMode(a, b, sortMode, tagOptions);
        if (cmp !== 0) return cmp;
      }
      return a.order - b.order;
    });
  }, [
    view,
    currentListId,
    topLevelTasks,
    overdueTasks,
    today,
    searchActive,
    searchQuery,
    filterTag,
    filterTagsMulti,
    filterCategory,
    filterCustomer,
    subtasksByParent,
    sortMode,
    tagOptions,
  ]);

  const incompleteTasks = visibleTasks.filter((t) => !t.completed);
  const completedTasks = visibleTasks.filter((t) => t.completed);
  // ガント・カレンダーは既定で未完了のタスクだけを対象にする(一覧の「完了済み」欄と同様、
  // デフォルトでは埋もれさせない)。トグルで完了済みも重ねて表示できる
  const [showCompletedInTimeline, setShowCompletedInTimeline] = useState(false);
  const tasksForTimeline = useMemo(
    () => visibleTasks.filter((t) => !!t.dueDate && (showCompletedInTimeline || !t.completed)),
    [visibleTasks, showCompletedInTimeline]
  );
  // カレンダー表示では、案件の段階と同様にサブタスクも自身の期日でその日に表示したい。
  // ガント側の表示対象(親)に含まれるタスクのサブタスクだけを対象にする
  const subtasksForTimeline = useMemo(
    () =>
      visibleTasks.flatMap((t) =>
        (subtasksByParent.get(t.id) ?? [])
          .filter((s) => !!s.dueDate && (showCompletedInTimeline || !s.completed))
          .map((s) => ({ subtask: s, parentTitle: t.title }))
      ),
    [visibleTasks, subtasksByParent, showCompletedInTimeline]
  );

  // 系統図テーブルのグループ列(左から順に結合表示する階層)
  const todoTreeGroupLabels = ["リスト", "分類", "対応状況"];

  // 系統図テーブル表示: リスト(大)→分類→対応状況→タスク→サブタスクのカスケード表示。
  // 現在のview(マイデイ/重要/期限日/期限切れ/特定リスト)で絞り込んだ結果を、リストごとにまとめ直す
  const todoTree = useMemo<TreeNode[]>(() => {
    const tasksToShow = visibleTasks.filter((t) => showCompletedInTimeline || !t.completed);
    const byList = new Map<string, TodoTask[]>();
    for (const t of tasksToShow) {
      if (!byList.has(t.listId)) byList.set(t.listId, []);
      byList.get(t.listId)!.push(t);
    }

    // 分類・対応状況ごとにタスクをグルーピングし、未設定は「未分類」「未設定」にまとめる
    const groupByField = (tasks: TodoTask[], field: "category" | "tag", fallback: string): Map<string, TodoTask[]> => {
      const map = new Map<string, TodoTask[]>();
      for (const t of tasks) {
        const key = (t[field] ?? "").trim() || fallback;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(t);
      }
      return map;
    };

    const buildTaskNode = (t: TodoTask): TreeNode => {
      const overdue = !t.completed && !!t.dueDate && t.dueDate < today;
      // タスク行は「タスク名」列+「アクション」列の表形式にする
      const taskBadges: TreeNodeBadge[] = [];
      if (t.important) taskBadges.push({ text: "重要" });
      if (t.completed) taskBadges.push({ text: "完了", tone: "muted" });

      const subs = (subtasksByParent.get(t.id) ?? []).filter((s) => showCompletedInTimeline || !s.completed);
      return {
        id: t.id,
        label: t.title,
        emphasis: overdue,
        valueLabel: t.action ?? "",
        badges: taskBadges,
        children: subs.map((s) => {
          // サブタスク行は「サブタスク名」列+「期日」列の表形式にする
          const subOverdue = !s.completed && !!s.dueDate && s.dueDate < today;
          const subBadges: TreeNodeBadge[] = [];
          if (s.completed) subBadges.push({ text: "完了", tone: "muted" });
          return {
            id: s.id,
            label: s.title,
            emphasis: subOverdue,
            valueLabel: s.dueDate ? formatDateJp(s.dueDate) : "",
            badges: subBadges,
          };
        }),
      };
    };

    return (lists ?? [])
      .filter((l) => (byList.get(l.id) ?? []).length > 0)
      .map((list) => {
        const listTasks = byList.get(list.id) ?? [];
        const byCategory = groupByField(listTasks, "category", "未分類");
        const categoryNodes: TreeNode[] = Array.from(byCategory.entries()).map(([categoryLabel, categoryTasks]) => {
          const byTag = groupByField(categoryTasks, "tag", "未設定");
          const tagNodes: TreeNode[] = Array.from(byTag.entries()).map(([tagLabel, tagTasks]) => ({
            id: `${list.id}::${categoryLabel}::${tagLabel}`,
            label: tagLabel,
            badges: [{ text: `${tagTasks.length}件`, tone: "muted" }],
            children: tagTasks.map(buildTaskNode),
          }));
          return {
            id: `${list.id}::${categoryLabel}`,
            label: categoryLabel,
            badges: [{ text: `${categoryTasks.length}件`, tone: "muted" }],
            children: tagNodes,
          };
        });
        return {
          id: list.id,
          label: list.title,
          badges: [{ text: `${listTasks.length}件`, tone: "muted" }],
          children: categoryNodes,
        };
      });
  }, [visibleTasks, showCompletedInTimeline, lists, subtasksByParent, today]);

  const detailTask = allTasks?.find((t) => t.id === detailTaskId) ?? null;

  const reorderEnabled =
    displayMode === "list" && !searchActive && view !== "planned" && view !== "overdue" && sortMode === "manual";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = incompleteTasks.findIndex((t) => t.id === active.id);
    const newIndex = incompleteTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(incompleteTasks, oldIndex, newIndex);
    await db.transaction("rw", db.todoTasks, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.todoTasks.update(reordered[i].id, { order: i });
      }
    });
  }

  async function addList() {
    if (!newListTitle.trim()) return;
    await db.todoLists.add({ id: uid(), title: newListTitle.trim(), order: (lists?.length ?? 0), createdAt: Date.now() });
    setNewListTitle("");
    setShowNewList(false);
  }

  async function deleteList(listId: string) {
    if (!confirm("このリストと、含まれる全てのタスクを削除しますか?")) return;
    const taskIds = (allTasks ?? []).filter((t) => t.listId === listId).map((t) => t.id);
    await db.transaction("rw", db.todoLists, db.todoTasks, async () => {
      await db.todoTasks.bulkDelete(taskIds);
      await db.todoLists.delete(listId);
    });
    if (view === `list:${listId}`) setView("myday");
  }

  function resolveTag(mode: string, custom: string): string | undefined {
    if (mode === CUSTOM_TAG_VALUE) return custom.trim() || undefined;
    return mode || undefined;
  }

  function resolveCategory(mode: string, custom: string): string | undefined {
    if (mode === CUSTOM_CATEGORY_VALUE) return custom.trim() || undefined;
    return mode || undefined;
  }

  function resolveCustomer(mode: string, custom: string): string | undefined {
    if (mode === CUSTOM_CUSTOMER_VALUE) return custom.trim() || undefined;
    return mode || undefined;
  }

  async function addTask() {
    if (!newTaskTitle.trim()) return;
    const targetListId = newTaskListId || currentListId || lists?.[0]?.id;
    if (!targetListId) return;
    const id = uid();
    const dueDate = newTaskDueDate || undefined;
    // 期日を入れた場合はリスト内で日付順の位置に(既存タスクの編集時と同じ並べ替えロジック)、
    // 期日なしの場合は埋もれないよう一番上に挿入する(どちらも既存タスクのorderを1つずつ後ろにずらす)
    const order = dueDate
      ? await computeDateOrderedPosition(targetListId, id, dueDate)
      : await shiftSiblingsForTopInsert(targetListId);
    const tag = resolveTag(newTaskTagMode, newTaskCustomTag);
    const task: TodoTask = {
      id,
      listId: targetListId,
      title: newTaskTitle.trim(),
      action: newTaskAction.trim() || undefined,
      tag,
      category: resolveCategory(newTaskCategoryMode, newTaskCustomCategory),
      customer: resolveCustomer(newTaskCustomerMode, newTaskCustomCustomer),
      dueDate,
      // 設定で指定したタグが選択されていれば自動的に重要にする（それ以外は閲覧中のビューに従う）
      important: view === "important" || (!!autoImportantTag && tag === autoImportantTag),
      completed: false,
      order,
      createdAt: Date.now(),
      myDayDate: view === "myday" ? today : undefined,
    };
    await db.todoTasks.add(task);
    setNewTaskTitle("");
    setNewTaskAction("");
    setNewTaskDueDate("");
    setNewTaskTagMode(NO_TAG_VALUE);
    setNewTaskCustomTag("");
    setNewTaskCategoryMode(NO_CATEGORY_VALUE);
    setNewTaskCustomCategory("");
    setNewTaskCustomerMode(NO_CUSTOMER_VALUE);
    setNewTaskCustomCustomer("");
  }

  // 期日を入れずに追加したタスクを一番上に置くため、同じリストの既存タスク(トップレベルのみ)の
  // orderを1つずつ後ろにずらし、新タスクの挿入位置(0)を返す
  async function shiftSiblingsForTopInsert(listId: string): Promise<number> {
    const siblings = (await db.todoTasks.where("listId").equals(listId).toArray()).filter((t) => !t.parentTaskId);
    await db.transaction("rw", db.todoTasks, async () => {
      for (const s of siblings) await db.todoTasks.update(s.id, { order: s.order + 1 });
    });
    return 0;
  }

  async function setTaskColumnValue(task: TodoTask, axis: KanbanAxis, value: string | undefined) {
    if (axis === "tag") {
      const updates: Partial<TodoTask> = { tag: value };
      if (autoImportantTag && value === autoImportantTag) updates.important = true;
      await db.todoTasks.update(task.id, updates);
    } else {
      await db.todoTasks.update(task.id, { category: value });
    }
  }

  async function toggleComplete(task: TodoTask) {
    if (!task.completed) {
      const openSubtasks = (subtasksByParent.get(task.id) ?? []).filter((s) => !s.completed);
      if (openSubtasks.length > 0) {
        setPendingCompleteTask(task);
        return;
      }
      await completeTodoTask(task, today);
      return;
    }
    await db.todoTasks.update(task.id, { completed: false, completedAt: undefined });
  }

  // 未完了のサブタスクが残っている状態でタスクを完了しようとした際、サブタスクも
  // まとめて完了にするか・タスクだけ完了にするか選んでもらうための確認
  const [pendingCompleteTask, setPendingCompleteTask] = useState<TodoTask | null>(null);

  async function resolveCompleteWithSubtasks() {
    if (!pendingCompleteTask) return;
    const task = pendingCompleteTask;
    const openSubtasks = (subtasksByParent.get(task.id) ?? []).filter((s) => !s.completed);
    setPendingCompleteTask(null);
    await db.transaction("rw", db.todoTasks, async () => {
      for (const s of openSubtasks) await db.todoTasks.update(s.id, { completed: true, completedAt: Date.now() });
    });
    await completeTodoTask(task, today);
  }

  async function resolveCompleteTaskOnly() {
    if (!pendingCompleteTask) return;
    const task = pendingCompleteTask;
    setPendingCompleteTask(null);
    await completeTodoTask(task, today);
  }

  async function toggleImportant(task: TodoTask) {
    await db.todoTasks.update(task.id, { important: !task.important });
  }

  async function toggleMyDay(task: TodoTask) {
    await db.todoTasks.update(task.id, { myDayDate: task.myDayDate === today ? undefined : today });
  }

  async function deleteTask(task: TodoTask) {
    const subs = subtasksByParent.get(task.id) ?? [];
    await db.todoTasks.bulkDelete([task.id, ...subs.map((s) => s.id)]);
    if (detailTaskId === task.id) setDetailTaskId(null);
    showUndoToast(`「${task.title}」を削除しました`, async () => {
      await db.todoTasks.bulkAdd([task, ...subs]);
    });
  }

  // 選択中タスクの一括操作。タグ変更・マイデイ追加・完了・削除をこの1つの選択状態で共通に扱う
  async function applyBulkTag(tagValue: string) {
    const ids = [...selectedTaskIds];
    if (ids.length === 0) return;
    await db.transaction("rw", db.todoTasks, async () => {
      for (const id of ids) await db.todoTasks.update(id, { tag: tagValue });
    });
  }

  async function applyBulkMyDay() {
    const ids = [...selectedTaskIds];
    if (ids.length === 0) return;
    await db.transaction("rw", db.todoTasks, async () => {
      for (const id of ids) await db.todoTasks.update(id, { myDayDate: today });
    });
    setSelectedTaskIds(new Set());
  }

  async function applyBulkComplete() {
    const targets = (allTasks ?? []).filter((t) => selectedTaskIds.has(t.id));
    for (const t of targets) {
      await completeTodoTask(t, today);
    }
    setSelectedTaskIds(new Set());
  }

  // 選択中タスクをまとめて別リストへ移動する。子から親だけ選んでも取り残されないよう、
  // 選択したタスクのサブタスクも一緒に移す
  async function applyBulkMoveList(targetListId: string) {
    const ids = [...selectedTaskIds];
    if (ids.length === 0 || !targetListId) return;
    const targets = (allTasks ?? []).filter((t) => ids.includes(t.id));
    const subs = targets.flatMap((t) => subtasksByParent.get(t.id) ?? []);
    await db.transaction("rw", db.todoTasks, async () => {
      for (const t of [...targets, ...subs]) await db.todoTasks.update(t.id, { listId: targetListId });
    });
    setSelectedTaskIds(new Set());
  }

  async function applyBulkDelete() {
    const targets = (allTasks ?? []).filter((t) => selectedTaskIds.has(t.id));
    if (targets.length === 0) return;
    const subs = targets.flatMap((t) => subtasksByParent.get(t.id) ?? []);
    await db.todoTasks.bulkDelete([...targets.map((t) => t.id), ...subs.map((s) => s.id)]);
    showUndoToast(`${targets.length}件のタスクを削除しました`, async () => {
      await db.todoTasks.bulkAdd([...targets, ...subs]);
    });
    setSelectedTaskIds(new Set());
  }

  // タスクをコピーして新規タスクとして追加する（よく使う内容をテンプレート的に使い回す用）。
  // 期日・完了状態・案件連携など「そのインスタンス固有」の情報は引き継がず、
  // 件名・アクション・タグ・分類・客先・メモ・サブタスクの構成だけを複製する
  async function copyTask(task: TodoTask) {
    const subs = subtasksByParent.get(task.id) ?? [];
    const count = (allTasks ?? []).filter((t) => t.listId === task.listId && !t.parentTaskId).length;
    const newId = uid();
    const newTask: TodoTask = {
      id: newId,
      listId: task.listId,
      title: task.title,
      action: task.action,
      url: task.url,
      tag: task.tag,
      category: task.category,
      customer: task.customer,
      notes: task.notes,
      important: false,
      completed: false,
      order: count,
      createdAt: Date.now(),
    };
    await db.todoTasks.add(newTask);
    for (let i = 0; i < subs.length; i++) {
      await db.todoTasks.add({
        id: uid(),
        listId: task.listId,
        parentTaskId: newId,
        title: subs[i].title,
        important: false,
        completed: false,
        order: i,
        createdAt: Date.now(),
      });
    }
    setDetailTaskId(newId);
  }

  async function toggleSubtaskComplete(sub: TodoTask) {
    await db.todoTasks.update(sub.id, { completed: !sub.completed, completedAt: !sub.completed ? Date.now() : undefined });
  }

  async function updateSubtaskTitleInline(sub: TodoTask, title: string) {
    const trimmed = title.trim();
    if (!trimmed || trimmed === sub.title) return;
    await db.todoTasks.update(sub.id, { title: trimmed });
  }

  async function updateSubtaskDueDateInline(sub: TodoTask, dueDate: string) {
    await db.todoTasks.update(sub.id, { dueDate: dueDate || undefined });
  }

  async function reorderSubtasks(subtasks: TodoTask[], oldIndex: number, newIndex: number) {
    const reordered = arrayMove(subtasks, oldIndex, newIndex);
    await db.transaction("rw", db.todoTasks, async () => {
      for (let i = 0; i < reordered.length; i++) {
        await db.todoTasks.update(reordered[i].id, { order: i });
      }
    });
  }

  // タスクの内容を案件タブに反映する（1度反映すると同じタスクからは再反映しない）
  // Todoタスクをメモの付箋に変換する(メモタブ側のconvertNoteToTodoの逆方向)。元のTodoは
  // 残したまま、内容をコピーした付箋を追加するだけの非破壊的な操作にする。サブタスクが
  // あればチェックリスト付箋(親タスク+各サブタスクの完了状態をそのまま反映)、無ければ
  // タイトル・次の行動・メモをまとめたテキスト付箋にする
  async function convertTodoToMemo(task: TodoTask, taskSubtasks: TodoTask[]) {
    let board = await db.memoBoards.orderBy("order").first();
    if (!board) {
      board = { id: uid(), title: "メモ", order: 0, createdAt: Date.now() };
      await db.memoBoards.add(board);
    }
    const existingCount = await db.memoNotes.where("boardId").equals(board.id).count();
    const offset = (existingCount * 24) % 220;
    const now = Date.now();
    const hasSubtasks = taskSubtasks.length > 0;
    const text = hasSubtasks ? "" : [task.title, task.action, task.notes].filter(Boolean).join("\n\n");
    // 内容量(テキストの行数・チェックリストの項目数)に応じて、あとから手を加えずに
    // ちょうど収まる高さを見積もる
    const height = hasSubtasks ? estimateChecklistNoteHeight(taskSubtasks.length + 1) : estimateTextNoteHeight(text);
    const note: MemoNote = {
      id: uid(),
      boardId: board.id,
      x: 40 + offset,
      y: 40 + offset,
      width: 220,
      height,
      color: DEFAULT_MEMO_NOTE_COLOR,
      text,
      order: existingCount + 1,
      createdAt: now,
      updatedAt: now,
      isChecklist: hasSubtasks,
      checklistItems: hasSubtasks
        ? [
            { id: uid(), text: task.title, done: task.completed },
            ...taskSubtasks.map((s) => ({ id: uid(), text: s.title, done: s.completed })),
          ]
        : undefined,
    };
    await db.memoNotes.add(note);
    showUndoToast(`「${task.title}」をメモに変換しました`, async () => {
      await db.memoNotes.delete(note.id);
    });
  }

  async function reflectToProject(task: TodoTask, category: string, workName: string) {
    if (task.projectId) return;
    const item: ProjectItem = {
      id: uid(),
      title: task.title,
      category,
      workName,
      dueDate: task.dueDate ?? today,
      createdAt: Date.now(),
    };
    await db.projects.add(item);
    await db.todoTasks.update(task.id, { projectId: item.id });
  }

  // Todoタスクを本日の作業に追加する。同じタスクを紐付けたDailyTask(todoTaskId)を作り、
  // 作業側から元のTodoを表示・完了・編集できるようにする
  async function addTaskToToday(task: TodoTask, category: string, workName: string) {
    const master = await findOrCreateMasterTask(category, workName, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, category, workName, master.estimatedSeconds);
    const count = (await db.dailyTasks.where("date").equals(today).toArray()).length;
    const dailyTask: DailyTask = {
      id: uid(),
      date: today,
      order: count,
      masterTaskId: master.id,
      category,
      name: workName,
      estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
      todoTaskId: task.id,
    };
    await db.dailyTasks.add(dailyTask);
  }

  function downloadTemplate() {
    downloadTextFile("todo_template.csv", todoCsvTemplate());
  }

  function exportCsv() {
    if (!allTasks || !lists) return;
    downloadTextFile(`todo_${today}.csv`, todoTasksToCsv(allTasks, lists));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const { rows, errors } = parseTodoCsv(text);
    setImportErrors(errors);
    if (rows.length === 0) {
      setImportResult("");
      return;
    }
    const { created, updated, listsCreated } = await upsertTodoFromCsv(rows);
    setImportResult(`${created}件を新規追加、${updated}件を更新しました（新規リスト${listsCreated}件）。`);
  }

  const listLabel = (key: ViewKey) => {
    if (key === "myday") return "マイデイ";
    if (key === "important") return "重要";
    if (key === "planned") return "期限日";
    if (key === "overdue") return "期限切れ";
    return lists?.find((l) => l.id === key.slice(5))?.title ?? "";
  };

  const panelTitle = searchActive ? `検索結果（${visibleTasks.length}件）` : listLabel(view);

  // ガントチャート用データ（開始日があればそこから、なければ作成日〜期日のバー）
  const { ganttStart, ganttTotalDays, ganttRows } = useMemo(() => {
    const list = tasksForTimeline;
    if (list.length === 0) return { ganttStart: today, ganttTotalDays: 1, ganttRows: [] as { task: TodoTask; barStart: number; barEnd: number; overdue: boolean }[] };
    let start = today;
    let end = today;
    for (const t of list) {
      const barStartStr = t.startDate ?? todayStr(new Date(t.createdAt));
      if (barStartStr < start) start = barStartStr;
      if (t.dueDate! < start) start = t.dueDate!;
      if (t.dueDate! > end) end = t.dueDate!;
    }
    end = todayStr(new Date(new Date(end + "T00:00:00").getTime() + 2 * 86400000));
    const total = Math.max(daysBetweenDateStrs(start, end), 1);
    const rows = list.map((t) => {
      // 開始日(または作成日)が期日より後になっているタスク(期日を過ぎてから登録された
      // 期限切れタスク等)でも、バーが開始日側に潰れて期日が見えなくなることがないよう、
      // 2つの日付のうち早い方・遅い方でバーの左端・右端を決める
      const barStartStr = t.startDate ?? todayStr(new Date(t.createdAt));
      const a = daysBetweenDateStrs(start, barStartStr);
      const b = daysBetweenDateStrs(start, t.dueDate!);
      const overdue = !t.completed && t.dueDate! < today;
      return { task: t, barStart: Math.min(a, b), barEnd: Math.max(a, b), overdue };
    });
    return { ganttStart: start, ganttTotalDays: total, ganttRows: rows };
  }, [tasksForTimeline, today]);

  const ganttTodayIndex = daysBetweenDateStrs(ganttStart, today);
  const ganttDayMarks = Array.from({ length: ganttTotalDays + 1 }, (_, i) => i);
  const labelStepDays = Math.max(1, Math.ceil(MIN_LABEL_SPACING_PX / pxPerDay));

  function zoomIn() {
    setPxPerDay((v) => Math.min(MAX_PX_PER_DAY, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerDay((v) => Math.max(MIN_PX_PER_DAY, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const containerWidth = scrollRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0 || ganttTotalDays <= 0) return;
    const fit = Math.max(0, containerWidth - 24) / ganttTotalDays;
    setPxPerDay(Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, +fit.toFixed(3))));
  }

  // 「今日」を初期位置にする設定の場合、ガントチャート表示時・拡大縮小時に
  // 今日の位置が見える所までスクロールする(「一番古い期日」の場合は既定の左端=0のままにする)
  useEffect(() => {
    if (displayMode !== "gantt") return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = ganttAnchor === "today" ? Math.max(0, ganttTodayIndex * pxPerDay - el.clientWidth / 2) : 0;
  }, [displayMode, ganttAnchor, ganttTodayIndex, pxPerDay, ganttTotalDays]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {!bottomViewBar &&
          (["myday", "important", "planned"] as ViewKey[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={view === v ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            >
              {v === "myday" ? "☀ マイデイ" : v === "important" ? "★ 重要" : "📅 期限日"}
            </button>
          ))}
        {!bottomViewBar && (
          <button
            onClick={() => setView("overdue")}
            className={view === "overdue" ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
          >
            ⚠ 期限切れ{overdueTasks.length > 0 && `（${overdueTasks.length}）`}
          </button>
        )}
        {(lists ?? []).map((l) => (
          <div key={l.id} className="flex items-center">
            <button
              onClick={() => setView(`list:${l.id}`)}
              className={view === `list:${l.id}` ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            >
              {l.title}
            </button>
          </div>
        ))}
        {showNewList ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newListTitle}
              onChange={(e) => setNewListTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addList()}
              placeholder="リスト名"
              className="w-32 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-sm text-cream"
            />
            <button className="btn-pill text-xs" onClick={addList}>
              追加
            </button>
            <button className="btn-pill-outline text-xs" onClick={() => setShowNewList(false)}>
              ×
            </button>
          </div>
        ) : (
          <button className="btn-pill-outline text-sm" onClick={() => setShowNewList(true)}>
            + 新しいリスト
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍 タスクを検索"
          className="min-w-[10rem] flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <select
          value={filterTag}
          onChange={(e) => {
            setFilterTag(e.target.value);
            setFilterTagsMulti([]);
          }}
          className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
        >
          <option value="">対応状況: すべて</option>
          {tagOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {filterTagsMulti.length > 0 && (
          <span className="flex items-center gap-1 rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream">
            対応状況: {filterTagsMulti.join(" / ")}
            <button className="text-cream/40 hover:text-alert" onClick={() => setFilterTagsMulti([])} aria-label="対応状況の条件を解除">
              ✕
            </button>
          </span>
        )}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
        >
          <option value="">分類: すべて</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filterCustomer}
          onChange={(e) => setFilterCustomer(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
        >
          <option value="">客先: すべて</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {searchActive && (
          <button
            className="btn-pill-outline text-xs"
            onClick={() => {
              setSearchQuery("");
              setFilterTag("");
              setFilterTagsMulti([]);
              setFilterCategory("");
              setFilterCustomer("");
            }}
          >
            クリア
          </button>
        )}
      </div>

      {(savedViews.length > 0 || filterTag || filterTagsMulti.length > 0 || filterCategory || filterCustomer) && (
        <div className="flex flex-wrap items-center gap-2">
          {savedViews.length > 0 && <span className="text-xs text-cream/40">保存済みビュー:</span>}
          {savedViews.map((v) => (
            <div key={v.id} className="flex items-center gap-1 rounded-full border border-cream/20 py-1 pl-1 pr-2">
              <button className="rounded-full px-2 py-0.5 text-xs text-cream hover:bg-cream/10" onClick={() => applySavedView(v)}>
                {v.name}
              </button>
              <button className="text-cream/30 hover:text-alert" onClick={() => deleteSavedView(v.id)} aria-label="削除">
                ✕
              </button>
            </div>
          ))}
          {(filterTag || filterTagsMulti.length > 0 || filterCategory || filterCustomer) && (
            <button className="btn-pill-outline text-xs" onClick={saveCurrentAsView}>
              + この条件を保存
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={downloadTemplate}>
          CSVテンプレート
        </button>
        <button className="btn-pill-outline text-sm" onClick={exportCsv}>
          CSVエクスポート
        </button>
        <button className="btn-pill-outline text-sm" onClick={() => fileInputRef.current?.click()}>
          CSVインポート
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importCsv(file);
            e.target.value = "";
          }}
        />
      </div>

      {importResult && <p className="text-xs text-cream/70">{importResult}</p>}
      {importErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold">{panelTitle}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {(["list", "kanban", "gantt", "calendar", "tree"] as DisplayMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setDisplayMode(m)}
                className={displayMode === m ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              >
                {m === "list"
                  ? "リスト"
                  : m === "kanban"
                    ? "かんばん"
                    : m === "gantt"
                      ? "ガント"
                      : m === "calendar"
                        ? "カレンダー"
                        : "系統図"}
              </button>
            ))}
            {(displayMode === "gantt" || displayMode === "calendar" || displayMode === "tree") && (
              <label className="ml-2 flex items-center gap-1.5 text-xs text-cream/60">
                <input
                  type="checkbox"
                  checked={showCompletedInTimeline}
                  onChange={(e) => setShowCompletedInTimeline(e.target.checked)}
                  className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
                />
                完了済みも表示
              </label>
            )}
            {displayMode === "list" && currentListId && !searchActive && (
              <label className="ml-2 flex items-center gap-1.5 text-xs text-cream/60">
                並び替え:
                <select
                  value={sortMode}
                  onChange={(e) => setSortModeStr(e.target.value)}
                  className="rounded-lg border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
                >
                  {(Object.keys(TODO_SORT_MODE_LABELS) as TodoSortMode[]).map((m) => (
                    <option key={m} value={m}>
                      {TODO_SORT_MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {displayMode === "list" && view !== "overdue" && (
              <button
                onClick={() => {
                  setBulkSelectionMode((v) => !v);
                  setSelectedTaskIds(new Set());
                }}
                className={bulkSelectionMode ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              >
                ☑ 選択モード
              </button>
            )}
            {currentListId && !searchActive && (
              <button className="text-xs text-alert" onClick={() => deleteList(currentListId)}>
                このリストを削除
              </button>
            )}
          </div>
        </div>

        {!showAddTaskForm && (
          <div className="mb-3">
            <button className="btn-pill-outline text-sm" onClick={() => setShowAddTaskForm(true)}>
              + タスクを追加
            </button>
          </div>
        )}
        {showAddTaskForm && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            autoFocus
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="件名"
            className="min-w-[10rem] flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            value={newTaskAction}
            onChange={(e) => setNewTaskAction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
            placeholder="アクション（任意）"
            className="min-w-[8rem] flex-1 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            type="date"
            value={newTaskDueDate}
            onChange={(e) => setNewTaskDueDate(e.target.value)}
            title="期日（任意）。設定するとリスト内で期日順の位置に入ります"
            className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
          />
          {(lists ?? []).length > 1 && (
            <select
              value={newTaskListId || currentListId || lists?.[0]?.id || ""}
              onChange={(e) => setNewTaskListId(e.target.value)}
              title="追加先のリスト"
              className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
            >
              {(lists ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}へ追加
                </option>
              ))}
            </select>
          )}
          <select
            value={newTaskTagMode}
            onChange={(e) => setNewTaskTagMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
          >
            <option value={NO_TAG_VALUE}>対応状況なし</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={CUSTOM_TAG_VALUE}>＋ 新しい対応状況...</option>
          </select>
          {newTaskTagMode === CUSTOM_TAG_VALUE && (
            <input
              value={newTaskCustomTag}
              onChange={(e) => setNewTaskCustomTag(e.target.value)}
              placeholder="対応状況名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
            />
          )}
          <select
            value={newTaskCategoryMode}
            onChange={(e) => setNewTaskCategoryMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
          >
            <option value={NO_CATEGORY_VALUE}>分類なし</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={CUSTOM_CATEGORY_VALUE}>＋ 新しい分類...</option>
          </select>
          {newTaskCategoryMode === CUSTOM_CATEGORY_VALUE && (
            <input
              value={newTaskCustomCategory}
              onChange={(e) => setNewTaskCustomCategory(e.target.value)}
              placeholder="分類名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
            />
          )}
          <select
            value={newTaskCustomerMode}
            onChange={(e) => setNewTaskCustomerMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
          >
            <option value={NO_CUSTOMER_VALUE}>客先なし</option>
            {customerOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={CUSTOM_CUSTOMER_VALUE}>＋ 新しい客先...</option>
          </select>
          {newTaskCustomerMode === CUSTOM_CUSTOMER_VALUE && (
            <input
              value={newTaskCustomCustomer}
              onChange={(e) => setNewTaskCustomCustomer(e.target.value)}
              placeholder="客先名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-2 text-xs text-cream"
            />
          )}
          <button className="btn-pill text-sm" onClick={addTask} disabled={!newTaskTitle.trim()}>
            追加
          </button>
          <button className="btn-pill-outline text-xs" onClick={() => setShowAddTaskForm(false)} aria-label="閉じる">
            ×
          </button>
        </div>
        )}

        {displayMode === "calendar" ? (
          <TodoCalendarView tasks={tasksForTimeline} subtasks={subtasksForTimeline} today={today} />
        ) : displayMode === "tree" ? (
          <PedigreeTable nodes={todoTree} groupLabels={todoTreeGroupLabels} />
        ) : displayMode === "kanban" ? (
          <KanbanBoard
            tasks={visibleTasks}
            axis={kanbanAxis}
            onAxisChange={setKanbanAxis}
            tagOptions={tagOptions}
            categoryOptions={categoryOptions}
            autoImportantTag={autoImportantTag}
            onMoveTask={setTaskColumnValue}
            onOpenDetail={(task) => setDetailTaskId(task.id)}
          />
        ) : displayMode === "gantt" ? (
          <div>
            {ganttRows.length === 0 ? (
              <p className="px-1 py-4 text-sm text-cream/50">
                {!showCompletedInTimeline && visibleTasks.some((t) => !!t.dueDate)
                  ? "表示するタスクがありません（完了済みのみのため。「完了済みも表示」をONにすると見られます）。"
                  : "期日が設定されたタスクはありません。"}
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-end gap-1">
                  <span className="mr-1 text-xs text-cream/50">初期位置</span>
                  <button
                    className={ganttAnchor === "today" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                    onClick={() => setGanttAnchor("today")}
                  >
                    今日
                  </button>
                  <button
                    className={ganttAnchor === "oldest" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                    onClick={() => setGanttAnchor("oldest")}
                  >
                    一番古い期日
                  </button>
                  <span className="mx-1 h-4 border-l border-cream/15" />
                  <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomOut} aria-label="縮小">
                    －
                  </button>
                  <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomIn} aria-label="拡大">
                    ＋
                  </button>
                  <button className="btn-pill-outline text-xs" onClick={fitToView}>
                    全体表示
                  </button>
                </div>
                <div className="flex">
                  <div className="w-28 shrink-0 pr-2 sm:w-40">
                    <div className="mb-2 h-6 border-b border-cream/20" />
                    {ganttRows.map((r) => (
                      <div
                        key={r.task.id}
                        className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70"
                        style={{ height: ROW_H }}
                        title={r.task.title}
                      >
                        {r.task.customer && <span className="truncate text-cream/50">{r.task.customer}</span>}
                        <span className="truncate">{r.task.title}</span>
                      </div>
                    ))}
                  </div>
                  <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
                    <div style={{ width: ganttTotalDays * pxPerDay + 24 }}>
                      <div className="relative mb-2 h-6 border-b border-cream/20 text-xs text-cream/50">
                        {ganttDayMarks
                          .filter((d) => d % labelStepDays === 0)
                          .map((d) => (
                            <div
                              key={d}
                              className="absolute top-0 border-l border-cream/10 pl-1"
                              style={{ left: d * pxPerDay }}
                            >
                              {formatDateJp(
                                todayStr(new Date(new Date(ganttStart + "T00:00:00").getTime() + d * 86400000))
                              )}
                            </div>
                          ))}
                      </div>
                      <div className="relative" style={{ height: ganttRows.length * ROW_H }}>
                        {ganttDayMarks
                          .filter((d) => d % labelStepDays === 0)
                          .map((d) => (
                            <div
                              key={d}
                              className="absolute top-0 bottom-0 border-l border-cream/5"
                              style={{ left: d * pxPerDay }}
                            />
                          ))}
                        <div
                          className="absolute top-0 bottom-0 border-l-2 border-alert/70"
                          style={{ left: ganttTodayIndex * pxPerDay }}
                        />
                        {ganttRows.map((r, idx) => {
                          const top = idx * ROW_H;
                          const left = r.barStart * pxPerDay;
                          const width = Math.max((r.barEnd - r.barStart) * pxPerDay, 3);
                          return (
                            <div key={r.task.id} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                              <div
                                className={`absolute rounded ${
                                  r.task.completed ? "bg-cream/30" : r.overdue ? "bg-alert" : "bg-cream/70"
                                }`}
                                style={{ left, width, top: 9, height: 20 }}
                                title={`${r.task.title}（期日 ${r.task.dueDate}）`}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-cream/40">赤い縦線が本日の位置です。バーは開始日（未設定の場合は登録日）から期日までの期間を表します。</p>
              </>
            )}
          </div>
        ) : view === "overdue" ? (
          <OverdueBulkList
            tasks={incompleteTasks}
            today={today}
            parentTitleById={parentTitleById}
            selectedIds={selectedOverdueIds}
            onToggleSelect={toggleOverdueSelect}
            onSelectAll={selectAllOverdue}
            onClearSelection={clearOverdueSelection}
            rescheduleDate={bulkRescheduleDate}
            onRescheduleDateChange={setBulkRescheduleDate}
            onApplyReschedule={() => applyBulkReschedule(bulkRescheduleDate)}
            onQuickReschedule={(days) => applyBulkReschedule(todayStr(new Date(Date.now() + days * 86400000)))}
            onOpenDetail={(id) => setDetailTaskId(id)}
          />
        ) : (
          <>
            {bulkSelectionMode && (
              <div className="panel mb-3 flex flex-wrap items-center gap-2 p-3">
                <span className="text-xs text-cream/60">{selectedTaskIds.size}件選択中</span>
                <button
                  className="btn-pill-outline text-xs"
                  onClick={() => setSelectedTaskIds(new Set(incompleteTasks.map((t) => t.id)))}
                >
                  全選択
                </button>
                <button className="btn-pill-outline text-xs" onClick={() => setSelectedTaskIds(new Set())}>
                  選択解除
                </button>
                <select
                  disabled={selectedTaskIds.size === 0}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) applyBulkTag(e.target.value);
                    e.target.value = "";
                  }}
                  className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream disabled:opacity-40"
                >
                  <option value="" disabled>
                    対応状況を変更...
                  </option>
                  {tagOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {(lists ?? []).length > 1 && (
                  <select
                    disabled={selectedTaskIds.size === 0}
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) applyBulkMoveList(e.target.value);
                      e.target.value = "";
                    }}
                    className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream disabled:opacity-40"
                  >
                    <option value="" disabled>
                      リストへ移動...
                    </option>
                    {(lists ?? []).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="btn-pill-outline text-xs disabled:opacity-40"
                  disabled={selectedTaskIds.size === 0}
                  onClick={applyBulkMyDay}
                >
                  ☀ マイデイに追加
                </button>
                <button
                  className="btn-pill-outline text-xs disabled:opacity-40"
                  disabled={selectedTaskIds.size === 0}
                  onClick={applyBulkComplete}
                >
                  ✓ 完了にする
                </button>
                <button
                  className="btn-pill-outline text-xs text-alert disabled:opacity-40"
                  disabled={selectedTaskIds.size === 0}
                  onClick={applyBulkDelete}
                >
                  削除
                </button>
              </div>
            )}
            <div className="space-y-3">
              {reorderEnabled && !bulkSelectionMode ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={incompleteTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                    {incompleteTasks.map((task) => (
                      <SortableTaskBlock
                        key={task.id}
                        task={task}
                        subtasks={subtasksByParent.get(task.id) ?? []}
                        listTitle={searchActive ? listTitleById.get(task.listId) : undefined}
                        onToggleComplete={() => toggleComplete(task)}
                        onToggleImportant={() => toggleImportant(task)}
                        onOpenDetail={() => setDetailTaskId(task.id)}
                        onToggleSubtask={toggleSubtaskComplete}
                        onUpdateSubtaskTitle={updateSubtaskTitleInline}
                        onUpdateSubtaskDueDate={updateSubtaskDueDateInline}
                        onReorderSubtasks={reorderSubtasks}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                incompleteTasks.map((task) => (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    subtasks={subtasksByParent.get(task.id) ?? []}
                    listTitle={searchActive ? listTitleById.get(task.listId) : undefined}
                    onToggleComplete={() => toggleComplete(task)}
                    onToggleImportant={() => toggleImportant(task)}
                    onOpenDetail={() => setDetailTaskId(task.id)}
                    onToggleSubtask={toggleSubtaskComplete}
                    onUpdateSubtaskTitle={updateSubtaskTitleInline}
                    onUpdateSubtaskDueDate={updateSubtaskDueDateInline}
                    onReorderSubtasks={reorderSubtasks}
                    selectionMode={bulkSelectionMode}
                    selected={selectedTaskIds.has(task.id)}
                    onToggleSelect={() => toggleTaskSelect(task.id)}
                  />
                ))
              )}
              {incompleteTasks.length === 0 && (
                <p className="px-1 py-4 text-sm text-cream/50">タスクはありません。</p>
              )}
            </div>

            {completedTasks.length > 0 && (
              <div className="mt-4 border-t border-cream/10 pt-3">
                <button
                  className="mb-2 text-xs text-cream/50 hover:text-cream/80"
                  onClick={() => setShowCompleted((v) => !v)}
                >
                  {showCompleted ? "▼" : "▶"} 完了済み（{completedTasks.length}）
                </button>
                {showCompleted && (
                  <div className="space-y-3">
                    {completedTasks.map((task) => (
                      <TaskBlock
                        key={task.id}
                        task={task}
                        subtasks={subtasksByParent.get(task.id) ?? []}
                        listTitle={searchActive ? listTitleById.get(task.listId) : undefined}
                        onToggleComplete={() => toggleComplete(task)}
                        onToggleImportant={() => toggleImportant(task)}
                        onOpenDetail={() => setDetailTaskId(task.id)}
                        onToggleSubtask={toggleSubtaskComplete}
                        onUpdateSubtaskTitle={updateSubtaskTitleInline}
                        onUpdateSubtaskDueDate={updateSubtaskDueDateInline}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {bottomViewBar && (
        <BottomTabBar
          items={[
            { key: "myday", icon: "☀", label: "マイデイ" },
            { key: "important", icon: "★", label: "重要" },
            { key: "planned", icon: "📅", label: "期限日" },
            { key: "overdue", icon: "⚠", label: "期限切れ", count: overdueTasks.length },
          ]}
          activeKey={view}
          onSelect={(k) => setView(k as ViewKey)}
          style={tabBarStyle as TabBarStyle}
          adaptiveEmphasis={tabBarAdaptiveEmphasis}
        />
      )}

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          subtasks={subtasksByParent.get(detailTask.id) ?? []}
          lists={lists ?? []}
          tagOptions={tagOptions}
          categoryOptions={categoryOptions}
          customerOptions={customerOptions}
          today={today}
          linkedProjectTitle={detailTask.projectId ? projectTitleById.get(detailTask.projectId) : undefined}
          onClose={() => setDetailTaskId(null)}
          onToggleMyDay={() => toggleMyDay(detailTask)}
          onDelete={() => deleteTask(detailTask)}
          onCopy={() => copyTask(detailTask)}
          onReflectToProject={(category, workName) => reflectToProject(detailTask, category, workName)}
          onAddToToday={(category, workName) => addTaskToToday(detailTask, category, workName)}
          onConvertToMemo={() => convertTodoToMemo(detailTask, subtasksByParent.get(detailTask.id) ?? [])}
          alreadyAddedToToday={addedTodoTaskIdsToday.has(detailTask.id)}
        />
      )}

      {pendingCompleteTask && (
        <Modal title="サブタスクが未完了です" onClose={() => setPendingCompleteTask(null)}>
          <p className="mb-4 text-sm text-cream/80">
            「{pendingCompleteTask.title}」には未完了のサブタスクが
            {(subtasksByParent.get(pendingCompleteTask.id) ?? []).filter((s) => !s.completed).length}件残っています。
            どうしますか？
          </p>
          <div className="flex flex-col gap-2">
            <button className="btn-pill text-sm" onClick={resolveCompleteWithSubtasks}>
              サブタスクもまとめて完了にする
            </button>
            <button className="btn-pill-outline text-sm" onClick={resolveCompleteTaskOnly}>
              タスクだけ完了にする（サブタスクはそのまま）
            </button>
            <button className="text-xs text-cream/50" onClick={() => setPendingCompleteTask(null)}>
              キャンセル
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// 期限切れタスクを一覧表示し、チェックボックスでの選択と、選択した分をまとめて
// （1件だけ選べば個別、複数/全選択すれば一括で）リスケジュールできるようにする
function OverdueBulkList({
  tasks,
  today,
  parentTitleById,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  rescheduleDate,
  onRescheduleDateChange,
  onApplyReschedule,
  onQuickReschedule,
  onOpenDetail,
}: {
  tasks: TodoTask[];
  today: string;
  parentTitleById: Map<string, string>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  rescheduleDate: string;
  onRescheduleDateChange: (date: string) => void;
  onApplyReschedule: () => void;
  onQuickReschedule: (days: number) => void;
  onOpenDetail: (id: string) => void;
}) {
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));
  const { themedMode, wordingThemedMode } = useVisualMode();

  if (tasks.length === 0) {
    return <p className="px-1 py-4 text-sm text-cream/50">期限切れのタスクはありません。</p>;
  }

  return (
    <div className="space-y-3">
      <div className="panel space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            className="text-xs text-cream/60 hover:text-cream"
            onClick={allSelected ? onClearSelection : onSelectAll}
          >
            {allSelected ? "☑ 選択解除" : "☐ すべて選択"}
          </button>
          <span className="text-xs text-cream/50">選択中 {selectedIds.size}件 / 全{tasks.length}件</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-pill-outline text-xs"
            disabled={selectedIds.size === 0}
            onClick={() => onQuickReschedule(0)}
          >
            今日に変更
          </button>
          <button
            className="btn-pill-outline text-xs"
            disabled={selectedIds.size === 0}
            onClick={() => onQuickReschedule(1)}
          >
            明日に変更
          </button>
          <button
            className="btn-pill-outline text-xs"
            disabled={selectedIds.size === 0}
            onClick={() => onQuickReschedule(7)}
          >
            1週間後に変更
          </button>
          <input
            type="date"
            value={rescheduleDate}
            onChange={(e) => onRescheduleDateChange(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-sm text-cream"
          />
          <button className="btn-pill text-xs" disabled={selectedIds.size === 0} onClick={onApplyReschedule}>
            選択した{selectedIds.size}件をこの日付に変更
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {tasks.map((task) => {
          const daysOverdue = task.dueDate ? daysBetweenDateStrs(task.dueDate, today) : null;
          return (
            <div
              key={task.id}
              className={`flex items-center gap-3 rounded-lg border border-alert/30 bg-alert/5 px-3 py-2 ${
                themedMode ? cardOverrunClass(themedMode) : ""
              }`}
            >
              <button
                onClick={() => onToggleSelect(task.id)}
                aria-label="選択"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs ${
                  selectedIds.has(task.id) ? "border-cream bg-cream text-ink" : "border-cream/40"
                }`}
              >
                {selectedIds.has(task.id) ? "✓" : ""}
              </button>
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpenDetail(task.id)}>
                {task.parentTaskId && (
                  <div className="truncate text-[10px] text-cream/40">
                    └ {parentTitleById.get(task.parentTaskId) ?? "親タスク"}のサブタスク
                  </div>
                )}
                <div className="truncate text-sm text-cream">{task.title}</div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-cream/50">
                  {task.tag && <span>{task.tag}</span>}
                  {task.category && <span>{task.category}</span>}
                  {task.customer && <span>{task.customer}</span>}
                </div>
              </button>
              <div className={`shrink-0 text-right text-xs font-bold ${themedMode ? emphasisTextClass(themedMode) : "text-alert"}`}>
                {task.dueDate ? formatDateJp(task.dueDate) : ""}
                {daysOverdue !== null && daysOverdue > 0 && (
                  <div className={`text-[10px] ${themedMode ? "overrun-flicker" : ""}`}>
                    {wordingThemedMode === "va11halla"
                      ? `${daysOverdue}日 オーダー未処理`
                      : wordingThemedMode === "persona5"
                        ? `${daysOverdue}日 未接触の標的`
                        : wordingThemedMode === "natsuyasumi"
                          ? `日記が${daysOverdue}日分たまってます`
                          : wordingThemedMode === "lobotomy"
                              ? `${daysOverdue}日 業務逸脱`
                              : `${daysOverdue}日超過`}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// サブタスク1行分。名前・期日をその場で編集できる入力欄を持つ
function SubtaskRow({
  sub,
  today,
  onToggleSubtask,
  onUpdateSubtaskTitle,
  onUpdateSubtaskDueDate,
  dragHandleProps,
}: {
  sub: TodoTask;
  today: string;
  onToggleSubtask: (sub: TodoTask) => void;
  onUpdateSubtaskTitle: (sub: TodoTask, title: string) => void;
  onUpdateSubtaskDueDate: (sub: TodoTask, dueDate: string) => void;
  dragHandleProps?: { attributes: ReturnType<typeof useSortable>["attributes"]; listeners: ReturnType<typeof useSortable>["listeners"] };
}) {
  const subOverdue = !sub.completed && !!sub.dueDate && sub.dueDate < today;
  const subDueToday = !sub.completed && !!sub.dueDate && sub.dueDate === today;
  return (
    <div
      className={`rounded-lg border border-cream/20 bg-ink/50 px-2 py-1.5 ${sub.completed ? "opacity-50" : ""} ${
        subDueToday ? "ring-1 ring-alert/40" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        {dragHandleProps && (
          <button
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
            className="shrink-0 cursor-grab px-0.5 text-cream/30 active:cursor-grabbing"
            aria-label="サブタスクを並び替え"
          >
            ⠿
          </button>
        )}
        <button
          onClick={() => onToggleSubtask(sub)}
          aria-label="完了"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
            sub.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
          }`}
        >
          {sub.completed ? "✓" : ""}
        </button>
        <input
          key={sub.id + sub.title}
          defaultValue={sub.title}
          onBlur={(e) => onUpdateSubtaskTitle(sub, e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={`min-w-0 flex-1 bg-transparent text-xs text-cream focus:outline-none focus:ring-1 focus:ring-cream/30 ${
            sub.completed ? "text-cream/40 line-through" : ""
          }`}
        />
      </div>
      <div className="mt-1 flex items-center justify-end gap-2">
        {subDueToday && (
          <span className="shrink-0 rounded-full bg-alert/20 px-1 py-0.5 text-[9px] font-bold text-alert">本日</span>
        )}
        <input
          key={sub.id + (sub.dueDate ?? "")}
          type="date"
          defaultValue={sub.dueDate ?? ""}
          onChange={(e) => onUpdateSubtaskDueDate(sub, e.target.value)}
          className={`w-[8.5rem] shrink-0 rounded border border-transparent bg-transparent px-0.5 text-[10px] focus:border-cream/20 focus:outline-none ${
            subOverdue || subDueToday ? "font-bold text-alert" : "text-cream/40"
          }`}
        />
      </div>
    </div>
  );
}

function SortableSubtaskRow(props: {
  sub: TodoTask;
  today: string;
  onToggleSubtask: (sub: TodoTask) => void;
  onUpdateSubtaskTitle: (sub: TodoTask, title: string) => void;
  onUpdateSubtaskDueDate: (sub: TodoTask, dueDate: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.sub.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <SubtaskRow {...props} dragHandleProps={{ attributes, listeners }} />
    </div>
  );
}

// メインタスクの下にサブタスクを一段ずらして表示する（Todoist風）
function TaskBlock({
  task,
  subtasks,
  listTitle,
  onToggleComplete,
  onToggleImportant,
  onOpenDetail,
  onToggleSubtask,
  onUpdateSubtaskTitle,
  onUpdateSubtaskDueDate,
  onReorderSubtasks,
  selectionMode,
  selected,
  onToggleSelect,
}: {
  task: TodoTask;
  subtasks: TodoTask[];
  listTitle?: string;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onOpenDetail: () => void;
  onToggleSubtask: (sub: TodoTask) => void;
  onUpdateSubtaskTitle: (sub: TodoTask, title: string) => void;
  onUpdateSubtaskDueDate: (sub: TodoTask, dueDate: string) => void;
  onReorderSubtasks?: (subtasks: TodoTask[], oldIndex: number, newIndex: number) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const today = todayStr();
  // 設定画面の「完了済みサブタスクの表示」と同じキーを共有する。ここで切り替えても
  // 設定画面側の表示に反映され、逆に設定画面で変えてもここに反映される(単一の値)
  const [showCompletedSubtasksStr, setShowCompletedSubtasksStr] = useSetting("todo.showCompletedSubtasks", "true");
  const showCompletedSubtasks = showCompletedSubtasksStr === "true";
  const [subtasksCollapsed, setSubtasksCollapsed] = useState(false);
  const subtaskSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // 進捗表示(TaskRow内の「完了数/全数」)は全サブタスクを対象にする一方、
  // ここでの一覧描画だけ設定に応じて完了済みを間引く
  const visibleSubtasks = showCompletedSubtasks ? subtasks : subtasks.filter((s) => !s.completed);
  const doneSubtaskCount = subtasks.filter((s) => s.completed).length;

  function handleSubtaskDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorderSubtasks) return;
    const oldIndex = visibleSubtasks.findIndex((s) => s.id === active.id);
    const newIndex = visibleSubtasks.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorderSubtasks(visibleSubtasks, oldIndex, newIndex);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        {selectionMode && (
          <button
            onClick={onToggleSelect}
            aria-label="選択"
            className={`mt-3 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 text-[10px] ${
              selected ? "border-cream bg-cream text-ink" : "border-cream/40"
            }`}
          >
            {selected ? "✓" : ""}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <TaskRow
            task={task}
            subtasks={subtasks}
            listTitle={listTitle}
            onToggleComplete={onToggleComplete}
            onToggleImportant={onToggleImportant}
            onOpenDetail={onOpenDetail}
          />
        </div>
      </div>
      {subtasks.length > 0 && (
        <div className="ml-7 space-y-1.5 border-l border-cream/10 pl-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              onClick={() => setSubtasksCollapsed((c) => !c)}
              className="flex items-center gap-1 text-[10px] text-cream/40"
              aria-expanded={!subtasksCollapsed}
              aria-label={subtasksCollapsed ? "サブタスクを展開" : "サブタスクを折りたたむ"}
            >
              <span className={`inline-block transition-transform ${subtasksCollapsed ? "-rotate-90" : ""}`}>▾</span>
              サブタスク {doneSubtaskCount}/{subtasks.length}
            </button>
            {doneSubtaskCount > 0 && (
              <button
                type="button"
                onClick={() => setShowCompletedSubtasksStr(showCompletedSubtasks ? "false" : "true")}
                className="text-[10px] text-cream/40 underline decoration-dotted underline-offset-2 hover:text-cream/70"
              >
                {showCompletedSubtasks ? "完了済みを隠す" : `完了済み${doneSubtaskCount}件を表示`}
              </button>
            )}
          </div>
          {!subtasksCollapsed && (
            <>
              {visibleSubtasks.length === 0 && (
                <p className="text-[10px] text-cream/30">未完了のサブタスクはありません</p>
              )}
              {onReorderSubtasks ? (
                <DndContext sensors={subtaskSensors} collisionDetection={closestCenter} onDragEnd={handleSubtaskDragEnd}>
                  <SortableContext items={visibleSubtasks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                    {visibleSubtasks.map((sub) => (
                      <SortableSubtaskRow
                        key={sub.id}
                        sub={sub}
                        today={today}
                        onToggleSubtask={onToggleSubtask}
                        onUpdateSubtaskTitle={onUpdateSubtaskTitle}
                        onUpdateSubtaskDueDate={onUpdateSubtaskDueDate}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                visibleSubtasks.map((sub) => (
                  <SubtaskRow
                    key={sub.id}
                    sub={sub}
                    today={today}
                    onToggleSubtask={onToggleSubtask}
                    onUpdateSubtaskTitle={onUpdateSubtaskTitle}
                    onUpdateSubtaskDueDate={onUpdateSubtaskDueDate}
                  />
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SortableTaskBlock(props: {
  task: TodoTask;
  subtasks: TodoTask[];
  listTitle?: string;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onOpenDetail: () => void;
  onToggleSubtask: (sub: TodoTask) => void;
  onUpdateSubtaskTitle: (sub: TodoTask, title: string) => void;
  onUpdateSubtaskDueDate: (sub: TodoTask, dueDate: string) => void;
  onReorderSubtasks?: (subtasks: TodoTask[], oldIndex: number, newIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1">
      <button
        {...attributes}
        {...listeners}
        className="mt-2 cursor-grab px-1 text-cream/30 active:cursor-grabbing"
        aria-label="並び替え"
      >
        ⠿
      </button>
      <div className="min-w-0 flex-1">
        <TaskBlock {...props} />
      </div>
    </div>
  );
}

function TaskRow({
  task,
  subtasks,
  listTitle,
  onToggleComplete,
  onToggleImportant,
  onOpenDetail,
}: {
  task: TodoTask;
  subtasks: TodoTask[];
  listTitle?: string;
  onToggleComplete: () => void;
  onToggleImportant: () => void;
  onOpenDetail: () => void;
}) {
  const today = todayStr();
  const [autoImportantTag] = useSetting("todo.autoImportantTag", "対応中");
  const { themedMode } = useVisualMode();
  const dueDate = effectiveDueDate(task, subtasks);
  const overdue = !task.completed && !!dueDate && dueDate < today;
  const dueToday = !task.completed && !!dueDate && dueDate === today;
  const doneCount = subtasks.filter((s) => s.completed).length;
  // 期日がなく重要でもない、長期間手つかずのタスクは経過日数に応じて徐々に色褪せさせる
  // (期日ベースの赤系警告とは重ならない範囲だけを対象にする、静かな気づきのための表現)
  const ageDays = task.completed || dueDate || task.important ? 0 : daysBetweenDateStrs(todayStr(new Date(task.createdAt)), today);
  const agingClass = ageDays >= 30 ? "opacity-45 grayscale" : ageDays >= 14 ? "opacity-70 grayscale-[50%]" : "";
  return (
    <div
      title={ageDays >= 14 ? `${ageDays}日間手つかずです` : undefined}
      className={`flex items-center gap-2 rounded-lg border border-cream/25 bg-ink/70 px-3 py-2 shadow-sm transition-[opacity,filter] ${
        task.completed ? "opacity-50" : agingClass
      } ${overdue && themedMode ? cardOverrunClass(themedMode) : dueToday ? "ring-1 ring-alert/50" : ""}`}
    >
      <button
        onClick={onToggleComplete}
        aria-label="完了"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          task.completed ? "border-cream bg-cream text-ink" : task.important ? "border-alert" : "border-cream/40"
        }`}
      >
        {task.completed ? "✓" : ""}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onOpenDetail}>
        <div className="flex flex-wrap items-center gap-1.5">
          {listTitle && (
            <span className="rounded-full bg-cream/5 px-1.5 py-0.5 text-[10px] text-cream/40">{listTitle}</span>
          )}
          {task.tag && (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                !!autoImportantTag && task.tag === autoImportantTag
                  ? "border-alert/50 bg-alert/15 font-bold text-alert"
                  : "border-cream/30 text-cream/80"
              }`}
            >
              {task.tag}
            </span>
          )}
          {task.category && (
            <span className="rounded-full border border-cream/20 bg-cream/5 px-1.5 py-0.5 text-[10px] text-cream/60">
              {task.category}
            </span>
          )}
          {task.customer && (
            <span className="rounded-full bg-cream/10 px-1.5 py-0.5 text-[10px] text-cream/60">
              {task.customer}
            </span>
          )}
          <span className={`text-sm text-cream ${task.completed ? "line-through" : ""}`}>{task.title}</span>
          {task.action && <span className="text-xs text-cream/50">→ {task.action}</span>}
          {task.recurrence && !task.completed && <span className="text-xs text-cream/40">🔁</span>}
          {task.projectId && (
            <span className="text-xs text-cream/40" title="案件に反映済み">
              📁
            </span>
          )}
          {task.reminderAt && !task.reminderFiredAt && (
            <span className="text-xs text-cream/40" title={`${formatDateTimeJp(task.reminderAt)}に通知`}>
              🔔 {formatDateTimeJp(task.reminderAt)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {dueDate && (
            <span
              className={
                overdue
                  ? `font-bold ${themedMode ? emphasisTextClass(themedMode) : "text-alert"} ${themedMode ? "overrun-flicker" : ""}`
                  : dueToday
                    ? "font-bold text-alert"
                    : "text-cream/50"
              }
            >
              {task.startDate && task.dueDate
                ? `${formatDateJp(task.startDate)} → ${formatDateJp(task.dueDate)}`
                : formatDateJp(dueDate)}
              {!task.dueDate && <span className="ml-1 text-cream/30">(サブタスク)</span>}
              {dueToday && (
                <span className="ml-1 rounded-full bg-alert/20 px-1.5 py-0.5 text-[9px] font-bold text-alert">本日</span>
              )}
            </span>
          )}
          {subtasks.length > 0 && (
            <span className="text-cream/40">
              {doneCount}/{subtasks.length}
            </span>
          )}
        </div>
      </button>
      {task.url && (
        <button
          onClick={() => window.open(normalizeUrl(task.url!), "_blank", "noopener,noreferrer")}
          aria-label="リンクを開く"
          title={task.url}
          className="shrink-0 text-lg text-cream/50 hover:text-cream"
        >
          🔗
        </button>
      )}
      <button onClick={onToggleImportant} aria-label="重要" className="shrink-0 text-lg">
        {task.important ? <span className="text-alert">★</span> : <span className="text-cream/30">☆</span>}
      </button>
    </div>
  );
}

function TaskDetailModal({
  task,
  subtasks,
  lists,
  tagOptions,
  categoryOptions,
  customerOptions,
  today,
  linkedProjectTitle,
  onClose,
  onToggleMyDay,
  onDelete,
  onCopy,
  onReflectToProject,
  onAddToToday,
  onConvertToMemo,
  alreadyAddedToToday,
}: {
  task: TodoTask;
  subtasks: TodoTask[];
  lists: TodoList[];
  tagOptions: string[];
  categoryOptions: string[];
  customerOptions: string[];
  today: string;
  linkedProjectTitle?: string;
  onClose: () => void;
  onToggleMyDay: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onReflectToProject: (category: string, workName: string) => void;
  onAddToToday: (category: string, workName: string) => void;
  onConvertToMemo: () => void;
  alreadyAddedToToday: boolean;
}) {
  const [autoImportantTag] = useSetting("todo.autoImportantTag", "対応中");
  const [showReflectDialog, setShowReflectDialog] = useState(false);
  const [showAddToTodayDialog, setShowAddToTodayDialog] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [listId, setListId] = useState(task.listId);
  const [action, setAction] = useState(task.action ?? "");
  const [url, setUrl] = useState(task.url ?? "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [startDate, setStartDate] = useState(task.startDate ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [reminderInput, setReminderInput] = useState(task.reminderAt ? toDatetimeLocalValue(task.reminderAt) : "");
  const [tagMode, setTagMode] = useState(task.tag && !tagOptions.includes(task.tag) ? CUSTOM_TAG_VALUE : (task.tag ?? NO_TAG_VALUE));
  const [customTag, setCustomTag] = useState(task.tag && !tagOptions.includes(task.tag) ? task.tag : "");
  const [categoryMode, setCategoryMode] = useState(
    task.category && !categoryOptions.includes(task.category) ? CUSTOM_CATEGORY_VALUE : (task.category ?? NO_CATEGORY_VALUE)
  );
  const [customCategory, setCustomCategory] = useState(
    task.category && !categoryOptions.includes(task.category) ? task.category : ""
  );
  const [customerMode, setCustomerMode] = useState(
    task.customer && !customerOptions.includes(task.customer) ? CUSTOM_CUSTOMER_VALUE : (task.customer ?? NO_CUSTOMER_VALUE)
  );
  const [customCustomer, setCustomCustomer] = useState(
    task.customer && !customerOptions.includes(task.customer) ? task.customer : ""
  );
  const [clientId, setClientId] = useState(task.clientId ?? "");
  const clients = useLiveQuery(() => db.clients.orderBy("order").toArray(), []);
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(!!task.recurrence);
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(
    task.recurrence ?? { type: "weekly", interval: 1, weekdays: [new Date().getDay()] }
  );
  const [newSubtask, setNewSubtask] = useState("");

  function resolveTag(): string | undefined {
    if (tagMode === CUSTOM_TAG_VALUE) return customTag.trim() || undefined;
    return tagMode || undefined;
  }

  function resolveCategory(): string | undefined {
    if (categoryMode === CUSTOM_CATEGORY_VALUE) return customCategory.trim() || undefined;
    return categoryMode || undefined;
  }

  function resolveCustomer(): string | undefined {
    if (customerMode === CUSTOM_CUSTOMER_VALUE) return customCustomer.trim() || undefined;
    return customerMode || undefined;
  }

  async function save() {
    if (!title.trim()) return;
    const tag = resolveTag();
    const updates: Partial<TodoTask> = {
      title: title.trim(),
      action: action.trim() || undefined,
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
      startDate: startDate || undefined,
      dueDate: dueDate || undefined,
      tag,
      category: resolveCategory(),
      customer: resolveCustomer(),
      clientId: clientId || undefined,
      recurrence: recurrenceEnabled ? recurrence : undefined,
    };
    // 設定で指定したタグが選択されていれば自動的に重要にする（タグを外しても重要フラグは自動では解除しない）
    if (autoImportantTag && tag === autoImportantTag) {
      updates.important = true;
    }
    // 期日を今日にした場合はマイデイに自動反映する
    if (dueDate === today) {
      updates.myDayDate = today;
    }
    // リストを変更した場合、サブタスクも一緒に新しいリストへ移す(サブタスクだけ元の
    // リストに取り残されて宙に浮いてしまうのを防ぐ)。並び順は移動先リストの末尾にする
    const listChanged = listId !== task.listId;
    if (listChanged) {
      updates.listId = listId;
      if (!task.parentTaskId) {
        const count = (await db.todoTasks.where("listId").equals(listId).toArray()).filter((t) => !t.parentTaskId).length;
        updates.order = count;
      }
    }
    // 開始日(優先)または期日が設定されていれば、リスト内で日付順の位置に並べ替える
    // (リストを変更した場合は移動先リストの末尾を優先するため、ここでは上書きしない)
    const sortDate = startDate || dueDate;
    if (sortDate && !task.parentTaskId && !listChanged) {
      updates.order = await computeDateOrderedPosition(task.listId, task.id, sortDate);
    }
    await db.todoTasks.update(task.id, updates);
    if (listChanged && subtasks.length > 0) {
      await db.transaction("rw", db.todoTasks, async () => {
        for (const sub of subtasks) await db.todoTasks.update(sub.id, { listId });
      });
    }
    onClose();
  }

  // 通知(リマインダー)は他のフィールドと違い「保存」ボタンを待たず即座に反映する
  // (お気に入りやマイデイ追加などの即時アクションと同じ扱い)。再設定した場合は
  // reminderFiredAtをクリアし、その新しい時刻でまた通知できるようにする
  async function setReminder() {
    const ms = fromDatetimeLocalValue(reminderInput);
    if (!ms) return;
    await db.todoTasks.update(task.id, { reminderAt: ms, reminderFiredAt: undefined });
  }

  async function clearReminder() {
    setReminderInput("");
    await db.todoTasks.update(task.id, { reminderAt: undefined, reminderFiredAt: undefined });
  }

  async function addSubtask() {
    if (!newSubtask.trim()) return;
    await db.todoTasks.add({
      id: uid(),
      listId: task.listId,
      parentTaskId: task.id,
      title: newSubtask.trim(),
      important: false,
      completed: false,
      order: subtasks.length,
      createdAt: Date.now(),
    });
    setNewSubtask("");
  }

  async function toggleSubtask(sub: TodoTask) {
    await db.todoTasks.update(sub.id, { completed: !sub.completed, completedAt: !sub.completed ? Date.now() : undefined });
  }

  async function deleteSubtask(sub: TodoTask) {
    await db.todoTasks.delete(sub.id);
  }

  async function updateSubtaskDueDate(sub: TodoTask, dueDate: string) {
    await db.todoTasks.update(sub.id, { dueDate: dueDate || undefined });
  }

  async function updateSubtaskTitle(sub: TodoTask, title: string) {
    const trimmed = title.trim();
    if (!trimmed || trimmed === sub.title) return;
    await db.todoTasks.update(sub.id, { title: trimmed });
  }

  return (
    <Modal title="タスクの詳細" onClose={onClose}>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          placeholder="タイトル"
        />

        {lists.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-cream/60">
            リスト
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-sm text-cream"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <input
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          placeholder="アクション（次にすべき行動）"
        />

        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            placeholder="URL（一覧のリンクボタンから開けます）"
          />
          {url.trim() && (
            <button
              onClick={() => window.open(normalizeUrl(url.trim()), "_blank", "noopener,noreferrer")}
              aria-label="リンクを開く"
              className="shrink-0 text-lg text-cream/50 hover:text-cream"
            >
              🔗
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">対応状況</label>
          <select
            value={tagMode}
            onChange={(e) => setTagMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            <option value={NO_TAG_VALUE}>対応状況なし</option>
            {tagOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={CUSTOM_TAG_VALUE}>＋ 新しい対応状況...</option>
          </select>
          {tagMode === CUSTOM_TAG_VALUE && (
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              placeholder="対応状況名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">分類</label>
          <select
            value={categoryMode}
            onChange={(e) => setCategoryMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            <option value={NO_CATEGORY_VALUE}>分類なし</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={CUSTOM_CATEGORY_VALUE}>＋ 新しい分類...</option>
          </select>
          {categoryMode === CUSTOM_CATEGORY_VALUE && (
            <input
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="分類名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">客先</label>
          <select
            value={customerMode}
            onChange={(e) => setCustomerMode(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            <option value={NO_CUSTOMER_VALUE}>客先なし</option>
            {customerOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={CUSTOM_CUSTOMER_VALUE}>＋ 新しい客先...</option>
          </select>
          {customerMode === CUSTOM_CUSTOMER_VALUE && (
            <input
              value={customCustomer}
              onChange={(e) => setCustomCustomer(e.target.value)}
              placeholder="客先名"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">取引先</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            <option value="">（なし）</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-cream/40">「案件」タブで登録した取引先マスタと紐付けます（客先とは別）</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">開始日</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          />
          {startDate && (
            <button className="text-xs text-cream/50 hover:text-alert" onClick={() => setStartDate("")}>
              クリア
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">期日</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          />
          {dueDate && (
            <button className="text-xs text-cream/50 hover:text-alert" onClick={() => setDueDate("")}>
              クリア
            </button>
          )}
        </div>
        <p className="text-[10px] text-cream/40">
          開始日を設定した場合、リスト内の並び順は期日ではなく開始日が優先されます。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-cream/60">🔔 通知</label>
          <input
            type="datetime-local"
            value={reminderInput}
            onChange={(e) => setReminderInput(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          />
          <button className="btn-pill-outline text-xs" onClick={setReminder} disabled={!reminderInput}>
            設定
          </button>
          {task.reminderAt && (
            <button className="text-xs text-cream/50 hover:text-alert" onClick={clearReminder}>
              クリア
            </button>
          )}
        </div>
        {task.reminderAt && (
          <p className="text-[10px] text-cream/40">
            {formatDateTimeJp(task.reminderAt)}に通知{task.reminderFiredAt ? "（通知済み）" : ""}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            className={task.myDayDate === today ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={onToggleMyDay}
          >
            ☀ {task.myDayDate === today ? "マイデイから削除" : "マイデイに追加"}
          </button>
          <button
            className={task.projectId ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowReflectDialog(true)}
            disabled={!!task.projectId}
          >
            📁 {task.projectId ? "案件に反映済み" : "案件に反映"}
          </button>
          <button
            className={alreadyAddedToToday ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowAddToTodayDialog(true)}
            disabled={alreadyAddedToToday}
          >
            📌 {alreadyAddedToToday ? "本日の作業に追加済み" : "本日の作業に追加"}
          </button>
          <button
            className="btn-pill-outline text-xs"
            onClick={onConvertToMemo}
            title={subtasks.length > 0 ? "サブタスクを含めてチェックリスト付箋にします" : "タイトル・次の行動・メモをまとめた付箋にします"}
          >
            📝 メモに変換
          </button>
        </div>

        {showReflectDialog && (
          <CategoryWorkNameDialog
            title="案件に反映"
            confirmLabel="反映する"
            defaultCategory={task.tag ?? ""}
            defaultWorkName={task.title}
            onConfirm={(category, workName) => {
              onReflectToProject(category, workName);
              setShowReflectDialog(false);
            }}
            onClose={() => setShowReflectDialog(false)}
          />
        )}

        {showAddToTodayDialog && (
          <CategoryWorkNameDialog
            title="本日の作業に追加"
            confirmLabel="追加する"
            defaultCategory={linkedProjectTitle ?? task.tag ?? ""}
            defaultWorkName={task.title}
            onConfirm={(category, workName) => {
              onAddToToday(category, workName);
              setShowAddToTodayDialog(false);
            }}
            onClose={() => setShowAddToTodayDialog(false)}
          />
        )}

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="メモ"
          rows={3}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />

        {/* 繰り返し設定 */}
        <div className="rounded-lg border border-cream/10 p-3">
          <label className="flex items-center gap-2 text-xs text-cream/70">
            <input
              type="checkbox"
              checked={recurrenceEnabled}
              onChange={(e) => setRecurrenceEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            繰り返し
          </label>
          {recurrenceEnabled && (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={recurrence.type}
                  onChange={(e) => setRecurrence({ ...recurrence, type: e.target.value as RecurrenceType })}
                  className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                >
                  {(Object.keys(RECURRENCE_TYPE_LABELS) as RecurrenceType[]).map((t) => (
                    <option key={t} value={t}>
                      {RECURRENCE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-cream/60">間隔</span>
                <input
                  type="number"
                  min={1}
                  value={recurrence.interval}
                  onChange={(e) => setRecurrence({ ...recurrence, interval: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                />
              </div>

              {recurrence.type === "weekly" && (
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    onClick={() => setRecurrence({ ...recurrence, weekdays: [1, 2, 3, 4, 5] })}
                    className="btn-pill-outline text-xs"
                  >
                    平日
                  </button>
                  {WEEKDAY_JP.map((label, w) => {
                    const active = (recurrence.weekdays ?? []).includes(w);
                    return (
                      <button
                        key={w}
                        onClick={() => {
                          const cur = recurrence.weekdays ?? [];
                          const next = active ? cur.filter((x) => x !== w) : [...cur, w];
                          setRecurrence({ ...recurrence, weekdays: next });
                        }}
                        className={active ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              {recurrence.type === "monthlyDate" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
                  <span>毎月</span>
                  <button
                    onClick={() => setRecurrence({ ...recurrence, day: 1 })}
                    className={(recurrence.day ?? 1) === 1 ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                  >
                    月初
                  </button>
                  <button
                    onClick={() => setRecurrence({ ...recurrence, day: -1 })}
                    className={recurrence.day === -1 ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                  >
                    月末
                  </button>
                  {recurrence.day !== -1 && (
                    <>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={recurrence.day ?? 1}
                        onChange={(e) => setRecurrence({ ...recurrence, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                        className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                      />
                      <span>日</span>
                    </>
                  )}
                </div>
              )}

              {recurrence.type === "monthlyWeekday" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
                  <span>毎月</span>
                  <select
                    value={recurrence.ordinal ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, ordinal: Number(e.target.value) as 1 | 2 | 3 | 4 | -1 })}
                    className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                  >
                    {([1, 2, 3, 4, -1] as (1 | 2 | 3 | 4 | -1)[]).map((o) => (
                      <option key={o} value={o}>
                        {ORDINAL_LABELS[o]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={recurrence.weekday ?? 5}
                    onChange={(e) => setRecurrence({ ...recurrence, weekday: Number(e.target.value) })}
                    className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
                  >
                    {WEEKDAY_JP.map((label, w) => (
                      <option key={w} value={w}>
                        {label}曜日
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {recurrence.type === "yearly" && (
                <div className="flex items-center gap-2 text-xs text-cream/60">
                  <span>毎年</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={recurrence.month ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, month: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                  />
                  <span>月</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={recurrence.day ?? 1}
                    onChange={(e) => setRecurrence({ ...recurrence, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
                    className="w-14 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-center text-xs text-cream"
                  />
                  <span>日</span>
                </div>
              )}
              <p className="text-[10px] text-cream/40">完了にすると自動で次回の期日に進み、完了状態には戻りません。</p>
            </div>
          )}
        </div>

        {/* サブタスク: 親から一段ずらして表示 */}
        <div>
          <h4 className="mb-1.5 text-xs font-bold text-cream/70">サブタスク</h4>
          <div className="space-y-1.5 pl-4">
            {subtasks.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2 rounded-lg bg-ink/50 px-2 py-1.5">
                <button
                  onClick={() => toggleSubtask(sub)}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
                    sub.completed ? "border-cream bg-cream text-ink" : "border-cream/40"
                  }`}
                >
                  {sub.completed ? "✓" : ""}
                </button>
                <input
                  key={sub.id}
                  defaultValue={sub.title}
                  onBlur={(e) => updateSubtaskTitle(sub, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={`flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xs text-cream hover:border-cream/20 focus:border-cream/30 focus:bg-ink focus:outline-none ${
                    sub.completed ? "text-cream/40 line-through" : ""
                  }`}
                />
                <input
                  type="date"
                  defaultValue={sub.dueDate ?? ""}
                  onBlur={(e) => updateSubtaskDueDate(sub, e.target.value)}
                  className="w-32 shrink-0 rounded-md border border-cream/20 bg-ink px-1.5 py-1 text-[11px] text-cream"
                />
                <button className="text-cream/40 hover:text-alert" onClick={() => deleteSubtask(sub)} aria-label="削除">
                  ✕
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSubtask()}
                placeholder="+ サブタスクを追加"
                className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
              />
              <button className="btn-pill-outline text-xs" onClick={addSubtask}>
                追加
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-cream/10 pt-3">
        <button className="text-xs text-alert" onClick={onDelete}>
          タスクを削除
        </button>
        <div className="flex gap-2">
          <button className="btn-pill-outline text-sm" onClick={onCopy} title="内容をコピーして新しいタスクを追加します">
            コピーして追加
          </button>
          <button className="btn-pill text-sm" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}

// 対応状況(タグ)または分類(カテゴリ)を列にした、ドラッグ&ドロップで移動できるかんばん表示
function KanbanBoard({
  tasks,
  axis,
  onAxisChange,
  tagOptions,
  categoryOptions,
  autoImportantTag,
  onMoveTask,
  onOpenDetail,
}: {
  tasks: TodoTask[];
  axis: KanbanAxis;
  onAxisChange: (axis: KanbanAxis) => void;
  tagOptions: string[];
  categoryOptions: string[];
  autoImportantTag: string;
  onMoveTask: (task: TodoTask, axis: KanbanAxis, value: string | undefined) => void;
  onOpenDetail: (task: TodoTask) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const columns = useMemo(() => [...(axis === "tag" ? tagOptions : categoryOptions), KANBAN_UNSET], [axis, tagOptions, categoryOptions]);

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const col of columns) map.set(col, []);
    for (const t of tasks) {
      const value = axis === "tag" ? t.tag : t.category;
      const col = value && map.has(value) ? value : KANBAN_UNSET;
      map.get(col)!.push(t);
    }
    return map;
  }, [tasks, axis, columns]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    if (!overId.startsWith("col:")) return;
    const value = overId.slice(4);
    const task = tasks.find((t) => t.id === active.id);
    if (!task) return;
    const current = (axis === "tag" ? task.tag : task.category) ?? KANBAN_UNSET;
    if (current === value) return;
    onMoveTask(task, axis, value === KANBAN_UNSET ? undefined : value);
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-cream/60">列の基準:</span>
        <button
          className={axis === "tag" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => onAxisChange("tag")}
        >
          対応状況
        </button>
        <button
          className={axis === "category" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
          onClick={() => onAxisChange("category")}
        >
          分類
        </button>
        <span className="text-[10px] text-cream/40">カードをドラッグして列間を移動できます</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((col) => (
            <KanbanColumn
              key={col}
              columnId={col}
              label={col === KANBAN_UNSET ? "未設定" : col}
              tasks={tasksByColumn.get(col) ?? []}
              highlighted={axis === "tag" && !!autoImportantTag && col === autoImportantTag}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function KanbanColumn({
  columnId,
  label,
  tasks,
  highlighted,
  onOpenDetail,
}: {
  columnId: string;
  label: string;
  tasks: TodoTask[];
  highlighted: boolean;
  onOpenDetail: (task: TodoTask) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${columnId}` });
  return (
    <div
      ref={setNodeRef}
      className={`w-56 shrink-0 rounded-lg border p-2 transition-colors ${
        isOver ? "border-cream/50 bg-cream/5" : "border-cream/10"
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className={`text-xs font-bold ${highlighted ? "text-alert" : "text-cream/80"}`}>{label}</span>
        <span className="text-[10px] text-cream/40">{tasks.length}</span>
      </div>
      <div className="min-h-[2rem] space-y-1.5">
        {tasks.map((t) => (
          <KanbanCard key={t.id} task={t} onOpenDetail={() => onOpenDetail(t)} />
        ))}
        {tasks.length === 0 && <p className="px-1 py-2 text-[10px] text-cream/30">なし</p>}
      </div>
    </div>
  );
}

function KanbanCard({ task, onOpenDetail }: { task: TodoTask; onOpenDetail: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpenDetail}
      className={`w-full cursor-grab rounded-lg border border-cream/10 bg-ink/50 px-2 py-1.5 text-left active:cursor-grabbing ${
        task.completed ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center gap-1">
        {task.important && <span className="text-alert">★</span>}
        <span className={`flex-1 truncate text-xs text-cream ${task.completed ? "text-cream/40 line-through" : ""}`}>
          {task.title}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-cream/50">
        {task.customer && <span>{task.customer}</span>}
        {task.dueDate && <span>{formatDateJp(task.dueDate)}</span>}
      </div>
    </button>
  );
}
