"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { aggregateRecords } from "@/lib/aggregate";
import { db, uid } from "@/lib/db";
import { useHomeFilteredMasterTasks } from "@/lib/homeMode";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "@/lib/master";
import { collectMethodSuggestions } from "@/lib/method";
import {
  adjustStopTimeForBreaks,
  breakRangeKey,
  findBreakRangeAt,
  parseBreakRanges,
  timeToMsOfDay,
} from "@/lib/breaks";
import { useDraftSetting, useSetting } from "@/lib/settings";
import { cardOverrunClass, emphasisTextClass, getRiskTier, overrunLabel, useVisualMode, appTitle } from "@/lib/theme";
import {
  baseAccumulatedMs,
  computePredictedSecondsByTaskId,
  computeRemainingEstimatedSeconds,
  computeRunningOverrunTaskIds,
  addProvisionalTaskIfIdle,
  findMergeTargetRecord,
  finishDailyTask,
  importScheduleRows,
  segmentsAccumulatedMs,
  type FinishDailyTaskOptions,
} from "@/lib/tasks";
import { useRunningTaskStrip } from "@/lib/runningStrip";
import { parseScheduleCsv, scheduleCsvTemplate } from "@/lib/scheduleCsv";
import { DEFAULT_IMPORT_DAYS, parseIcsToScheduleRows } from "@/lib/icsImport";
import { downloadTextFile } from "@/lib/report";
import { computeStreakDays } from "@/lib/streak";
import { computeSuggestedTask } from "@/lib/suggest";
import { computeNextTaskPick } from "@/lib/nextTaskPick";
import { CONDITION_LEVELS, dominantConditionLevel, computeProductivityByCondition } from "@/lib/condition";
import { completeTodoTask } from "@/lib/todo";
import { computeWeekdayAverages } from "@/lib/weekday";
import { computeUntrackedGapSeconds } from "@/lib/gap";
import { computeProductivityByWeather } from "@/lib/weather";
import { fireConfetti } from "@/lib/confetti";
import { findDueScheduledTasks, findProvisionalStart, inactivityCutoff } from "@/lib/automation";

import { computeGrowthStage } from "@/lib/growth";
import { createSpeechRecognition, parseVoiceCommand, speak } from "@/lib/voice";
import { isStageDone } from "@/lib/projectStage";
import { computeAutoAllocation, type AutoAllocationResult } from "@/lib/allocate";
import {
  formatClock,
  formatMsClock,
  jsWeekdayToApp,
  todayStr,
} from "@/lib/time";
import { getNotificationPermission, notify, requestNotificationPermission } from "@/lib/notifications";
import type {
  BreakRange,
  DailyTask,
  GeoPlace,
  MasterTask,
  ProjectItem,
  TemplateItem,
  TimeSegment,
  Weekday,
  WorkRecord,
} from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/types";
import { showUndoToast } from "@/lib/toast";

import ConditionGlyph from "@/components/ui/ConditionGlyph";
import AddTaskDialog from "@/components/sections/AddTaskDialog";
import AddTimeDialog from "@/components/sections/AddTimeDialog";
import EditTaskDialog from "@/components/sections/EditTaskDialog";
import CompletedTasksGantt from "@/components/sections/CompletedTasksGantt";
import DeleteCompletedTaskDialog from "@/components/sections/DeleteCompletedTaskDialog";
import ManualFinishDialog from "@/components/sections/ManualFinishDialog";
import FinishAtDialog from "@/components/sections/FinishAtDialog";
import ProvisionalTaskCard from "@/components/sections/ProvisionalTaskCard";
import UnifiedBoardSection from "@/components/sections/UnifiedBoardSection";
import TodayStatusPanel from "@/components/sections/TodayStatusPanel";
import DailyChallengePanel from "@/components/DailyChallengePanel";
import TodayHintPanel from "@/components/TodayHintPanel";
import BackupNudge from "@/components/BackupNudge";
import DayCardModal from "@/components/DayCardModal";
import TodayMemoPanel from "@/components/TodayMemoPanel";
import TodayHandoffPanel from "@/components/TodayHandoffPanel";
import type { DayCardData } from "@/lib/dayCard";
import TomorrowDraftModal from "@/components/TomorrowDraftModal";
import DayPlanModal from "@/components/DayPlanModal";
import {
  ConditionStartDialog,
  OverrunPromptDialog,
  ProvisionalConflictDialog,
  RestartChoiceDialog,
  RunningConflictDialog,
  TemplateConfirmDialog,
} from "@/components/sections/today/ChoiceDialogs";
import DueDetailDialog from "@/components/sections/today/DueDetailDialog";
import LinkedCompletionDialog, { type LinkedCompletionConfirm } from "@/components/sections/today/LinkedCompletionDialog";
import SecondaryProjectsDialog from "@/components/sections/today/SecondaryProjectsDialog";
import TaskCard, { type TaskCardContext } from "@/components/sections/today/TaskCard";
import TodayToolbar from "@/components/sections/today/TodayToolbar";
import { useGeoArrivalWatch, useGeoMovementWatch, useWakeLock } from "@/components/sections/today/useLocationWatch";
import { useTodayNotifications } from "@/components/sections/today/useTodayNotifications";
import { useWeatherWatch } from "@/components/sections/today/useWeatherWatch";
import AutoAllocatePanel, { type AutoAllocateMode } from "@/components/sections/today/AutoAllocatePanel";
import {
  formatCrossingDateTime,
  GeoArrivalStatus,
  GeoTrackingStatus,
  WeatherStatus,
} from "@/components/sections/today/AutomationStatus";
import EndOfDayReflectionModal from "@/components/EndOfDayReflectionModal";
import BreakChecklistDialog from "@/components/sections/BreakChecklistDialog";
import BreakAssignDialog from "@/components/sections/BreakAssignDialog";
import BottomTabBar, { type TabBarStyle } from "@/components/ui/BottomTabBar";

const OVERRUN_REPROMPT_MS = 20 * 60 * 1000;

export default function TodaySection({
  onOpenTodoDetail,
  onOpenProjectEdit,
  onOpenMemo,
  onOpenTodoTab,
}: {
  onOpenTodoDetail: (taskId: string) => void;
  onOpenProjectEdit: (projectId: string) => void;
  onOpenMemo?: () => void;
  onOpenTodoTab?: () => void;
}) {
  const date = todayStr();
  // 構造化されたタスクとは別の、自由記述の日次ジャーナル。日付ごとに保存する
  const [dailyJournal, setDailyJournal] = useDraftSetting(`journal.daily.${date}`, "");
  const [now, setNow] = useState(() => Date.now());
  const [weekday, setWeekday] = useState<Weekday>(() => jsWeekdayToApp(new Date()) ?? 1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [scheduleImportErrors, setScheduleImportErrors] = useState<string[]>([]);
  const [scheduleImportResult, setScheduleImportResult] = useState("");
  const [notifPermission, setNotifPermission] = useState<string>("default");
  const [overrunTask, setOverrunTask] = useState<DailyTask | null>(null);
  // 案件の段階・案件(段階なし直付け)・ToDoのいずれかに紐づく作業を完了させた際、
  // その紐づく先も完了とみなせるかまとめて確認するキュー。1件の作業完了で複数の
  // 確認が該当する場合(例: 案件のToDoから反映された段階作業)も、一度に全部出さず
  // 順番に1つずつ確認する
  const [confirmQueue, setConfirmQueue] = useState<LinkedCompletionConfirm[]>([]);
  const activeConfirm = confirmQueue[0] ?? null;
  function advanceConfirmQueue() {
    setConfirmQueue((q) => q.slice(1));
  }
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);
  const [deletingCompletedTask, setDeletingCompletedTask] = useState<DailyTask | null>(null);
  // 兼務・並行作業向けに、主案件(projectId)以外の追加の案件タグを付ける小さなモーダルの対象タスク
  const [secondaryProjectsTask, setSecondaryProjectsTask] = useState<DailyTask | null>(null);
  const [manualFinishTask, setManualFinishTaskTarget] = useState<DailyTask | null>(null);
  const [finishAtTask, setFinishAtTask] = useState<DailyTask | null>(null);
  const [addTimeTask, setAddTimeTask] = useState<DailyTask | null>(null);
  const [conditionEditTaskId, setConditionEditTaskId] = useState<string | null>(null);
  // 当日最初の作業を開始する直前に体調を選ばせるための保留アクション。
  // nullでなければ「体調を記録してから開始しますか」モーダルを表示する
  const [pendingConditionStart, setPendingConditionStart] = useState<(() => void | Promise<void>) | null>(null);
  // 予定インポートの自動開始時刻になった際、既に計測中の作業があった場合に
  // 強制的に差し込まず、停止して開始するか確認するための保留状態
  const [scheduleConflict, setScheduleConflict] = useState<{ task: DailyTask; runningTasks: DailyTask[] } | null>(null);
  const [voiceEnabledStr] = useSetting("today.voiceEnabled", "false");
  const voiceEnabled = voiceEnabledStr === "true";
  const [showScheduleCsvToolsStr] = useSetting("csvTools.today", "true");
  const showScheduleCsvTools = showScheduleCsvToolsStr === "true";
  const [handsFreeModeStr] = useSetting("today.handsFreeEnabled", "false");
  const handsFreeMode = handsFreeModeStr === "true";
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const voiceRecognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  // ハンズフリーモード中かどうか。stateではなくrefで持つのは、onend/リトライのコールバック
  // からタイミングよく最新値を読みたいため(stateだとクロージャが古い値を掴む恐れがある)
  const handsFreeActiveRef = useRef(false);
  const [pendingQuickSlot, setPendingQuickSlot] = useState<number | null>(null);
  const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);
  const [quickStartEnabledStr] = useSetting("today.quickStartEnabled", "true");
  const quickStartEnabled = quickStartEnabledStr === "true";
  const [standardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [standardWorkEnd] = useSetting("today.standardWorkEnd", "17:00");
  // 自動配分: 残業務時間内に未完了作業(予測)を収めるための目標ペースを自動計算する機能。
  // 「オフ」「ライブ（常に再計算）」「手動（ボタンを押した時だけ計算）」を切り替えられる
  const [autoAllocateMode, setAutoAllocateMode] = useSetting("today.autoAllocateMode", "off");
  const [showStatusPanelStr] = useSetting("today.showStatusPanel", "true");
  const showStatusPanel = showStatusPanelStr === "true";
  const [showAutoAllocateStr] = useSetting("today.showAutoAllocate", "true");
  const showAutoAllocate = showAutoAllocateStr === "true";
  const [showSuggestedTaskStr] = useSetting("today.showSuggestedTask", "true");
  const showSuggestedTask = showSuggestedTaskStr === "true";
  const [showNextMovePickStr] = useSetting("today.showNextMovePick", "true");
  const showNextMovePick = showNextMovePickStr === "true";
  const [showDailyChallengeStr] = useSetting("today.showDailyChallenge", "true");
  const showDailyChallenge = showDailyChallengeStr === "true";
  const [favoritesCollapsedStr, setFavoritesCollapsedStr] = useSetting("today.collapseFavorites", "false");
  const favoritesCollapsed = favoritesCollapsedStr === "true";
  const { va11hallaMode, themedMode, wordingThemedMode, wordingMode } = useVisualMode();
  const [manualAllocation, setManualAllocation] = useState<AutoAllocationResult | null>(null);
  const [manualAllocationAt, setManualAllocationAt] = useState<number | null>(null);
  const [pendingStart, setPendingStart] = useState<
    { category: string; name: string; estimatedSeconds: number; masterTaskId: string | undefined } | null
  >(null);
  // 完了済みの作業を再開する際、「続きから開始」か「新しく開始」かを選ばせるための対象タスク
  const [restartChoice, setRestartChoice] = useState<DailyTask | null>(null);
  // 「続きから開始」を選んだ際に未計測(仮計測)が計測中だった場合、合算/破棄の判断を仰ぐための対象タスク
  const [pendingContinue, setPendingContinue] = useState<DailyTask | null>(null);
  const [thresholdMinutesStr] = useSetting("today.untrackedThresholdMinutes", "5");
  // "0" は「無操作を検知し次第すぐ開始」を意味する有効な値なので、falsyでも5分にフォールバックしない
  const thresholdMinutesNum = Number(thresholdMinutesStr);
  const thresholdMinutes = Number.isFinite(thresholdMinutesNum) ? Math.max(0, thresholdMinutesNum) : 5;
  const [provisionalEnabledStr] = useSetting("today.provisionalEnabled", "false");
  const provisionalEnabled = provisionalEnabledStr === "true";
  const [provisionalNotifyEnabledStr] = useSetting("today.provisionalNotifyEnabled", "true");
  const provisionalNotifyEnabled = provisionalNotifyEnabledStr === "true";
  const [breakRangesStr] = useSetting("today.provisionalBreakRanges", "[]");
  const breakRanges = useMemo(() => parseBreakRanges(breakRangesStr), [breakRangesStr]);
  // 強制ストップ対象の休憩帯。該当時刻になると計測中の作業を一時停止し、休憩扱いにする
  const forceStopBreakRanges = useMemo(() => breakRanges.filter((r) => r.forceStop), [breakRanges]);
  const activeForceStopRange = useMemo(
    () => findBreakRangeAt(now, date, forceStopBreakRanges),
    [now, date, forceStopBreakRanges]
  );
  // 本日、強制ストップ済みの休憩帯のキー一覧。1つの休憩帯につき1回だけ強制停止を行うためのガード
  const [breakStopHandledStr, setBreakStopHandledStr] = useSetting(`today.breakStopHandled.${date}`, "[]");
  const breakStopHandled = useMemo<Set<string>>(() => {
    try {
      const parsed = JSON.parse(breakStopHandledStr);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }, [breakStopHandledStr]);
  const [breakChecklistRange, setBreakChecklistRange] = useState<BreakRange | null>(null);
  const [breakAssignRange, setBreakAssignRange] = useState<BreakRange | null>(null);
  // 本日すでに始まっている強制ストップ休憩帯。移動・ミーティングなどで実際には
  // 作業していた場合に、後から作業へ割り当てられるようにする一覧表示に使う
  const startedForceStopRanges = useMemo(
    () => forceStopBreakRanges.filter((r) => timeToMsOfDay(date, r.start) <= now),
    [forceStopBreakRanges, date, now]
  );
  const provisionalNotifiedAtRef = useRef<number | null>(null);
  const [emphasizeRunningStr] = useSetting("today.emphasizeRunning", "false");
  const emphasizeRunning = emphasizeRunningStr === "true";
  const [tabBarStyle] = useSetting("ui.bottomTabBarStyle", "pill");
  const [tabBarAdaptiveEmphasisStr] = useSetting("ui.bottomTabBarAdaptiveEmphasis", "false");
  const tabBarAdaptiveEmphasis = tabBarAdaptiveEmphasisStr === "true";
  const [tabBarProgressStripStr] = useSetting("today.tabBarProgressStrip", "false");
  const tabBarProgressStrip = tabBarProgressStripStr === "true";
  const [provisionalIdleHoursStr] = useSetting("today.provisionalIdleThresholdHours", "3");
  const provisionalIdleMs = Math.max(0.5, Number(provisionalIdleHoursStr) || 3) * 3600000;
  const [geoTrackingEnabledStr] = useSetting("today.geoTrackingEnabled", "false");
  const geoTrackingEnabled = geoTrackingEnabledStr === "true";
  const [geoDistanceThresholdStr] = useSetting("today.geoDistanceThresholdMeters", "200");
  const geoDistanceThresholdMeters = Math.max(10, Number(geoDistanceThresholdStr) || 200);
  const [geoCategorySetting] = useSetting("today.geoCategory", "移動");
  const [geoTaskNameSetting] = useSetting("today.geoTaskName", "移動");
  const [geoStillMinutesStr] = useSetting("today.geoStillMinutes", "10");
  const geoStillMs = Math.max(1, Number(geoStillMinutesStr) || 10) * 60000;
  const geoFinishInFlightRef = useRef(false);
  // 位置情報: 登録地点への到着検知(自動開始)。移動検知(仮計測)とは別の独立した機能
  const [geoArrivalEnabledStr] = useSetting("today.geoArrivalEnabled", "false");
  const geoArrivalEnabled = geoArrivalEnabledStr === "true";
  const geoPlaces = useLiveQuery(() => db.geoPlaces.toArray(), []);
  // 未着手(pending)の作業カードのドラッグ&ドロップ並べ替え用。計測中・完了は常に上/下に
  // 固定されるため、並べ替え対象は未着手グループのみに限定する
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [geoArrivalConflict, setGeoArrivalConflict] = useState<{ place: GeoPlace; runningTasks: DailyTask[] } | null>(null);
  const [masterEditMode] = useSetting("records.masterEditMode", "relink");
  const [afterHoursCutoff] = useSetting("report.afterHoursCutoff", "18:00");
  const [conditionEnabledStr] = useSetting("condition.enabled", "true");
  const conditionEnabled = conditionEnabledStr === "true";
  const [simpleButtonsStr] = useSetting("today.simpleButtons", "false");
  const simpleButtons = simpleButtonsStr === "true";
  // 下部タブバーに出す「今なにを計測しているか」。件数だけでは中身が分からないため、
  // 作業名と経過時間を帯で添える
  const runningStrip = useRunningTaskStrip();
  // 実行中/予定/完了でタブ分けして表示するモード。選んだタブは端末に保存し、次回も同じ表示にする
  const [taskViewTabRaw, setTaskViewTab] = useSetting("today.taskViewTab", "running");
  const taskViewTab: "running" | "pending" | "done" | "board" =
    taskViewTabRaw === "pending" || taskViewTabRaw === "done" || taskViewTabRaw === "board" ? taskViewTabRaw : "running";
  const [growthStageEnabledStr] = useSetting("today.growthStageEnabled", "true");
  const growthStageEnabled = growthStageEnabledStr === "true";
  const [shortcutsEnabledStr] = useSetting("today.shortcutsEnabled", "true");
  const shortcutsEnabled = shortcutsEnabledStr === "true";
  // 直近でマウス/キーボード操作があった時刻。放置検知で未計測を打ち切る起点に使う
  const lastActivityRef = useRef(Date.now());
  const idleFinishInFlightRef = useRef(false);
  // 本日まだ一度も作業を停止していない場合の未計測起点。ページを開いた/日付が変わった時刻を仮の起点とする
  const sessionAnchorRef = useRef(Date.now());
  useEffect(() => {
    sessionAnchorRef.current = Date.now();
  }, [date]);

  const tasks = useLiveQuery(
    () => db.dailyTasks.where("date").equals(date).sortBy("order"),
    [date]
  );
  const favoritesRaw = useLiveQuery(
    () => db.masterTasks.filter((t) => t.isFavorite && !t.archived).toArray(),
    []
  );
  const favorites = useHomeFilteredMasterTasks(favoritesRaw);
  // お気に入りパネルの「完了した業務から再開」欄用: 本日中に同じ作業を何度も完了していても
  // 1つにまとめる(再開ボタンとして意味があるのは「その作業をもう一度始める」ことだけなので)
  const doneTodayUnique = useMemo(() => {
    const seen = new Set<string>();
    const result: DailyTask[] = [];
    for (const t of tasks ?? []) {
      if (t.status !== "done" || t.isProvisional) continue;
      const key = t.masterTaskId ?? `${t.category}::${t.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
    }
    return result;
  }, [tasks]);
  const allMasterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const favoriteMasterIds = useMemo(
    () => new Set((allMasterTasks ?? []).filter((m) => m.isFavorite).map((m) => m.id)),
    [allMasterTasks]
  );
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const projectRecords = useLiveQuery(() => db.records.toArray(), []);
  const conditionLogs = useLiveQuery(
    () => db.conditionLogs.where("date").equals(date).sortBy("loggedAt"),
    [date]
  );
  // 案件・Todoから「本日の作業」に反映されたタスクは、元のTodoタスクを作業カード上に
  // 表示し、その場で完了チェック・編集(Todoタブへ遷移)ができるようにする
  const linkedTodoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);

  const projectMap = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const todoTaskMap = useMemo(() => new Map((linkedTodoTasks ?? []).map((t) => [t.id, t])), [linkedTodoTasks]);
  // 案件ごとの累計作業時間（全期間の実績を合算）。案件から追加した作業のモチベーション表示に使う
  const projectTotalSeconds = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of projectRecords ?? []) {
      if (!r.projectId) continue;
      map.set(r.projectId, (map.get(r.projectId) ?? 0) + r.seconds);
    }
    return map;
  }, [projectRecords]);

  // 集計・ランキングで上位（累計時間トップ3）に入っている作業を、順位付きで把握しておく
  const topRankedKeys = useMemo(() => {
    if (!projectRecords || projectRecords.length === 0) return new Map<string, number>();
    const ranked = aggregateRecords(projectRecords, { type: "all" }, "total");
    return new Map(ranked.slice(0, 3).map((r, idx) => [r.key, idx]));
  }, [projectRecords]);

  // 同じ曜日・近い時間帯によく行っている作業を、過去の実績からワンタップ提案する
  const nowMinuteBucket = Math.floor(now / 60000);
  const suggestedTask = useMemo(() => {
    if (!projectRecords) return null;
    const nowDate = new Date(nowMinuteBucket * 60000);
    const suggestion = computeSuggestedTask(projectRecords, nowDate.getDay(), nowDate.getHours());
    if (!suggestion) return null;
    const alreadyToday = (tasks ?? []).some((t) => t.category === suggestion.category && t.name === suggestion.name);
    return alreadyToday ? null : suggestion;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRecords, nowMinuteBucket, tasks]);

  // 「そろそろこの作業では?」は曜日・時間帯パターンだけを見るため、締切や残り時間までは
  // 考慮しない。その隙間を埋める「今この一手」: 期限が来ているToDoや、終業までの残り時間に
  // 収まらない普段の提案の代わりになる短時間の代替を、普段の提案で足りない時だけ出す
  const nextTaskPick = useMemo(() => {
    if (!projectRecords || !allMasterTasks || !linkedTodoTasks) return null;
    const nowDate = new Date(nowMinuteBucket * 60000);
    const pick = computeNextTaskPick({
      records: projectRecords,
      masterTasks: allMasterTasks,
      todoTasks: linkedTodoTasks,
      favoriteMasterIds,
      today: date,
      now: nowDate,
      afterHoursCutoff,
    });
    if (!pick) return null;
    const alreadyToday = (tasks ?? []).some((t) => t.category === pick.category && t.name === pick.name);
    return alreadyToday ? null : pick;
  }, [projectRecords, allMasterTasks, linkedTodoTasks, favoriteMasterIds, date, nowMinuteBucket, afterHoursCutoff, tasks]);

  async function startNextTaskPick() {
    if (!nextTaskPick) return;
    const masterId = nextTaskPick.masterTaskId ?? (await findOrCreateMasterTask(nextTaskPick.category, nextTaskPick.name, 0)).id;
    requestStartNew(nextTaskPick.category, nextTaskPick.name, nextTaskPick.estimatedSeconds, masterId);
  }

  useEffect(() => {
    setNotifPermission(getNotificationPermission());
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // マウス/キーボード操作を監視し、放置検知（未計測の自動打ち切り）の起点として使う
  useEffect(() => {
    function markActivity() {
      lastActivityRef.current = Date.now();
    }
    const events: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"];
    events.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));
    return () => events.forEach((ev) => window.removeEventListener(ev, markActivity));
  }, []);

  // タブがバックグラウンドから復帰した瞬間に、放置判定を取りこぼさないよう即座にチェックし直す
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") setNow(Date.now());
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // キーボードショートカット: Space=計測中の作業を一時停止/一番上の一時停止中の作業を再開、
  // N=突発作業を追加、T=トラブル発生。入力欄にフォーカスしている時や修飾キー使用時は無効
  useEffect(() => {
    if (!shortcutsEnabled) return;
    function handleKeydown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.code === "Space") {
        const running = (tasks ?? []).find((t) => t.status === "running" && !t.isProvisional);
        if (running) {
          e.preventDefault();
          pauseTask(running);
          return;
        }
        const paused = (tasks ?? []).find((t) => t.status === "paused");
        if (paused) {
          e.preventDefault();
          startTask(paused);
        }
        return;
      }
      if (e.key === "n" || e.key === "N") {
        setShowAddDialog(true);
      }
      if (e.key === "t" || e.key === "T") {
        startTrouble();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [shortcutsEnabled, tasks]);

  // 「予測」（マスタの平均想定時間）。ガントチャートと同じ考え方で、同日中に同じ作業を
  // 複数回登録している場合は、既に今日積み上がった実績分を差し引いた残り予測にする。
  // 工程・改善の判断は実績ベースの予測を軸にする方針のため、個人が設定した「予定」の
  // 有無に関わらず、常にこちらを主役の目安として使う
  const predictedSecondsByTaskId = useMemo(() => {
    if (!tasks) return new Map<string, number>();
    return computePredictedSecondsByTaskId(tasks, allMasterTasks ?? [], now);
  }, [tasks, allMasterTasks, now]);

  // 演出テーマの警告表示(ティッカー・ビネット・走査線)用に、現在計測中かつ予測を
  // 超過している作業と、その中で最も危険度の高い階級をまとめておく
  const runningOverrunTasks = useMemo(() => {
    const overrunIds = new Set(computeRunningOverrunTaskIds(tasks ?? [], predictedSecondsByTaskId, now));
    return (tasks ?? []).filter((t) => overrunIds.has(t.id));
  }, [tasks, predictedSecondsByTaskId, now]);
  const worstRiskTier = useMemo(() => {
    if (!themedMode) return null;
    let worst: ReturnType<typeof getRiskTier> | null = null;
    for (const t of runningOverrunTasks) {
      const predSec = predictedSecondsByTaskId.get(t.id) ?? 0;
      if (predSec <= 0) continue;
      const ratio = segmentsAccumulatedMs(t, now) / 1000 / predSec;
      const tier = getRiskTier(ratio, themedMode);
      if (!worst || tier.level > worst.level) worst = tier;
    }
    return worst;
  }, [runningOverrunTasks, predictedSecondsByTaskId, now, themedMode]);

  // ライブモード時のみ、常に現在時刻を基準に自動配分を再計算する
  const liveAllocation = useMemo(() => {
    if (autoAllocateMode !== "live" || !tasks) return null;
    return computeAutoAllocation(tasks, predictedSecondsByTaskId, date, standardWorkEnd, now);
  }, [autoAllocateMode, tasks, predictedSecondsByTaskId, date, standardWorkEnd, now]);

  const effectiveAllocation =
    autoAllocateMode === "live" ? liveAllocation : autoAllocateMode === "manual" ? manualAllocation : null;

  function runManualAllocation() {
    if (!tasks) return;
    setManualAllocation(computeAutoAllocation(tasks, predictedSecondsByTaskId, date, standardWorkEnd, Date.now()));
    setManualAllocationAt(Date.now());
  }

  // 「まだこの作業中ですか?」で「続けている」を選んだ時刻(作業ID→時刻)。DBへの書き込みが
  // 作業一覧(useLiveQuery)に反映されるまでの一瞬に下のチェックが古い一覧で走ると、
  // 閉じたばかりの確認がまた開いてしまうため、反映を待たずに覚えておく
  const overrunDismissedAtRef = useRef(new Map<string, number>());

  // 予測超過チェック（通知 + 20分超過の画面確認）
  useEffect(() => {
    if (!tasks) return;
    for (const task of tasks) {
      const predicted = predictedSecondsByTaskId.get(task.id) ?? 0;
      if (task.status !== "running" || predicted <= 0) continue;
      const elapsedMs = segmentsAccumulatedMs(task, now);
      const predMs = predicted * 1000;
      if (elapsedMs > predMs && !task.notifiedOverrun) {
        notify("予測時間を超過しました", `${task.category} / ${task.name}`);
        db.dailyTasks.update(task.id, { notifiedOverrun: true });
      }
      const dismissedAt = Math.max(task.overrunPromptDismissedAt ?? 0, overrunDismissedAtRef.current.get(task.id) ?? 0);
      const sinceDismiss = dismissedAt ? now - dismissedAt : Infinity;
      const shown = task.overrunPromptShown || overrunDismissedAtRef.current.has(task.id);
      if (
        elapsedMs > predMs + OVERRUN_REPROMPT_MS &&
        (!shown || sinceDismiss > OVERRUN_REPROMPT_MS) &&
        !overrunTask
      ) {
        setOverrunTask(task);
      }
    }
  }, [now, tasks, overrunTask, predictedSecondsByTaskId]);

  // 予定インポートで登録した作業(scheduledTime)が指定時刻になったら自動的に差し込み開始する
  useEffect(() => {
    if (!tasks) return;
    for (const task of findDueScheduledTasks(tasks, date, now)) autoStartScheduledTask(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, tasks, date]);

  const nextTaskId = useMemo(() => {
    if (!tasks) return null;
    const next = tasks.find(
      (t) => !t.isProvisional && (t.status === "pending" || t.status === "paused" || t.status === "running")
    );
    return next?.id ?? null;
  }, [tasks]);

  // 予測時間から、このまま順番どおり進めた場合の各作業の終了予定時刻を計算する
  // （個人が設定した「予定」があっても、終了見込みの計算自体は常に予測を基準にする）
  const projectedFinishByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    if (!tasks) return map;
    let cursor = now;
    for (const task of tasks) {
      const predicted = predictedSecondsByTaskId.get(task.id) ?? 0;
      if (task.status === "done" || predicted <= 0) continue;
      if (task.status === "running") {
        const remainingMs = Math.max(0, predicted * 1000 - segmentsAccumulatedMs(task, now));
        const finish = now + remainingMs;
        map.set(task.id, finish);
        cursor = Math.max(cursor, finish);
      } else if (task.status === "paused") {
        const remainingMs = Math.max(0, predicted * 1000 - baseAccumulatedMs(task));
        const finish = now + remainingMs;
        map.set(task.id, finish);
        cursor = Math.max(cursor, finish);
      } else {
        cursor += predicted * 1000;
        map.set(task.id, cursor);
      }
    }
    return map;
  }, [tasks, now, predictedSecondsByTaskId]);

  // 一時停止・完了した時刻(実際にその操作をした瞬間)を返す。無ければ(古いデータ等)
  // 並び替えの基準にできないので、orderへのフォールバックが分かるようnullを返す
  function pauseOrFinishTime(t: DailyTask): number | null {
    if (t.stoppedAt !== undefined) return t.stoppedAt;
    if (t.status === "done") return t.endedAt ?? null;
    if (t.status === "paused") return t.segments[t.segments.length - 1]?.end ?? null;
    return null;
  }

  // 計測中の作業を一番上に、完了済みを一番下に沈める。未着手はもとの順番(order)のまま。
  // 一時停止中どうし・完了どうしは、追加した順(order)ではなく実際に一時停止/完了した順に
  // 並べる(一時停止/完了は、追加した順とは無関係にどれからでも操作されうるため、
  // orderのままだと「後から追加したのに先に一時停止した作業」が下に埋もれるなど
  // 直感に反する並びになっていた)
  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    const statusRank = (t: DailyTask) => (t.status === "running" ? 0 : t.status === "done" ? 2 : 1);
    return [...tasks].sort((a, b) => {
      const rankDiff = statusRank(a) - statusRank(b);
      if (rankDiff) return rankDiff;
      if (a.status === b.status && (a.status === "paused" || a.status === "done")) {
        const aTime = pauseOrFinishTime(a);
        const bTime = pauseOrFinishTime(b);
        if (aTime !== null && bTime !== null) return aTime - bTime;
      }
      return a.order - b.order;
    });
  }, [tasks]);

  // 実行中(running/paused)・予定(pending)・完了(done)のタブ分け表示用。件数はタブのバッジにも使う
  const nonProvisionalSortedTasks = useMemo(() => sortedTasks.filter((t) => !t.isProvisional), [sortedTasks]);
  const taskCountsByTab = useMemo(() => {
    let running = 0;
    let pending = 0;
    let done = 0;
    for (const t of nonProvisionalSortedTasks) {
      if (t.status === "running" || t.status === "paused") running++;
      else if (t.status === "pending") pending++;
      else if (t.status === "done") done++;
    }
    return { running, pending, done };
  }, [nonProvisionalSortedTasks]);
  // 下部タブバーの進捗ストリップ表示用(実行中/予定/完了の内訳比率の分母)
  const taskViewTotal = taskCountsByTab.running + taskCountsByTab.pending + taskCountsByTab.done;
  const visibleTasks = useMemo(
    () =>
      nonProvisionalSortedTasks.filter((t) => {
        if (taskViewTab === "running") return t.status === "running" || t.status === "paused";
        if (taskViewTab === "pending") return t.status === "pending";
        if (taskViewTab === "board") return false;
        return t.status === "done";
      }),
    [nonProvisionalSortedTasks, taskViewTab]
  );

  // 予定タブ用: ToDo・案件の期限切れ/本日期限の件数サマリー。判定ロジックは
  // ToDoタブの「期限切れ」ビュー(TodoSection)・案件タブ(ProjectsSection)と揃える
  const pendingDueSummary = useMemo(() => {
    let todoOverdue = 0;
    let todoDueToday = 0;
    for (const t of linkedTodoTasks ?? []) {
      if (t.completed || !t.dueDate) continue;
      if (t.dueDate < date) todoOverdue++;
      else if (t.dueDate === date) todoDueToday++;
    }
    let projectOverdue = 0;
    let projectDueToday = 0;
    for (const p of projects ?? []) {
      if (p.completedAt) continue;
      if (p.dueDate < date) projectOverdue++;
      else if (p.dueDate === date) projectDueToday++;
    }
    return { todoOverdue, todoDueToday, projectOverdue, projectDueToday };
  }, [linkedTodoTasks, projects, date]);

  // 予定タブのバッジをタップした時の詳細表示用: 期限切れ・本日期限のToDo/案件そのものの一覧。
  // pendingDueSummaryと同じ条件で絞り込み、期日が早い(＝超過が大きい)ものから並べる
  const pendingDueTodoItems = useMemo(
    () =>
      (linkedTodoTasks ?? [])
        .filter((t) => !t.completed && t.dueDate && t.dueDate <= date)
        .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0)),
    [linkedTodoTasks, date]
  );
  const pendingDueProjectItems = useMemo(
    () =>
      (projects ?? [])
        .filter((p) => !p.completedAt && p.dueDate <= date)
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)),
    [projects, date]
  );
  const [dueDetailKind, setDueDetailKind] = useState<"todo" | "project" | null>(null);

  // 声かけ・週の定時以降・1日の終わり・月初・朝の通知
  useTodayNotifications({
    date,
    now,
    records: projectRecords,
    conditionLogs,
    afterHoursCutoff,
    suggestedTask,
    dueDataReady: tasks !== undefined && linkedTodoTasks !== undefined && projects !== undefined,
    pendingCount: taskCountsByTab.pending,
    dueSummary: pendingDueSummary,
  });

  // 直近の「停止」時刻（完了した作業の終了時刻、または一時停止中の作業が
  // 一時停止した時刻のうち、リスト上で一番最後(orderが最大)の作業のもの）。
  // さかのぼって開始/再開する際の起点にする。本日まだ一度も停止していなければ、
  // ページを開いた時刻を仮の起点として扱う（そうしないと、初回の作業を始める前は
  // 未計測の自動開始が永遠に判定できないため）。
  // ※ 単純に全作業中で一番遅い時刻(endedAt/segmentsの終了時刻)を使うと、完了タブの
  // ガントチャート等で過去の作業の終了時刻を手動で伸ばした場合に、その作業が数値上
  // 一番大きくなってしまい、逆に本当に最後に一時停止/完了した作業がここに反映されない
  // という分かりづらい挙動になる。そのため「実際にその場で一時停止/完了の操作をした時刻」
  // (stoppedAt。手動編集では変わらない)を優先して使う。stoppedAtが無い(古いデータ)場合のみ、
  // 従来通り「一番最後にやった作業(orderが最大)」にフォールバックする
  const lastStopTime = useMemo(() => {
    if (!tasks) return null;
    const stopCandidates = tasks.filter(
      (t) =>
        (t.status === "done" && t.endedAt !== undefined) ||
        (t.status === "paused" && t.segments[t.segments.length - 1]?.end !== undefined)
    );
    if (stopCandidates.length === 0) return sessionAnchorRef.current;
    const withStoppedAt = stopCandidates.filter((t) => t.stoppedAt !== undefined);
    if (withStoppedAt.length > 0) {
      // 「最後に停止した作業」自体の特定にはstoppedAt(実際に操作した時刻。手動編集では
      // 変わらない)を使うが、返す時刻はその作業の実際の終了時刻(endedAt/区間の終了)にする。
      // stoppedAtをそのまま返すと、後から完了タブ等で終了時刻を編集していても反映されず、
      // 「前の作業が本当に何時に終わったか」ではなく「何時にボタンを押したか」になってしまうため
      const last = withStoppedAt.reduce((a, b) => (b.stoppedAt! > a.stoppedAt! ? b : a));
      return last.status === "done" ? last.endedAt! : last.segments[last.segments.length - 1].end!;
    }
    const last = stopCandidates.reduce((a, b) => (b.order > a.order ? b : a));
    return last.status === "done" ? last.endedAt! : last.segments[last.segments.length - 1].end!;
  }, [tasks]);

  // 休憩などの除外時間帯を差し引いた「実質的な」直近停止時刻。未計測の自動開始や
  // 「さかのぼって開始/再開」で使う起点はこちらを使い、休憩時間を計測対象から除く
  const effectiveLastStopTime = useMemo(() => {
    if (lastStopTime === null) return null;
    return adjustStopTimeForBreaks(lastStopTime, now, date, breakRanges);
  }, [lastStopTime, now, date, breakRanges]);

  // 未割り当ての仮計測タスク（未計測時間が閾値を超えた際に自動生成される）
  const provisionalTask = useMemo(() => tasks?.find((t) => t.isProvisional) ?? null, [tasks]);
  // トラブル対応などで仮計測自体が一時停止中の場合は「計測中」ではないため、
  // 他の作業をブロックする対象からは除外する
  const provisionalActive = provisionalTask?.status === "running";

  // 仮計測タスクの割り当て先として選べる、本日の作業に登録済みの未着手/一時停止中タスク
  const candidateTasks = useMemo(
    () => (tasks ?? []).filter((t) => !t.isProvisional && (t.status === "pending" || t.status === "paused")),
    [tasks]
  );
  // 仮計測タスクの割り当て先として、完了済みの作業も「もう一度開始」する形で選べるようにする
  // (同じ作業を本日中に何度も完了していても、選択肢としては1つにまとめる)
  const completedTasksForProvisional = useMemo(() => {
    const seen = new Set<string>();
    const result: DailyTask[] = [];
    for (const t of tasks ?? []) {
      if (t.isProvisional || t.status !== "done") continue;
      const key = t.masterTaskId ?? `${t.category}::${t.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
    }
    return result;
  }, [tasks]);

  // 同じ大項目・詳細作業名の組み合わせが同時に計測されないようにするため、
  // 現在計測中の（大項目, 作業名）の組み合わせを把握しておく
  const runningTaskKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of tasks ?? []) {
      if (t.status === "running" && !t.isProvisional) keys.add(`${t.category}::${t.name}`);
    }
    return keys;
  }, [tasks]);

  // 「計測中の作業を強調表示」設定用: 現在計測中（仮計測を除く）の作業ID一覧
  const runningTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks ?? []) {
      if (t.status === "running" && !t.isProvisional) ids.add(t.id);
    }
    return ids;
  }, [tasks]);

  // 誰も計測していない状態が閾値を超えたら、自動で仮計測タスクを立ち上げる（オフの場合は何もしない）。
  // 除外時間帯（休憩など）の最中は開始しない。しきい値の判定は休憩時間を差し引いた正味の経過時間で行うため、
  // 休憩をまたいでも休憩前に経過していた時間が無駄にならず、休憩が終わった時点で正しく超過を判定できる
  useEffect(() => {
    if (!provisionalEnabled) return;
    if (!tasks) return;
    const gapStart = findProvisionalStart({
      tasks,
      lastStopTime,
      effectiveLastStopTime,
      now,
      date,
      breakRanges,
      thresholdMinutes,
    });
    if (gapStart === null) return;
    (async () => {
      const added = await addProvisionalTaskIfIdle({
        id: uid(),
        date,
        category: "未分類",
        name: "仮計測中",
        estimatedSeconds: 0,
        status: "running",
        segments: [{ start: gapStart }],
        accumulatedMs: 0,
        startedAt: gapStart,
        isSpontaneous: true,
        isProvisional: true,
      });
      if (!added) return;
      setTaskViewTab("running");
    })();
  }, [provisionalEnabled, tasks, now, lastStopTime, effectiveLastStopTime, thresholdMinutes, date, breakRanges]);

  // 強制ストップ付きの休憩帯に入ったら、計測中の作業(仮計測含む)を一時停止し、
  // チェックリストを表示する。1つの休憩帯につき1回だけ行い(breakStopHandledで判定)、
  // その後は本人が休憩中に手動で計測を再開しても再度は割り込まない
  useEffect(() => {
    if (!activeForceStopRange || !tasks) return;
    const key = breakRangeKey(activeForceStopRange);
    if (breakStopHandled.has(key)) return;
    const runningTasks = tasks.filter((t) => t.status === "running");
    (async () => {
      for (const t of runningTasks) await pauseTask(t);
    })();
    setBreakStopHandledStr(JSON.stringify([...breakStopHandled, key]));
    setBreakChecklistRange(activeForceStopRange);
  }, [activeForceStopRange, tasks, breakStopHandled]);

  // 放置検知: マウス/キーボード操作もタブの表示もない状態が一定時間続いたら、
  // 未計測の計測を「最後に操作していた時刻」で自動的に打ち切る。定時後・休日に
  // PCを開いたまま放置しても、際限なく計測され続けないようにするための保険
  useEffect(() => {
    if (!provisionalTask || provisionalTask.status !== "running") return;
    const cutoff = inactivityCutoff(provisionalTask, lastActivityRef.current, now, provisionalIdleMs);
    if (cutoff === null) return;
    if (idleFinishInFlightRef.current) return;
    idleFinishInFlightRef.current = true;
    commitFinish(provisionalTask, { endAtMs: cutoff }).then(() => {
      idleFinishInFlightRef.current = false;
      const hoursLabel = Math.round((provisionalIdleMs / 3600000) * 10) / 10;
      notify(
        "未計測を自動的に打ち切りました",
        `${hoursLabel}時間以上操作がなかったため、最後の操作時刻で計測を終了しました`,
        "provisional-idle-stop"
      );
    });
  }, [now, provisionalTask, provisionalIdleMs]);

  // 仮計測中は、開始時と一定間隔ごとに「何を計測中か・経過時間」を通知する
  // （オフの場合や、トラブル対応などで一時停止中の場合は何もしない）
  useEffect(() => {
    if (!provisionalNotifyEnabled || !provisionalTask || !provisionalActive) {
      provisionalNotifiedAtRef.current = null;
      return;
    }
    const last = provisionalNotifiedAtRef.current;
    if (last !== null && now - last < 5 * 60 * 1000) return;
    const elapsedMs = segmentsAccumulatedMs(provisionalTask, now);
    notify(
      "未計測時間を自動計測中",
      `${provisionalTask.category} / ${provisionalTask.name} ・経過 ${formatMsClock(elapsedMs)}`,
      "provisional-tracking"
    );
    provisionalNotifiedAtRef.current = now;
  }, [provisionalNotifyEnabled, provisionalTask, provisionalActive, now]);

  // 位置情報の監視(移動検知・登録地点への到着検知)。検知したことだけを受け取り、
  // 実際の作業の開始・打ち切りは下のeffectで最新のtasksを見て行う
  const geoMovement = useGeoMovementWatch(geoTrackingEnabled, geoDistanceThresholdMeters);
  const geoArrival = useGeoArrivalWatch(geoArrivalEnabled, geoPlaces);
  const arrivedPlaceEvent = geoArrival.arrivedEvent;

  // 到着イベント(arrivedPlaceEvent)を受けて、実際に作業を自動開始する。
  // ここは通常のレンダーサイクルで動くため、tasks等の最新stateを安全に参照できる
  useEffect(() => {
    if (!geoArrivalEnabled || !arrivedPlaceEvent || !geoPlaces) return;
    const place = geoPlaces.find((p) => p.id === arrivedPlaceEvent.placeId);
    if (!place) return;
    handleGeoArrival(place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedPlaceEvent]);

  // 地点到着で自動開始がONの間、画面消灯で位置監視が止まらないようにする
  const wakeLock = useWakeLock(geoArrivalEnabled);
  // 登録地点の天気変化通知
  const weather = useWeatherWatch();

  // 移動を検知した(movementTickが進んだ)ら、他に計測中/仮計測中の作業がなければ
  // 「移動」の仮計測タスクを自動的に開始する。仕組みは未計測の自動計測と同じ仮計測枠を使う
  useEffect(() => {
    if (!geoTrackingEnabled) return;
    if (geoMovement.movementTick === 0) return;
    if (!tasks) return;
    if (tasks.some((t) => t.isProvisional)) return;
    if (tasks.some((t) => t.status === "running")) return;
    (async () => {
      const startAt = Date.now();
      const task = {
        id: uid(),
        date,
        category: geoCategorySetting || "移動",
        name: geoTaskNameSetting || "移動",
        estimatedSeconds: 0,
        status: "running" as const,
        segments: [{ start: startAt }],
        accumulatedMs: 0,
        startedAt: startAt,
        isSpontaneous: true,
        isProvisional: true,
      };
      if (!(await addProvisionalTaskIfIdle(task))) return;
      geoMovement.taskIdRef.current = task.id;
      setTaskViewTab("running");
      notify("移動を検知しました", `${task.category} / ${task.name} の自動計測を開始しました`, "geo-tracking-start");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoMovement.movementTick]);

  // 移動検知で始めた仮計測は、一定時間位置情報の変化がなくなったら
  // (＝止まったら)最後に動いていた時刻で自動的に打ち切る
  useEffect(() => {
    if (!geoTrackingEnabled) return;
    if (!provisionalTask || provisionalTask.status !== "running") return;
    if (geoMovement.taskIdRef.current !== provisionalTask.id) return;
    const cutoff = inactivityCutoff(provisionalTask, geoMovement.lastMovedAtRef.current, now, geoStillMs);
    if (cutoff === null) return;
    if (geoFinishInFlightRef.current) return;
    geoFinishInFlightRef.current = true;
    commitFinish(provisionalTask, { endAtMs: cutoff }).then(() => {
      geoFinishInFlightRef.current = false;
      geoMovement.taskIdRef.current = null;
      const minutesLabel = Math.round((geoStillMs / 60000) * 10) / 10;
      notify(
        "移動の自動計測を終了しました",
        `${minutesLabel}分以上、位置情報の変化がなかったため終了しました`,
        "geo-tracking-stop"
      );
    });
  }, [now, provisionalTask, geoTrackingEnabled, geoStillMs]);

  // ホーム画面ショートカット(manifestのshortcuts、/?quickstart=1〜4)からの起動を検知する。
  // URLのクエリはその場で消し、実際の処理はtasks/allMasterTasksの読み込みを待ってから行う
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slotStr = params.get("quickstart");
    if (!slotStr) return;
    window.history.replaceState({}, "", window.location.pathname);
    const slot = Number(slotStr);
    if (Number.isFinite(slot)) setPendingQuickSlot(slot);
  }, []);

  useEffect(() => {
    if (pendingQuickSlot === null) return;
    if (!tasks || !allMasterTasks) return;
    const slot = pendingQuickSlot;
    setPendingQuickSlot(null);
    handleQuickStart(slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuickSlot, tasks, allMasterTasks]);

  useEffect(() => {
    if (!quickActionMessage) return;
    const id = setTimeout(() => setQuickActionMessage(null), 6000);
    return () => clearTimeout(id);
  }, [quickActionMessage]);

  // クイック起動枠(1〜4)に割り当てられた作業を、状況に応じて開始/再開/終了する
  // (計測中なら終了、一時停止中なら再開、それ以外なら新しく開始)ワンタップ用のトグル処理
  async function handleQuickStart(slot: number) {
    if (!quickStartEnabled) {
      setQuickActionMessage("ホーム画面ショートカットからのクイック起動は設定でOFFになっています。");
      return;
    }
    const master = (allMasterTasks ?? []).find((m) => m.quickSlot === slot);
    if (!master) {
      setQuickActionMessage(
        `クイック起動${slot}にはまだ作業が割り当てられていません。「お気に入り」欄の番号ボタンから割り当てできます。`
      );
      return;
    }
    const activeToday = (tasks ?? []).filter((t) => t.masterTaskId === master.id && !t.isProvisional);
    const running = activeToday.find((t) => t.status === "running");
    if (running) {
      await finishTask(running);
      setQuickActionMessage(`🛑「${master.category} / ${master.name}」を終了しました`);
      return;
    }
    const paused = activeToday.find((t) => t.status === "paused");
    if (paused) {
      await startTask(paused);
      setQuickActionMessage(`▶「${master.category} / ${master.name}」を再開しました`);
      return;
    }
    const estimatedSeconds = await computeRemainingEstimatedSeconds(date, master.category, master.name, master.estimatedSeconds);
    requestStartNew(master.category, master.name, estimatedSeconds, master.id);
    setQuickActionMessage(`▶「${master.category} / ${master.name}」を開始しました`);
  }

  // お気に入り作業をクイック起動枠(1〜4)に割り当て/解除する。既に他の作業が
  // その枠を使っていた場合は先にその割り当てを外す(枠は常に最大1件のみ)
  async function toggleQuickSlot(masterId: string, slot: number) {
    const current = (allMasterTasks ?? []).find((m) => m.id === masterId);
    if (!current) return;
    if (current.quickSlot === slot) {
      await db.masterTasks.update(masterId, { quickSlot: undefined });
      return;
    }
    const holder = (allMasterTasks ?? []).find((m) => m.quickSlot === slot && m.id !== masterId);
    if (holder) await db.masterTasks.update(holder.id, { quickSlot: undefined });
    await db.masterTasks.update(masterId, { quickSlot: slot });
  }

  // 音声コマンドの発話結果を解釈して実行する。「○○を開始」で、その名前に近い
  // お気に入り/マスタの作業があれば開始し、無ければその場で新規の突発作業として開始する。
  // 「終了」「一時停止」は対象名が無ければ今計測中の作業を対象にする
  async function handleVoiceResult(transcript: string) {
    const command = parseVoiceCommand(transcript);
    if (!command) return;

    if (command.action === "finish") {
      const target = command.target
        ? (tasks ?? []).find(
            (t) => (t.status === "running" || t.status === "paused") && !t.isProvisional && (t.name.includes(command.target!) || command.target!.includes(t.name))
          )
        : undefined;
      const running = target ?? (tasks ?? []).find((t) => t.status === "running" && !t.isProvisional);
      if (!running) {
        const message = "対象の計測中の作業が見つかりませんでした";
        setQuickActionMessage(`🎤「${transcript}」→ ${message}`);
        if (handsFreeMode) speak(message);
        return;
      }
      await finishTask(running);
      const message = `「${running.category} / ${running.name}」を終了しました`;
      setQuickActionMessage(`🎤「${transcript}」→ 🛑${message}`);
      if (handsFreeMode) speak(message);
      return;
    }

    if (command.action === "pause") {
      const running = (tasks ?? []).find((t) => t.status === "running" && !t.isProvisional);
      if (!running) {
        const message = "計測中の作業が見つかりませんでした";
        setQuickActionMessage(`🎤「${transcript}」→ ${message}`);
        if (handsFreeMode) speak(message);
        return;
      }
      await pauseTask(running);
      const message = `「${running.category} / ${running.name}」を一時停止しました`;
      setQuickActionMessage(`🎤「${transcript}」→ ‖${message}`);
      if (handsFreeMode) speak(message);
      return;
    }

    if (command.action === "status") {
      const running = (tasks ?? []).find((t) => t.status === "running" && !t.isProvisional);
      const pendingCount = (tasks ?? []).filter((t) => t.status === "pending").length;
      let message: string;
      if (running) {
        const elapsedMs = segmentsAccumulatedMs(running, now);
        message = `現在「${running.category} ${running.name}」を計測中です。経過時間は${formatMsClock(elapsedMs)}です。`;
      } else {
        message = "現在計測中の作業はありません。";
      }
      if (pendingCount > 0) message += `予定が${pendingCount}件残っています。`;
      setQuickActionMessage(`🎤「${transcript}」→ ${message}`);
      if (handsFreeMode) speak(message);
      return;
    }

    const target = command.target?.trim();
    if (!target) return;
    const master = (allMasterTasks ?? []).find((m) => m.name.includes(target) || target.includes(m.name));
    if (master) {
      const estimatedSeconds = await computeRemainingEstimatedSeconds(date, master.category, master.name, master.estimatedSeconds);
      requestStartNew(master.category, master.name, estimatedSeconds, master.id);
      const message = `「${master.category} / ${master.name}」を開始しました`;
      setQuickActionMessage(`🎤「${transcript}」→ ▶${message}`);
      if (handsFreeMode) speak(message);
      return;
    }
    requestStartNew("音声", target, 0, undefined);
    const message = `「音声 / ${target}」を新規作業として開始しました`;
    setQuickActionMessage(`🎤「${transcript}」→ ▶${message}`);
    if (handsFreeMode) speak(message);
  }

  // 1回分の音声認識セッションを開始する。ハンズフリーモードでは認識が終わる(onend)たびに
  // 呼び直して連続的な聞き取りを実現する
  function beginListeningSession(): boolean {
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setVoiceUnsupported(true);
      setQuickActionMessage("この端末・ブラウザは音声入力に対応していません");
      return false;
    }
    voiceRecognitionRef.current = recognition;
    recognition.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) handleVoiceResult(transcript);
    };
    recognition.onerror = () => {
      if (!handsFreeActiveRef.current) {
        setQuickActionMessage("音声を認識できませんでした。もう一度お試しください");
      }
    };
    recognition.onend = () => {
      if (handsFreeActiveRef.current) {
        restartListeningIfHandsFree();
      } else {
        setVoiceListening(false);
      }
    };
    recognition.start();
    return true;
  }

  // 読み上げ(speak)中はマイクが自分の声を拾ってしまうため、speechSynthesisが
  // 話し終わるのを待ってから聞き取りを再開する
  function restartListeningIfHandsFree(attempt = 0) {
    if (!handsFreeActiveRef.current) return;
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking && attempt < 30) {
      setTimeout(() => restartListeningIfHandsFree(attempt + 1), 300);
      return;
    }
    setTimeout(() => {
      if (handsFreeActiveRef.current) beginListeningSession();
    }, 400);
  }

  function startVoiceListening() {
    if (voiceListening) return;
    handsFreeActiveRef.current = handsFreeMode;
    const ok = beginListeningSession();
    if (ok) setVoiceListening(true);
  }

  function stopVoiceListening() {
    handsFreeActiveRef.current = false;
    voiceRecognitionRef.current?.stop();
    setVoiceListening(false);
  }

  // ボタンを押した時点では中身を確認するだけで、実際の生成(既存の削除・追加)は
  // 確認モーダルで「生成する」を押すまで行わない。ネイティブのconfirm/alertは
  // テーマの見た目に合わず浮いてしまうため、他の確認と同じ自前のModalに揃えた
  const [templateConfirm, setTemplateConfirm] = useState<{ items: TemplateItem[]; existingCount: number } | null>(
    null
  );

  async function requestGenerateFromTemplate() {
    const items = await db.templateItems.where("weekday").equals(weekday).sortBy("order");
    if (items.length === 0) {
      showUndoToast(`${WEEKDAY_LABELS[weekday]}曜日のテンプレートが空です。先に「曜日別テンプレート」で登録してください。`);
      return;
    }
    const existingCount = await db.dailyTasks.where("date").equals(date).count();
    setTemplateConfirm({ items, existingCount });
  }

  async function confirmGenerateFromTemplate() {
    if (!templateConfirm) return;
    const existing = await db.dailyTasks.where("date").equals(date).toArray();
    if (existing.length > 0) {
      await db.dailyTasks.bulkDelete(existing.map((e) => e.id));
    }
    const newTasks: DailyTask[] = templateConfirm.items.map((item, idx) => ({
      id: uid(),
      date,
      order: idx,
      masterTaskId: item.masterTaskId,
      category: item.category,
      name: item.name,
      estimatedSeconds: item.estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: false,
    }));
    await db.dailyTasks.bulkAdd(newTasks);
    setTemplateConfirm(null);
  }

  // 当日まだ何も開始しておらず、体調記録も未設定の状態で最初の作業を開始しようとした場合、
  // 体調を選んでから開始できるよう一旦保留する。体調記録がOFF・すでに何か開始済み・
  // すでに体調を記録済みのいずれかならそのまま実行する。呼び出し元がawaitできるよう、
  // 保留された場合はモーダルでの選択/スキップが終わるまで解決しないPromiseを返す
  function gateFirstStart(action: () => void | Promise<void>): Promise<void> {
    const alreadyStartedSomething = (tasks ?? []).some((t) => t.status !== "pending");
    const alreadyLoggedCondition = (conditionLogs ?? []).length > 0;
    if (conditionEnabled && !alreadyStartedSomething && !alreadyLoggedCondition) {
      return new Promise<void>((resolve) => {
        setPendingConditionStart(() => async () => {
          await action();
          resolve();
        });
      });
    }
    return Promise.resolve(action());
  }

  async function startTask(task: DailyTask, startAt: number = Date.now()) {
    const doStart = async () => {
      const segments = [...task.segments, { start: startAt }];
      // さかのぼって開始/再開した場合、その時点で既に「予定超過+20分」を
      // 超えていることがあり得るが、開始直後に超過確認ダイアログが出るのは
      // 紛らわしいため、この時点では抑制しておく（超過が続けば通常どおり後で再表示される）
      const isRetroactive = startAt < Date.now() - 5000;
      await db.dailyTasks.update(task.id, {
        segments,
        status: "running",
        startedAt: task.startedAt ?? startAt,
        ...(isRetroactive ? { overrunPromptShown: true, overrunPromptDismissedAt: Date.now() } : {}),
      });
      // 予定・一時停止中からの開始/再開も、insertRunningTaskと同様に実行中タブへ切り替える
      setTaskViewTab("running");
    };
    await gateFirstStart(doStart);
  }

  async function insertRunningTask(
    category: string,
    name: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    startAt: number
  ) {
    const doInsert = async () => {
      const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
      // 未計測(仮計測)分をさかのぼって合算した場合など、startAtが過去の時刻だと
      // 作成直後から既に「予測時間を大幅に超過」扱いになり得る。startTaskの
      // さかのぼって開始/再開と同様、この場合は超過確認ダイアログを抑制しておく
      // (超過が続けば通常どおり後で再表示される)
      const isRetroactive = startAt < Date.now() - 5000;
      const task: DailyTask = {
        id: uid(),
        date,
        order: count,
        masterTaskId,
        category,
        name,
        estimatedSeconds,
        status: "running",
        segments: [{ start: startAt }],
        accumulatedMs: 0,
        startedAt: startAt,
        isSpontaneous: true,
        ...(isRetroactive ? { overrunPromptShown: true, overrunPromptDismissedAt: Date.now() } : {}),
      };
      await db.dailyTasks.add(task);
      // お気に入り・クイック起動・音声操作・提案作業など、この関数を通る「すぐ開始」系の
      // 起動は全て、開始した作業がひと目で見えるよう実行中タブに切り替える
      setTaskViewTab("running");
    };
    await gateFirstStart(doInsert);
  }

  // 登録地点に対応する作業を、実際に開始する。マスタが無ければ作成し、同日中の
  // 繰り越し分を差し引いた残り予測時間を初期の想定時間として使う（お気に入り起動と同じ考え方）
  async function startGeoArrivalTask(place: GeoPlace) {
    const master = await findOrCreateMasterTask(place.category, place.name, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(date, place.category, place.name, master.estimatedSeconds);
    await insertRunningTask(place.category, place.name, estimatedSeconds, master.id, Date.now());
  }

  // 登録地点への到着を検知した際の入口。予定インポートの自動開始と同様、既に計測中の
  // 作業があれば自動で割り込まず、停止して開始するか確認する
  async function handleGeoArrival(place: GeoPlace) {
    const runningTasks = (tasks ?? []).filter((t) => t.status === "running");
    notify("到着を検知しました", `${place.label}: ${place.category} / ${place.name}`, `geo-arrival-${place.id}-${Date.now()}`);
    if (runningTasks.length > 0) {
      setGeoArrivalConflict({ place, runningTasks });
      return;
    }
    await startGeoArrivalTask(place);
  }

  // 地点到着の自動開始と、計測中の作業がバッティングした際の確認モーダルへの回答を反映する
  async function resolveGeoArrivalConflict(startHere: boolean) {
    if (!geoArrivalConflict) return;
    const { place, runningTasks } = geoArrivalConflict;
    setGeoArrivalConflict(null);
    if (!startHere) return;
    for (const r of runningTasks) await pauseTask(r);
    await startGeoArrivalTask(place);
  }

  // 新規作業（突発作業の追加・お気に入り）をすぐ開始しようとした際、未計測(仮計測)が
  // 計測中なら二重に計測が進行してしまうため、先に判断を仰ぐ
  function requestStartNew(category: string, name: string, estimatedSeconds: number, masterTaskId: string | undefined) {
    if (provisionalActive) {
      setPendingStart({ category, name, estimatedSeconds, masterTaskId });
      return;
    }
    insertRunningTask(category, name, estimatedSeconds, masterTaskId, Date.now());
  }

  // 未計測(仮計測)分を、これから開始する作業に合算する（未計測の開始時刻からそのまま続けて計測）
  async function resolvePendingStartMerge() {
    if (!pendingStart || !provisionalTask) return;
    const provisionalId = provisionalTask.id;
    const mergeStartAt = provisionalTask.startedAt ?? Date.now();
    await db.transaction("rw", db.dailyTasks, async () => {
      await insertRunningTask(pendingStart.category, pendingStart.name, pendingStart.estimatedSeconds, pendingStart.masterTaskId, mergeStartAt);
      await db.dailyTasks.delete(provisionalId);
    });
    setPendingStart(null);
  }

  // 未計測(仮計測)分は記録せずに打ち切り、これから開始する作業は今の時刻から新たに計測する
  async function resolvePendingStartDiscard() {
    if (!pendingStart || !provisionalTask) return;
    const provisionalId = provisionalTask.id;
    await db.transaction("rw", db.dailyTasks, async () => {
      await insertRunningTask(pendingStart.category, pendingStart.name, pendingStart.estimatedSeconds, pendingStart.masterTaskId, Date.now());
      await db.dailyTasks.delete(provisionalId);
    });
    setPendingStart(null);
  }

  // 指定した作業より前(order昇順)で、直近に完了した作業の終了時刻を返す。
  // 完了作業の時刻編集ダイアログで「前の作業の終了時刻を開始時刻に使う」ための参照値
  function findPreviousTaskEndedAt(task: DailyTask): number | null {
    const candidates = (tasks ?? []).filter(
      (t) => t.id !== task.id && !t.isProvisional && t.order < task.order && t.endedAt !== undefined
    );
    if (candidates.length === 0) return null;
    const prev = candidates.reduce((a, b) => (b.order > a.order ? b : a));
    return prev.endedAt ?? null;
  }

  // 作業内容の編集を保存する。完了済み(done)の場合は、既に作成済みの実績(WorkRecord)にも反映する。
  // 同じ区分/作業名の実績は日付ごとに1件へ合算されているため、実績時間の変更は差分(delta)を
  // その実績にそのまま加減することで、他の作業から合算された分にも影響を与えず正しく反映できる。
  // 区分/作業名の変更は設定(records.masterEditMode)に従い、マスタ自体をリネームするか、
  // 別マスタ(既存 or 新規)に実績ごと繋ぎ変える。開始/終了時刻が指定された場合は、最初/最後の
  // セグメントの端をその時刻に合わせて伸縮させ、実績時間(accumulatedMs)はセグメント合計から
  // 再計算する（開始・終了・実績時間は常に連動する）
  async function applyTaskEdit(
    task: DailyTask,
    category: string,
    name: string,
    actualSeconds?: number,
    note?: string,
    method?: string,
    startedAtOverride?: number,
    endedAtOverride?: number
  ) {
    const renamed = category !== task.category || name !== task.name;

    if (task.status === "running" || task.status === "paused") {
      // 計測中/一時停止中の作業は、まだ終了していないため開始時刻だけをさかのぼって
      // 修正できるようにする(最初の区間のstartを動かすだけで、計測中の区間の経過分は
      // segmentsAccumulatedMsが都度計算するため、accumulatedMsは確定済みの区間のみで
      // 再計算すればよい)
      let segments = task.segments;
      if (startedAtOverride !== undefined && segments.length > 0) {
        segments = segments.map((s, i) => (i === 0 ? { ...s, start: startedAtOverride } : s));
        if (segments[0].end !== undefined && segments[0].end <= segments[0].start) {
          alert("開始時刻の指定が不正です(この作業が最初に一時停止した時刻より後になっています)");
          return;
        }
      }
      const segmentsChanged = segments !== task.segments;
      const taskUpdates: Partial<DailyTask> = {
        category,
        name,
        note,
        method,
        ...(renamed ? { masterTaskId: undefined } : {}),
      };
      if (segmentsChanged) {
        taskUpdates.segments = segments;
        taskUpdates.startedAt = segments[0].start;
        taskUpdates.accumulatedMs = segments.reduce((sum, s) => sum + (s.end !== undefined ? s.end - s.start : 0), 0);
      }
      await db.dailyTasks.update(task.id, taskUpdates);
      return;
    }

    if (task.status !== "done") {
      await db.dailyTasks.update(task.id, {
        category,
        name,
        note,
        method,
        ...(renamed ? { masterTaskId: undefined } : {}),
      });
      return;
    }

    const oldSeconds = Math.round(task.accumulatedMs / 1000);
    let segments = task.segments;
    if (startedAtOverride !== undefined && segments.length > 0) {
      segments = segments.map((s, i) => (i === 0 ? { ...s, start: startedAtOverride } : s));
    }
    if (endedAtOverride !== undefined && segments.length > 0) {
      segments = segments.map((s, i) => (i === segments.length - 1 ? { ...s, end: endedAtOverride } : s));
    }
    const segmentsChanged = segments !== task.segments;
    if (segmentsChanged && segments.some((s) => s.end !== undefined && s.end <= s.start)) {
      alert("開始・終了時刻の範囲が不正です(途中の一時停止区間と矛盾しています)");
      return;
    }
    const newAccumulatedMs = segmentsChanged
      ? segments.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start), 0)
      : task.accumulatedMs;
    const newSeconds = segmentsChanged ? Math.round(newAccumulatedMs / 1000) : (actualSeconds ?? oldSeconds);
    const delta = newSeconds - oldSeconds;

    const taskUpdates: Partial<DailyTask> = { category, name, note, method };
    if (segmentsChanged) {
      taskUpdates.segments = segments;
      taskUpdates.accumulatedMs = newAccumulatedMs;
      taskUpdates.startedAt = segments[0].start;
      taskUpdates.endedAt = segments[segments.length - 1].end;
    } else if (delta !== 0) {
      const lastEnd = (task.segments[task.segments.length - 1]?.end ?? task.endedAt ?? Date.now()) + delta * 1000;
      taskUpdates.accumulatedMs = newSeconds * 1000;
      taskUpdates.segments = task.segments.map((s, i) =>
        i === task.segments.length - 1 ? { ...s, end: lastEnd } : s
      );
      taskUpdates.endedAt = lastEnd;
    }
    if (taskUpdates.accumulatedMs !== undefined) {
      // 実績側もこの差分だけ直すので、編集後の合計を「実績へ反映済み」とする
      // (この後「続きから」再開して完了した際、二重に足したり差し引いたりしないように)
      taskUpdates.recordedMs = taskUpdates.accumulatedMs;
      taskUpdates.recordedSegmentCount = (taskUpdates.segments ?? task.segments).length;
    }

    const oldMasterId = task.masterTaskId;
    // 編集前の帰属先(案件・段階・ToDo・手段)で、この作業分が合算されている実績を探す
    const existingOld = oldMasterId ? await findMergeTargetRecord(task.date, oldMasterId, task) : undefined;

    // 開始/終了時刻の直接編集や実績時間の手動変更は、合算元の他インスタンス分まで
    // 正確な区間を再構成できないため、既存のsegmentsは破棄して(定時以降の判定は
    // startedAt〜endedAtによる従来通りの近似に戻す)、ズレたまま残さないようにする
    const clearSegments = delta !== 0 || segmentsChanged;

    if (!renamed) {
      if (existingOld) {
        await db.records.update(existingOld.id, {
          ...(delta !== 0 ? { seconds: Math.max(0, existingOld.seconds + delta) } : {}),
          note,
          method,
          ...(clearSegments ? { segments: undefined } : {}),
        });
      }
      await db.dailyTasks.update(task.id, taskUpdates);
      if (delta !== 0 && oldMasterId) await recomputeEstimateFromRecords(oldMasterId);
      return;
    }

    if (masterEditMode === "rename") {
      if (oldMasterId) {
        await db.masterTasks.update(oldMasterId, { category, name, updatedAt: Date.now() });
        // マスタ自体をリネームする設定の場合、同じマスタに紐づく他の日の実績も
        // 表示上の名称・区分を新しいものに揃える(設定画面の説明通りの挙動にする)
        await db.records.where("masterTaskId").equals(oldMasterId).modify({ category, name });
      }
      if (existingOld) {
        await db.records.update(existingOld.id, {
          ...(delta !== 0 ? { seconds: Math.max(0, existingOld.seconds + delta) } : {}),
          note,
          method,
          ...(clearSegments ? { segments: undefined } : {}),
        });
      }
      await db.dailyTasks.update(task.id, taskUpdates);
      if (delta !== 0 && oldMasterId) await recomputeEstimateFromRecords(oldMasterId);
      return;
    }

    // relink: 実績ごと別マスタ(既存 or 新規)へ繋ぎ変える
    const newMaster = await findOrCreateMasterTask(category, name, task.estimatedSeconds);
    const newEndedAt = taskUpdates.endedAt ?? task.endedAt ?? Date.now();
    if (existingOld) {
      const remaining = existingOld.seconds - oldSeconds;
      if (remaining <= 0) await db.records.delete(existingOld.id);
      else await db.records.update(existingOld.id, { seconds: remaining, segments: undefined });
    }
    const existingNew = await findMergeTargetRecord(task.date, newMaster.id, { ...task, method });
    if (existingNew) {
      await db.records.update(existingNew.id, {
        seconds: existingNew.seconds + newSeconds,
        endedAt: newEndedAt,
        note,
        method,
        todoTaskId: existingNew.todoTaskId ?? task.todoTaskId,
        segments: undefined,
      });
    } else {
      await db.records.add({
        id: uid(),
        date: task.date,
        category,
        name,
        masterTaskId: newMaster.id,
        seconds: newSeconds,
        startedAt: task.startedAt ?? Date.now(),
        endedAt: newEndedAt,
        excludedFromStats: false,
        projectId: task.projectId,
        stageId: task.stageId,
        todoTaskId: task.todoTaskId,
        isTrouble: task.isTrouble,
        note,
        method,
      });
    }
    taskUpdates.masterTaskId = newMaster.id;
    await db.dailyTasks.update(task.id, taskUpdates);
    if (oldMasterId) await recomputeEstimateFromRecords(oldMasterId);
    await recomputeEstimateFromRecords(newMaster.id);
  }

  // 本日の作業カードから直接お気に入りを付け外しする。まだ作業マスタに紐づいていない
  // （自由入力の突発作業など）場合は、その場でマスタを見つける/作成してから紐づける
  async function toggleTaskFavorite(task: DailyTask) {
    let masterId = task.masterTaskId;
    if (!masterId) {
      const master = await findOrCreateMasterTask(task.category, task.name, task.estimatedSeconds);
      masterId = master.id;
      await db.dailyTasks.update(task.id, { masterTaskId: masterId });
    }
    const master = await db.masterTasks.get(masterId);
    if (!master) return;
    await db.masterTasks.update(masterId, { isFavorite: !master.isFavorite });
  }

  // カレンダー予定インポートで登録された作業(scheduledTime)について、その時刻になっても
  // 自動的に差し込み開始しないようにする/元に戻す。時刻の目安表示自体は残す
  async function toggleAutoStart(task: DailyTask) {
    await db.dailyTasks.update(task.id, { autoStartDisabled: !task.autoStartDisabled });
  }

  // この作業カードに紐づく元のTodoタスクを完了にする（繰り返しタスクは次回期日に進む）
  async function completeLinkedTodo(todoTaskId: string) {
    const todoTask = todoTaskMap.get(todoTaskId);
    if (!todoTask) return;
    await completeTodoTask(todoTask, date);
  }

  // 段階に紐付かず案件に直接追加された作業カードから、案件そのものを完了/未完了に切り替える
  async function toggleLinkedProjectComplete(project: ProjectItem) {
    if (!project.completedAt && !confirm(`案件「${project.title}」を完了にしますか?`)) return;
    const nowCompleting = !project.completedAt;
    await db.projects.update(project.id, { completedAt: nowCompleting ? Date.now() : undefined, autoCompletedByImport: false });
    if (nowCompleting) fireConfetti();
  }

  async function deleteTask(task: DailyTask) {
    if (!confirm(`「${task.name}」を本日の作業リストから削除しますか?`)) return;
    await db.dailyTasks.delete(task.id);
  }

  // 完了済みの作業を、本日の作業リストから削除する(必要に応じて紐づく実績・作業マスタも
  // あわせて削除する)。同じ区分/作業名の実績は日付ごとに1件へ合算されているため、
  // この作業インスタンス分の秒数だけ差し引く(合算後0以下になれば実績ごと削除する)
  async function deleteCompletedTask(task: DailyTask, deleteRecord: boolean, deleteMaster: boolean) {
    const taskSnapshot = { ...task };
    let recordSnapshot: WorkRecord | undefined;
    let masterSnapshot: MasterTask | undefined;

    const existing = task.masterTaskId ? await findMergeTargetRecord(task.date, task.masterTaskId, task) : undefined;

    await db.dailyTasks.delete(task.id);

    if (deleteRecord && existing) {
      recordSnapshot = { ...existing };
      const taskSeconds = Math.round(task.accumulatedMs / 1000);
      const remaining = existing.seconds - taskSeconds;
      if (remaining <= 0) {
        await db.records.delete(existing.id);
      } else {
        // 合算元のうちどの区間がこの作業分だったか厳密には切り分けられないため、
        // segmentsは破棄する(定時以降の判定はstartedAt〜endedAtの近似に戻る)
        await db.records.update(existing.id, { seconds: remaining, segments: undefined });
      }
    }

    if (deleteMaster && task.masterTaskId) {
      masterSnapshot = await db.masterTasks.get(task.masterTaskId);
      await db.masterTasks.delete(task.masterTaskId);
    } else if (deleteRecord && existing && task.masterTaskId) {
      await recomputeEstimateFromRecords(task.masterTaskId);
    }

    const parts = ["本日の作業"];
    if (deleteRecord && existing) parts.push("実績");
    if (deleteMaster && masterSnapshot) parts.push("作業マスタ");
    showUndoToast(`「${task.name}」の${parts.join("・")}を削除しました`, async () => {
      await db.dailyTasks.add(taskSnapshot);
      if (recordSnapshot) await db.records.put(recordSnapshot);
      if (masterSnapshot) await db.masterTasks.put(masterSnapshot);
      if (deleteRecord && existing && task.masterTaskId && !deleteMaster) {
        await recomputeEstimateFromRecords(task.masterTaskId);
      }
    });
  }

  // 未着手(pending)の作業カードをドラッグ&ドロップで並べ替える。計測中・完了は表示上
  // 常に上/下に固定されるため、同じ未着手グループ内での並べ替えのみを対象にする
  async function reorderPendingTask(draggedId: string, targetId: string) {
    if (draggedId === targetId || !tasks) return;
    const group = tasks.filter((t) => t.status === "pending" && !t.isProvisional).sort((a, b) => a.order - b.order);
    const fromIdx = group.findIndex((t) => t.id === draggedId);
    const toIdx = group.findIndex((t) => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...group];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    await Promise.all(reordered.map((t, i) => db.dailyTasks.update(t.id, { order: i })));
  }

  async function pauseTask(task: DailyTask) {
    const nowMs = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: nowMs } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? nowMs) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs, stoppedAt: nowMs });
  }

  // 強制ストップされた休憩帯を、「実は移動やミーティングで作業していた」として後から
  // 既存の作業へ割り当てる。休憩帯の開始〜終了を1つの実働区間として追加し、その分だけ
  // 計測時間を増やす(現在計測中の区間があってもそれは含めず、確定済みの区間だけを再集計する)
  async function assignBreakTimeToTask(task: DailyTask, range: BreakRange) {
    const startMs = timeToMsOfDay(date, range.start);
    const endMs = timeToMsOfDay(date, range.end);
    const segments = [...task.segments, { start: startMs, end: endMs }].sort((a, b) => a.start - b.start);
    const accumulatedMs = segments
      .filter((s): s is { start: number; end: number } => s.end !== undefined)
      .reduce((sum, s) => sum + (s.end - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, accumulatedMs });
    setBreakAssignRange(null);
  }

  // 同様に、その場で新しい作業として登録した上で休憩帯の時間を割り当てる
  async function assignBreakTimeToNewTask(category: string, workName: string, range: BreakRange) {
    const startMs = timeToMsOfDay(date, range.start);
    const endMs = timeToMsOfDay(date, range.end);
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const task: DailyTask = {
      id: uid(),
      date,
      order: count,
      category,
      name: workName,
      estimatedSeconds: 0,
      status: "paused",
      segments: [{ start: startMs, end: endMs }],
      accumulatedMs: endMs - startMs,
      startedAt: startMs,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
    setBreakAssignRange(null);
  }

  // 作業を完了にせず、計測時間だけを加算する。segmentsとは独立したmanualAdjustmentMsとして
  // 保持し、一時停止・終了時にsegments合計で上書きされて消えてしまわないようにする
  async function addTimeToTask(task: DailyTask, seconds: number) {
    if (seconds <= 0) return;
    await db.dailyTasks.update(task.id, { manualAdjustmentMs: (task.manualAdjustmentMs ?? 0) + seconds * 1000 });
    setAddTimeTask(null);
  }

  // 作業を完了として確定する。同日・同じマスタの実績が既にあれば合算する
  // 完了の確定と実績への反映はlib/tasks.tsのfinishDailyTaskに一本化している。
  // ここではこの画面固有の後処理(タブ切り替え・超過通知の解除)だけを行う
  // 戻り値: 実際に完了させたか(連打などで既に完了済みだった場合はfalse)
  async function commitFinish(task: DailyTask, options?: FinishDailyTaskOptions): Promise<boolean> {
    if (!(await finishDailyTask(task, options))) return false;
    // 放置検知・位置情報による無人での自動打ち切りもここを通るが、それらは今まさに
    // 完了操作をしたわけではないので、タブ切り替えの対象から外す(仮計測は必ず該当する)
    if (!task.isProvisional) {
      // 完了させたら、次に何をするか選びやすいよう「予定」タブに切り替える
      setTaskViewTab("pending");
    }
    if (overrunTask?.id === task.id) setOverrunTask(null);
    return true;
  }

  // 案件の段階・案件(段階なし直付け)・ToDoのいずれかから追加された作業を完了させた場合、
  // その紐づく先自体も完了とみなせるか確認する（まだ続く場合は確認せず、作業時間の記録だけ残す）。
  // 1つの作業が複数(例: 段階作業がToDoからも反映されている)に該当する場合は、
  // confirmQueueで1つずつ順番に確認する
  function queueLinkedCompletionConfirms(task: DailyTask) {
    const queue: LinkedCompletionConfirm[] = [];
    if (task.stageId && task.projectId) {
      const project = projectMap.get(task.projectId);
      const stage = project?.stages?.find((s) => s.id === task.stageId);
      if (stage && !isStageDone(stage)) queue.push({ kind: "stage", task });
    } else if (task.projectId) {
      const project = projectMap.get(task.projectId);
      if (project && !project.completedAt) queue.push({ kind: "project", task });
    }
    if (task.todoTaskId) {
      const todo = todoTaskMap.get(task.todoTaskId);
      if (todo && !todo.completed) queue.push({ kind: "todo", task });
    }
    if (queue.length > 0) setConfirmQueue((q) => [...q, ...queue]);
  }

  // endAtOverride: 止め忘れていた場合に、計測中セグメントを閉じる実際の終了時刻を
  // 現在時刻の代わりに指定する(FinishAtDialogから)
  async function finishTask(task: DailyTask, endAtOverride?: number) {
    // 2回目の「終了」(連打)では、紐づく先の確認や中断作業の再開を繰り返さない
    if (!(await commitFinish(task, { endAtMs: endAtOverride }))) return;
    queueLinkedCompletionConfirms(task);
    // トラブル対応・予定の自動差し込みなどで中断した作業（仮計測含む、複数ある場合も全て）を自動的に再開する
    if (task.resumeTaskIds && task.resumeTaskIds.length > 0) {
      for (const id of task.resumeTaskIds) {
        const target = await db.dailyTasks.get(id);
        if (target && target.status === "paused") {
          await startTask(target);
        }
      }
    }
  }

  // 仮計測タスクを、本日の作業に既に登録されている作業に割り当てる。
  // 未計測だった区間の開始時刻から、そのままその作業の計測として続ける
  // （一時停止中だった場合は、その時間が計測に加算される形になる）
  async function resolveProvisionalToExisting(targetId: string) {
    if (!provisionalTask) return;
    const target = tasks?.find((t) => t.id === targetId);
    if (!target) return;
    const provisionalId = provisionalTask.id;
    const startAt = provisionalTask.startedAt ?? Date.now();
    if (target.status === "done") {
      // 完了済みの作業を選んだ場合は、restartCompletedTaskと同様に完了記録は
      // そのまま残し、新しいインスタンスを追加してそちらへ仮計測分を合算する
      const estimatedSeconds = await computeRemainingEstimatedSeconds(date, target.category, target.name, target.estimatedSeconds);
      await db.transaction("rw", db.dailyTasks, async () => {
        await insertRunningTask(target.category, target.name, estimatedSeconds, target.masterTaskId, startAt);
        await db.dailyTasks.delete(provisionalId);
      });
      setTaskViewTab("running");
      return;
    }
    // 対象作業を再開してから仮計測タスクを消すまでの間、両方が「計測中」に
    // 見える瞬間ができないよう、ひとつのトランザクションでまとめて処理する
    await db.transaction("rw", db.dailyTasks, async () => {
      await startTask(target, startAt);
      await db.dailyTasks.delete(provisionalId);
    });
    setTaskViewTab("running");
  }

  // 仮計測タスクを、新しい作業（マスタ選択 or 自由入力 or トラブル対応）として確定する。
  // 計測はそのまま継続する
  async function resolveProvisionalAsNew(
    category: string,
    name: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    hasPlan: boolean,
    isTrouble?: boolean
  ) {
    if (!provisionalTask) return;
    await db.dailyTasks.update(provisionalTask.id, {
      category,
      name,
      estimatedSeconds: hasPlan ? estimatedSeconds : 0,
      hasPlan,
      masterTaskId,
      isProvisional: false,
      ...(isTrouble ? { isTrouble: true } : {}),
    });
    setTaskViewTab("running");
  }

  // 割り当てずに「未分類」の実績としてそのまま終了する
  async function resolveProvisionalFinish() {
    if (!provisionalTask) return;
    await finishTask(provisionalTask);
  }

  // 計測し忘れた場合に、実際の所要時間を直接入力して終了する
  async function manualFinish(task: DailyTask, manualSeconds: number) {
    if (manualSeconds <= 0) return;
    const nowMs = Date.now();
    const startedAt = nowMs - manualSeconds * 1000;
    const segments: TimeSegment[] = [{ start: startedAt, end: nowMs }];
    await commitFinish(task, { segments, startedAt });
    queueLinkedCompletionConfirms(task);
  }

  // 体調を記録する。その時点で計測中の作業があれば一緒に紐付けて残す
  async function logCondition(level: string) {
    const runningTask = (tasks ?? []).find((t) => t.status === "running");
    const nowMs = Date.now();
    await db.conditionLogs.add({
      id: uid(),
      date,
      time: formatClock(nowMs),
      loggedAt: nowMs,
      level,
      category: runningTask?.category,
      name: runningTask?.name,
    });
  }

  // 完了した作業の実際の作業時間中に記録されていた体調ログを返す（複数あれば最後のもの）。
  // この作業「専用」の記録があるかどうかの判定に使う（編集時に上書き対象を決めるため）。
  // 終了時刻ちょうどは次の作業の開始時刻と一致し得るため、終了側は含めない
  // （境界の記録がどちらの作業のものか曖昧にならないようにする）
  function taskOwnConditionLog(task: DailyTask) {
    if (!task.startedAt || !task.endedAt) return null;
    const matches = (conditionLogs ?? []).filter(
      (log) => log.loggedAt >= task.startedAt! && log.loggedAt < task.endedAt!
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  // 表示用の体調レベル。その作業専用の記録があればそれを、無ければ集計(生産性分析等)と
  // 同じ「繰り越し」ロジックで、直前までに記録されていた体調を表示する
  function taskDisplayConditionLevel(task: DailyTask): string | null {
    const own = taskOwnConditionLog(task);
    if (own) return own.level;
    if (!task.startedAt || !task.endedAt) return null;
    return dominantConditionLevel(conditionLogs ?? [], task.date, task.startedAt, task.endedAt);
  }

  // 完了した作業に体調を記録/変更する。その作業専用の体調ログが既にあればそれを書き換え、
  // 無ければ（繰り越し表示中でも）新しくその作業専用の記録を作業終了時刻で追加する
  // （直前の作業から繰り越されている共有ログ自体は書き換えない）
  async function setTaskCondition(task: DailyTask, level: string) {
    const existing = taskOwnConditionLog(task);
    if (existing) {
      await db.conditionLogs.update(existing.id, { level });
    } else {
      // 開始・終了ちょうどの時刻だと、隣接する作業の境界時刻と一致してしまい、
      // どちらの作業の記録か曖昧になる(ガントチャート上でも境界に表示されて分かりづらい)。
      // 作業時間の中央に置くことで、その作業の区間内であることを明確にする
      const loggedAt =
        task.startedAt && task.endedAt
          ? Math.round((task.startedAt + task.endedAt) / 2)
          : (task.endedAt ?? task.startedAt ?? Date.now());
      await db.conditionLogs.add({
        id: uid(),
        date: task.date,
        time: formatClock(loggedAt),
        loggedAt,
        level,
        category: task.category,
        name: task.name,
      });
    }
    setConditionEditTaskId(null);
  }

  async function clearTaskCondition(task: DailyTask) {
    const existing = taskOwnConditionLog(task);
    if (existing) await db.conditionLogs.delete(existing.id);
    setConditionEditTaskId(null);
  }

  async function addFavoriteAndStart(masterTaskId: string) {
    const master = await db.masterTasks.get(masterTaskId);
    if (!master) return;
    const estimatedSeconds = await computeRemainingEstimatedSeconds(date, master.category, master.name, master.estimatedSeconds);
    requestStartNew(master.category, master.name, estimatedSeconds, master.id);
  }

  // 本日すでに完了した作業を、もう一度(新しいインスタンスとして)開始し直す
  async function restartCompletedTask(daily: DailyTask) {
    const estimatedSeconds = await computeRemainingEstimatedSeconds(date, daily.category, daily.name, daily.estimatedSeconds);
    requestStartNew(daily.category, daily.name, estimatedSeconds, daily.masterTaskId);
  }

  // 完了済みの作業を、同じインスタンスのまま「続きから」再開する(区間を追加して計測を継続する)。
  // 未計測(仮計測)が計測中の場合は二重計測になるため、先に判断を仰いでから合算/破棄する
  async function continueCompletedTaskDirect(daily: DailyTask, startAt: number) {
    const segments = [...daily.segments, { start: startAt }];
    await db.dailyTasks.update(daily.id, {
      segments,
      status: "running",
      endedAt: undefined,
      stoppedAt: undefined,
      // 反映済みの印が無い(この仕組みより前に完了した)作業は、完了時点の合計と区間を
      // 反映済みとみなす。これが無いと次の完了で前回分が実績に二重に足されてしまう
      recordedMs: daily.recordedMs ?? daily.accumulatedMs,
      recordedSegmentCount: daily.recordedSegmentCount ?? daily.segments.length,
    });
    setTaskViewTab("running");
  }

  function continueCompletedTask(daily: DailyTask) {
    if (provisionalActive) {
      setRestartChoice(null);
      setPendingContinue(daily);
      return;
    }
    continueCompletedTaskDirect(daily, Date.now());
  }

  // 未計測(仮計測)分を、これから続ける作業に合算する（未計測の開始時刻からそのまま続けて計測）
  async function resolvePendingContinueMerge() {
    if (!pendingContinue || !provisionalTask) return;
    const provisionalId = provisionalTask.id;
    const mergeStartAt = provisionalTask.startedAt ?? Date.now();
    await db.transaction("rw", db.dailyTasks, async () => {
      await continueCompletedTaskDirect(pendingContinue, mergeStartAt);
      await db.dailyTasks.delete(provisionalId);
    });
    setPendingContinue(null);
  }

  // 未計測(仮計測)分は記録せずに打ち切り、続ける作業は今の時刻から新たに計測する
  async function resolvePendingContinueDiscard() {
    if (!pendingContinue || !provisionalTask) return;
    const provisionalId = provisionalTask.id;
    await db.transaction("rw", db.dailyTasks, async () => {
      await continueCompletedTaskDirect(pendingContinue, Date.now());
      await db.dailyTasks.delete(provisionalId);
    });
    setPendingContinue(null);
  }

  async function startSuggested() {
    if (!suggestedTask) return;
    const master = await findOrCreateMasterTask(suggestedTask.category, suggestedTask.name, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      date,
      suggestedTask.category,
      suggestedTask.name,
      master.estimatedSeconds
    );
    requestStartNew(suggestedTask.category, suggestedTask.name, estimatedSeconds, master.id);
  }

  // 作業名・対応部署を入力せずにすぐ計測を開始し、詳細は後から編集する。
  // どんな状態でもトラブル対応を最優先で開始する。仮計測を含め、計測中の作業が
  // （複数同時に計測中であっても全て）あればまず一時停止し、トラブル対応が
  // 終わったら自動的に再開できるよう覚えておく
  async function startTrouble() {
    const runningTasks = (tasks ?? []).filter((t) => t.status === "running");
    const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
    const nowMs = Date.now();
    const task: DailyTask = {
      id: uid(),
      date,
      order: count,
      category: "トラブル対応",
      name: `トラブル ${formatClock(nowMs)}`,
      estimatedSeconds: 0,
      status: "running",
      segments: [{ start: nowMs }],
      accumulatedMs: 0,
      startedAt: nowMs,
      isSpontaneous: true,
      isTrouble: true,
      resumeTaskIds: runningTasks.map((t) => t.id),
    };
    await db.transaction("rw", db.dailyTasks, async () => {
      for (const r of runningTasks) await pauseTask(r);
      await db.dailyTasks.add(task);
    });
    setTaskViewTab("running");
  }

  // 予定インポートで登録した作業(scheduledTime)がその時刻になったら、計測中の作業を
  // 計測中の作業が無ければそのまま差し込み開始する。トラブル対応と異なり、予定終了後に
  // 元の作業を自動再開はしない（予定の内容によって次にやることが変わり得るため、判断は
  // ユーザーに委ねる）。既に計測中の作業がある場合は、強制的に止めて差し込むのではなく、
  // 停止して開始するかどうかを確認する
  async function autoStartScheduledTask(task: DailyTask) {
    const runningTasks = (tasks ?? []).filter((t) => t.status === "running");
    notify("予定の時刻になりました", `${task.category} / ${task.name}`, `schedule-${task.id}`);
    if (runningTasks.length > 0) {
      await db.dailyTasks.update(task.id, { autoStartNotified: true });
      setScheduleConflict({ task, runningTasks });
      return;
    }
    const nowMs = Date.now();
    await db.dailyTasks.update(task.id, {
      status: "running",
      segments: [{ start: nowMs }],
      startedAt: nowMs,
      autoStartNotified: true,
    });
  }

  // 予定インポートの自動開始と、計測中の作業がバッティングした際の確認モーダルへの回答を反映する
  async function resolveScheduleConflict(startScheduled: boolean) {
    if (!scheduleConflict) return;
    const { task, runningTasks } = scheduleConflict;
    setScheduleConflict(null);
    if (!startScheduled) return;
    const nowMs = Date.now();
    await db.transaction("rw", db.dailyTasks, async () => {
      for (const r of runningTasks) await pauseTask(r);
      await db.dailyTasks.update(task.id, {
        status: "running",
        segments: [{ start: nowMs }],
        startedAt: nowMs,
      });
    });
  }

  function downloadScheduleTemplate() {
    downloadTextFile("schedule_template.csv", scheduleCsvTemplate());
  }

  // 予定CSVと、カレンダー(.ics)の両方を受ける。.icsはOutlook/Googleカレンダー/スマホの
  // カレンダーがそのまま書き出せる形式で、解析はブラウザ内で完結する。
  // どちらも同じ ScheduleRow に落としてから取り込むので、以降の扱いは共通
  async function importScheduleFile(file: File) {
    const text = await file.text();
    const isIcs = /\.ics$/i.test(file.name) || /BEGIN:VCALENDAR/i.test(text.slice(0, 200));

    let rows;
    let errors: string[];
    let notes: string[] = [];
    if (isIcs) {
      const parsed = parseIcsToScheduleRows(text);
      rows = parsed.rows;
      errors = parsed.errors;
      if (parsed.skipped > 0) notes.push(`終日・中止の予定${parsed.skipped}件は取り込みませんでした`);
      if (parsed.timezones.length > 0) {
        notes.push(`書き出し元のタイムゾーン: ${parsed.timezones.join("、")}（時刻は書かれたまま取り込みます）`);
      }
    } else {
      const parsed = parseScheduleCsv(text);
      rows = parsed.rows;
      errors = parsed.errors;
    }

    setScheduleImportErrors(errors);
    if (rows.length === 0) {
      setScheduleImportResult(notes.join(" / "));
      if (errors.length === 0) {
        alert(
          isIcs
            ? `今日から${DEFAULT_IMPORT_DAYS}日以内に、取り込める予定が見つかりませんでした。`
            : "取り込める予定がありませんでした（このCSVにはヘッダーのみで、予定のデータ行がありません）。"
        );
      }
      return;
    }
    const { created } = await importScheduleRows(rows);
    setScheduleImportResult([`${created}件の予定を取り込みました。`, ...notes].join(" / "));
  }

  async function enableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
  }

  const streakDays = useMemo(() => computeStreakDays(projectRecords ?? [], date), [projectRecords, date]);

  const methodSuggestions = useMemo(() => collectMethodSuggestions(projectRecords ?? []), [projectRecords]);

  // 同曜日比較: 本日の実績合計を、過去の同じ曜日の平均と比べる
  const todayTotalSeconds = useMemo(
    () => (projectRecords ?? []).filter((r) => r.date === date && !r.excludedFromStats).reduce((s, r) => s + r.seconds, 0),
    [projectRecords, date]
  );
  const sameWeekdayAvg = useMemo(() => {
    const averages = computeWeekdayAverages((projectRecords ?? []).filter((r) => r.date !== date));
    const dow = new Date(date + "T12:00:00").getDay();
    return averages.find((w) => w.dow === dow) ?? null;
  }, [projectRecords, date]);
  const latestConditionLevel =
    conditionLogs && conditionLogs.length > 0 ? conditionLogs[conditionLogs.length - 1].level : null;

  // 「今日の一枚」: 本日の実績(除外分を除く)からカテゴリ別内訳とMVP作業(最長時間)を集計する
  const [showDayCard, setShowDayCard] = useState(false);
  const [showTomorrowDraft, setShowTomorrowDraft] = useState(false);
  const [showDayPlan, setShowDayPlan] = useState(false);
  const [showReflection, setShowReflection] = useState(false);
  const reflectionAnsweredToday = useLiveQuery(
    async () => !!(await db.settings.get(`reflection.daily.${date}`)),
    [date]
  );
  const todayRecordsForCard = useMemo(
    () => (projectRecords ?? []).filter((r) => r.date === date && !r.excludedFromStats),
    [projectRecords, date]
  );
  const dayCardData: DayCardData = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const r of todayRecordsForCard) {
      byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.seconds);
    }
    const categoryTotals = [...byCategory.entries()]
      .map(([category, seconds]) => ({ category, seconds }))
      .sort((a, b) => b.seconds - a.seconds);
    const mvpRecord = [...todayRecordsForCard].sort((a, b) => b.seconds - a.seconds)[0];
    const { stage } = computeGrowthStage(themedMode, todayTotalSeconds);
    return {
      appTitle: appTitle(wordingMode),
      date,
      totalSeconds: todayTotalSeconds,
      doneCount: (tasks ?? []).filter((t) => t.status === "done" && !t.isProvisional).length,
      streakDays,
      growthIcon: stage.icon,
      growthLabel: stage.label,
      categoryTotals,
      mvpTask: mvpRecord ? { category: mvpRecord.category, name: mvpRecord.name, seconds: mvpRecord.seconds } : undefined,
    };
  }, [todayRecordsForCard, themedMode, todayTotalSeconds, tasks, streakDays, date, wordingMode]);

  // 条件付き見積もり警告: 現在の体調・天気から、既存の分析データ(体調別/天気別の生産性)を使い
  // 「今日はいつもよりどのくらいかかりそうか」を一言添える(通知ではなく控えめなインライン表示)。
  // 上のconditionLogsは本日分だけに絞られているため、履歴分析用に全期間を別途取得する
  const allConditionLogsForEstimate = useLiveQuery(() => db.conditionLogs.toArray(), []);
  const weatherForecastsForEstimate = useLiveQuery(() => db.weatherForecasts.toArray(), []);
  const conditionProductivity = useMemo(
    () =>
      allMasterTasks && projectRecords && allConditionLogsForEstimate
        ? computeProductivityByCondition(allConditionLogsForEstimate, projectRecords, allMasterTasks)
        : [],
    [allMasterTasks, projectRecords, allConditionLogsForEstimate]
  );
  const weatherProductivityForEstimate = useMemo(
    () =>
      allMasterTasks && projectRecords && weatherForecastsForEstimate
        ? computeProductivityByWeather(weatherForecastsForEstimate, projectRecords, allMasterTasks)
        : [],
    [allMasterTasks, projectRecords, weatherForecastsForEstimate]
  );
  const estimateAdjustment = useMemo(() => {
    const MIN_SAMPLES = 3;
    const factors: string[] = [];
    let totalShortfallPct = 0;
    let count = 0;
    if (latestConditionLevel) {
      const row = conditionProductivity.find((r) => r.level === latestConditionLevel);
      if (row && row.sampleCount >= MIN_SAMPLES && row.avgProductivityPct < 95) {
        totalShortfallPct += 100 - row.avgProductivityPct;
        count++;
        factors.push("体調");
      }
    }
    const isRainyNow = (weather.current ?? []).some((c) => c.precipProbability >= 50);
    if (isRainyNow) {
      const row = weatherProductivityForEstimate.find((r) => r.bucket === "rain");
      if (row && row.sampleCount >= MIN_SAMPLES && row.avgProductivityPct < 95) {
        totalShortfallPct += 100 - row.avgProductivityPct;
        count++;
        factors.push("天気");
      }
    }
    if (count === 0) return null;
    return { factors, avgShortfallPct: Math.round(totalShortfallPct / count) };
  }, [latestConditionLevel, conditionProductivity, weather.current, weatherProductivityForEstimate]);

  // 個々のタスクカードの描画をmapのコールバックから関数として切り出したもの
  // 作業カード(TaskCard)に渡す、タブ全体で共有している状態と操作
  const taskCardCtx: TaskCardContext = {
    now,
    themedMode,
    va11hallaMode,
    wordingThemedMode,
    emphasizeRunning,
    conditionEnabled,
    standardWorkEnd,
    nextTaskId,
    provisionalActive,
    effectiveLastStopTime,
    runningTaskIds,
    runningTaskKeys,
    favoriteMasterIds,
    predictedSecondsByTaskId,
    projectedFinishByTaskId,
    topRankedKeys,
    effectiveAllocation,
    projectMap,
    projectTotalSeconds,
    todoTaskMap,
    draggingTaskId,
    setDraggingTaskId,
    conditionEditTaskId,
    setConditionEditTaskId,
    taskOwnConditionLog,
    taskDisplayConditionLevel,
    startTask,
    pauseTask,
    finishTask,
    deleteTask,
    reorderPendingTask,
    toggleTaskFavorite,
    toggleAutoStart,
    toggleLinkedProjectComplete,
    completeLinkedTodo,
    setTaskCondition,
    clearTaskCondition,
    onRequestStageConfirm: (task) => setConfirmQueue((q) => [...q, { kind: "stage", task }]),
    setEditingTask,
    setDeletingCompletedTask,
    setAddTimeTask,
    setManualFinishTaskTarget,
    setFinishAtTask,
    setSecondaryProjectsTask,
    onOpenTodoDetail,
    onOpenProjectEdit,
  };

  return (
    <div className="space-y-4">
      {themedMode && (
        <div
          className={`containment-vignette ${va11hallaMode ? "vignette-v11" : ""} ${
            runningOverrunTasks.length > 0 ? "is-active" : ""
          }`}
          aria-hidden="true"
        />
      )}
      {themedMode && runningOverrunTasks.length > 0 && (
        <div
          className={`warning-ticker panel px-3 py-2 text-xs font-bold ${
            va11hallaMode ? "border border-v11-pink/60 bg-v11-pink/10 text-v11-pink" : `border border-alert/60 bg-alert/10 ${emphasisTextClass(themedMode)}`
          }`}
        >
          <div className="warning-ticker-track">
            {(() => {
              const names = runningOverrunTasks.map((t) => `${t.category}/${t.name}`).join("、");
              // 文言表示がオフの時はタイマーの階級名(ALEPH等)も出さず、通常の言い回しにする
              const tierName = wordingThemedMode ? worstRiskTier?.name : undefined;
              const message =
                wordingThemedMode === "va11halla"
                  ? `⚡ GLITCH CITY NETWORK ⚡ 予測時間を超過して稼働中の注文が${runningOverrunTasks.length}件${
                      tierName ? `（最大: ${tierName}）` : ""
                    }： ${names}`
                  : wordingThemedMode === "persona5"
                    ? `★ 予告状 ★ 潜入予定時間を超過している作業が${runningOverrunTasks.length}件${
                        tierName ? `（最大階級: ${tierName}）` : ""
                      }： ${names}`
                    : wordingThemedMode === "natsuyasumi"
                      ? `☀ 夏休みの日記帳より ☀ 予定より長引いている作業が${runningOverrunTasks.length}件あります${
                          tierName ? `（今日のお天気: ${tierName}）` : ""
                        }： ${names}`
                      : wordingThemedMode === "lobotomy"
                          ? `⚠ 収容の不安定化を検知 ⚠ 予測を超過して計測中の作業が${runningOverrunTasks.length}件あります${
                              tierName ? `（最大警戒階級: ${tierName}）` : ""
                            }： ${names}`
                          : `⚠ 予測を超過して計測中の作業が${runningOverrunTasks.length}件あります： ${names}`;
              return `${message}　${message}`;
            })()}
          </div>
        </div>
      )}
      {quickActionMessage && (
        <div className="panel flex items-center justify-between gap-2 border border-cream/30 p-4">
          <p className="text-sm font-bold text-cream">{quickActionMessage}</p>
          <button className="text-xs text-cream/50" onClick={() => setQuickActionMessage(null)}>
            閉じる
          </button>
        </div>
      )}
      {weather.alert && (
        <div className="panel flex items-center justify-between gap-2 border border-alert/40 p-4">
          <p className="text-sm font-bold text-cream">
            ☔ {weather.alert.placeLabel}で{formatCrossingDateTime(weather.alert.atIso)}頃、降水確率
            {weather.alert.precipProbability}%の見込みです（{Math.round(weather.alert.hoursUntil * 10) / 10}時間後）
          </p>
          <button className="text-xs text-cream/50" onClick={weather.dismissAlert}>
            閉じる
          </button>
        </div>
      )}
      <TodayHandoffPanel today={date} />
      {showStatusPanel && (
        <TodayStatusPanel
          tasks={tasks ?? []}
          conditionLogs={conditionLogs ?? []}
          now={now}
          standardWorkStart={standardWorkStart}
          standardWorkEnd={standardWorkEnd}
        />
      )}
      {showDailyChallenge && <DailyChallengePanel />}
      <TodayHintPanel />
      <BackupNudge />
      <TodayMemoPanel onOpenMemo={onOpenMemo} />
      {startedForceStopRanges.length > 0 && (
        <div className="panel space-y-2 p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">☕ 本日の休憩</h3>
          <p className="text-xs text-cream/50">
            この時間帯になると計測中の作業を自動で一時停止します。移動やミーティングなどで実際には
            作業していた場合は、後からその作業に割り当てられます。
          </p>
          <div className="space-y-1.5">
            {startedForceStopRanges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2 text-sm">
                <span className="text-cream/70">
                  {r.start}〜{r.end}
                </span>
                <div className="flex flex-wrap gap-2">
                  {(r.checklist?.length ?? 0) > 0 && (
                    <button className="btn-pill-outline text-xs" onClick={() => setBreakChecklistRange(r)}>
                      チェックリストを見る
                    </button>
                  )}
                  <button className="btn-pill-outline text-xs" onClick={() => setBreakAssignRange(r)}>
                    実は作業していた分を割り当てる
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {showAutoAllocate && (
        <AutoAllocatePanel
          mode={autoAllocateMode as AutoAllocateMode}
          onModeChange={setAutoAllocateMode}
          standardWorkEnd={standardWorkEnd}
          allocation={effectiveAllocation}
          manualComputed={!!manualAllocation}
          manualComputedAt={manualAllocationAt}
          onRunManual={runManualAllocation}
        />
      )}
      {conditionEnabled && (
        <div className="panel p-4">
          <h3 className="mb-2 font-display text-sm font-bold text-cream/80">今の体調</h3>
          <div className="flex flex-wrap gap-2">
            {CONDITION_LEVELS.map((c) => (
              <button
                key={c.level}
                className={
                  c.level === latestConditionLevel
                    ? "btn-pill p-1.5"
                    : "btn-pill-outline p-1.5"
                }
                onClick={() => logCondition(c.level)}
                aria-label={c.label}
                title={c.label}
              >
                <ConditionGlyph level={c.level} size={28} />
              </button>
            ))}
          </div>
        </div>
      )}

      {(!tasks || tasks.length === 0) && (
        <div className="panel p-5">
          <h2 className="mb-3 font-display text-lg font-bold">本日の作業リストを生成</h2>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value) as Weekday)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
            >
              {([1, 2, 3, 4, 5] as Weekday[]).map((w) => (
                <option key={w} value={w}>
                  {WEEKDAY_LABELS[w]}曜日
                </option>
              ))}
            </select>
            <button className="btn-pill" onClick={requestGenerateFromTemplate}>
              テンプレートから生成
            </button>
          </div>
        </div>
      )}

      {notifPermission !== "granted" && notifPermission !== "unsupported" && (
        <div className="panel flex items-center justify-between p-4">
          <p className="text-sm text-cream/80">予定超過を通知でお知らせできます。</p>
          <button className="btn-pill-outline text-sm" onClick={enableNotifications}>
            通知を許可
          </button>
        </div>
      )}

      {geoTrackingEnabled && (
        <GeoTrackingStatus
          error={geoMovement.error}
          distanceThresholdMeters={geoDistanceThresholdMeters}
          category={geoCategorySetting}
          taskName={geoTaskNameSetting}
          stillMs={geoStillMs}
        />
      )}

      {geoArrivalEnabled && (
        <GeoArrivalStatus
          error={geoArrival.error}
          placeCount={(geoPlaces ?? []).length}
          wakeLockActive={wakeLock.active}
          wakeLockError={wakeLock.error}
        />
      )}

      {weather.notifyEnabled && (weather.places ?? []).length > 0 && (
        <WeatherStatus
          placeCount={(weather.places ?? []).length}
          thresholdPercent={weather.thresholdStr}
          leadHours={weather.leadHoursStr}
          error={weather.error}
          checking={weather.checking}
          lastCheckedAt={weather.lastCheckedAt}
          current={weather.current}
          nextCrossings={weather.nextCrossings}
          onCheckNow={weather.checkNow}
        />
      )}

      {estimateAdjustment && (
        <div className="panel p-4">
          <p className="text-sm text-cream/80">
            🔍 今日は{estimateAdjustment.factors.join("・")}の影響で、いつもより
            <span className="mx-1 font-bold text-alert">+{estimateAdjustment.avgShortfallPct}%</span>
            ほど時間がかかる見込みです。
          </p>
          <p className="mt-1 text-[10px] text-cream/40">
            過去の{estimateAdjustment.factors.join("・")}別の生産性データ(要注意リスト)から算出した目安です。
          </p>
        </div>
      )}

      {showNextMovePick && nextTaskPick && (
        <div className="panel flex flex-wrap items-center justify-between gap-2 border border-alert/40 bg-alert/5 p-4">
          <div>
            <h3 className="font-display text-sm font-bold text-alert">🎯 今この一手</h3>
            <p className="text-xs text-cream/50">{nextTaskPick.reason}</p>
            <p className="mt-1 text-sm text-cream">
              {nextTaskPick.category} / {nextTaskPick.name}
            </p>
          </div>
          <button className="btn-pill text-sm" onClick={startNextTaskPick}>
            ワンタップで開始
          </button>
        </div>
      )}

      {showSuggestedTask && suggestedTask && (
        <div className="panel flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <h3 className="font-display text-sm font-bold text-cream/80">💡 そろそろこの作業では?</h3>
            <p className="text-xs text-cream/50">
              同じ曜日のこの時間帯によく行っている作業です（{suggestedTask.count}回）
            </p>
            <p className="mt-1 text-sm text-cream">
              {suggestedTask.category} / {suggestedTask.name}
            </p>
          </div>
          <button className="btn-pill text-sm" onClick={startSuggested}>
            ワンタップで開始
          </button>
        </div>
      )}

      <div className="panel space-y-2 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">📓 今日の記録</h3>
        <textarea
          value={dailyJournal}
          onChange={(e) => setDailyJournal(e.target.value)}
          placeholder="タスクに縛られない、今日の気づき・メモを自由に書けます"
          rows={2}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <p className="text-[11px] text-cream/40">過去の記録は「実績編集」タブの「記録の履歴」から見返せます。</p>
      </div>

      {favorites && favorites.length > 0 && (
        <div className="panel p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setFavoritesCollapsedStr(favoritesCollapsed ? "false" : "true")}
          >
            <h3 className="font-display text-sm font-bold text-cream/80">
              ★ お気に入り（ワンタップで追加+開始）
              {favoritesCollapsed && <span className="ml-1 font-normal text-cream/40">（{favorites.length}件）</span>}
            </h3>
            <span className="text-xs text-cream/40">{favoritesCollapsed ? "▶" : "▼"}</span>
          </button>
          {!favoritesCollapsed && (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                {favorites.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-1 rounded-full border border-cream/30 bg-ink py-1 pl-1 pr-2"
                  >
                    <button
                      onClick={() => addFavoriteAndStart(f.id)}
                      className="rounded-full px-3 py-1 text-sm text-cream hover:bg-cream/10"
                    >
                      ★ {f.category} / {f.name}
                    </button>
                    {quickStartEnabled && (
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4].map((slot) => (
                          <button
                            key={slot}
                            onClick={() => toggleQuickSlot(f.id, slot)}
                            title={`ホーム画面ショートカット${slot}に割り当て`}
                            className={`h-5 w-5 rounded text-[10px] font-bold ${
                              f.quickSlot === slot ? "bg-alert text-ink" : "text-cream/30 hover:text-cream/70"
                            }`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {quickStartEnabled && (
                <p className="mt-2 text-[10px] text-cream/40">
                  番号を押すと、ホーム画面に追加したこのアプリのアイコンを長押しして出てくる「クイック起動①〜④」ショートカットにその作業を割り当てられます。ショートカットをタップすると、計測中なら終了・一時停止中なら再開・それ以外なら新規開始、とワンタップで切り替わります(対応はAndroidのChrome/Edge等。iOS Safariのホーム画面追加ではショートカットメニュー自体が利用できません)。設定画面でOFFにできます。
                </p>
              )}
            </>
          )}
        </div>
      )}

      {doneTodayUnique.length > 0 && (
        <div className="panel p-4">
          <h3 className="font-display text-sm font-bold text-cream/80">✅ 完了した業務から再開</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {doneTodayUnique.map((d) => (
              <button
                key={d.id}
                onClick={() => setRestartChoice(d)}
                className="rounded-full border border-cream/30 bg-ink px-3 py-1.5 text-sm text-cream hover:bg-cream/10"
              >
                ✅ {d.category} / {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <TodayToolbar
        date={date}
        simpleButtons={simpleButtons}
        themedMode={themedMode}
        streakDays={streakDays}
        growthStageEnabled={growthStageEnabled}
        todayTotalSeconds={todayTotalSeconds}
        sameWeekdayAvg={sameWeekdayAvg}
        reflectionAnsweredToday={!!reflectionAnsweredToday}
        hasTasks={!!tasks && tasks.length > 0}
        voice={{
          available: voiceEnabled && !voiceUnsupported,
          listening: voiceListening,
          handsFree: handsFreeMode,
          onToggle: voiceListening ? stopVoiceListening : startVoiceListening,
        }}
        showScheduleCsvTools={showScheduleCsvTools}
        onTrouble={() => startTrouble()}
        onAddTask={() => setShowAddDialog(true)}
        onDayCard={() => setShowDayCard(true)}
        onDayPlan={() => setShowDayPlan(true)}
        onTomorrowDraft={() => setShowTomorrowDraft(true)}
        onReflection={() => setShowReflection(true)}
        onDownloadScheduleTemplate={downloadScheduleTemplate}
        onImportScheduleFile={importScheduleFile}
        onRegenerate={requestGenerateFromTemplate}
      />

      {scheduleImportResult && <p className="text-xs text-cream/70">{scheduleImportResult}</p>}
      {scheduleImportErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {scheduleImportErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {taskViewTab === "board" && <UnifiedBoardSection onOpenTodo={onOpenTodoTab} />}

      {taskViewTab !== "board" && (
        <div key={taskViewTab}>
      {provisionalTask && taskViewTab === "running" && (
        <ProvisionalTaskCard
          task={provisionalTask}
          now={now}
          candidateTasks={candidateTasks}
          completedTasks={completedTasksForProvisional}
          favorites={favorites ?? []}
          onAssignExisting={resolveProvisionalToExisting}
          onAssignNew={resolveProvisionalAsNew}
          onFinishAsIs={resolveProvisionalFinish}
        />
      )}

      {taskViewTab === "pending" && (
        <div className="panel flex flex-wrap gap-x-6 gap-y-2 p-3 text-xs">
          {(() => {
            const hasTodo = pendingDueSummary.todoOverdue > 0 || pendingDueSummary.todoDueToday > 0;
            const Wrapper = hasTodo ? "button" : "div";
            return (
              <Wrapper
                className={`flex items-center gap-1.5 ${hasTodo ? "rounded-lg hover:bg-cream/5" : ""}`}
                {...(hasTodo ? { onClick: () => setDueDetailKind("todo") } : {})}
              >
                <span className="text-cream/50">✅ ToDo</span>
                {pendingDueSummary.todoOverdue > 0 && (
                  <span className="rounded-full bg-alert/15 px-2 py-0.5 font-bold text-alert">
                    期限切れ {pendingDueSummary.todoOverdue}件
                  </span>
                )}
                {pendingDueSummary.todoDueToday > 0 && (
                  <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream/80">
                    本日期限 {pendingDueSummary.todoDueToday}件
                  </span>
                )}
                {!hasTodo && <span className="text-cream/40">期限切れ・本日期限なし</span>}
              </Wrapper>
            );
          })()}
          {(() => {
            const hasProject = pendingDueSummary.projectOverdue > 0 || pendingDueSummary.projectDueToday > 0;
            const Wrapper = hasProject ? "button" : "div";
            return (
              <Wrapper
                className={`flex items-center gap-1.5 ${hasProject ? "rounded-lg hover:bg-cream/5" : ""}`}
                {...(hasProject ? { onClick: () => setDueDetailKind("project") } : {})}
              >
                <span className="text-cream/50">📁 案件</span>
                {pendingDueSummary.projectOverdue > 0 && (
                  <span className="rounded-full bg-alert/15 px-2 py-0.5 font-bold text-alert">
                    期限切れ {pendingDueSummary.projectOverdue}件
                  </span>
                )}
                {pendingDueSummary.projectDueToday > 0 && (
                  <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream/80">
                    本日期限 {pendingDueSummary.projectDueToday}件
                  </span>
                )}
                {!hasProject && <span className="text-cream/40">期限切れ・本日期限なし</span>}
              </Wrapper>
            );
          })()}
        </div>
      )}

      {dueDetailKind && (
        <DueDetailDialog
          kind={dueDetailKind}
          date={date}
          todoItems={pendingDueTodoItems}
          projectItems={pendingDueProjectItems}
          onOpenTodo={(id) => {
            setDueDetailKind(null);
            onOpenTodoDetail(id);
          }}
          onOpenProject={(id) => {
            setDueDetailKind(null);
            onOpenProjectEdit(id);
          }}
          onClose={() => setDueDetailKind(null)}
        />
      )}

      {taskViewTab === "done" && (
        <CompletedTasksGantt
          tasks={nonProvisionalSortedTasks}
          date={date}
          onOpenEdit={(task) => setEditingTask(task)}
          onCommitTimes={(task, startedAt, endedAt) =>
            applyTaskEdit(task, task.category, task.name, undefined, task.note, task.method, startedAt, endedAt)
          }
        />
      )}

      <div className="space-y-3">
        {visibleTasks.length === 0 && (
          <p className="panel p-4 text-center text-sm text-cream/50">
            {taskViewTab === "running" && "実行中・一時停止中の作業はありません"}
            {taskViewTab === "pending" && "予定している作業はありません"}
            {taskViewTab === "done" && "完了した作業はまだありません"}
          </p>
        )}
        {visibleTasks.map((task) => (
          <TaskCard key={task.id} task={task} ctx={taskCardCtx} />
        ))}
      </div>
        </div>
      )}

      <BottomTabBar
        items={[
          {
            key: "running",
            icon: "▶",
            label: "実行中",
            count: taskCountsByTab.running,
            badge: provisionalActive,
            badgeTitle: "仮計測(未割り当て)が計測中です",
            emphasize: runningTaskIds.size > 0,
          },
          { key: "pending", icon: "📋", label: "予定", count: taskCountsByTab.pending },
          { key: "done", icon: "✅", label: "完了", count: taskCountsByTab.done },
          { key: "board", icon: "🗂️", label: "ボード" },
        ]}
        activeKey={taskViewTab}
        onSelect={(k) => setTaskViewTab(k as typeof taskViewTab)}
        style={tabBarStyle as TabBarStyle}
        adaptiveEmphasis={tabBarAdaptiveEmphasis}
        running={
          runningStrip
            ? {
                ...runningStrip,
                onClick: () => setTaskViewTab("running"),
                overrunLabel: overrunLabel(wordingThemedMode),
                overrunAnimClass: themedMode ? cardOverrunClass(themedMode) : "card-overrun",
              }
            : null
        }
        progress={
          tabBarProgressStrip
            ? [
                { key: "running", ratio: taskViewTotal > 0 ? taskCountsByTab.running / taskViewTotal : 0, className: "bg-alert" },
                { key: "pending", ratio: taskViewTotal > 0 ? taskCountsByTab.pending / taskViewTotal : 0, className: "bg-cream/40" },
                { key: "done", ratio: taskViewTotal > 0 ? taskCountsByTab.done / taskViewTotal : 0, className: "bg-cream/15" },
              ]
            : undefined
        }
      />

      {showAddDialog && (
        <AddTaskDialog
          date={date}
          provisionalRunning={provisionalActive}
          lastStopTime={effectiveLastStopTime}
          doneTasks={doneTodayUnique}
          methodSuggestions={methodSuggestions}
          onRequestConflictStart={requestStartNew}
          onAdded={(status) => setTaskViewTab(status)}
          onSelectCompleted={(task) => {
            setShowAddDialog(false);
            setRestartChoice(task);
          }}
          onClose={() => setShowAddDialog(false)}
        />
      )}

      {showDayCard && <DayCardModal data={dayCardData} onClose={() => setShowDayCard(false)} />}
      {showDayPlan && <DayPlanModal today={date} onClose={() => setShowDayPlan(false)} />}
      {showTomorrowDraft && (
        <TomorrowDraftModal today={date} todayTasks={tasks ?? []} onClose={() => setShowTomorrowDraft(false)} />
      )}
      {showReflection && (
        <EndOfDayReflectionModal
          date={date}
          totalSeconds={todayTotalSeconds}
          doneCount={(tasks ?? []).filter((t) => t.status === "done" && !t.isProvisional).length}
          onClose={() => setShowReflection(false)}
        />
      )}

      {templateConfirm && (
        <TemplateConfirmDialog
          weekday={weekday}
          itemCount={templateConfirm.items.length}
          existingCount={templateConfirm.existingCount}
          onConfirm={confirmGenerateFromTemplate}
          onClose={() => setTemplateConfirm(null)}
        />
      )}

      {pendingStart && provisionalTask && (
        <ProvisionalConflictDialog
          provisionalTask={provisionalTask}
          variant="start"
          onMerge={resolvePendingStartMerge}
          onDiscard={resolvePendingStartDiscard}
          onClose={() => setPendingStart(null)}
        />
      )}

      {restartChoice && (
        <RestartChoiceDialog
          task={restartChoice}
          onContinue={() => {
            const d = restartChoice;
            setRestartChoice(null);
            continueCompletedTask(d);
          }}
          onRestartNew={() => {
            const d = restartChoice;
            setRestartChoice(null);
            restartCompletedTask(d);
          }}
          onClose={() => setRestartChoice(null)}
        />
      )}

      {pendingContinue && provisionalTask && (
        <ProvisionalConflictDialog
          provisionalTask={provisionalTask}
          variant="continue"
          onMerge={resolvePendingContinueMerge}
          onDiscard={resolvePendingContinueDiscard}
          onClose={() => setPendingContinue(null)}
        />
      )}

      {secondaryProjectsTask && (
        <SecondaryProjectsDialog
          task={secondaryProjectsTask}
          projects={projects ?? []}
          primaryProjectTitle={
            secondaryProjectsTask.projectId ? projectMap.get(secondaryProjectsTask.projectId)?.title ?? "未設定" : "未設定"
          }
          onChange={setSecondaryProjectsTask}
          onClose={() => setSecondaryProjectsTask(null)}
        />
      )}

      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          previousTaskEndedAt={findPreviousTaskEndedAt(editingTask)}
          methodSuggestions={methodSuggestions}
          onSave={(category, name, actualSeconds, note, method, startedAt, endedAt) =>
            applyTaskEdit(editingTask, category, name, actualSeconds, note, method, startedAt, endedAt)
          }
          onClose={() => setEditingTask(null)}
        />
      )}

      {deletingCompletedTask && (
        <DeleteCompletedTaskDialog
          task={deletingCompletedTask}
          onDelete={(deleteRecord, deleteMaster) => {
            deleteCompletedTask(deletingCompletedTask, deleteRecord, deleteMaster);
            setDeletingCompletedTask(null);
          }}
          onClose={() => setDeletingCompletedTask(null)}
        />
      )}

      {addTimeTask && (
        <AddTimeDialog
          taskName={addTimeTask.name}
          gapSeconds={computeUntrackedGapSeconds(tasks ?? [], date, standardWorkStart, standardWorkEnd, now)}
          onConfirm={(seconds) => addTimeToTask(addTimeTask, seconds)}
          onClose={() => setAddTimeTask(null)}
        />
      )}

      {manualFinishTask && (
        <ManualFinishDialog
          taskName={manualFinishTask.name}
          onClose={() => setManualFinishTaskTarget(null)}
          onConfirm={async (seconds) => {
            await manualFinish(manualFinishTask, seconds);
            setManualFinishTaskTarget(null);
          }}
        />
      )}

      {finishAtTask && (
        <FinishAtDialog
          taskName={finishAtTask.name}
          startedAt={finishAtTask.segments[finishAtTask.segments.length - 1]?.start ?? finishAtTask.startedAt ?? Date.now()}
          onClose={() => setFinishAtTask(null)}
          onConfirm={(endAtMs) => {
            finishTask(finishAtTask, endAtMs);
            setFinishAtTask(null);
          }}
        />
      )}

      {breakChecklistRange && (
        <BreakChecklistDialog range={breakChecklistRange} onClose={() => setBreakChecklistRange(null)} />
      )}

      {breakAssignRange && (
        <BreakAssignDialog
          range={breakAssignRange}
          candidateTasks={candidateTasks}
          onAssignExisting={(task) => assignBreakTimeToTask(task, breakAssignRange)}
          onAssignNew={(category, workName) => assignBreakTimeToNewTask(category, workName, breakAssignRange)}
          onClose={() => setBreakAssignRange(null)}
        />
      )}

      {overrunTask && (
        <OverrunPromptDialog
          task={overrunTask}
          onKeepGoing={async () => {
            const dismissedAt = Date.now();
            overrunDismissedAtRef.current.set(overrunTask.id, dismissedAt);
            await db.dailyTasks.update(overrunTask.id, {
              overrunPromptShown: true,
              overrunPromptDismissedAt: dismissedAt,
            });
            setOverrunTask(null);
          }}
          onFinish={async () => {
            await finishTask(overrunTask);
          }}
        />
      )}

      {pendingConditionStart && (
        <ConditionStartDialog
          onPick={async (level) => {
            const action = pendingConditionStart;
            setPendingConditionStart(null);
            await logCondition(level);
            await action?.();
          }}
          onSkip={async () => {
            const action = pendingConditionStart;
            setPendingConditionStart(null);
            await action?.();
          }}
        />
      )}

      {scheduleConflict && (
        <RunningConflictDialog title="予定の時刻になりました" onResolve={resolveScheduleConflict}>
          予定「{scheduleConflict.task.category} / {scheduleConflict.task.name}」の時刻になりましたが、
          現在「{scheduleConflict.runningTasks.map((t) => t.name).join("、")}」を計測中です。
          一時停止してこちらを開始しますか?
        </RunningConflictDialog>
      )}

      {geoArrivalConflict && (
        <RunningConflictDialog title="位置情報: 到着を検知しました" onResolve={resolveGeoArrivalConflict}>
          「{geoArrivalConflict.place.label}」（{geoArrivalConflict.place.category} / {geoArrivalConflict.place.name}）
          への到着を検知しましたが、現在「{geoArrivalConflict.runningTasks.map((t) => t.name).join("、")}」を計測中です。
          一時停止してこちらを開始しますか?
        </RunningConflictDialog>
      )}

      {activeConfirm && (
        <LinkedCompletionDialog
          confirm={activeConfirm}
          projectMap={projectMap}
          todoTaskMap={todoTaskMap}
          onCompleteTodo={completeLinkedTodo}
          onDone={advanceConfirmQueue}
        />
      )}
    </div>
  );
}
