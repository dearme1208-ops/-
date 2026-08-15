"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { parseBreakRanges, serializeBreakRanges } from "@/lib/breaks";
import { DEFAULT_TAG_PRESETS, parsePresetList, serializePresetList } from "@/lib/todo";
import { exportBackup, importBackup, type BackupFile } from "@/lib/backup";
import { buildArchive, deleteArchivedRange } from "@/lib/archive";
import { downloadTextFile } from "@/lib/report";
import { todayStr } from "@/lib/time";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_RGB,
  DEFAULT_CUSTOM_CREAM_RGB,
  DEFAULT_CUSTOM_INK_RGB,
  DEFAULT_CUSTOM_PANEL_RGB,
  hexToRgbSpace,
  rgbSpaceToHex,
} from "@/lib/theme";
import ConditionGlyph from "@/components/ui/ConditionGlyph";
import { CONDITION_LEVELS } from "@/lib/condition";
import { parseCategoryRates, serializeCategoryRates } from "@/lib/cost";
import type { BreakRange } from "@/lib/types";
import { WEEKDAY_JP } from "@/lib/types";

export default function SettingsSection() {
  const [backupStatus, setBackupStatus] = useState("");
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [archiveBeforeMonth, setArchiveBeforeMonth] = useState(() => todayStr().slice(0, 7));
  const [archiveStatus, setArchiveStatus] = useState("");
  const [archiveExported, setArchiveExported] = useState(false);
  const [thresholdMinutesStr, setThresholdMinutesStr] = useSetting("today.untrackedThresholdMinutes", "5");
  const [provisionalEnabledStr, setProvisionalEnabledStr] = useSetting("today.provisionalEnabled", "false");
  const provisionalEnabled = provisionalEnabledStr === "true";
  const [provisionalNotifyEnabledStr, setProvisionalNotifyEnabledStr] = useSetting(
    "today.provisionalNotifyEnabled",
    "true"
  );
  const provisionalNotifyEnabled = provisionalNotifyEnabledStr === "true";
  const [breakRangesStr, setBreakRangesStr] = useSetting("today.provisionalBreakRanges", "[]");
  const breakRanges = parseBreakRanges(breakRangesStr);
  const [provisionalIdleHoursStr, setProvisionalIdleHoursStr] = useSetting("today.provisionalIdleThresholdHours", "3");
  const [geoTrackingEnabledStr, setGeoTrackingEnabledStr] = useSetting("today.geoTrackingEnabled", "false");
  const geoTrackingEnabled = geoTrackingEnabledStr === "true";
  const [geoDistanceThresholdStr, setGeoDistanceThresholdStr] = useSetting("today.geoDistanceThresholdMeters", "200");
  const [geoCategory, setGeoCategory] = useSetting("today.geoCategory", "移動");
  const [geoTaskName, setGeoTaskName] = useSetting("today.geoTaskName", "移動");
  const [geoStillMinutesStr, setGeoStillMinutesStr] = useSetting("today.geoStillMinutes", "10");
  const [geoArrivalEnabledStr, setGeoArrivalEnabledStr] = useSetting("today.geoArrivalEnabled", "false");
  const geoArrivalEnabled = geoArrivalEnabledStr === "true";
  const geoPlaces = useLiveQuery(() => db.geoPlaces.orderBy("createdAt").toArray(), []);
  const [weatherNotifyEnabledStr, setWeatherNotifyEnabledStr] = useSetting("weather.notifyEnabled", "false");
  const weatherNotifyEnabled = weatherNotifyEnabledStr === "true";
  const [weatherLeadHoursStr, setWeatherLeadHoursStr] = useSetting("weather.notifyLeadHours", "3");
  const [weatherThresholdStr, setWeatherThresholdStr] = useSetting("weather.precipThreshold", "50");
  const [newPlaceLabel, setNewPlaceLabel] = useState("");
  const [newPlaceCategory, setNewPlaceCategory] = useState("");
  const [newPlaceName, setNewPlaceName] = useState("");
  const [newPlaceRadius, setNewPlaceRadius] = useState("150");
  const [newPlaceLat, setNewPlaceLat] = useState("");
  const [newPlaceLon, setNewPlaceLon] = useState("");
  const [geoPlaceStatus, setGeoPlaceStatus] = useState("");
  // nullなら新規登録、idが入っていればその地点を編集中（フォームを共用し、保存時の挙動だけ分ける）
  const [editingPlaceId, setEditingPlaceId] = useState<string | null>(null);
  // 天気変化の通知用の登録地点。地点到着検知(geoPlaces)とは別の独立した一覧
  const weatherPlaces = useLiveQuery(() => db.weatherPlaces.orderBy("createdAt").toArray(), []);
  const [newWeatherPlaceLabel, setNewWeatherPlaceLabel] = useState("");
  const [newWeatherPlaceLat, setNewWeatherPlaceLat] = useState("");
  const [newWeatherPlaceLon, setNewWeatherPlaceLon] = useState("");
  const [weatherPlaceStatus, setWeatherPlaceStatus] = useState("");
  const [editingWeatherPlaceId, setEditingWeatherPlaceId] = useState<string | null>(null);
  const [quickStartEnabledStr, setQuickStartEnabledStr] = useSetting("today.quickStartEnabled", "true");
  const quickStartEnabled = quickStartEnabledStr === "true";
  const [emphasizeRunningStr, setEmphasizeRunningStr] = useSetting("today.emphasizeRunning", "false");
  const emphasizeRunning = emphasizeRunningStr === "true";
  const [showStatusPanelStr, setShowStatusPanelStr] = useSetting("today.showStatusPanel", "true");
  const showStatusPanel = showStatusPanelStr === "true";
  const [showAutoAllocateStr, setShowAutoAllocateStr] = useSetting("today.showAutoAllocate", "true");
  const showAutoAllocate = showAutoAllocateStr === "true";
  const [showSuggestedTaskStr, setShowSuggestedTaskStr] = useSetting("today.showSuggestedTask", "true");
  const showSuggestedTask = showSuggestedTaskStr === "true";
  const [patternSuggestNotifyEnabledStr, setPatternSuggestNotifyEnabledStr] = useSetting(
    "notify.patternSuggestEnabled",
    "false"
  );
  const patternSuggestNotifyEnabled = patternSuggestNotifyEnabledStr === "true";
  const [masterEditModeStr, setMasterEditModeStr] = useSetting("records.masterEditMode", "relink");
  const [standardWorkStart, setStandardWorkStart] = useSetting("today.standardWorkStart", "08:00");
  const [standardWorkEnd, setStandardWorkEnd] = useSetting("today.standardWorkEnd", "17:00");
  const [conditionEnabledStr, setConditionEnabledStr] = useSetting("condition.enabled", "true");
  const conditionEnabled = conditionEnabledStr === "true";
  const [simpleButtonsStr, setSimpleButtonsStr] = useSetting("today.simpleButtons", "false");
  const simpleButtons = simpleButtonsStr === "true";
  const [conditionIconStyle, setConditionIconStyle] = useSetting("condition.iconStyle", "custom");
  const [autoImportantTag, setAutoImportantTag] = useSetting("todo.autoImportantTag", "対応中");
  const [tagPresetsJson, setTagPresetsJson] = useSetting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS));
  const tagPresets = useMemo(() => parsePresetList(tagPresetsJson), [tagPresetsJson]);
  const [categoryPresetsJson, setCategoryPresetsJson] = useSetting("todo.categoryPresets", "[]");
  const categoryPresets = useMemo(() => parsePresetList(categoryPresetsJson), [categoryPresetsJson]);
  const [showCompletedSubtasksStr, setShowCompletedSubtasksStr] = useSetting("todo.showCompletedSubtasks", "true");
  const showCompletedSubtasks = showCompletedSubtasksStr === "true";
  const [showCompletedStagesStr, setShowCompletedStagesStr] = useSetting("projects.showCompletedStages", "true");
  const showCompletedStages = showCompletedStagesStr === "true";
  const [todoReminderEnabledStr, setTodoReminderEnabledStr] = useSetting("todo.reminderEnabled", "true");
  const todoReminderEnabled = todoReminderEnabledStr === "true";
  const [todoReminderDaysBefore, setTodoReminderDaysBefore] = useSetting("todo.reminderDaysBefore", "1");
  const [voiceEnabledStr, setVoiceEnabledStr] = useSetting("today.voiceEnabled", "false");
  const voiceEnabled = voiceEnabledStr === "true";
  const [defaultHourlyRateStr, setDefaultHourlyRateStr] = useSetting("cost.defaultHourlyRate", "");
  const [categoryRatesJson, setCategoryRatesJson] = useSetting("cost.categoryRates", "{}");
  const categoryRates = useMemo(() => parseCategoryRates(categoryRatesJson), [categoryRatesJson]);
  const [newRateCategory, setNewRateCategory] = useState("");
  const [newRateAmount, setNewRateAmount] = useState("");

  function addCategoryRate() {
    const cat = newRateCategory.trim();
    const amount = Number(newRateAmount);
    if (!cat || !Number.isFinite(amount) || amount < 0) return;
    setCategoryRatesJson(serializeCategoryRates({ ...categoryRates, [cat]: amount }));
    setNewRateCategory("");
    setNewRateAmount("");
  }
  function removeCategoryRate(cat: string) {
    const next = { ...categoryRates };
    delete next[cat];
    setCategoryRatesJson(serializeCategoryRates(next));
  }

  function addTagPreset(value: string) {
    if (tagPresets.includes(value)) return;
    setTagPresetsJson(serializePresetList([...tagPresets, value]));
  }
  function removeTagPreset(value: string) {
    setTagPresetsJson(serializePresetList(tagPresets.filter((v) => v !== value)));
    if (autoImportantTag === value) setAutoImportantTag("");
  }
  function addCategoryPreset(value: string) {
    if (categoryPresets.includes(value)) return;
    setCategoryPresetsJson(serializePresetList([...categoryPresets, value]));
  }
  function removeCategoryPreset(value: string) {
    setCategoryPresetsJson(serializePresetList(categoryPresets.filter((v) => v !== value)));
  }
  const [afterHoursCutoff, setAfterHoursCutoff] = useSetting("report.afterHoursCutoff", "18:00");
  const [weeklyAfterHoursNotifyEnabledStr, setWeeklyAfterHoursNotifyEnabledStr] = useSetting(
    "notify.afterHoursWeeklyEnabled",
    "false"
  );
  const weeklyAfterHoursNotifyEnabled = weeklyAfterHoursNotifyEnabledStr === "true";
  const [weeklyAfterHoursThresholdStr, setWeeklyAfterHoursThresholdStr] = useSetting(
    "notify.afterHoursWeeklyThresholdHours",
    "5"
  );
  const [accentRgb, setAccentRgb] = useSetting("theme.accentRgb", DEFAULT_ACCENT_RGB);
  const [fontScale, setFontScale] = useSetting("accessibility.fontScale", "md");
  const [highContrastStr, setHighContrastStr] = useSetting("accessibility.highContrast", "false");
  const highContrast = highContrastStr === "true";
  const [weekViewMode, setWeekViewMode] = useSetting("calendar.weekViewMode", "fixedStart");
  const [weekStartDayStr, setWeekStartDayStr] = useSetting("calendar.weekStartDay", "0");
  const [visualMode, setVisualMode] = useSetting("theme.visualMode", "off");
  const [customInkRgb, setCustomInkRgb] = useSetting("theme.custom.inkRgb", DEFAULT_CUSTOM_INK_RGB);
  const [customCreamRgb, setCustomCreamRgb] = useSetting("theme.custom.creamRgb", DEFAULT_CUSTOM_CREAM_RGB);
  const [customPanelRgb, setCustomPanelRgb] = useSetting("theme.custom.panelRgb", DEFAULT_CUSTOM_PANEL_RGB);
  const [applyWordingStr, setApplyWordingStr] = useSetting("theme.applyWording", "true");
  const applyWording = applyWordingStr !== "false";
  const [dailySummaryEnabledStr, setDailySummaryEnabledStr] = useSetting("notify.dailySummaryEnabled", "false");
  const dailySummaryEnabled = dailySummaryEnabledStr === "true";
  const [dailySummaryTime, setDailySummaryTime] = useSetting("notify.dailySummaryTime", "18:00");
  const [monthlySummaryEnabledStr, setMonthlySummaryEnabledStr] = useSetting("notify.monthlySummaryEnabled", "false");
  const monthlySummaryEnabled = monthlySummaryEnabledStr === "true";
  const [shortcutsEnabledStr, setShortcutsEnabledStr] = useSetting("today.shortcutsEnabled", "true");
  const shortcutsEnabled = shortcutsEnabledStr === "true";
  const [weeklyGoalHoursStr, setWeeklyGoalHoursStr] = useSetting("report.weeklyGoalHours", "");
  const [monthlyGoalHoursStr, setMonthlyGoalHoursStr] = useSetting("report.monthlyGoalHours", "");
  const [staleMasterDaysStr, setStaleMasterDaysStr] = useSetting("master.staleDays", "90");

  function addBreakRange() {
    setBreakRangesStr(serializeBreakRanges([...breakRanges, { start: "12:00", end: "13:00" }]));
  }
  function updateBreakRange(index: number, patch: Partial<BreakRange>) {
    const next = breakRanges.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setBreakRangesStr(serializeBreakRanges(next));
  }
  function removeBreakRange(index: number) {
    setBreakRangesStr(serializeBreakRanges(breakRanges.filter((_, i) => i !== index)));
  }

  // 地点登録フォームの緯度・経度に、今いる場所の座標を自動入力する
  // （利用者が緯度経度を自分で調べて入力するのは非現実的なため、現在地から登録できるようにする）
  function useCurrentLocationForNewPlace() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoPlaceStatus("この端末・ブラウザは位置情報の取得に対応していません");
      return;
    }
    setGeoPlaceStatus("現在地を取得中...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNewPlaceLat(pos.coords.latitude.toFixed(6));
        setNewPlaceLon(pos.coords.longitude.toFixed(6));
        setGeoPlaceStatus("現在地を取得しました。内容を確認して登録してください。");
      },
      () => setGeoPlaceStatus("現在地を取得できませんでした（権限をご確認ください）"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function resetGeoPlaceForm() {
    setNewPlaceLabel("");
    setNewPlaceCategory("");
    setNewPlaceName("");
    setNewPlaceRadius("150");
    setNewPlaceLat("");
    setNewPlaceLon("");
    setEditingPlaceId(null);
  }

  // 既存地点の「編集」を押した際、フォームにその地点の内容を読み込む（保存はaddGeoPlaceが分岐して行う）
  function startEditGeoPlace(place: NonNullable<typeof geoPlaces>[number]) {
    setNewPlaceLabel(place.label);
    setNewPlaceCategory(place.category);
    setNewPlaceName(place.name);
    setNewPlaceRadius(String(place.radiusMeters));
    setNewPlaceLat(String(place.lat));
    setNewPlaceLon(String(place.lon));
    setEditingPlaceId(place.id);
    setGeoPlaceStatus("");
  }

  async function addGeoPlace() {
    const lat = Number(newPlaceLat);
    const lon = Number(newPlaceLon);
    const radius = Math.max(10, Number(newPlaceRadius) || 150);
    if (!newPlaceLabel.trim() || !newPlaceCategory.trim() || !newPlaceName.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setGeoPlaceStatus("地点名・業務区分・作業名・緯度経度（現在地を登録）を入力してください。");
      return;
    }
    if (editingPlaceId) {
      await db.geoPlaces.update(editingPlaceId, {
        label: newPlaceLabel.trim(),
        lat,
        lon,
        radiusMeters: radius,
        category: newPlaceCategory.trim(),
        name: newPlaceName.trim(),
      });
      resetGeoPlaceForm();
      setGeoPlaceStatus("地点を更新しました。");
      return;
    }
    await db.geoPlaces.add({
      id: uid(),
      label: newPlaceLabel.trim(),
      lat,
      lon,
      radiusMeters: radius,
      category: newPlaceCategory.trim(),
      name: newPlaceName.trim(),
      createdAt: Date.now(),
    });
    resetGeoPlaceForm();
    setGeoPlaceStatus("地点を登録しました。");
  }

  async function removeGeoPlace(id: string) {
    await db.geoPlaces.delete(id);
    if (editingPlaceId === id) resetGeoPlaceForm();
  }

  // 天気変化通知用の地点登録フォームに、今いる場所の座標を自動入力する
  function useCurrentLocationForNewWeatherPlace() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setWeatherPlaceStatus("この端末・ブラウザは位置情報の取得に対応していません");
      return;
    }
    setWeatherPlaceStatus("現在地を取得中...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNewWeatherPlaceLat(pos.coords.latitude.toFixed(6));
        setNewWeatherPlaceLon(pos.coords.longitude.toFixed(6));
        setWeatherPlaceStatus("現在地を取得しました。内容を確認して登録してください。");
      },
      () => setWeatherPlaceStatus("現在地を取得できませんでした（権限をご確認ください）"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function resetWeatherPlaceForm() {
    setNewWeatherPlaceLabel("");
    setNewWeatherPlaceLat("");
    setNewWeatherPlaceLon("");
    setEditingWeatherPlaceId(null);
  }

  function startEditWeatherPlace(place: NonNullable<typeof weatherPlaces>[number]) {
    setNewWeatherPlaceLabel(place.label);
    setNewWeatherPlaceLat(String(place.lat));
    setNewWeatherPlaceLon(String(place.lon));
    setEditingWeatherPlaceId(place.id);
    setWeatherPlaceStatus("");
  }

  async function addWeatherPlace() {
    const lat = Number(newWeatherPlaceLat);
    const lon = Number(newWeatherPlaceLon);
    if (!newWeatherPlaceLabel.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setWeatherPlaceStatus("地点名・緯度経度（現在地を登録）を入力してください。");
      return;
    }
    if (editingWeatherPlaceId) {
      await db.weatherPlaces.update(editingWeatherPlaceId, {
        label: newWeatherPlaceLabel.trim(),
        lat,
        lon,
      });
      resetWeatherPlaceForm();
      setWeatherPlaceStatus("地点を更新しました。");
      return;
    }
    await db.weatherPlaces.add({
      id: uid(),
      label: newWeatherPlaceLabel.trim(),
      lat,
      lon,
      createdAt: Date.now(),
    });
    resetWeatherPlaceForm();
    setWeatherPlaceStatus("地点を登録しました。");
  }

  async function removeWeatherPlace(id: string) {
    await db.weatherPlaces.delete(id);
    if (editingWeatherPlaceId === id) resetWeatherPlaceForm();
  }

  async function downloadBackup() {
    const data = await exportBackup();
    downloadTextFile(`koutei-hyo_backup_${todayStr()}.json`, JSON.stringify(data, null, 2));
    setBackupStatus("バックアップをダウンロードしました。");
  }

  // バックエンド・クラウド同期を持たないこのアプリで、他の自分の端末にその場でデータを
  // 移したい場合向け。OSの共有機能(AirDrop/近くのデバイス/Bluetooth等)経由でファイルを
  // 直接渡せるので、サーバーを介さず「今だけ・この2台だけ」で完結する
  async function shareBackup() {
    const data = await exportBackup();
    const file = new File([JSON.stringify(data, null, 2)], `koutei-hyo_backup_${todayStr()}.json`, {
      type: "application/json",
    });
    if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare?.({ files: [file] })) {
      setBackupStatus("この端末・ブラウザは共有機能に対応していません。「バックアップをダウンロード」をご利用ください。");
      return;
    }
    try {
      await navigator.share({ files: [file], title: "工程表バックアップ" });
      setBackupStatus("共有しました。");
    } catch {
      // ユーザーがキャンセルした場合など。エラー表示は不要
    }
  }

  async function restoreBackup(file: File) {
    const text = await file.text();
    let data: BackupFile;
    try {
      data = JSON.parse(text);
    } catch {
      setBackupStatus("ファイルの読み込みに失敗しました（JSON形式ではありません）。");
      return;
    }
    if (data.app !== "koutei-hyo" || !data.tables) {
      setBackupStatus("このアプリのバックアップファイルではないようです。");
      return;
    }
    if (
      !confirm(
        "現在のすべてのデータをこのバックアップの内容で置き換えます。この操作は元に戻せません。よろしいですか?"
      )
    ) {
      return;
    }
    const { restoredRows } = await importBackup(data);
    setBackupStatus(`復元しました（${restoredRows}件のデータ）。エクスポート日時: ${data.exportedAt}`);
  }

  async function exportArchive() {
    const beforeDate = `${archiveBeforeMonth}-01`;
    const data = await buildArchive(beforeDate);
    if (data.records.length === 0 && data.dailyTasks.length === 0) {
      setArchiveStatus("対象期間のデータはありません。");
      setArchiveExported(false);
      return;
    }
    downloadTextFile(`koutei-hyo_archive_before-${archiveBeforeMonth}.json`, JSON.stringify(data, null, 2));
    setArchiveStatus(
      `実績${data.records.length}件、日次タスク${data.dailyTasks.length}件をダウンロードしました。内容を確認してから削除を実行してください。`
    );
    setArchiveExported(true);
  }

  async function deleteArchive() {
    const beforeDate = `${archiveBeforeMonth}-01`;
    if (
      !confirm(
        `${archiveBeforeMonth}より前の実績・日次タスクを削除します。ダウンロードしたアーカイブファイルは保存済みですか？この操作は元に戻せません。`
      )
    ) {
      return;
    }
    const { deletedRecords, deletedDailyTasks } = await deleteArchivedRange(beforeDate);
    setArchiveStatus(`削除しました（実績${deletedRecords}件、日次タスク${deletedDailyTasks}件）。`);
    setArchiveExported(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-bold">設定</h2>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">未計測時間の自動計測</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={provisionalEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setProvisionalEnabledStr(provisionalEnabled ? "false" : "true")}
          >
            未計測の自動計測: {provisionalEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {provisionalEnabled && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <span>未計測が</span>
            <input
              type="number"
              min={0}
              value={thresholdMinutesStr}
              onChange={(e) => setThresholdMinutesStr(e.target.value)}
              className="w-14 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
            />
            <span>分以上続いたら、自動で仮計測を開始します</span>
            <button
              className={provisionalNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setProvisionalNotifyEnabledStr(provisionalNotifyEnabled ? "false" : "true")}
            >
              仮計測の通知: {provisionalNotifyEnabled ? "ON" : "OFF"}
            </button>
          </div>
        )}

        {provisionalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <p className="text-xs text-cream/60">
              除外する時間帯（休憩など）。この時間帯は未計測の自動開始が始まらず、「さかのぼって開始/再開」でも対象に含まれません。
            </p>
            {breakRanges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
                <input
                  type="time"
                  value={r.start}
                  onChange={(e) => updateBreakRange(i, { start: e.target.value })}
                  className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <span>〜</span>
                <input
                  type="time"
                  value={r.end}
                  onChange={(e) => updateBreakRange(i, { end: e.target.value })}
                  className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <button className="text-alert" onClick={() => removeBreakRange(i)} aria-label="削除">
                  ✕
                </button>
              </div>
            ))}
            <button className="btn-pill-outline text-xs" onClick={addBreakRange}>
              + 時間帯を追加
            </button>
          </div>
        )}

        {provisionalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
              <span>放置</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={provisionalIdleHoursStr}
                onChange={(e) => setProvisionalIdleHoursStr(e.target.value)}
                className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>時間以上マウス/キーボード操作がなければ、未計測の計測を最後に操作していた時刻で自動的に打ち切ります</span>
            </div>
            <p className="text-[10px] text-cream/40">
              定時後・休日にPCを開いたまま放置しても、際限なく計測され続けないようにするための保険です。
            </p>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">位置情報による移動検知</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={geoTrackingEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setGeoTrackingEnabledStr(geoTrackingEnabled ? "false" : "true")}
          >
            移動検知の自動計測: {geoTrackingEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-[10px] text-cream/40">
          ONにするとブラウザから位置情報の利用許可を求められます。ブラウザ/PWAの仕様上、この画面(タブ)を開いている間だけ動作します。アプリを閉じたり画面を消灯してバックグラウンドに回すと、特にiOSでは数十秒〜数分で位置情報の取得が止まり、移動を検知できなくなります。
        </p>
        {geoTrackingEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3 text-xs text-cream/60">
            <div className="flex flex-wrap items-center gap-2">
              <span>直前の地点から</span>
              <input
                type="number"
                min={10}
                step={10}
                value={geoDistanceThresholdStr}
                onChange={(e) => setGeoDistanceThresholdStr(e.target.value)}
                className="w-20 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>m以上動いたら、以下の名称で仮計測を自動開始します</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={geoCategory}
                onChange={(e) => setGeoCategory(e.target.value)}
                placeholder="業務区分（例: 移動）"
                className="w-32 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
              />
              <span>/</span>
              <input
                type="text"
                value={geoTaskName}
                onChange={(e) => setGeoTaskName(e.target.value)}
                placeholder="作業名（例: 移動）"
                className="w-32 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>その後</span>
              <input
                type="number"
                min={1}
                step={1}
                value={geoStillMinutesStr}
                onChange={(e) => setGeoStillMinutesStr(e.target.value)}
                className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>分以上、位置情報の変化(移動)がなければ自動的に計測を終了します</span>
            </div>
            <p className="text-[10px] text-cream/40">
              自動開始された仮計測は「本日の作業」画面の仮計測カードから、通常の仮計測と同様に既存の作業へ割り当てたり、新しい作業として確定できます。他の作業を計測中・仮計測中は移動検知による自動開始は行われません。
            </p>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">位置情報による地点到着検知（自動開始）</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={geoArrivalEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setGeoArrivalEnabledStr(geoArrivalEnabled ? "false" : "true")}
          >
            地点到着検知の自動開始: {geoArrivalEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-[10px] text-cream/40">
          客先など、あらかじめ座標を登録した地点に近づくと、紐づく作業を自動的に開始します（上の「移動検知」とは別の機能です）。ONにするとブラウザから位置情報の利用許可を求められます。ブラウザ/PWAの仕様上、この画面(タブ)を開いている間だけ動作し、バックグラウンドに回すと数十秒〜数分で位置情報の取得が止まります。既に他の作業を計測中の場合は自動で割り込まず、停止して開始するか確認します。
        </p>
        {geoArrivalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            {(geoPlaces ?? []).length > 0 && (
              <div className="space-y-1.5">
                {(geoPlaces ?? []).map((p) => (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                      editingPlaceId === p.id ? "bg-cream/10 ring-1 ring-cream/40" : "bg-ink/50"
                    }`}
                  >
                    <span className="font-bold text-cream">{p.label}</span>
                    <span className="text-cream/60">
                      {p.category} / {p.name}
                    </span>
                    <span className="text-cream/40">半径{p.radiusMeters}m</span>
                    <span className="text-cream/30">
                      ({p.lat.toFixed(4)}, {p.lon.toFixed(4)})
                    </span>
                    <button
                      className="ml-auto text-cream/40 hover:text-cream"
                      onClick={() => startEditGeoPlace(p)}
                      aria-label="編集"
                    >
                      ✎
                    </button>
                    <button className="text-cream/40 hover:text-alert" onClick={() => removeGeoPlace(p.id)} aria-label="削除">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              className={`space-y-2 rounded-lg border p-3 text-xs text-cream/70 ${
                editingPlaceId ? "border-cream/40 bg-cream/5" : "border-cream/10"
              }`}
            >
              {editingPlaceId && (
                <p className="text-xs font-bold text-cream">✎ 地点を編集中（保存すると上の一覧に反映されます）</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={newPlaceLabel}
                  onChange={(e) => setNewPlaceLabel(e.target.value)}
                  placeholder="地点名（例: A社本社）"
                  className="w-40 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <input
                  type="text"
                  value={newPlaceCategory}
                  onChange={(e) => setNewPlaceCategory(e.target.value)}
                  placeholder="業務区分"
                  className="w-32 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <span>/</span>
                <input
                  type="text"
                  value={newPlaceName}
                  onChange={(e) => setNewPlaceName(e.target.value)}
                  placeholder="作業名"
                  className="w-32 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span>半径</span>
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={newPlaceRadius}
                  onChange={(e) => setNewPlaceRadius(e.target.value)}
                  className="w-20 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
                />
                <span>m以内で到着とみなす</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-pill-outline text-xs" onClick={useCurrentLocationForNewPlace}>
                  📍 現在地を登録
                </button>
                <input
                  type="number"
                  value={newPlaceLat}
                  onChange={(e) => setNewPlaceLat(e.target.value)}
                  placeholder="緯度"
                  className="w-28 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <input
                  type="number"
                  value={newPlaceLon}
                  onChange={(e) => setNewPlaceLon(e.target.value)}
                  placeholder="経度"
                  className="w-28 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <button className="btn-pill text-xs" onClick={addGeoPlace}>
                  {editingPlaceId ? "地点を更新" : "地点を追加"}
                </button>
                {editingPlaceId && (
                  <button className="btn-pill-outline text-xs" onClick={resetGeoPlaceForm}>
                    編集をキャンセル
                  </button>
                )}
              </div>
              {geoPlaceStatus && <p className="text-[10px] text-cream/40">{geoPlaceStatus}</p>}
              <p className="text-[10px] text-cream/40">
                現地で「現在地を登録」を押すと緯度経度が自動で入ります。地点情報は端末内にのみ保存されます。
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">天気変化の通知（降水確率）</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={weatherNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setWeatherNotifyEnabledStr(weatherNotifyEnabled ? "false" : "true")}
          >
            天気変化の通知: {weatherNotifyEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {weatherNotifyEnabled && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={weatherLeadHoursStr}
              onChange={(e) => setWeatherLeadHoursStr(e.target.value)}
              className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
            />
            <span>時間以内に、降水確率が</span>
            <input
              type="number"
              min={0}
              max={100}
              value={weatherThresholdStr}
              onChange={(e) => setWeatherThresholdStr(e.target.value)}
              className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
            />
            <span>%以上になる見込みなら通知します</span>
          </div>
        )}
        <p className="text-[10px] text-cream/40">
          下に登録した地点それぞれについて、無料の気象データ(Open-Meteo)から時間ごとの降水確率を取得し、まだ閾値未満の状態から指定時間以内に閾値以上になる時刻が近づいたら通知します。アプリを開いている間に取得できた情報をもとに判定するため、アプリを閉じている/バックグラウンドの間は情報が更新されません（その時点で取得できていた予報が前提になります）。地点が1件も登録されていない場合は動作しません。
        </p>
        {weatherNotifyEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            {(weatherPlaces ?? []).length > 0 && (
              <div className="space-y-1.5">
                {(weatherPlaces ?? []).map((p) => (
                  <div
                    key={p.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                      editingWeatherPlaceId === p.id ? "bg-cream/10 ring-1 ring-cream/40" : "bg-ink/50"
                    }`}
                  >
                    <span className="font-bold text-cream">{p.label}</span>
                    <span className="text-cream/30">
                      ({p.lat.toFixed(4)}, {p.lon.toFixed(4)})
                    </span>
                    <button
                      className="ml-auto text-cream/40 hover:text-cream"
                      onClick={() => startEditWeatherPlace(p)}
                      aria-label="編集"
                    >
                      ✎
                    </button>
                    <button
                      className="text-cream/40 hover:text-alert"
                      onClick={() => removeWeatherPlace(p.id)}
                      aria-label="削除"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              className={`space-y-2 rounded-lg border p-3 text-xs text-cream/70 ${
                editingWeatherPlaceId ? "border-cream/40 bg-cream/5" : "border-cream/10"
              }`}
            >
              {editingWeatherPlaceId && (
                <p className="text-xs font-bold text-cream">✎ 地点を編集中（保存すると上の一覧に反映されます）</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={newWeatherPlaceLabel}
                  onChange={(e) => setNewWeatherPlaceLabel(e.target.value)}
                  placeholder="地点名（例: 自宅）"
                  className="w-40 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-pill-outline text-xs" onClick={useCurrentLocationForNewWeatherPlace}>
                  📍 現在地を登録
                </button>
                <input
                  type="number"
                  value={newWeatherPlaceLat}
                  onChange={(e) => setNewWeatherPlaceLat(e.target.value)}
                  placeholder="緯度"
                  className="w-28 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <input
                  type="number"
                  value={newWeatherPlaceLon}
                  onChange={(e) => setNewWeatherPlaceLon(e.target.value)}
                  placeholder="経度"
                  className="w-28 rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <button className="btn-pill text-xs" onClick={addWeatherPlace}>
                  {editingWeatherPlaceId ? "地点を更新" : "地点を追加"}
                </button>
                {editingWeatherPlaceId && (
                  <button className="btn-pill-outline text-xs" onClick={resetWeatherPlaceForm}>
                    編集をキャンセル
                  </button>
                )}
              </div>
              {weatherPlaceStatus && <p className="text-[10px] text-cream/40">{weatherPlaceStatus}</p>}
              <p className="text-[10px] text-cream/40">
                現地で「現在地を登録」を押すと緯度経度が自動で入ります。地点情報は端末内にのみ保存されます（「地点到着検知」の登録地点とは別の一覧です）。
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">ホーム画面のクイック起動</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={quickStartEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setQuickStartEnabledStr(quickStartEnabled ? "false" : "true")}
          >
            クイック起動: {quickStartEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-[10px] text-cream/40">
          ホーム画面に追加したアプリのアイコンを長押しして出る「クイック起動①〜④」ショートカットから、お気に入り作業をワンタップで開始/終了できる機能です。OFFにすると、ショートカットを開いても何も起きなくなり、「本日の作業」画面のお気に入り欄からも割り当てボタンが消えます(割り当て自体は消えないので、再度ONにすれば元通りです)。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">音声での開始/終了</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={voiceEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVoiceEnabledStr(voiceEnabled ? "false" : "true")}
          >
            音声での操作: {voiceEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-[10px] text-cream/40">
          ONにすると「本日の作業」画面に🎤ボタンが出ます。タップして「掃除を開始」「終了」のように話しかけると、その内容に応じて作業を開始/終了/一時停止します。お気に入りやマスタに近い名前の作業があればそれを、無ければその場で新規の作業として開始します。ONにするとブラウザからマイクの利用許可を求められます。対応はブラウザによって異なり(主にChrome/Edge/Safari系)、Firefoxなどでは利用できません。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">コスト換算（時給/単価）</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="text-xs text-cream/60">デフォルト単価</label>
          <input
            type="number"
            min={0}
            step={100}
            value={defaultHourlyRateStr}
            onChange={(e) => setDefaultHourlyRateStr(e.target.value)}
            placeholder="未設定"
            className="w-24 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-right text-cream"
          />
          <span className="text-xs text-cream/60">円/時間</span>
        </div>
        <p className="text-[10px] text-cream/40">
          設定すると、集計・週報/月報・案件などの画面に概算金額（作業時間×単価）が表示されます。未設定のカテゴリ・案件にはこのデフォルト単価が使われます。案件ごとの単価は「案件」タブから個別に設定できます。
        </p>
        <div className="space-y-2 border-t border-cream/10 pt-3">
          <p className="text-xs text-cream/60">カテゴリ別の単価（デフォルトより優先されます）</p>
          {Object.entries(categoryRates).map(([cat, amount]) => (
            <div key={cat} className="flex items-center gap-2 text-xs text-cream/70">
              <span className="flex-1 truncate">{cat}</span>
              <span className="tabular-nums">{amount.toLocaleString("ja-JP")}円/時間</span>
              <button className="text-alert" onClick={() => removeCategoryRate(cat)} aria-label="削除">
                ✕
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newRateCategory}
              onChange={(e) => setNewRateCategory(e.target.value)}
              placeholder="業務区分"
              className="w-28 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
            />
            <input
              type="number"
              min={0}
              step={100}
              value={newRateAmount}
              onChange={(e) => setNewRateAmount(e.target.value)}
              placeholder="円/時間"
              className="w-24 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-right text-xs text-cream"
            />
            <button className="btn-pill-outline text-xs" onClick={addCategoryRate}>
              + 追加
            </button>
          </div>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">本日の作業の表示</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={emphasizeRunning ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setEmphasizeRunningStr(emphasizeRunning ? "false" : "true")}
          >
            計測中の作業を強調表示: {emphasizeRunning ? "ON" : "OFF"}
          </button>
          <button
            className={shortcutsEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShortcutsEnabledStr(shortcutsEnabled ? "false" : "true")}
          >
            キーボードショートカット: {shortcutsEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-xs text-cream/50">
          ONにすると、計測中の作業がある間は他の作業が薄く表示され、ボタンも操作できなくなります（仮計測中と同様の見せ方です）。
        </p>
        {shortcutsEnabled && (
          <p className="text-xs text-cream/50">
            キーボードショートカット（入力欄にフォーカスしていない時のみ有効）: <b className="text-cream">Space</b>
            = 計測中の作業を一時停止/一番上の一時停止中の作業を再開、<b className="text-cream">N</b> = 突発作業を追加、
            <b className="text-cream">T</b> = トラブル発生
          </p>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">本日タブのパネル表示</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={showStatusPanel ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowStatusPanelStr(showStatusPanel ? "false" : "true")}
          >
            本日の作業状況: {showStatusPanel ? "ON" : "OFF"}
          </button>
          <button
            className={showAutoAllocate ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowAutoAllocateStr(showAutoAllocate ? "false" : "true")}
          >
            自動配分: {showAutoAllocate ? "ON" : "OFF"}
          </button>
          <button
            className={showSuggestedTask ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowSuggestedTaskStr(showSuggestedTask ? "false" : "true")}
          >
            そろそろこの作業では?: {showSuggestedTask ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-xs text-cream/50">
          OFFにしたパネルは本日タブに表示されなくなります（記録や設定自体は消えません。自動配分はモード自体を「オフ」にしても止められますが、ここでOFFにするとパネルごと非表示にできます）。
        </p>
        <div className="border-t border-cream/10 pt-3">
          <button
            className={patternSuggestNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setPatternSuggestNotifyEnabledStr(patternSuggestNotifyEnabled ? "false" : "true")}
          >
            パターン学習型の声かけ通知: {patternSuggestNotifyEnabled ? "ON" : "OFF"}
          </button>
          <p className="mt-2 text-xs text-cream/50">
            「そろそろこの作業では?」の提案が出た最初のタイミングで、パネル表示に加えて通知も送ります（同じ提案は1日1回まで）。
          </p>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">基本労働時間</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <input
            type="time"
            value={standardWorkStart}
            onChange={(e) => setStandardWorkStart(e.target.value)}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          />
          <span>〜</span>
          <input
            type="time"
            value={standardWorkEnd}
            onChange={(e) => setStandardWorkEnd(e.target.value)}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          />
        </div>
        <p className="text-xs text-cream/50">
          本日タブの「時間を加算」で、この時間帯のうちどの作業のセグメントにも含まれていない
          （未計測の）時間を目安として表示します。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">アクセントカラー</h3>
        <div className="flex flex-wrap gap-2">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setAccentRgb(p.rgb)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                accentRgb === p.rgb ? "border-cream bg-cream/10 text-cream" : "border-cream/20 text-cream/60"
              }`}
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: `rgb(${p.rgb.split(" ").join(",")})` }}
              />
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-cream/50">
          警告・重要・強調表示に使う単色アクセントの色相を変更します（配色方針自体は単色のまま維持されます）。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">文字サイズ・見やすさ</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={fontScale === "sm" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setFontScale("sm")}
          >
            小
          </button>
          <button
            className={fontScale === "md" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setFontScale("md")}
          >
            標準
          </button>
          <button
            className={fontScale === "lg" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setFontScale("lg")}
          >
            大
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={highContrast ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setHighContrastStr(highContrast ? "false" : "true")}
          >
            ハイコントラスト: {highContrast ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-xs text-cream/50">
          文字サイズはアプリ全体に反映されます。ハイコントラストは、薄い文字色・枠線をより濃く表示し、フォーカス時の輪郭も強調します。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">📆 カレンダーの週表示</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={weekViewMode === "fixedStart" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setWeekViewMode("fixedStart")}
          >
            指定した曜日から1週間
          </button>
          <button
            className={weekViewMode === "centered" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setWeekViewMode("centered")}
          >
            今日を中心に前後3日
          </button>
          <button
            className={weekViewMode === "todayForward" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setWeekViewMode("todayForward")}
          >
            今日から1週間先まで
          </button>
        </div>
        {weekViewMode === "fixedStart" && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {WEEKDAY_JP.map((label, i) => (
              <button
                key={label}
                className={weekStartDayStr === String(i) ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => setWeekStartDayStr(String(i))}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-cream/50">
          案件・ToDoタブのカレンダー表示を「週」に切り替えた際に、1週間として表示する範囲を選べます。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">🎭 演出テーマ</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={visualMode === "off" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("off")}
          >
            オフ
          </button>
          <button
            className={visualMode === "lobotomy" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("lobotomy")}
          >
            🩸 ロボトミーコーポレーション風
          </button>
          <button
            className={visualMode === "va11halla" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("va11halla")}
          >
            🍸 VA-11 HALL-A風
          </button>
          <button
            className={visualMode === "persona5" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("persona5")}
          >
            ★ ペルソナ5風
          </button>
          <button
            className={visualMode === "natsuyasumi" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("natsuyasumi")}
          >
            🌻 ぼくのなつやすみ風
          </button>
          <button
            className={visualMode === "powerpro" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("powerpro")}
          >
            ⚾ パワプロ風
          </button>
          <button
            className={visualMode === "custom" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setVisualMode("custom")}
          >
            🎨 カスタム
          </button>
        </div>
        <p className="text-xs text-cream/50">
          演出テーマを選ぶと、色や装飾だけでなくアプリ名・タブの呼び名までテーマの世界観のものに総入れ替えされます（例: ぼくのなつやすみ風では「ToDo」が「しゅくだい」に、アプリ名も「なつやすみの しゅくだい」になります）。カスタムは背景・文字・パネルの色だけを自由に選べるモードです（形・アニメーション・文言は変わりません）。
        </p>
        {visualMode !== "off" && visualMode !== "custom" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/40 px-3 py-2">
            <div>
              <p className="text-xs font-bold text-cream/80">テーマに合わせた文言を使う</p>
              <p className="text-[11px] text-cream/50">
                オフにすると、色・形・アニメーションはテーマのまま、アプリ名・タブ名・バッジや通知の文言だけ通常表記に戻ります。
              </p>
            </div>
            <button
              className={applyWording ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setApplyWordingStr(applyWording ? "false" : "true")}
            >
              文言の変更: {applyWording ? "ON" : "OFF"}
            </button>
          </div>
        )}
        {visualMode === "lobotomy" && (
          <p className="text-xs text-cream/50">
            画面全体にCRT風の走査線・ノイズ、アプリタイトルの色収差グリッチ、パネル四隅のリベット、見出しの走査ブロック装飾が有効になります。予測を大幅に超過した作業には「収容の不安定化」警戒表示（画面端のビネット・横スクロールする警告ティッカー・危険階級バッジ ZAYIN〜ALEPH）が出ます。
          </p>
        )}
        {visualMode === "va11halla" && (
          <p className="text-xs text-cream/50">
            画面全体にネオンのシンセウェイブグリッド・VHS風走査線、パネル枠のネオングロー、アプリタイトルのネオン色収差が有効になります。予測を大幅に超過した作業には「システムオーバーロード」警戒表示（ネオンビネット・横スクロールする警告ティッカー・注文階級バッジ REGULAR〜BAD TOUCH）が出ます。
          </p>
        )}
        {visualMode === "persona5" && (
          <p className="text-xs text-cream/50">
            画面全体が黒地に赤・白を基調にした切り絵風の配色に丸ごと変わり、パネル左上の斜め切り取りリボン・見出しの斜体強調・角を落とした鋭いボタンが有効になります。予測を大幅に超過した作業には「予告状」警戒表示（高速ストロボのビネット・横スクロールする警告ティッカー・階級バッジ 順調〜予告状）が出ます。
          </p>
        )}
        {visualMode === "natsuyasumi" && (
          <p className="text-xs text-cream/50">
            画面全体が暖色の紙焼き写真風ライトテーマに丸ごと反転し、他の演出テーマとは対照的な見た目になります。パネルは角丸の写真カード風、警告は夏の天気（そよ風〜夕立警報）になぞらえたのんびりした表示に変わります。アプリ名は「なつやすみの しゅくだい」、ToDoは「しゅくだい」、ガントチャートは「生活記録表」など、タブの呼び名も総入れ替えされます。
          </p>
        )}
        {visualMode === "powerpro" && (
          <p className="text-xs text-cream/50">
            画面全体が白地に緑・紺・金を効かせたスコアボード風ライトテーマに丸ごと反転します。パネルには球場グリーンの太枠、査定ランクのようなメダル型バッジ（G〜S）、球場の芝目模様が入ります。アプリ名は「球団ノート」、ToDoは「伝令メモ」、ガントチャートは「スタメン表」など、タブの呼び名も野球用語に総入れ替えされます。
          </p>
        )}
        {visualMode === "off" && (
          <p className="text-xs text-cream/50">
            通常表示です。計測中・予測超過の強調表示自体は演出テーマに関わらず常に有効です。
          </p>
        )}
        {visualMode === "custom" && (
          <div className="space-y-3 border-t border-cream/10 pt-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-cream/70">
                背景
                <input
                  type="color"
                  value={rgbSpaceToHex(customInkRgb)}
                  onChange={(e) => setCustomInkRgb(hexToRgbSpace(e.target.value))}
                  className="h-8 w-12 cursor-pointer rounded border border-cream/20 bg-ink"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-cream/70">
                文字
                <input
                  type="color"
                  value={rgbSpaceToHex(customCreamRgb)}
                  onChange={(e) => setCustomCreamRgb(hexToRgbSpace(e.target.value))}
                  className="h-8 w-12 cursor-pointer rounded border border-cream/20 bg-ink"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-cream/70">
                パネル
                <input
                  type="color"
                  value={rgbSpaceToHex(customPanelRgb)}
                  onChange={(e) => setCustomPanelRgb(hexToRgbSpace(e.target.value))}
                  className="h-8 w-12 cursor-pointer rounded border border-cream/20 bg-ink"
                />
              </label>
              <button
                className="btn-pill-outline text-xs"
                onClick={() => {
                  setCustomInkRgb(DEFAULT_CUSTOM_INK_RGB);
                  setCustomCreamRgb(DEFAULT_CUSTOM_CREAM_RGB);
                  setCustomPanelRgb(DEFAULT_CUSTOM_PANEL_RGB);
                }}
              >
                初期値に戻す
              </button>
            </div>
            <p className="text-xs text-cream/50">
              背景・文字・パネルの色を自由に選べます。アクセントカラーは上の「アクセントカラー」設定と共通です。
            </p>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">週・月の目標時間</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <span>週の目標</span>
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="未設定"
            value={weeklyGoalHoursStr}
            onChange={(e) => setWeeklyGoalHoursStr(e.target.value)}
            className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
          />
          <span>時間</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <span>月の目標</span>
          <input
            type="number"
            min={0}
            step={0.5}
            placeholder="未設定"
            value={monthlyGoalHoursStr}
            onChange={(e) => setMonthlyGoalHoursStr(e.target.value)}
            className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
          />
          <span>時間</span>
        </div>
        <p className="text-xs text-cream/50">
          週報・月報に達成率を表示します。空欄のままなら目標表示は行いません。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">1日の終わりの自動サマリー通知</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={dailySummaryEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setDailySummaryEnabledStr(dailySummaryEnabled ? "false" : "true")}
          >
            自動サマリー通知: {dailySummaryEnabled ? "ON" : "OFF"}
          </button>
          {dailySummaryEnabled && (
            <>
              <span className="text-xs text-cream/60">時刻</span>
              <input
                type="time"
                value={dailySummaryTime}
                onChange={(e) => setDailySummaryTime(e.target.value)}
                className="rounded border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
            </>
          )}
        </div>
        <p className="text-xs text-cream/50">
          指定した時刻になったら、その日の合計作業時間（と体調を記録していればその内容）を通知します（1日1回）。
        </p>
        <div className="border-t border-cream/10 pt-3">
          <button
            className={monthlySummaryEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMonthlySummaryEnabledStr(monthlySummaryEnabled ? "false" : "true")}
          >
            月次ダイジェスト通知: {monthlySummaryEnabled ? "ON" : "OFF"}
          </button>
          <p className="mt-2 text-xs text-cream/50">
            月が変わって初めてアプリを開いたタイミングで、先月の合計作業時間と最も時間を使った業務区分を通知します（月1回）。
          </p>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">使用頻度の低い作業マスタの検出基準</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <span>最終実績から</span>
          <input
            type="number"
            min={1}
            value={staleMasterDaysStr}
            onChange={(e) => setStaleMasterDaysStr(e.target.value)}
            className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
          />
          <span>日以上経過した作業マスタを、作業マスタタブでアーカイブ候補として表示します</span>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">体調の記録</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={conditionEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setConditionEnabledStr("true")}
          >
            ON
          </button>
          <button
            className={!conditionEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setConditionEnabledStr("false")}
          >
            OFF
          </button>
        </div>
        <p className="text-xs text-cream/50">
          {conditionEnabled
            ? "本日タブに「今の体調」欄を表示し、いつでも記録できます。"
            : "本日タブの「今の体調」欄を非表示にします（既に記録済みのデータは残ります）。"}
        </p>
        <div className="space-y-2 border-t border-cream/10 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={conditionIconStyle === "custom" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setConditionIconStyle("custom")}
            >
              オリジナルアイコン
            </button>
            <button
              className={conditionIconStyle === "emoji" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setConditionIconStyle("emoji")}
            >
              絵文字
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {CONDITION_LEVELS.map((c) => (
              <ConditionGlyph key={c.level} level={c.level} size={24} />
            ))}
          </div>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">本日タブのボタン表示</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={!simpleButtons ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setSimpleButtonsStr("false")}
          >
            通常表示
          </button>
          <button
            className={simpleButtons ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setSimpleButtonsStr("true")}
          >
            簡易表示（アイコンのみ）
          </button>
        </div>
        <p className="text-xs text-cream/50">
          {simpleButtons
            ? "「トラブル発生」「突発作業を追加」ボタンをアイコンのみで表示します。"
            : "「トラブル発生」「突発作業を追加」ボタンを文字付きで表示します。"}
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">実績編集で名称・区分を変更した時の挙動</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={masterEditModeStr === "relink" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMasterEditModeStr("relink")}
          >
            別のマスタに繋ぎ変える
          </button>
          <button
            className={masterEditModeStr === "rename" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMasterEditModeStr("rename")}
          >
            マスタ自体もリネームする
          </button>
        </div>
        <p className="text-xs text-cream/50">
          {masterEditModeStr === "rename"
            ? "この実績が紐づく作業マスタの名称・区分もそのまま書き換えます。同じマスタに紐づく他の日の実績の表示も一緒に変わります。"
            : "新しい名称・区分の作業マスタが既にあればそこに繋ぎ変え、なければ新規作成して繋ぎ変えます。元のマスタや、それに紐づく他の実績には影響しません。"}
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">ToDoの対応状況の選択肢</h3>
        <PresetListEditor presets={tagPresets} onAdd={addTagPreset} onRemove={removeTagPreset} placeholder="対応状況名" />
        <p className="text-xs text-cream/50">
          ToDoの「対応状況」ドロップダウン・かんばんの列に出てくる選択肢です。ここでの増減とは別に、ToDo登録・編集時は自由入力（「＋
          新しい対応状況...」）も引き続きできます。
        </p>

        <div className="border-t border-cream/10 pt-3">
          <h4 className="mb-2 text-xs font-bold text-cream/70">自動重要化のトリガー</h4>
          <div className="flex flex-wrap gap-2">
            <button
              className={!autoImportantTag ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setAutoImportantTag("")}
            >
              なし
            </button>
            {tagPresets.map((t) => (
              <button
                key={t}
                className={autoImportantTag === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
                onClick={() => setAutoImportantTag(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-cream/50">
            {autoImportantTag
              ? `ToDoのタスク登録・編集時に対応状況「${autoImportantTag}」を選ぶと、自動的に★重要にします（対応状況を外しても重要フラグは自動では解除しません）。`
              : "自動重要化は無効です。対応状況を選んでも★重要は自動では変わりません。"}
          </p>
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">ToDoの期日リマインダー</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={todoReminderEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setTodoReminderEnabledStr(todoReminderEnabled ? "false" : "true")}
          >
            期日リマインダー: {todoReminderEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {todoReminderEnabled && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <span>期日の</span>
            <input
              type="number"
              min={0}
              step={1}
              value={todoReminderDaysBefore}
              onChange={(e) => setTodoReminderDaysBefore(e.target.value)}
              className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
            />
            <span>日前から（期限切れは常に）、タブに関わらずポップアップで知らせます。</span>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">ToDoの分類の選択肢</h3>
        <PresetListEditor presets={categoryPresets} onAdd={addCategoryPreset} onRemove={removeCategoryPreset} placeholder="分類名" />
        <p className="text-xs text-cream/50">
          分類には既定値はありません。ここで登録したものだけがドロップダウン・かんばんの列に出てきます（自由入力でタスクに設定はできますが、ここで登録するまで選択肢やかんばんの列にはなりません）。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">完了済みのサブタスク・段階の表示</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={showCompletedSubtasks ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowCompletedSubtasksStr(showCompletedSubtasks ? "false" : "true")}
          >
            ToDoの完了済みサブタスクを表示: {showCompletedSubtasks ? "ON" : "OFF"}
          </button>
          <button
            className={showCompletedStages ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setShowCompletedStagesStr(showCompletedStages ? "false" : "true")}
          >
            案件の完了済み段階を表示: {showCompletedStages ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-xs text-cream/50">
          OFFにすると、親タスク・案件の下に並ぶ完了済みのサブタスク・段階を一覧から隠します（データ自体は消えません。進捗率・件数の集計には引き続き含まれます）。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">週報・月報の「定時以降の業務」判定基準</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <span>定時（終業時刻）</span>
          <input
            type="time"
            value={afterHoursCutoff}
            onChange={(e) => setAfterHoursCutoff(e.target.value)}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          />
        </div>
        <p className="text-xs text-cream/50">
          週報・月報で、この時刻より後にかかった実績時間を「定時以降の業務」として集計します（所定労働時間による概算残業とは別の、実際の時刻ベースの集計です）。
        </p>
        <div className="space-y-2 border-t border-cream/10 pt-3">
          <button
            className={weeklyAfterHoursNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setWeeklyAfterHoursNotifyEnabledStr(weeklyAfterHoursNotifyEnabled ? "false" : "true")}
          >
            週次の基準超え通知: {weeklyAfterHoursNotifyEnabled ? "ON" : "OFF"}
          </button>
          {weeklyAfterHoursNotifyEnabled && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
              <span>今週の定時以降の業務が</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={weeklyAfterHoursThresholdStr}
                onChange={(e) => setWeeklyAfterHoursThresholdStr(e.target.value)}
                className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>時間を超えたら通知します（週1回）</span>
            </div>
          )}
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">全データのバックアップ・復元</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill-outline text-sm" onClick={downloadBackup}>
            バックアップをダウンロード
          </button>
          <button
            className="btn-pill-outline text-sm"
            onClick={shareBackup}
            title="AirDrop/近くのデバイス等、OSの共有機能でそのまま他の端末に渡せます"
          >
            📤 他の端末に共有
          </button>
          <button className="btn-pill-outline text-sm" onClick={() => restoreInputRef.current?.click()}>
            バックアップから復元
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) restoreBackup(file);
              e.target.value = "";
            }}
          />
        </div>
        {backupStatus && <p className="text-xs text-cream/70">{backupStatus}</p>}
        <p className="text-xs text-cream/50">
          このアプリのデータは端末のブラウザ内にのみ保存されています。定期的にバックアップをダウンロードしておくと、機種変更やブラウザデータ消去の際に復元できます。復元は現在のデータを全て上書きします。「他の端末に共有」は、クラウドを経由せずOSの共有機能(AirDrop/近くのデバイス等)でその場だけ他の自分の端末にファイルを渡したい場合にお使いください。渡した端末側では「バックアップから復元」で取り込めます。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">実績データの月次アーカイブ</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <input
            type="month"
            value={archiveBeforeMonth}
            onChange={(e) => {
              setArchiveBeforeMonth(e.target.value);
              setArchiveExported(false);
              setArchiveStatus("");
            }}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          />
          <span>より前の実績・日次タスクをアーカイブ</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill-outline text-sm" onClick={exportArchive}>
            アーカイブをダウンロード
          </button>
          <button
            className="btn-pill-outline text-sm disabled:opacity-30"
            onClick={deleteArchive}
            disabled={!archiveExported}
          >
            ダウンロード済みデータを削除
          </button>
        </div>
        {archiveStatus && <p className="text-xs text-cream/70">{archiveStatus}</p>}
        <p className="text-xs text-cream/50">
          データが増えすぎて動作が重くなってきた場合などに使います。まずダウンロードしてバックアップし、内容を確認してから削除を実行してください（削除ボタンは同じ期間でダウンロードするまで押せません）。作業マスタや案件、ToDoは削除されません。
        </p>
      </div>
    </div>
  );
}

// チップ形式の選択肢リストを増減編集する小さな汎用エディタ（対応状況・分類の両方で使う）
function PresetListEditor({
  presets,
  onAdd,
  onRemove,
  placeholder,
}: {
  presets: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder: string;
}) {
  const [newValue, setNewValue] = useState("");

  function add() {
    const v = newValue.trim();
    if (!v) return;
    onAdd(v);
    setNewValue("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {presets.length === 0 && <p className="text-xs text-cream/40">まだ何も登録されていません。</p>}
        {presets.map((p) => (
          <span
            key={p}
            className="flex items-center gap-1.5 rounded-full border border-cream/20 bg-ink px-2.5 py-1 text-xs text-cream"
          >
            {p}
            <button onClick={() => onRemove(p)} aria-label={`${p}を削除`} className="text-cream/40 hover:text-alert">
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
        />
        <button className="btn-pill-outline text-xs" onClick={add}>
          追加
        </button>
      </div>
    </div>
  );
}
