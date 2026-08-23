"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { aggregateRecords } from "@/lib/aggregate";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask, recomputeEstimateFromRecords } from "@/lib/master";
import {
  adjustStopTimeForBreaks,
  breakRangeKey,
  computeEffectiveElapsedMs,
  findBreakRangeAt,
  isWithinBreak,
  parseBreakRanges,
  timeToMsOfDay,
} from "@/lib/breaks";
import { useDraftSetting, useSetting } from "@/lib/settings";
import {
  cardOverrunClass,
  cardRunningClass,
  emphasisTextClass,
  getRiskTier,
  hazardBarClass,
  overrunLabel,
  riskBadgeClasses,
  riskBadgeLabel,
  runningLabel,
  useVisualMode,
} from "@/lib/theme";
import {
  baseAccumulatedMs,
  computePredictedSecondsByTaskId,
  computeRemainingEstimatedSeconds,
  computeRunningOverrunTaskIds,
  importScheduleRows,
  mergeRecordSegments,
  segmentsAccumulatedMs,
} from "@/lib/tasks";
import { parseScheduleCsv, scheduleCsvTemplate } from "@/lib/scheduleCsv";
import { downloadTextFile } from "@/lib/report";
import { computeStreakDays } from "@/lib/streak";
import { computeAfterHoursBreakdown } from "@/lib/overtime";
import { getPeriodRange, isDateStrInRange } from "@/lib/period";
import { computeSuggestedTask } from "@/lib/suggest";
import { CONDITION_LEVELS, dominantConditionLevel, computeProductivityByCondition } from "@/lib/condition";
import { completeTodoTask } from "@/lib/todo";
import { computeWeekdayAverages } from "@/lib/weekday";
import { computeUntrackedGapSeconds } from "@/lib/gap";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  refreshWeatherAndFindAlerts,
  computeProductivityByWeather,
  type CurrentWeatherReading,
  type WeatherAlert,
} from "@/lib/weather";
import { fireConfetti } from "@/lib/confetti";
import { fireCompletionPopup } from "@/lib/completionPopup";
import { computeGrowthStage } from "@/lib/growth";
import { createSpeechRecognition, parseVoiceCommand } from "@/lib/voice";
import { isStageDone } from "@/lib/projectStage";
import { computeAutoAllocation, type AutoAllocationResult } from "@/lib/allocate";
import { formatClock, formatDateJp, formatHms, formatMsClock, jsWeekdayToApp, parseHourStr, todayStr } from "@/lib/time";
import {
  getNotificationPermission,
  notify,
  requestNotificationPermission,
} from "@/lib/notifications";
import type { BreakRange, DailyTask, GeoPlace, MasterTask, ProjectItem, TimeSegment, Weekday, WorkRecord } from "@/lib/types";
import { WEEKDAY_LABELS } from "@/lib/types";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";
import RadialTimer from "@/components/ui/RadialTimer";
import ConditionGlyph from "@/components/ui/ConditionGlyph";
import AddTaskDialog from "@/components/sections/AddTaskDialog";
import AddTimeDialog from "@/components/sections/AddTimeDialog";
import EditTaskDialog from "@/components/sections/EditTaskDialog";
import CompletedTasksGantt from "@/components/sections/CompletedTasksGantt";
import DeleteCompletedTaskDialog from "@/components/sections/DeleteCompletedTaskDialog";
import ManualFinishDialog from "@/components/sections/ManualFinishDialog";
import ProvisionalTaskCard from "@/components/sections/ProvisionalTaskCard";
import TodayStatusPanel from "@/components/sections/TodayStatusPanel";
import DailyChallengePanel from "@/components/DailyChallengePanel";
import BreakChecklistDialog from "@/components/sections/BreakChecklistDialog";
import BreakAssignDialog from "@/components/sections/BreakAssignDialog";

const OVERRUN_REPROMPT_MS = 20 * 60 * 1000;
const RANK_MEDALS = ["🥇", "🥈", "🥉"];

// 天気変化通知の「次に閾値を超える時刻」表示用。予報は当日〜翌日早朝まで含むため、
// 日付が今日と異なる場合(=翌日の予報)は時刻だけでなく日付も明示し、日をまたいだ
// 見込みを取り違えないようにする
function formatCrossingDateTime(atIso: string): string {
  const d = new Date(atIso);
  const dateLabel = todayStr(d) !== todayStr() ? `${formatDateJp(todayStr(d))} ` : "";
  return `${dateLabel}${formatClock(d.getTime())}`;
}

export default function TodaySection({
  onOpenTodoDetail,
  onOpenProjectEdit,
}: {
  onOpenTodoDetail: (taskId: string) => void;
  onOpenProjectEdit: (projectId: string) => void;
}) {
  const date = todayStr();
  // 構造化されたタスクとは別の、自由記述の日次ジャーナル。日付ごとに保存する
  const [dailyJournal, setDailyJournal] = useDraftSetting(`journal.daily.${date}`, "");
  const [now, setNow] = useState(() => Date.now());
  const [weekday, setWeekday] = useState<Weekday>(() => jsWeekdayToApp(new Date()) ?? 1);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [scheduleImportErrors, setScheduleImportErrors] = useState<string[]>([]);
  const [scheduleImportResult, setScheduleImportResult] = useState("");
  const scheduleFileInputRef = useRef<HTMLInputElement>(null);
  const [notifPermission, setNotifPermission] = useState<string>("default");
  const [overrunTask, setOverrunTask] = useState<DailyTask | null>(null);
  const [stageConfirmTask, setStageConfirmTask] = useState<DailyTask | null>(null);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);
  const [deletingCompletedTask, setDeletingCompletedTask] = useState<DailyTask | null>(null);
  // 兼務・並行作業向けに、主案件(projectId)以外の追加の案件タグを付ける小さなモーダルの対象タスク
  const [secondaryProjectsTask, setSecondaryProjectsTask] = useState<DailyTask | null>(null);
  const [manualFinishTask, setManualFinishTaskTarget] = useState<DailyTask | null>(null);
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
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceUnsupported, setVoiceUnsupported] = useState(false);
  const voiceRecognitionRef = useRef<ReturnType<typeof createSpeechRecognition>>(null);
  const [pendingQuickSlot, setPendingQuickSlot] = useState<number | null>(null);
  const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);
  const [quickStartEnabledStr] = useSetting("today.quickStartEnabled", "true");
  const quickStartEnabled = quickStartEnabledStr === "true";
  const [standardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [standardWorkEnd] = useSetting("today.standardWorkEnd", "17:00");
  // 自動配分: 残業務時間内に未完了作業(予測)を収めるための目標ペースを自動計算する機能。
  // 「オフ」「ライブ（常に再計算）」「手動（ボタンを押した時だけ計算）」を切り替えられる
  const [autoAllocateMode, setAutoAllocateMode] = useSetting("today.autoAllocateMode", "off");
  const [autoAllocateCollapsedStr, setAutoAllocateCollapsedStr] = useSetting("today.collapseAutoAllocate", "false");
  const [showStatusPanelStr] = useSetting("today.showStatusPanel", "true");
  const showStatusPanel = showStatusPanelStr === "true";
  const [showAutoAllocateStr] = useSetting("today.showAutoAllocate", "true");
  const showAutoAllocate = showAutoAllocateStr === "true";
  const [showSuggestedTaskStr] = useSetting("today.showSuggestedTask", "true");
  const showSuggestedTask = showSuggestedTaskStr === "true";
  const autoAllocateCollapsed = autoAllocateCollapsedStr === "true";
  const [favoritesCollapsedStr, setFavoritesCollapsedStr] = useSetting("today.collapseFavorites", "false");
  const favoritesCollapsed = favoritesCollapsedStr === "true";
  const { lobotomyMode, va11hallaMode, themedMode, wordingThemedMode } = useVisualMode();
  const [manualAllocation, setManualAllocation] = useState<AutoAllocationResult | null>(null);
  const [manualAllocationAt, setManualAllocationAt] = useState<number | null>(null);
  const [pendingStart, setPendingStart] = useState<
    { category: string; name: string; estimatedSeconds: number; masterTaskId: string | undefined } | null
  >(null);
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
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoMovementTick, setGeoMovementTick] = useState(0);
  // GPSでの移動検知に使う各種状態。位置情報コールバックは頻繁に発火するため、
  // 再レンダーを避けてrefで保持し、しきい値超過を検知した時だけstateを更新してタスク生成をトリガーする
  const geoWatchIdRef = useRef<number | null>(null);
  const geoAnchorRef = useRef<{ lat: number; lon: number } | null>(null);
  const geoLastMovedAtRef = useRef<number>(Date.now());
  const geoTaskIdRef = useRef<string | null>(null);
  const geoFinishInFlightRef = useRef(false);
  // 位置情報: 登録地点への到着検知(自動開始)。移動検知(仮計測)とは別の独立した機能
  const [geoArrivalEnabledStr] = useSetting("today.geoArrivalEnabled", "false");
  const geoArrivalEnabled = geoArrivalEnabledStr === "true";
  const geoPlaces = useLiveQuery(() => db.geoPlaces.toArray(), []);
  const [geoArrivalError, setGeoArrivalError] = useState<string | null>(null);
  // 登録地点の天気変化通知(降水確率が閾値を超える見込みが近づいたら通知)。
  // アプリを開いている間だけ定期的にチェックする(地点到着検知と同じ制約)
  const [weatherNotifyEnabledStr] = useSetting("weather.notifyEnabled", "false");
  const weatherNotifyEnabled = weatherNotifyEnabledStr === "true";
  const [weatherLeadHoursStr] = useSetting("weather.notifyLeadHours", "3");
  const [weatherThresholdStr] = useSetting("weather.precipThreshold", "50");
  // 天気変化の通知用の登録地点。地点到着検知(geoPlaces)とは別の独立した一覧
  const weatherPlaces = useLiveQuery(() => db.weatherPlaces.toArray(), []);
  // 未着手(pending)の作業カードのドラッグ&ドロップ並べ替え用。計測中・完了は常に上/下に
  // 固定されるため、並べ替え対象は未着手グループのみに限定する
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [weatherAlert, setWeatherAlert] = useState<WeatherAlert | null>(null);
  const [weatherCurrent, setWeatherCurrent] = useState<CurrentWeatherReading[]>([]);
  const [weatherNextCrossings, setWeatherNextCrossings] = useState<WeatherAlert[]>([]);
  const [weatherCheckError, setWeatherCheckError] = useState<string | null>(null);
  const [weatherChecking, setWeatherChecking] = useState(false);
  const [weatherLastCheckedAt, setWeatherLastCheckedAt] = useState<number | null>(null);
  const geoArrivalWatchIdRef = useRef<number | null>(null);
  // 地点ごとに「現在圏内にいるか」を保持し、圏内に入った瞬間だけ自動開始をトリガーする。
  // 退出判定にはヒステリシス(半径の1.5倍)を設け、境界付近でのGPS誤差による連続トリガーを防ぐ
  const geoInsidePlaceIdsRef = useRef<Set<string>>(new Set());
  const [geoArrivalConflict, setGeoArrivalConflict] = useState<{ place: GeoPlace; runningTasks: DailyTask[] } | null>(null);
  // 地点到着で自動開始がONの間だけ、画面消灯で位置監視が止まらないようWake Lockで画面を常時点灯させる。
  // 対応ブラウザでのみ有効(非対応なら何もしない)。バッテリー消費が増えるため、ON時のみ限定で使う
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockError, setWakeLockError] = useState<string | null>(null);
  const [masterEditMode] = useSetting("records.masterEditMode", "relink");
  const [afterHoursCutoff] = useSetting("report.afterHoursCutoff", "18:00");
  const [conditionEnabledStr] = useSetting("condition.enabled", "true");
  const conditionEnabled = conditionEnabledStr === "true";
  const [simpleButtonsStr] = useSetting("today.simpleButtons", "false");
  const simpleButtons = simpleButtonsStr === "true";
  // 実行中/予定/完了でタブ分けして表示するモード。選んだタブは端末に保存し、次回も同じ表示にする
  const [taskViewTabRaw, setTaskViewTab] = useSetting("today.taskViewTab", "running");
  const taskViewTab: "running" | "pending" | "done" =
    taskViewTabRaw === "pending" || taskViewTabRaw === "done" ? taskViewTabRaw : "running";
  const [growthStageEnabledStr] = useSetting("today.growthStageEnabled", "true");
  const growthStageEnabled = growthStageEnabledStr === "true";
  const [weeklyAfterHoursNotifyEnabledStr] = useSetting("notify.afterHoursWeeklyEnabled", "false");
  const weeklyAfterHoursNotifyEnabled = weeklyAfterHoursNotifyEnabledStr === "true";
  const [weeklyAfterHoursThresholdStr] = useSetting("notify.afterHoursWeeklyThresholdHours", "5");
  const [weeklyAfterHoursNotifiedWeek, setWeeklyAfterHoursNotifiedWeek] = useSetting(
    "notify.afterHoursWeeklyNotifiedWeek",
    ""
  );
  const [dailySummaryEnabledStr] = useSetting("notify.dailySummaryEnabled", "false");
  const dailySummaryEnabled = dailySummaryEnabledStr === "true";
  const [dailySummaryTime] = useSetting("notify.dailySummaryTime", "18:00");
  const [dailySummaryNotifiedDate, setDailySummaryNotifiedDate] = useSetting("notify.dailySummaryNotifiedDate", "");
  const [morningDigestEnabledStr] = useSetting("notify.morningDigestEnabled", "false");
  const morningDigestEnabled = morningDigestEnabledStr === "true";
  const [morningDigestTime] = useSetting("notify.morningDigestTime", "08:00");
  const [morningDigestNotifiedDate, setMorningDigestNotifiedDate] = useSetting("notify.morningDigestNotifiedDate", "");
  const [monthlySummaryEnabledStr] = useSetting("notify.monthlySummaryEnabled", "false");
  const monthlySummaryEnabled = monthlySummaryEnabledStr === "true";
  const [monthlySummaryNotifiedMonth, setMonthlySummaryNotifiedMonth] = useSetting(
    "notify.monthlySummaryNotifiedMonth",
    ""
  );
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
  const favorites = useLiveQuery(
    () => db.masterTasks.filter((t) => t.isFavorite && !t.archived).toArray(),
    []
  );
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

  // パターン学習型の声かけ通知。「そろそろこの作業では?」の提案が出た最初のタイミングで、
  // パネル表示に加えて通知も送る(同じ提案は1日1回まで、設定書き込みの非同期反映による
  // 二重通知を防ぐため同期的なrefで先にラッチする)
  const [patternSuggestNotifyEnabledStr] = useSetting("notify.patternSuggestEnabled", "false");
  const patternSuggestNotifyEnabled = patternSuggestNotifyEnabledStr === "true";
  const [patternSuggestNotifiedKey, setPatternSuggestNotifiedKey] = useSetting("notify.patternSuggestNotifiedKey", "");
  const patternSuggestFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!patternSuggestNotifyEnabled || !suggestedTask) return;
    const key = `${date}::${suggestedTask.category}::${suggestedTask.name}`;
    if (patternSuggestNotifiedKey === key) return;
    if (patternSuggestFiredRef.current === key) return;
    patternSuggestFiredRef.current = key;
    notify(
      "💡 そろそろこの作業では?",
      `${suggestedTask.category} / ${suggestedTask.name}（同じ曜日のこの時間帯によく行っています）`,
      `pattern-suggest-${key}`
    );
    setPatternSuggestNotifiedKey(key);
  }, [patternSuggestNotifyEnabled, suggestedTask, date, patternSuggestNotifiedKey, setPatternSuggestNotifiedKey]);

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

  // 今週の「定時以降の業務」合計が週次基準を超えたら通知する（週ごとに1回だけ）
  useEffect(() => {
    if (!weeklyAfterHoursNotifyEnabled || !projectRecords) return;
    const thresholdSeconds = Math.max(0, Number(weeklyAfterHoursThresholdStr) || 0) * 3600;
    if (thresholdSeconds <= 0) return;
    const range = getPeriodRange({ type: "week" });
    if (!range) return;
    const weekKey = range.start.toISOString().slice(0, 10);
    if (weeklyAfterHoursNotifiedWeek === weekKey) return;
    const periodRecords = projectRecords.filter((r) => isDateStrInRange(r.date, range));
    const { totalSeconds } = computeAfterHoursBreakdown(periodRecords, afterHoursCutoff);
    if (totalSeconds >= thresholdSeconds) {
      notify("定時以降の業務が週次基準を超えました", `今週の定時以降の業務が ${formatHms(totalSeconds)} になりました`);
      setWeeklyAfterHoursNotifiedWeek(weekKey);
    }
  }, [
    weeklyAfterHoursNotifyEnabled,
    projectRecords,
    afterHoursCutoff,
    weeklyAfterHoursThresholdStr,
    weeklyAfterHoursNotifiedWeek,
    setWeeklyAfterHoursNotifiedWeek,
  ]);

  // 1日の終わりに、その日の合計作業時間（と体調記録があればその内容）を通知する（1日1回）
  useEffect(() => {
    if (!dailySummaryEnabled || !projectRecords) return;
    if (dailySummaryNotifiedDate === date) return;
    const summaryHour = parseHourStr(dailySummaryTime, 18);
    const nowHourNum = new Date(now).getHours() + new Date(now).getMinutes() / 60;
    if (nowHourNum < summaryHour) return;
    const totalSeconds = projectRecords
      .filter((r) => r.date === date && !r.excludedFromStats)
      .reduce((s, r) => s + r.seconds, 0);
    const conditionPart =
      conditionLogs && conditionLogs.length > 0
        ? `・体調 ${CONDITION_LEVELS.find((c) => c.level === conditionLogs[conditionLogs.length - 1].level)?.emoji ?? ""}`
        : "";
    notify("今日の作業サマリー", `合計 ${formatHms(totalSeconds)}${conditionPart}`, "daily-summary");
    setDailySummaryNotifiedDate(date);
  }, [
    dailySummaryEnabled,
    dailySummaryNotifiedDate,
    dailySummaryTime,
    projectRecords,
    conditionLogs,
    date,
    now,
    setDailySummaryNotifiedDate,
  ]);

  // 月が変わって初めてアプリを開いたタイミングで、先月の合計時間・最多区分を通知する(月1回)。
  // 日次サマリーと同じ「アプリを開いている間に判定する」方式で、特定の時刻は問わない
  const monthlySummaryFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!monthlySummaryEnabled || !projectRecords) return;
    const currentMonth = date.slice(0, 7);
    if (monthlySummaryNotifiedMonth === currentMonth) return;
    // 設定書き込みが非同期(IndexedDB経由)で反映に一拍かかるため、書き込み完了前に
    // このeffectが再実行されて二重通知しないよう、同期的なrefで先にラッチする
    if (monthlySummaryFiredRef.current === currentMonth) return;
    monthlySummaryFiredRef.current = currentMonth;
    const [y, m] = currentMonth.split("-").map(Number);
    const prevMonthDate = new Date(y, m - 2, 1);
    const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
    const prevRecords = projectRecords.filter((r) => r.date.startsWith(prevMonth) && !r.excludedFromStats);
    if (prevRecords.length === 0) {
      setMonthlySummaryNotifiedMonth(currentMonth);
      return;
    }
    const totalSeconds = prevRecords.reduce((s, r) => s + r.seconds, 0);
    const byCategory = new Map<string, number>();
    for (const r of prevRecords) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.seconds);
    let topCategory = "";
    let topCategorySeconds = 0;
    for (const [cat, sec] of byCategory) {
      if (sec > topCategorySeconds) {
        topCategory = cat;
        topCategorySeconds = sec;
      }
    }
    notify(
      `${prevMonth}のサマリー`,
      `合計 ${formatHms(totalSeconds)}${topCategory ? `・最多区分「${topCategory}」${formatHms(topCategorySeconds)}` : ""}`,
      "monthly-summary"
    );
    setMonthlySummaryNotifiedMonth(currentMonth);
  }, [monthlySummaryEnabled, monthlySummaryNotifiedMonth, projectRecords, date, setMonthlySummaryNotifiedMonth]);

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
      const sinceDismiss = task.overrunPromptDismissedAt ? now - task.overrunPromptDismissedAt : Infinity;
      if (
        elapsedMs > predMs + OVERRUN_REPROMPT_MS &&
        (!task.overrunPromptShown || sinceDismiss > OVERRUN_REPROMPT_MS) &&
        !overrunTask
      ) {
        setOverrunTask(task);
      }
    }
  }, [now, tasks, overrunTask, predictedSecondsByTaskId]);

  // 予定インポートで登録した作業(scheduledTime)が指定時刻になったら自動的に差し込み開始する
  useEffect(() => {
    if (!tasks) return;
    for (const task of tasks) {
      if (task.status !== "pending" || !task.scheduledTime || task.autoStartNotified || task.autoStartDisabled) continue;
      const [h, m] = task.scheduledTime.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
      const scheduledMs = new Date(date + "T00:00:00").getTime() + (h * 60 + m) * 60000;
      if (now < scheduledMs) continue;
      autoStartScheduledTask(task);
    }
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

  // 計測中の作業を一番上に、完了済みを一番下に沈める。それ以外（一時停止中/未着手）はもとの順番のまま
  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    const statusRank = (t: DailyTask) => (t.status === "running" ? 0 : t.status === "done" ? 2 : 1);
    return [...tasks].sort((a, b) => {
      const rankDiff = statusRank(a) - statusRank(b);
      return rankDiff || a.order - b.order;
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
  const visibleTasks = useMemo(
    () =>
      nonProvisionalSortedTasks.filter((t) => {
        if (taskViewTab === "running") return t.status === "running" || t.status === "paused";
        if (taskViewTab === "pending") return t.status === "pending";
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

  // 朝、指定した時刻になったら、本日の予定件数とToDo・案件の期限状況をまとめて通知する(1日1回)。
  // 「1日の終わりの自動サマリー通知」と同じ「アプリを開いている間に、時刻を過ぎたタイミングで
  // 判定する」方式。外部のカレンダー連携ルーティン等に頼らず、アプリ単体で確実に動くようにする。
  // 設定の書き込み(IndexedDB経由)は非同期で反映に一拍かかるため、書き込み完了前にtasks等の
  // 別の変化でこのeffectが再実行されて二重通知しないよう、月次ダイジェストと同様に同期的な
  // refで先にラッチしておく
  const morningDigestFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!morningDigestEnabled) return;
    if (morningDigestNotifiedDate === date) return;
    if (morningDigestFiredRef.current === date) return;
    const digestHour = parseHourStr(morningDigestTime, 8);
    const nowHourNum = new Date(now).getHours() + new Date(now).getMinutes() / 60;
    if (nowHourNum < digestHour) return;
    morningDigestFiredRef.current = date;
    const parts = [`本日の予定 ${taskCountsByTab.pending}件`];
    if (pendingDueSummary.todoOverdue > 0 || pendingDueSummary.todoDueToday > 0) {
      parts.push(`ToDo 期限切れ${pendingDueSummary.todoOverdue}件・本日期限${pendingDueSummary.todoDueToday}件`);
    }
    if (pendingDueSummary.projectOverdue > 0 || pendingDueSummary.projectDueToday > 0) {
      parts.push(`案件 期限切れ${pendingDueSummary.projectOverdue}件・本日期限${pendingDueSummary.projectDueToday}件`);
    }
    notify("おはようございます", parts.join(" / "), "morning-digest");
    setMorningDigestNotifiedDate(date);
  }, [
    morningDigestEnabled,
    morningDigestNotifiedDate,
    morningDigestTime,
    taskCountsByTab,
    pendingDueSummary,
    date,
    now,
    setMorningDigestNotifiedDate,
  ]);

  // 直近の「停止」時刻（完了した作業の終了時刻、または一時停止中の作業が
  // 一時停止した時刻のうち、リスト上で一番最後(orderが最大)の作業のもの）。
  // さかのぼって開始/再開する際の起点にする。本日まだ一度も停止していなければ、
  // ページを開いた時刻を仮の起点として扱う（そうしないと、初回の作業を始める前は
  // 未計測の自動開始が永遠に判定できないため）。
  // ※ 単純に全作業中で一番遅い時刻(Math.max)を使うと、完了タブのガントチャート等で
  // 過去の作業の終了時刻を手動で伸ばした場合に、その作業がリスト上は最後でなくても
  // 数値上は一番大きくなり、逆に本当に最後にやった作業を編集した結果がここに
  // 反映されない(別の未編集の作業の時刻が優先され続ける)という分かりづらい挙動になる。
  // 「一番最後にやった作業(orderが最大)」を基準にすることで、直感的な動作にする
  const lastStopTime = useMemo(() => {
    if (!tasks) return null;
    const stopCandidates = tasks.filter(
      (t) =>
        (t.status === "done" && t.endedAt !== undefined) ||
        (t.status === "paused" && t.segments[t.segments.length - 1]?.end !== undefined)
    );
    if (stopCandidates.length === 0) return sessionAnchorRef.current;
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
    if (tasks.some((t) => t.isProvisional)) return;
    if (tasks.some((t) => t.status === "running")) return;
    if (lastStopTime === null || effectiveLastStopTime === null) return;
    if (isWithinBreak(now, date, breakRanges)) return;
    const realElapsedMs = computeEffectiveElapsedMs(lastStopTime, now, date, breakRanges);
    if (realElapsedMs < thresholdMinutes * 60000) return;
    const gapStart = effectiveLastStopTime;
    (async () => {
      const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
      const task: DailyTask = {
        id: uid(),
        date,
        order: count,
        category: "未分類",
        name: "仮計測中",
        estimatedSeconds: 0,
        status: "running",
        segments: [{ start: gapStart }],
        accumulatedMs: 0,
        startedAt: gapStart,
        isSpontaneous: true,
        isProvisional: true,
      };
      await db.dailyTasks.add(task);
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
    const idleMs = now - lastActivityRef.current;
    if (idleMs < provisionalIdleMs) return;
    if (idleFinishInFlightRef.current) return;
    idleFinishInFlightRef.current = true;
    const cutoff = Math.max(lastActivityRef.current, provisionalTask.segments[0]?.start ?? lastActivityRef.current);
    const segments = provisionalTask.segments.map((s, i) =>
      i === provisionalTask.segments.length - 1 && s.end === undefined ? { ...s, end: Math.max(cutoff, s.start) } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? cutoff) - s.start), 0);
    commitFinish(provisionalTask, segments, accumulatedMs).then(() => {
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

  // 位置情報の監視。しきい値以上動いたことを検知したら geoMovementTick を進めて、
  // 別のuseEffectに「移動を検知した」ことだけを伝える。タブが開いている間のみ動作し、
  // バックグラウンド/アプリを閉じている間は動作しない(ブラウザの位置情報APIの制約による)
  useEffect(() => {
    if (!geoTrackingEnabled) {
      if (geoWatchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
      geoWatchIdRef.current = null;
      geoAnchorRef.current = null;
      geoTaskIdRef.current = null;
      setGeoError(null);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("この端末・ブラウザは位置情報の取得に対応していません");
      return;
    }
    geoAnchorRef.current = null;
    geoLastMovedAtRef.current = Date.now();
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError(null);
        const { latitude, longitude } = pos.coords;
        if (!geoAnchorRef.current) {
          geoAnchorRef.current = { lat: latitude, lon: longitude };
          return;
        }
        const dist = haversineDistanceMeters(geoAnchorRef.current.lat, geoAnchorRef.current.lon, latitude, longitude);
        if (dist >= geoDistanceThresholdMeters) {
          geoAnchorRef.current = { lat: latitude, lon: longitude };
          geoLastMovedAtRef.current = Date.now();
          setGeoMovementTick((n) => n + 1);
        }
      },
      () => setGeoError("位置情報を取得できませんでした（権限をご確認ください）"),
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
    );
    geoWatchIdRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      geoWatchIdRef.current = null;
    };
  }, [geoTrackingEnabled, geoDistanceThresholdMeters]);

  // 位置情報: 登録地点への到着検知。GPSコールバックは頻繁に発火するため、ここでは
  // 圏内に入ったことだけを検知してstateに記録し、実際の自動開始処理は別のuseEffectに委ねる
  // (tasksなど最新のstateを使って判定する必要があるため、コールバック内で直接処理しない)
  const [arrivedPlaceEvent, setArrivedPlaceEvent] = useState<{ placeId: string; at: number } | null>(null);
  useEffect(() => {
    if (!geoArrivalEnabled || !geoPlaces || geoPlaces.length === 0) {
      if (geoArrivalWatchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.clearWatch(geoArrivalWatchIdRef.current);
      }
      geoArrivalWatchIdRef.current = null;
      geoInsidePlaceIdsRef.current = new Set();
      setGeoArrivalError(null);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoArrivalError("この端末・ブラウザは位置情報の取得に対応していません");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoArrivalError(null);
        const { latitude, longitude } = pos.coords;
        for (const place of geoPlaces) {
          const dist = haversineDistanceMeters(place.lat, place.lon, latitude, longitude);
          const wasInside = geoInsidePlaceIdsRef.current.has(place.id);
          if (dist <= place.radiusMeters) {
            if (!wasInside) {
              geoInsidePlaceIdsRef.current.add(place.id);
              setArrivedPlaceEvent({ placeId: place.id, at: Date.now() });
            }
          } else if (dist > place.radiusMeters * 1.5) {
            // 退出判定には半径の1.5倍のヒステリシスを設け、境界付近のGPS誤差による連続トリガーを防ぐ
            geoInsidePlaceIdsRef.current.delete(place.id);
          }
        }
      },
      () => setGeoArrivalError("位置情報を取得できませんでした（権限をご確認ください）"),
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
    );
    geoArrivalWatchIdRef.current = watchId;
    return () => {
      navigator.geolocation.clearWatch(watchId);
      geoArrivalWatchIdRef.current = null;
    };
  }, [geoArrivalEnabled, geoPlaces]);

  // 到着イベント(arrivedPlaceEvent)を受けて、実際に作業を自動開始する。
  // ここは通常のレンダーサイクルで動くため、tasks等の最新stateを安全に参照できる
  useEffect(() => {
    if (!geoArrivalEnabled || !arrivedPlaceEvent || !geoPlaces) return;
    const place = geoPlaces.find((p) => p.id === arrivedPlaceEvent.placeId);
    if (!place) return;
    handleGeoArrival(place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedPlaceEvent]);

  // 地点到着で自動開始がONの間、Wake Lockで画面消灯を防ぐ。Wake Lockはタブが非表示になると
  // ブラウザ側で自動解除されるため、再度表示された時にvisibilitychangeで再取得する
  useEffect(() => {
    if (!geoArrivalEnabled) {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
      setWakeLockError(null);
      return;
    }
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setWakeLockError("この端末・ブラウザは画面常時点灯(Wake Lock)に対応していません");
      return;
    }
    let cancelled = false;
    async function acquire() {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        wakeLockRef.current = sentinel;
        setWakeLockActive(true);
        setWakeLockError(null);
        sentinel.addEventListener("release", () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
            setWakeLockActive(false);
          }
        });
      } catch {
        if (!cancelled) setWakeLockError("画面常時点灯を有効にできませんでした");
      }
    }
    acquire();
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !wakeLockRef.current) {
        acquire();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
    };
  }, [geoArrivalEnabled]);

  // 登録地点の天気変化通知。アプリを開いている間だけ、定期的に降水確率予報を取得・保存し、
  // 閾値を超える見込みの時刻が指定時間以内に近づいていれば通知する(地点到着検知と同じく
  // ブラウザ/PWAの仕様上フォアグラウンドでのみ動作し、閉じている間は情報が更新されない)。
  // force=trueなら「今すぐ取得」ボタンからの呼び出しで、30分キャッシュを無視して必ず再取得する
  const checkWeather = useCallback(
    async (force: boolean) => {
      if (!weatherPlaces || weatherPlaces.length === 0) return;
      const leadHours = Math.max(0.5, Number(weatherLeadHoursStr) || 3);
      const thresholdPct = Math.min(100, Math.max(0, Number(weatherThresholdStr) || 50));
      setWeatherChecking(true);
      try {
        const { alerts, current, nextCrossings } = await refreshWeatherAndFindAlerts(weatherPlaces, {
          leadHours,
          thresholdPct,
          nowMs: Date.now(),
          todayDateStr: todayStr(),
          force,
        });
        setWeatherCheckError(null);
        setWeatherLastCheckedAt(Date.now());
        setWeatherCurrent(current);
        setWeatherNextCrossings(nextCrossings);
        for (const alert of alerts) {
          const hourLabel = formatClock(new Date(alert.atIso).getTime());
          notify(
            "☔ 天気の変化が近づいています",
            `${alert.placeLabel}: ${hourLabel}頃に降水確率${alert.precipProbability}%の見込みです`,
            `weather-${alert.placeId}-${alert.atIso}`
          );
        }
        if (alerts.length > 0) setWeatherAlert(alerts[0]);
      } catch {
        setWeatherCheckError("天気予報を取得できませんでした");
      } finally {
        setWeatherChecking(false);
      }
    },
    [weatherPlaces, weatherLeadHoursStr, weatherThresholdStr]
  );

  useEffect(() => {
    if (!weatherNotifyEnabled || !weatherPlaces || weatherPlaces.length === 0) {
      setWeatherCheckError(null);
      return;
    }
    checkWeather(false);
    // 内部で30分キャッシュされるためAPI呼び出し自体はもっと少ない頻度になる
    const id = setInterval(() => checkWeather(false), 15 * 60000);
    return () => clearInterval(id);
  }, [weatherNotifyEnabled, weatherPlaces, checkWeather]);

  // 移動を検知した(geoMovementTickが進んだ)ら、他に計測中/仮計測中の作業がなければ
  // 「移動」の仮計測タスクを自動的に開始する。仕組みは未計測の自動計測と同じ仮計測枠を使う
  useEffect(() => {
    if (!geoTrackingEnabled) return;
    if (geoMovementTick === 0) return;
    if (!tasks) return;
    if (tasks.some((t) => t.isProvisional)) return;
    if (tasks.some((t) => t.status === "running")) return;
    (async () => {
      const count = (await db.dailyTasks.where("date").equals(date).toArray()).length;
      const startAt = Date.now();
      const task: DailyTask = {
        id: uid(),
        date,
        order: count,
        category: geoCategorySetting || "移動",
        name: geoTaskNameSetting || "移動",
        estimatedSeconds: 0,
        status: "running",
        segments: [{ start: startAt }],
        accumulatedMs: 0,
        startedAt: startAt,
        isSpontaneous: true,
        isProvisional: true,
      };
      await db.dailyTasks.add(task);
      geoTaskIdRef.current = task.id;
      notify("移動を検知しました", `${task.category} / ${task.name} の自動計測を開始しました`, "geo-tracking-start");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoMovementTick]);

  // 移動検知で始めた仮計測は、一定時間位置情報の変化がなくなったら
  // (＝止まったら)最後に動いていた時刻で自動的に打ち切る
  useEffect(() => {
    if (!geoTrackingEnabled) return;
    if (!provisionalTask || provisionalTask.status !== "running") return;
    if (geoTaskIdRef.current !== provisionalTask.id) return;
    const stillMs = now - geoLastMovedAtRef.current;
    if (stillMs < geoStillMs) return;
    if (geoFinishInFlightRef.current) return;
    geoFinishInFlightRef.current = true;
    const cutoff = Math.max(geoLastMovedAtRef.current, provisionalTask.segments[0]?.start ?? geoLastMovedAtRef.current);
    const segments = provisionalTask.segments.map((s, i) =>
      i === provisionalTask.segments.length - 1 && s.end === undefined ? { ...s, end: Math.max(cutoff, s.start) } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? cutoff) - s.start), 0);
    commitFinish(provisionalTask, segments, accumulatedMs).then(() => {
      geoFinishInFlightRef.current = false;
      geoTaskIdRef.current = null;
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
        setQuickActionMessage(`🎤「${transcript}」→ 対象の計測中の作業が見つかりませんでした`);
        return;
      }
      await finishTask(running);
      setQuickActionMessage(`🎤「${transcript}」→ 🛑「${running.category} / ${running.name}」を終了しました`);
      return;
    }

    if (command.action === "pause") {
      const running = (tasks ?? []).find((t) => t.status === "running" && !t.isProvisional);
      if (!running) {
        setQuickActionMessage(`🎤「${transcript}」→ 計測中の作業が見つかりませんでした`);
        return;
      }
      await pauseTask(running);
      setQuickActionMessage(`🎤「${transcript}」→ ‖「${running.category} / ${running.name}」を一時停止しました`);
      return;
    }

    const target = command.target?.trim();
    if (!target) return;
    const master = (allMasterTasks ?? []).find((m) => m.name.includes(target) || target.includes(m.name));
    if (master) {
      const estimatedSeconds = await computeRemainingEstimatedSeconds(date, master.category, master.name, master.estimatedSeconds);
      requestStartNew(master.category, master.name, estimatedSeconds, master.id);
      setQuickActionMessage(`🎤「${transcript}」→ ▶「${master.category} / ${master.name}」を開始しました`);
      return;
    }
    requestStartNew("音声", target, 0, undefined);
    setQuickActionMessage(`🎤「${transcript}」→ ▶「音声 / ${target}」を新規作業として開始しました`);
  }

  function startVoiceListening() {
    if (voiceListening) return;
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setVoiceUnsupported(true);
      setQuickActionMessage("この端末・ブラウザは音声入力に対応していません");
      return;
    }
    voiceRecognitionRef.current = recognition;
    recognition.onresult = (e) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) handleVoiceResult(transcript);
    };
    recognition.onerror = () => {
      setQuickActionMessage("音声を認識できませんでした。もう一度お試しください");
    };
    recognition.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    recognition.start();
  }

  function stopVoiceListening() {
    voiceRecognitionRef.current?.stop();
    setVoiceListening(false);
  }

  async function generateFromTemplate() {
    const items = await db.templateItems.where("weekday").equals(weekday).sortBy("order");
    if (items.length === 0) {
      alert(`${WEEKDAY_LABELS[weekday]}曜日のテンプレートが空です。先に「曜日別テンプレート」で登録してください。`);
      return;
    }
    const existing = await db.dailyTasks.where("date").equals(date).toArray();
    if (existing.length > 0) {
      if (!confirm("本日の作業リストは既にあります。テンプレートから再生成すると、進行中の記録は失われます。よろしいですか?")) {
        return;
      }
      await db.dailyTasks.bulkDelete(existing.map((e) => e.id));
    }
    const newTasks: DailyTask[] = items.map((item, idx) => ({
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
    startedAtOverride?: number,
    endedAtOverride?: number
  ) {
    const renamed = category !== task.category || name !== task.name;

    if (task.status !== "done") {
      await db.dailyTasks.update(task.id, {
        category,
        name,
        note,
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

    const taskUpdates: Partial<DailyTask> = { category, name, note };
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

    const oldMasterId = task.masterTaskId;
    const existingOld = oldMasterId
      ? await db.records
          .where("date")
          .equals(task.date)
          .filter((r) => r.masterTaskId === oldMasterId && r.projectId === task.projectId)
          .first()
      : undefined;

    // 開始/終了時刻の直接編集や実績時間の手動変更は、合算元の他インスタンス分まで
    // 正確な区間を再構成できないため、既存のsegmentsは破棄して(定時以降の判定は
    // startedAt〜endedAtによる従来通りの近似に戻す)、ズレたまま残さないようにする
    const clearSegments = delta !== 0 || segmentsChanged;

    if (!renamed) {
      if (existingOld) {
        await db.records.update(existingOld.id, {
          ...(delta !== 0 ? { seconds: Math.max(0, existingOld.seconds + delta) } : {}),
          note,
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
    const existingNew = await db.records
      .where("date")
      .equals(task.date)
      .filter((r) => r.masterTaskId === newMaster.id && r.projectId === task.projectId && r.stageId === task.stageId)
      .first();
    if (existingNew) {
      await db.records.update(existingNew.id, {
        seconds: existingNew.seconds + newSeconds,
        endedAt: newEndedAt,
        note,
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
        isTrouble: task.isTrouble,
        note,
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

    const existing = task.masterTaskId
      ? await db.records
          .where("date")
          .equals(task.date)
          .filter((r) => r.masterTaskId === task.masterTaskId && r.projectId === task.projectId && r.stageId === task.stageId)
          .first()
      : undefined;

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
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Date.now() } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs });
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
  async function commitFinish(
    task: DailyTask,
    segments: TimeSegment[],
    accumulatedMs: number,
    startedAtOverride?: number
  ) {
    const seconds = Math.round(accumulatedMs / 1000);
    const nowMs = Date.now();
    const startedAt = startedAtOverride ?? task.startedAt ?? nowMs;
    await db.dailyTasks.update(task.id, {
      segments,
      status: "done",
      accumulatedMs,
      // 手動加算分は既にaccumulatedMsへ織り込み済みのため、完了時にクリアしておく
      // （残したままだとbaseAccumulatedMs/segmentsAccumulatedMsで二重に加算されてしまう）
      manualAdjustmentMs: 0,
      startedAt,
      endedAt: nowMs,
      isProvisional: false,
    });

    // 仮計測(まだ何の作業か確定していない未計測時間)は「完了した作業」として
    // 可視化する対象ではないため、ポップアップは出さない(lib/tasks.tsのfinishDailyTaskと同じ判断)
    if (!task.isProvisional) {
      fireCompletionPopup({ category: task.category, name: task.name, seconds, estimatedSeconds: task.estimatedSeconds });
    }

    let masterTaskId = task.masterTaskId;
    if (!masterTaskId) {
      const master = await findOrCreateMasterTask(task.category, task.name, task.estimatedSeconds);
      masterTaskId = master.id;
    }

    const existing = await db.records
      .where("date")
      .equals(date)
      .filter((r) => r.masterTaskId === masterTaskId && r.projectId === task.projectId && r.stageId === task.stageId)
      .first();

    if (existing) {
      await db.records.update(existing.id, {
        seconds: existing.seconds + seconds,
        endedAt: nowMs,
        isTrouble: existing.isTrouble || task.isTrouble,
        ...(task.secondaryProjectIds ? { secondaryProjectIds: task.secondaryProjectIds } : {}),
        segments: mergeRecordSegments(existing, segments),
      });
    } else {
      await db.records.add({
        id: uid(),
        date,
        category: task.category,
        name: task.name,
        masterTaskId,
        seconds,
        startedAt,
        endedAt: nowMs,
        excludedFromStats: false,
        projectId: task.projectId,
        stageId: task.stageId,
        isTrouble: task.isTrouble,
        secondaryProjectIds: task.secondaryProjectIds,
        segments,
      });
    }

    await recomputeEstimateFromRecords(masterTaskId);
    if (overrunTask?.id === task.id) setOverrunTask(null);
  }

  // 案件の段階から追加された作業を完了させた場合、その段階自体も完了とみなせるか確認する
  // （まだ続く場合は確認せず、作業時間の記録だけ残す）
  function maybePromptStageConfirm(task: DailyTask) {
    if (!task.stageId || !task.projectId) return;
    const project = projectMap.get(task.projectId);
    const stage = project?.stages?.find((s) => s.id === task.stageId);
    if (stage && !isStageDone(stage)) setStageConfirmTask(task);
  }

  async function finishTask(task: DailyTask) {
    let segments = task.segments;
    if (task.status === "running") {
      segments = task.segments.map((s, i) =>
        i === task.segments.length - 1 && s.end === undefined ? { ...s, end: Date.now() } : s
      );
    }
    const segmentsMs = segments.reduce((sum, s) => sum + ((s.end ?? Date.now()) - s.start), 0);
    const accumulatedMs = segmentsMs + (task.manualAdjustmentMs ?? 0);
    await commitFinish(task, segments, accumulatedMs);
    maybePromptStageConfirm(task);
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
    // 対象作業を再開してから仮計測タスクを消すまでの間、両方が「計測中」に
    // 見える瞬間ができないよう、ひとつのトランザクションでまとめて処理する
    await db.transaction("rw", db.dailyTasks, async () => {
      await startTask(target, startAt);
      await db.dailyTasks.delete(provisionalId);
    });
  }

  // 仮計測タスクを、新しい作業（マスタ選択 or 自由入力）として確定する。
  // 計測はそのまま継続する
  async function resolveProvisionalAsNew(
    category: string,
    name: string,
    estimatedSeconds: number,
    masterTaskId: string | undefined,
    hasPlan: boolean
  ) {
    if (!provisionalTask) return;
    await db.dailyTasks.update(provisionalTask.id, {
      category,
      name,
      estimatedSeconds: hasPlan ? estimatedSeconds : 0,
      hasPlan,
      masterTaskId,
      isProvisional: false,
    });
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
    await commitFinish(task, segments, manualSeconds * 1000, startedAt);
    maybePromptStageConfirm(task);
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

  async function importScheduleCsv(file: File) {
    const text = await file.text();
    const { rows, errors } = parseScheduleCsv(text);
    setScheduleImportErrors(errors);
    if (rows.length === 0) {
      setScheduleImportResult("");
      if (errors.length === 0) {
        alert("取り込める予定がありませんでした（このCSVにはヘッダーのみで、予定のデータ行がありません）。");
      }
      return;
    }
    const { created } = await importScheduleRows(rows);
    setScheduleImportResult(`${created}件の予定を取り込みました。`);
  }

  async function enableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
  }

  const streakDays = useMemo(() => computeStreakDays(projectRecords ?? [], date), [projectRecords, date]);

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
    const isRainyNow = (weatherCurrent ?? []).some((c) => c.precipProbability >= 50);
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
  }, [latestConditionLevel, conditionProductivity, weatherCurrent, weatherProductivityForEstimate]);

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
                      : wordingThemedMode === "powerpro"
                        ? `⚾ 延長戦のお知らせ ⚾ 予測時間を超過している試合が${runningOverrunTasks.length}件${
                            tierName ? `（最大査定: ${tierName}）` : ""
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
      {weatherAlert && (
        <div className="panel flex items-center justify-between gap-2 border border-alert/40 p-4">
          <p className="text-sm font-bold text-cream">
            ☔ {weatherAlert.placeLabel}で{formatCrossingDateTime(weatherAlert.atIso)}頃、降水確率
            {weatherAlert.precipProbability}%の見込みです（{Math.round(weatherAlert.hoursUntil * 10) / 10}時間後）
          </p>
          <button className="text-xs text-cream/50" onClick={() => setWeatherAlert(null)}>
            閉じる
          </button>
        </div>
      )}
      {showStatusPanel && (
        <TodayStatusPanel
          tasks={tasks ?? []}
          conditionLogs={conditionLogs ?? []}
          now={now}
          standardWorkStart={standardWorkStart}
          standardWorkEnd={standardWorkEnd}
        />
      )}
      <DailyChallengePanel />
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
        <div className="panel p-4">
          <button
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setAutoAllocateCollapsedStr(autoAllocateCollapsed ? "false" : "true")}
          >
            <h3 className="font-display text-sm font-bold text-cream/80">
              自動配分
              {autoAllocateCollapsed && autoAllocateMode !== "off" && (
                <span className="ml-1 font-normal text-cream/40">（{autoAllocateMode === "live" ? "ライブ" : "手動"}）</span>
              )}
            </h3>
            <span className="text-xs text-cream/40">{autoAllocateCollapsed ? "▶" : "▼"}</span>
          </button>
          {!autoAllocateCollapsed && (
            <>
              <div className="mb-2 mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-normal text-cream/40">
                  {standardWorkEnd}までの残り時間に、未完了作業の予測を収めるための目標ペース
                </span>
                <div className="flex items-center gap-1">
                  {(["off", "live", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setAutoAllocateMode(m)}
                      className={autoAllocateMode === m ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                    >
                      {m === "off" ? "オフ" : m === "live" ? "ライブ" : "手動"}
                    </button>
                  ))}
                  {autoAllocateMode === "manual" && (
                    <button className="btn-pill-outline text-xs" onClick={runManualAllocation}>
                      配分を計算
                    </button>
                  )}
                </div>
              </div>
              {autoAllocateMode === "manual" && !manualAllocation && (
                <p className="text-xs text-cream/50">「配分を計算」を押すと、その時点の残業務時間から配分を計算します。</p>
              )}
              {effectiveAllocation && (
                <div className="text-xs text-cream/60">
                  {autoAllocateMode === "manual" && manualAllocationAt && (
                    <div className="mb-1 text-cream/40">{formatClock(manualAllocationAt)} 時点で計算</div>
                  )}
                  <div>
                    {standardWorkEnd}までの残り {formatMsClock(effectiveAllocation.remainingWorkMs)} / 未完了作業の予測合計{" "}
                    {formatMsClock(effectiveAllocation.totalRemainingPredictedMs)}
                  </div>
                  <div className={effectiveAllocation.scale < 1 ? "text-alert" : "text-cream/60"}>
                    {effectiveAllocation.scale < 1
                      ? `ペース ${Math.round(effectiveAllocation.scale * 100)}%（業務時間に収めるには、この比率まで各作業を圧縮する必要があります）`
                      : "業務時間内に収まる見込みです（圧縮なし）"}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
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
            <button className="btn-pill" onClick={generateFromTemplate}>
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
        <div className="panel flex items-center gap-2 p-3 text-xs">
          {geoError ? (
            <span className="text-alert">📍 {geoError}</span>
          ) : (
            <span className="text-cream/50">
              📍 移動検知中（{geoDistanceThresholdMeters}m以上の移動で「{geoCategorySetting || "移動"} / {geoTaskNameSetting || "移動"}」を自動計測・
              {Math.round((geoStillMs / 60000) * 10) / 10}分以上停止で自動終了）
            </span>
          )}
        </div>
      )}

      {geoArrivalEnabled && (
        <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-xs">
          {geoArrivalError ? (
            <span className="text-alert">📍 {geoArrivalError}</span>
          ) : (
            <span className="text-cream/50">
              📍 地点到着検知中（登録地点{(geoPlaces ?? []).length}件。到着すると紐づく作業を自動開始）
            </span>
          )}
          {wakeLockActive ? (
            <span className="text-cream/50">💡 画面常時点灯 ON（バッテリー消費が増えます）</span>
          ) : wakeLockError ? (
            <span className="text-cream/40">💡 {wakeLockError}</span>
          ) : null}
        </div>
      )}

      {weatherNotifyEnabled && (weatherPlaces ?? []).length > 0 && (
        <div className="panel flex flex-col gap-1.5 p-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {weatherCheckError ? (
              <span className="text-alert">🌤 {weatherCheckError}</span>
            ) : (
              <span className="text-cream/50">
                🌤 天気変化の通知 ON（登録地点{(weatherPlaces ?? []).length}件。降水確率{weatherThresholdStr}%以上が{weatherLeadHoursStr}時間以内に近づくと通知
                {weatherLastCheckedAt ? `・最終取得 ${formatClock(weatherLastCheckedAt)}` : ""}）
              </span>
            )}
            <button
              className="btn-pill-outline text-xs"
              onClick={() => checkWeather(true)}
              disabled={weatherChecking}
            >
              {weatherChecking ? "取得中..." : "🔄 今すぐ取得"}
            </button>
          </div>
          {weatherCurrent.length === 0 && !weatherCheckError && (
            <p className="text-cream/40">取得中...（初回は数秒かかることがあります）</p>
          )}
          {weatherCurrent.length > 0 && (
            <div className="flex flex-col gap-1 text-cream/70">
              {weatherCurrent.map((c) => {
                const next = weatherNextCrossings.find((n) => n.placeId === c.placeId);
                return (
                  <span key={c.placeId}>
                    {c.placeLabel}: 現在 降水確率{c.precipProbability}%（{formatClock(new Date(c.atIso).getTime())}時点）
                    {next
                      ? next.hoursUntil <= 0.01
                        ? `・すでに${weatherThresholdStr}%以上です`
                        : `・次に${weatherThresholdStr}%以上: ${formatCrossingDateTime(next.atIso)}頃（${next.precipProbability}%）`
                      : `・当面${weatherThresholdStr}%以上の予報なし`}
                  </span>
                );
              })}
            </div>
          )}
        </div>
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold">{date} の作業リスト</h2>
          {streakDays > 0 && (
            <span
              className="rounded-full bg-alert/15 px-2 py-0.5 text-xs font-bold text-alert"
              title="実績が記録されている連続日数"
            >
              🔥 連続{streakDays}日
            </span>
          )}
          {growthStageEnabled &&
            todayTotalSeconds > 0 &&
            (() => {
              const { stage } = computeGrowthStage(themedMode, todayTotalSeconds);
              return (
                <span
                  className="rounded-full bg-cream/10 px-2 py-0.5 text-xs text-cream/70"
                  title={`本日の作業時間(${formatHms(todayTotalSeconds)})に応じた育成度`}
                >
                  {stage.icon} {stage.label}
                </span>
              );
            })()}
          {todayTotalSeconds > 0 && sameWeekdayAvg && sameWeekdayAvg.dayCount >= 2 && (
            <span
              className="rounded-full bg-cream/10 px-2 py-0.5 text-xs text-cream/70"
              title={`過去の${sameWeekdayAvg.label}曜日${sameWeekdayAvg.dayCount}日分の平均との比較`}
            >
              {sameWeekdayAvg.label}曜平均比{" "}
              {todayTotalSeconds >= sameWeekdayAvg.avgSeconds ? "+" : "-"}
              {Math.round((Math.abs(todayTotalSeconds - sameWeekdayAvg.avgSeconds) / sameWeekdayAvg.avgSeconds) * 100)}%
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {simpleButtons ? (
            <>
              <button
                className="btn-pill-danger px-3 py-2 text-base"
                onClick={() => startTrouble()}
                title="トラブル発生"
                aria-label="トラブル発生"
              >
                ⚡
              </button>
              <button
                className="btn-pill-outline px-3 py-2 text-base"
                onClick={() => setShowAddDialog(true)}
                title="突発作業を追加"
                aria-label="突発作業を追加"
              >
                ➕
              </button>
            </>
          ) : (
            <>
              <button className="btn-pill-danger text-sm" onClick={() => startTrouble()}>
                ⚡ トラブル発生
              </button>
              <button className="btn-pill-outline text-sm" onClick={() => setShowAddDialog(true)}>
                + 突発作業を追加
              </button>
            </>
          )}
          {voiceEnabled && !voiceUnsupported && (simpleButtons ? (
            <button
              className={voiceListening ? "btn-pill-danger px-3 py-2 text-base" : "btn-pill-outline px-3 py-2 text-base"}
              onClick={voiceListening ? stopVoiceListening : startVoiceListening}
              title={voiceListening ? "聞き取り中..." : "音声で操作(「〇〇を開始」「終了」のように話しかけて操作できます)"}
              aria-label={voiceListening ? "聞き取り中" : "音声で操作"}
            >
              🎤
            </button>
          ) : (
            <button
              className={voiceListening ? "btn-pill-danger text-sm" : "btn-pill-outline text-sm"}
              onClick={voiceListening ? stopVoiceListening : startVoiceListening}
              title="「〇〇を開始」「終了」のように話しかけて操作できます"
            >
              {voiceListening ? "🎤 聞き取り中..." : "🎤 音声で操作"}
            </button>
          ))}
          <button className="btn-pill-outline text-sm" onClick={downloadScheduleTemplate}>
            予定CSVテンプレート
          </button>
          <button className="btn-pill-outline text-sm" onClick={() => scheduleFileInputRef.current?.click()}>
            予定インポート
          </button>
          <input
            ref={scheduleFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importScheduleCsv(file);
              e.target.value = "";
            }}
          />
          {tasks && tasks.length > 0 && (
            <button className="btn-pill-outline text-sm" onClick={generateFromTemplate}>
              再生成
            </button>
          )}
        </div>
      </div>

      {scheduleImportResult && <p className="text-xs text-cream/70">{scheduleImportResult}</p>}
      {scheduleImportErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {scheduleImportErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {provisionalTask && (
        <ProvisionalTaskCard
          task={provisionalTask}
          now={now}
          candidateTasks={candidateTasks}
          onAssignExisting={resolveProvisionalToExisting}
          onAssignNew={resolveProvisionalAsNew}
          onFinishAsIs={resolveProvisionalFinish}
        />
      )}

      {taskViewTab === "pending" && (
        <div className="panel flex flex-wrap gap-x-6 gap-y-2 p-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-cream/50">✅ ToDo</span>
            {pendingDueSummary.todoOverdue > 0 && (
              <span className="rounded-full bg-alert/15 px-2 py-0.5 font-bold text-alert">
                期限切れ {pendingDueSummary.todoOverdue}件
              </span>
            )}
            {pendingDueSummary.todoDueToday > 0 && (
              <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream/80">本日期限 {pendingDueSummary.todoDueToday}件</span>
            )}
            {pendingDueSummary.todoOverdue === 0 && pendingDueSummary.todoDueToday === 0 && (
              <span className="text-cream/40">期限切れ・本日期限なし</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-cream/50">📁 案件</span>
            {pendingDueSummary.projectOverdue > 0 && (
              <span className="rounded-full bg-alert/15 px-2 py-0.5 font-bold text-alert">
                期限切れ {pendingDueSummary.projectOverdue}件
              </span>
            )}
            {pendingDueSummary.projectDueToday > 0 && (
              <span className="rounded-full bg-cream/10 px-2 py-0.5 text-cream/80">本日期限 {pendingDueSummary.projectDueToday}件</span>
            )}
            {pendingDueSummary.projectOverdue === 0 && pendingDueSummary.projectDueToday === 0 && (
              <span className="text-cream/40">期限切れ・本日期限なし</span>
            )}
          </div>
        </div>
      )}

      {taskViewTab === "done" && (
        <CompletedTasksGantt
          tasks={nonProvisionalSortedTasks}
          onOpenEdit={(task) => setEditingTask(task)}
          onCommitTimes={(task, startedAt, endedAt) =>
            applyTaskEdit(task, task.category, task.name, undefined, task.note, startedAt, endedAt)
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
        {visibleTasks.map((task) => {
          const elapsedMs = segmentsAccumulatedMs(task, now);
          const estMs = task.estimatedSeconds * 1000;
          const predictedSecondsForTask = predictedSecondsByTaskId.get(task.id) ?? 0;
          const predMs = predictedSecondsForTask * 1000;
          const overEstimate = predictedSecondsForTask > 0 && elapsedMs > predMs;
          const remainingMs = predMs - elapsedMs;
          const isNext = task.id === nextTaskId;
          const taskRankKey = task.masterTaskId ?? `${task.category}::${task.name}`;
          const topRank = topRankedKeys.get(taskRankKey);
          const isRunningOverrun = task.status === "running" && overEstimate;
          const riskTier =
            themedMode && isRunningOverrun && predictedSecondsForTask > 0
              ? getRiskTier(elapsedMs / predMs, themedMode)
              : null;
          const overrunCardAnim = themedMode ? cardOverrunClass(themedMode) : "card-overrun";
          const runningCardAnim = themedMode ? cardRunningClass(themedMode) : "card-running";
          const cardClass =
            task.status === "running"
              ? isRunningOverrun
                ? va11hallaMode
                  ? `border-v11-pink ring-2 ring-v11-pink/70 bg-v11-pink/[0.06] ${overrunCardAnim}`
                  : `border-alert ring-2 ring-alert/70 bg-alert/[0.05] ${overrunCardAnim}`
                : va11hallaMode
                  ? `border-v11-cyan ring-2 ring-v11-cyan/50 bg-v11-cyan/[0.05] ${runningCardAnim}`
                  : `border-cream ring-2 ring-cream/50 bg-cream/[0.04] ${runningCardAnim}`
              : task.status === "paused"
                ? "border-cream/40"
                : isNext
                  ? "border-cream/60 ring-1 ring-cream/40"
                  : "";
          const isBlockedByEmphasis = emphasizeRunning && runningTaskIds.size > 0 && !runningTaskIds.has(task.id);
          const dimmed = task.status !== "done" && (provisionalActive || isBlockedByEmphasis);
          const duplicateRunning =
            task.status !== "running" && runningTaskKeys.has(`${task.category}::${task.name}`);
          const controlsDisabled = provisionalActive || isBlockedByEmphasis;
          const isDraggable = task.status === "pending";
          return (
            <div
              key={task.id}
              draggable={isDraggable}
              onDragStart={isDraggable ? () => setDraggingTaskId(task.id) : undefined}
              onDragEnd={isDraggable ? () => setDraggingTaskId(null) : undefined}
              onDragOver={isDraggable ? (e) => e.preventDefault() : undefined}
              onDrop={
                isDraggable
                  ? (e) => {
                      e.preventDefault();
                      if (draggingTaskId) reorderPendingTask(draggingTaskId, task.id);
                      setDraggingTaskId(null);
                    }
                  : undefined
              }
              className={`panel relative p-4 transition-opacity ${cardClass} ${
                task.status === "done" ? "opacity-50" : dimmed ? "opacity-40" : ""
              } ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""} ${
                draggingTaskId === task.id ? "opacity-30" : ""
              } ${draggingTaskId && draggingTaskId !== task.id && isDraggable ? "border-dashed" : ""}`}
            >
              {isRunningOverrun && (
                <div className={`absolute inset-x-0 top-0 rounded-t-2xl ${themedMode ? hazardBarClass(themedMode) : "hazard-bar"}`} />
              )}
              {task.status !== "done" && (
                <button
                  onClick={() => deleteTask(task)}
                  className="absolute right-3 top-3 text-cream/40 hover:text-alert"
                  aria-label="削除"
                >
                  ✕
                </button>
              )}
              {isDraggable && (
                <span className="absolute left-1 top-3 text-cream/30" aria-hidden title="ドラッグで並べ替え">
                  ⠿
                </span>
              )}
              <div className={`flex flex-wrap items-center justify-between gap-3 pr-6 ${isDraggable ? "pl-4" : ""}`}>
                <div>
                  <div className="flex items-center gap-2 text-xs text-cream/60">
                    <span className="flex items-center gap-1">
                      {task.status === "running" && !isRunningOverrun && (
                        <span className={`flex items-center gap-1 font-bold ${va11hallaMode ? "text-v11-cyan" : "text-cream"}`}>
                          <span className={`h-2 w-2 animate-pulse rounded-full ${va11hallaMode ? "bg-v11-cyan" : "bg-alert"}`} />
                          {runningLabel(wordingThemedMode)}
                        </span>
                      )}
                      {isRunningOverrun && (
                        <span
                          className={`overrun-badge flex items-center gap-1 font-bold ${va11hallaMode ? "text-v11-pink" : themedMode ? emphasisTextClass(themedMode) : "text-alert"}`}
                        >
                          <span className={`h-2 w-2 rounded-full ${va11hallaMode ? "bg-v11-pink" : "bg-alert"}`} />
                          {overrunLabel(wordingThemedMode)}
                        </span>
                      )}
                      {riskTier && themedMode && (
                        <span
                          className={riskBadgeClasses(riskTier.level, themedMode)}
                          title={
                            wordingThemedMode === "va11halla"
                              ? "VA-11 HALL-A風モード: 予測超過の度合いに応じた注文階級"
                              : wordingThemedMode === "persona5"
                                ? "ペルソナ5風モード: 予告状に至るまでの盛り上がり階級"
                                : wordingThemedMode === "natsuyasumi"
                                  ? "ぼくのなつやすみ風モード: 夏の天気になぞらえた進み具合"
                                  : wordingThemedMode === "powerpro"
                                    ? "パワプロ風モード: 予測超過の度合いに応じた査定ランク"
                                    : wordingThemedMode === "lobotomy"
                                      ? "ロボトミーコーポレーション風モード: 予測超過の度合いに応じた警戒階級"
                                      : "予測超過の度合いに応じた危険度バッジです"
                          }
                        >
                          {riskBadgeLabel(riskTier, wordingThemedMode)}
                        </span>
                      )}
                      {task.status === "paused" && <span className="text-cream/70">‖ 一時停止中</span>}
                      {task.category} {task.isSpontaneous && <span className="ml-1 text-alert">突発</span>}
                      {isNext && task.status === "pending" && <span className="ml-2 text-cream">▶ 次の作業</span>}
                    </span>
                    <button
                      onClick={() => toggleTaskFavorite(task)}
                      className={favoriteMasterIds.has(task.masterTaskId ?? "") ? "text-alert" : "text-cream/40 hover:text-cream"}
                      aria-label={favoriteMasterIds.has(task.masterTaskId ?? "") ? "お気に入り解除" : "お気に入りに追加"}
                      title={favoriteMasterIds.has(task.masterTaskId ?? "") ? "お気に入り解除" : "お気に入りに追加"}
                    >
                      {favoriteMasterIds.has(task.masterTaskId ?? "") ? "★" : "☆"}
                    </button>
                    <button
                      onClick={() => setEditingTask(task)}
                      className="text-cream/40 hover:text-cream"
                      aria-label="編集"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => setSecondaryProjectsTask(task)}
                      className={(task.secondaryProjectIds?.length ?? 0) > 0 ? "text-alert" : "text-cream/40 hover:text-cream"}
                      aria-label="追加の案件タグ"
                      title="兼務・並行作業向けに、主案件以外の案件にも時間を按分できます"
                    >
                      🏷️{(task.secondaryProjectIds?.length ?? 0) > 0 ? task.secondaryProjectIds!.length : ""}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-base font-bold">{task.name}</span>
                    {topRank !== undefined && (
                      <span className="rounded-full bg-alert/20 px-2 py-0.5 text-[10px] font-bold text-alert">
                        {RANK_MEDALS[topRank]} 集計ランキング{topRank + 1}位
                      </span>
                    )}
                  </div>
                  {task.projectId &&
                    projectMap.get(task.projectId) &&
                    (() => {
                      const linkedProject = projectMap.get(task.projectId!)!;
                      const linkedStage = task.stageId ? linkedProject.stages?.find((s) => s.id === task.stageId) : undefined;
                      const stageDone = linkedStage ? isStageDone(linkedStage) : false;
                      const stageCountBased = linkedStage?.targetCount != null;
                      return (
                        <>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-full border border-cream/30 px-2 py-0.5 text-cream/80">
                              案件: {linkedProject.title}
                            </span>
                            {(projectTotalSeconds.get(task.projectId!) ?? 0) > 0 && (
                              <span className="font-bold tabular-nums text-cream/70">
                                この案件の累計 {formatHms(projectTotalSeconds.get(task.projectId!)!)}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-cream/15 bg-ink/40 px-2.5 py-1.5 text-xs">
                            <span className="text-cream/50">📁 元案件:</span>
                            <button
                              onClick={() => onOpenProjectEdit(linkedProject.id)}
                              className={`font-bold hover:underline ${
                                linkedProject.completedAt ? "text-cream/40 line-through" : "text-cream"
                              }`}
                            >
                              {linkedProject.title}
                              {linkedStage && `／${linkedStage.title}`}
                            </button>
                            {linkedStage ? (
                              stageDone ? (
                                <span className="text-[10px] text-cream/40">
                                  段階完了済み{stageCountBased && `（${linkedStage.completedCount ?? 0}/${linkedStage.targetCount}件）`}
                                </span>
                              ) : (
                                <button
                                  className="btn-pill-outline px-2 py-0.5 text-[10px]"
                                  onClick={() => setStageConfirmTask(task)}
                                >
                                  {stageCountBased ? "件数を進める" : "✓ 段階を完了にする"}
                                </button>
                              )
                            ) : linkedProject.completedAt ? (
                              <span className="text-[10px] text-cream/40">案件完了済み</span>
                            ) : (
                              <button
                                className="btn-pill-outline px-2 py-0.5 text-[10px]"
                                onClick={() => toggleLinkedProjectComplete(linkedProject)}
                              >
                                ✓ 案件を完了にする
                              </button>
                            )}
                            <button
                              className="text-cream/40 hover:text-cream"
                              onClick={() => onOpenProjectEdit(linkedProject.id)}
                              aria-label="編集"
                              title="案件タブで詳細を編集"
                            >
                              ✎
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  {task.todoTaskId &&
                    todoTaskMap.get(task.todoTaskId) &&
                    (() => {
                      const linkedTodo = todoTaskMap.get(task.todoTaskId!)!;
                      return (
                        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-cream/15 bg-ink/40 px-2.5 py-1.5 text-xs">
                          <span className="text-cream/50">📌 元Todo:</span>
                          <button
                            onClick={() => onOpenTodoDetail(linkedTodo.id)}
                            className={`font-bold hover:underline ${
                              linkedTodo.completed ? "text-cream/40 line-through" : "text-cream"
                            }`}
                          >
                            {linkedTodo.title}
                          </button>
                          {linkedTodo.completed ? (
                            <span className="text-[10px] text-cream/40">完了済み</span>
                          ) : (
                            <button
                              className="btn-pill-outline px-2 py-0.5 text-[10px]"
                              onClick={() => completeLinkedTodo(task.todoTaskId!)}
                            >
                              ✓ Todoを完了にする
                            </button>
                          )}
                          <button
                            className="text-cream/40 hover:text-cream"
                            onClick={() => onOpenTodoDetail(linkedTodo.id)}
                            aria-label="編集"
                            title="Todoタブで詳細を編集"
                          >
                            ✎
                          </button>
                        </div>
                      );
                    })()}
                  {task.scheduledTime && task.status === "pending" && (
                    <div className="flex items-center gap-2 text-xs">
                      {task.autoStartDisabled ? (
                        <span className="text-cream/50" title="この時刻になっても自動的には開始されません">
                          ⏰ {task.scheduledTime}（自動開始OFF）
                        </span>
                      ) : (
                        <span className="font-bold text-alert" title="この時刻になったら自動的に差し込み開始されます">
                          ⏰ {task.scheduledTime} に自動開始
                        </span>
                      )}
                      <button
                        onClick={() => toggleAutoStart(task)}
                        className="text-cream/40 underline hover:text-cream"
                      >
                        {task.autoStartDisabled ? "自動開始をONにする" : "自動開始をOFFにする"}
                      </button>
                    </div>
                  )}
                  <div className="text-xs text-cream/50">
                    {predictedSecondsForTask > 0 ? (
                      <span className="font-bold text-cream/70">予測 {formatMsClock(predMs)}</span>
                    ) : (
                      <span className="text-cream/40" title="マスタの実績がまだ十分にないため、目安の「予測」を算出できません">
                        予測 データ不足
                      </span>
                    )}
                    {task.hasPlan === true && (
                      <span className="ml-2 text-cream/40" title="この作業に個人で設定した目標時間です（工程の判断には使われません）">
                        （個人目標 {formatMsClock(estMs)}）
                      </span>
                    )}
                    {projectedFinishByTaskId.has(task.id) && (
                      <span className="ml-2 text-cream/70">
                        終了予定 {formatClock(projectedFinishByTaskId.get(task.id)!)}
                      </span>
                    )}
                    {effectiveAllocation?.allocatedMsByTaskId.has(task.id) && (
                      <span
                        className="ml-2 text-cream/50"
                        title={`${standardWorkEnd}までに収めるための目標ペース（自動配分）`}
                      >
                        配分目安 {formatMsClock(effectiveAllocation.allocatedMsByTaskId.get(task.id)!)}
                      </span>
                    )}
                  </div>
                  {task.note && <div className="mt-0.5 text-xs italic text-cream/50">📝 {task.note}</div>}
                  {duplicateRunning && (
                    <div className="text-xs text-alert">同じ作業を計測中のため開始できません</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {task.status === "running" && predictedSecondsForTask > 0 && (
                      <RadialTimer progressPct={(elapsedMs / predMs) * 100} overEstimate={overEstimate} />
                    )}
                    <div
                      className={`font-display text-2xl font-bold tabular-nums ${
                        overEstimate ? (va11hallaMode ? "text-v11-pink" : "text-alert") : "text-cream"
                      } ${isRunningOverrun ? (themedMode ? "overrun-flicker-intense" : "overrun-flicker") : ""}`}
                    >
                      {formatMsClock(elapsedMs)}
                    </div>
                  </div>
                  {predictedSecondsForTask > 0 && (task.status === "running" || task.status === "paused") && (
                    <div
                      className={`text-xs tabular-nums ${
                        remainingMs < 0 ? (va11hallaMode ? "text-v11-pink" : "text-alert") : "text-cream/60"
                      }`}
                    >
                      {remainingMs >= 0 ? `残り ${formatMsClock(remainingMs)}` : `超過 ${formatMsClock(-remainingMs)}`}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap justify-end gap-2">
                    {task.status === "pending" && (
                      <>
                        <button
                          className="btn-pill text-xs"
                          disabled={controlsDisabled || duplicateRunning}
                          onClick={() => startTask(task)}
                        >
                          開始
                        </button>
                        {effectiveLastStopTime && (
                          <button
                            className="btn-pill-outline text-xs"
                            disabled={controlsDisabled || duplicateRunning}
                            onClick={() => startTask(task, effectiveLastStopTime)}
                            title="前の作業が終了/一時停止した時刻から、この作業が始まっていたことにします"
                          >
                            {formatClock(effectiveLastStopTime)}から開始
                          </button>
                        )}
                        <button
                          className="btn-pill-outline text-xs"
                          disabled={controlsDisabled}
                          onClick={() => setManualFinishTaskTarget(task)}
                        >
                          手動で記録
                        </button>
                      </>
                    )}
                    {task.status === "running" && (
                      <>
                        <button className="btn-pill-outline text-xs" disabled={controlsDisabled} onClick={() => pauseTask(task)}>
                          一時停止
                        </button>
                        <button
                          className="btn-pill-outline text-xs"
                          disabled={controlsDisabled}
                          onClick={() => setAddTimeTask(task)}
                        >
                          時間を加算
                        </button>
                        <button className="btn-pill text-xs" disabled={controlsDisabled} onClick={() => finishTask(task)}>
                          終了
                        </button>
                      </>
                    )}
                    {task.status === "paused" && (
                      <>
                        <button
                          className="btn-pill-outline text-xs"
                          disabled={controlsDisabled || duplicateRunning}
                          onClick={() => startTask(task)}
                        >
                          再開
                        </button>
                        {effectiveLastStopTime && (
                          <button
                            className="btn-pill-outline text-xs"
                            disabled={controlsDisabled || duplicateRunning}
                            onClick={() => startTask(task, effectiveLastStopTime)}
                            title="前の作業が終了/一時停止した時刻から、この作業が再開していたことにします"
                          >
                            {formatClock(effectiveLastStopTime)}から再開
                          </button>
                        )}
                        <button
                          className="btn-pill-outline text-xs"
                          disabled={controlsDisabled}
                          onClick={() => setAddTimeTask(task)}
                        >
                          時間を加算
                        </button>
                        <button className="btn-pill text-xs" disabled={controlsDisabled} onClick={() => finishTask(task)}>
                          終了
                        </button>
                        <button
                          className="btn-pill-outline text-xs"
                          disabled={controlsDisabled}
                          onClick={() => setManualFinishTaskTarget(task)}
                        >
                          手動で記録
                        </button>
                      </>
                    )}
                    {task.status === "done" && (
                      <div className="text-right">
                        <span className="text-xs text-cream/50">完了</span>
                        {task.startedAt && task.endedAt && (
                          <div className="text-xs tabular-nums text-cream/40">
                            {formatClock(task.startedAt)}〜{formatClock(task.endedAt)}
                          </div>
                        )}
                        <button
                          className="mt-1 text-xs text-cream/40 hover:text-alert"
                          onClick={() => setDeletingCompletedTask(task)}
                        >
                          削除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {conditionEnabled && task.status === "done" && (
                  <div className="mt-2 border-t border-cream/10 pt-2">
                    {(() => {
                      const ownLog = taskOwnConditionLog(task);
                      const displayLevel = taskDisplayConditionLevel(task);
                      return (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setConditionEditTaskId(conditionEditTaskId === task.id ? null : task.id)}
                            className="flex items-center gap-1 text-xs text-cream/50 hover:text-cream"
                          >
                            {displayLevel ? (
                              <>
                                <ConditionGlyph level={displayLevel} size={16} />
                                <span>
                                  {CONDITION_LEVELS.find((c) => c.level === displayLevel)?.label ?? displayLevel}
                                  {!ownLog && <span className="text-cream/30">（直前から）</span>}
                                </span>
                              </>
                            ) : (
                              <span>体調: 記録なし（タップして記録）</span>
                            )}
                          </button>
                          {conditionEditTaskId === task.id && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {CONDITION_LEVELS.map((c) => (
                                <button
                                  key={c.level}
                                  onClick={() => setTaskCondition(task, c.level)}
                                  aria-label={c.label}
                                  title={c.label}
                                  className={displayLevel === c.level ? "btn-pill p-1" : "btn-pill-outline p-1"}
                                >
                                  <ConditionGlyph level={c.level} size={18} />
                                </button>
                              ))}
                              {ownLog && (
                                <button
                                  onClick={() => clearTaskCondition(task)}
                                  className="text-xs text-cream/40 hover:text-alert"
                                >
                                  記録を削除
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-2 z-10 pt-2" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="panel flex items-center gap-1 p-1.5 shadow-lg backdrop-blur">
          {(
            [
              { key: "running", label: "▶ 実行中", count: taskCountsByTab.running },
              { key: "pending", label: "📋 予定", count: taskCountsByTab.pending },
              { key: "done", label: "✅ 完了", count: taskCountsByTab.done },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTaskViewTab(t.key)}
              className={`flex-1 ${taskViewTab === t.key ? "btn-pill" : "btn-pill-outline"} px-2 py-2 text-xs sm:text-sm`}
            >
              {t.label}
              <span className={`tabular-nums ${taskViewTab === t.key ? "opacity-70" : "opacity-50"}`}>({t.count})</span>
            </button>
          ))}
        </div>
      </div>

      {showAddDialog && (
        <AddTaskDialog
          date={date}
          provisionalRunning={provisionalActive}
          lastStopTime={effectiveLastStopTime}
          onRequestConflictStart={requestStartNew}
          onAdded={(status) => setTaskViewTab(status)}
          onClose={() => setShowAddDialog(false)}
        />
      )}

      {pendingStart && provisionalTask && (
        <Modal title="未計測(仮計測)が計測中です" onClose={() => setPendingStart(null)}>
          <p className="mb-4 text-sm text-cream/80">
            「{provisionalTask.category} / {provisionalTask.name}」として未計測の自動計測が現在進行中です。
            このまま新しい作業を開始すると二重に計測されてしまいます。どうしますか？
          </p>
          <div className="flex flex-col gap-2">
            <button className="btn-pill text-sm" onClick={resolvePendingStartMerge}>
              今回の作業に合算する（未計測の開始時刻から続けて計測）
            </button>
            <button className="btn-pill-outline text-sm" onClick={resolvePendingStartDiscard}>
              自動計測をやめる（未計測分は記録せず、今から計測開始）
            </button>
            <button className="text-xs text-cream/50" onClick={() => setPendingStart(null)}>
              キャンセル
            </button>
          </div>
        </Modal>
      )}

      {secondaryProjectsTask && (
        <Modal title="追加の案件タグ" onClose={() => setSecondaryProjectsTask(null)}>
          <p className="mb-3 text-xs text-cream/60">
            兼務・並行作業などで、主案件(
            {secondaryProjectsTask.projectId ? projectMap.get(secondaryProjectsTask.projectId)?.title ?? "未設定" : "未設定"}
            )以外にもこの作業の時間を按分したい案件を選べます。集計・レポートの時間合算にのみ使われ、段階の進捗などには影響しません。
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {(projects ?? [])
              .filter((p) => p.id !== secondaryProjectsTask.projectId && !p.completedAt)
              .map((p) => {
                const checked = secondaryProjectsTask.secondaryProjectIds?.includes(p.id) ?? false;
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg bg-ink/50 px-3 py-2 text-sm text-cream/80"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={async (e) => {
                        const current = secondaryProjectsTask.secondaryProjectIds ?? [];
                        const next = e.target.checked ? [...current, p.id] : current.filter((id) => id !== p.id);
                        await db.dailyTasks.update(secondaryProjectsTask.id, { secondaryProjectIds: next });
                        setSecondaryProjectsTask({ ...secondaryProjectsTask, secondaryProjectIds: next });
                      }}
                      className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
                    />
                    {p.title}
                  </label>
                );
              })}
            {(projects ?? []).filter((p) => p.id !== secondaryProjectsTask.projectId && !p.completedAt).length === 0 && (
              <p className="text-sm text-cream/50">選択できる他の案件がありません。</p>
            )}
          </div>
        </Modal>
      )}

      {editingTask && (
        <EditTaskDialog
          task={editingTask}
          previousTaskEndedAt={findPreviousTaskEndedAt(editingTask)}
          onSave={(category, name, actualSeconds, note, startedAt, endedAt) =>
            applyTaskEdit(editingTask, category, name, actualSeconds, note, startedAt, endedAt)
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
        <Modal title="まだこの作業中ですか?">
          <p className="mb-4 text-sm text-cream/80">
            「{overrunTask.name}」が予測時間を大幅に超過しています。
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="btn-pill-outline text-sm"
              onClick={async () => {
                await db.dailyTasks.update(overrunTask.id, {
                  overrunPromptShown: true,
                  overrunPromptDismissedAt: Date.now(),
                });
                setOverrunTask(null);
              }}
            >
              続けている
            </button>
            <button
              className="btn-pill text-sm"
              onClick={async () => {
                await finishTask(overrunTask);
              }}
            >
              終了する
            </button>
          </div>
        </Modal>
      )}

      {pendingConditionStart && (
        <Modal
          title="体調を記録してから始めますか?"
          onClose={async () => {
            const action = pendingConditionStart;
            setPendingConditionStart(null);
            await action?.();
          }}
        >
          <p className="mb-3 text-sm text-cream/80">今日最初の作業を開始します。今の体調を記録しておきますか?</p>
          <div className="flex flex-wrap gap-2">
            {CONDITION_LEVELS.map((c) => (
              <button
                key={c.level}
                className="btn-pill-outline p-1.5"
                aria-label={c.label}
                title={c.label}
                onClick={async () => {
                  const action = pendingConditionStart;
                  setPendingConditionStart(null);
                  await logCondition(c.level);
                  await action?.();
                }}
              >
                <ConditionGlyph level={c.level} size={28} />
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              className="text-xs text-cream/50 hover:text-cream"
              onClick={async () => {
                const action = pendingConditionStart;
                setPendingConditionStart(null);
                await action?.();
              }}
            >
              スキップして開始
            </button>
          </div>
        </Modal>
      )}

      {scheduleConflict && (
        <Modal title="予定の時刻になりました" onClose={() => resolveScheduleConflict(false)}>
          <p className="mb-3 text-sm text-cream/80">
            予定「{scheduleConflict.task.category} / {scheduleConflict.task.name}」の時刻になりましたが、
            現在「{scheduleConflict.runningTasks.map((t) => t.name).join("、")}」を計測中です。
            一時停止してこちらを開始しますか?
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => resolveScheduleConflict(false)}>
              今の作業を続ける
            </button>
            <button className="btn-pill text-sm" onClick={() => resolveScheduleConflict(true)}>
              一時停止して開始する
            </button>
          </div>
        </Modal>
      )}

      {geoArrivalConflict && (
        <Modal title="位置情報: 到着を検知しました" onClose={() => resolveGeoArrivalConflict(false)}>
          <p className="mb-3 text-sm text-cream/80">
            「{geoArrivalConflict.place.label}」（{geoArrivalConflict.place.category} / {geoArrivalConflict.place.name}）
            への到着を検知しましたが、現在「{geoArrivalConflict.runningTasks.map((t) => t.name).join("、")}」を計測中です。
            一時停止してこちらを開始しますか?
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => resolveGeoArrivalConflict(false)}>
              今の作業を続ける
            </button>
            <button className="btn-pill text-sm" onClick={() => resolveGeoArrivalConflict(true)}>
              一時停止して開始する
            </button>
          </div>
        </Modal>
      )}

      {stageConfirmTask &&
        (() => {
          const project = stageConfirmTask.projectId ? projectMap.get(stageConfirmTask.projectId) : undefined;
          const stage = project?.stages?.find((s) => s.id === stageConfirmTask.stageId);
          if (!project || !stage) return null;
          const isCountBased = stage.targetCount != null;
          return (
            <Modal title="段階の進捗確認" onClose={() => setStageConfirmTask(null)}>
              <p className="mb-1 text-sm text-cream/80">「{stageConfirmTask.name}」の作業を完了しました。</p>
              {isCountBased ? (
                <p className="mb-4 text-sm text-cream/80">
                  案件「{project.title}」の段階「{stage.title}」は現在{" "}
                  <span className="font-bold">
                    {stage.completedCount ?? 0}/{stage.targetCount}件
                  </span>
                  です。この作業で1件進めますか?
                </p>
              ) : (
                <p className="mb-4 text-sm text-cream/80">
                  案件「{project.title}」の段階「{stage.title}」はこれで完了ですか?
                </p>
              )}
              {!isCountBased &&
                (() => {
                  const stages = project.stages ?? [];
                  const idx = stages.findIndex((s) => s.id === stage.id);
                  const incompletePrevious = stages.slice(0, idx).filter((s) => !s.completed);
                  if (incompletePrevious.length === 0) return null;
                  return (
                    <p className="mb-4 rounded-lg border border-alert/40 bg-alert/5 p-2 text-xs text-alert">
                      ⚠ 前の段階「{incompletePrevious.map((s) => s.title).join("」「")}」がまだ完了していません。
                    </p>
                  );
                })()}
              <div className="flex justify-end gap-2">
                <button className="btn-pill-outline text-sm" onClick={() => setStageConfirmTask(null)}>
                  {isCountBased ? "件数はそのまま（時間だけ記録）" : "まだ続く（時間だけ記録）"}
                </button>
                <button
                  className="btn-pill text-sm"
                  onClick={async () => {
                    const stages = (project.stages ?? []).map((s) => {
                      if (s.id !== stage.id) return s;
                      if (isCountBased) {
                        const next = Math.min(s.targetCount ?? 0, (s.completedCount ?? 0) + 1);
                        const justReachedTarget = next >= (s.targetCount ?? 0) && (s.completedCount ?? 0) < (s.targetCount ?? 0);
                        return { ...s, completedCount: next, completedAt: justReachedTarget ? Date.now() : s.completedAt };
                      }
                      return { ...s, completed: true, completedAt: Date.now() };
                    });
                    await db.projects.update(project.id, { stages });
                    setStageConfirmTask(null);
                  }}
                >
                  {isCountBased ? "1件進める" : "この段階を完了にする"}
                </button>
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}
