"use client";

import { useEffect, useMemo, useState } from "react";
import SectionBoundary from "@/components/SectionBoundary";
import dynamic from "next/dynamic";
import { useLiveQuery } from "dexie-react-hooks";
import TabNav, { TabDef } from "@/components/TabNav";
import GroupedTabNav from "@/components/GroupedTabNav";
import { db } from "@/lib/db";
import { useSetting, useSettingLoaded } from "@/lib/settings";
import { finishDailyTask } from "@/lib/tasks";
import { todayStr } from "@/lib/time";
import Modal from "@/components/ui/Modal";
import ThemeInit from "@/components/ThemeInit";
import VisualModeInit from "@/components/VisualModeInit";
import AccessibilityInit from "@/components/AccessibilityInit";
import StoragePersistInit from "@/components/StoragePersistInit";
import AutoBackupInit from "@/components/AutoBackupInit";
import LobotomyOverrunWatcher from "@/components/LobotomyOverrunWatcher";
import ToastHost from "@/components/ui/ToastHost";
import ConfettiHost from "@/components/ui/ConfettiHost";
import CommandPalette from "@/components/CommandPalette";
import OrphanTaskModal from "@/components/OrphanTaskModal";
import RunningNowPill from "@/components/RunningNowPill";
import TodoReminderModal from "@/components/TodoReminderModal";
import TodoReminderPopup from "@/components/TodoReminderPopup";
import OnboardingGuide from "@/components/OnboardingGuide";
import { PLAIN_TAB_LABELS, parseHiddenTabKeys, tabLabel, useVisualMode, visibleTabKeys, type TabKey } from "@/lib/theme";
import { menuSkinFor } from "@/lib/mainMenu";

const TodaySection = dynamic(() => import("@/components/sections/TodaySection"), { ssr: false });
const ClaudeWorkspaceSection = dynamic(() => import("@/components/sections/ClaudeWorkspaceSection"), { ssr: false });
const ZenSection = dynamic(() => import("@/components/sections/ZenSection"), { ssr: false });
const TerminalDashboardSection = dynamic(() => import("@/components/sections/TerminalDashboardSection"), { ssr: false });
const PowerproTrainingSection = dynamic(() => import("@/components/sections/PowerproTrainingSection"), { ssr: false });
const MountainSection = dynamic(() => import("@/components/sections/MountainSection"), { ssr: false });
const MainMenuSection = dynamic(() => import("@/components/sections/MainMenuSection"), { ssr: false });
const HayarigamiSection = dynamic(() => import("@/components/sections/HayarigamiSection"), { ssr: false });
const LobotomySection = dynamic(() => import("@/components/sections/LobotomySection"), { ssr: false });
const LibrarySection = dynamic(() => import("@/components/sections/LibrarySection"), { ssr: false });
const AdventurerQuestSection = dynamic(() => import("@/components/sections/AdventurerQuestSection"), { ssr: false });
const AdventurerStatusSection = dynamic(() => import("@/components/sections/AdventurerStatusSection"), { ssr: false });
const TodoSection = dynamic(() => import("@/components/sections/TodoSection"), { ssr: false });
const ProjectsSection = dynamic(() => import("@/components/sections/ProjectsSection"), { ssr: false });
const ClaudeReportSection = dynamic(() => import("@/components/sections/ClaudeReportSection"), { ssr: false });
const ClaudeInsightsSection = dynamic(() => import("@/components/sections/ClaudeInsightsSection"), { ssr: false });
const NatsuyasumiSection = dynamic(() => import("@/components/sections/NatsuyasumiSection"), { ssr: false });
const MasterSection = dynamic(() => import("@/components/sections/MasterSection"), { ssr: false });
const HomeMasterSection = dynamic(() => import("@/components/sections/HomeMasterSection"), { ssr: false });
const TemplateSection = dynamic(() => import("@/components/sections/TemplateSection"), { ssr: false });
const GanttSection = dynamic(() => import("@/components/sections/GanttSection"), { ssr: false });
const AggregationSection = dynamic(() => import("@/components/sections/AggregationSection"), { ssr: false });
const ChartsSection = dynamic(() => import("@/components/sections/ChartsSection"), { ssr: false });
const HeatmapSection = dynamic(() => import("@/components/sections/HeatmapSection"), { ssr: false });
const AttentionSection = dynamic(() => import("@/components/sections/AttentionSection"), { ssr: false });
const ReportSection = dynamic(() => import("@/components/sections/ReportSection"), { ssr: false });
const RecordsSection = dynamic(() => import("@/components/sections/RecordsSection"), { ssr: false });
const SettingsSection = dynamic(() => import("@/components/sections/SettingsSection"), { ssr: false });
const AppearanceSection = dynamic(() => import("@/components/sections/AppearanceSection"), { ssr: false });
const OvertimeSection = dynamic(() => import("@/components/sections/OvertimeSection"), { ssr: false });
const YearlyChartSection = dynamic(() => import("@/components/sections/YearlyChartSection"), { ssr: false });
const MandalaSection = dynamic(() => import("@/components/sections/MandalaSection"), { ssr: false });
const MemoSection = dynamic(() => import("@/components/sections/MemoSection"), { ssr: false });
const ModeExtras = () => import("@/components/modes/ModeExtras");
const MountainPlanPanel = dynamic(() => ModeExtras().then((m) => m.MountainPlanPanel), { ssr: false });
const PowerproInjuryPanel = dynamic(() => ModeExtras().then((m) => m.PowerproInjuryPanel), { ssr: false });
const HayarigamiDeductionPanel = dynamic(() => ModeExtras().then((m) => m.HayarigamiDeductionPanel), { ssr: false });
const OverdueTodoPanel = dynamic(() => ModeExtras().then((m) => m.OverdueTodoPanel), { ssr: false });
const NatsuyasumiPanels = dynamic(() => ModeExtras().then((m) => m.NatsuyasumiPanels), { ssr: false });
const ZenPanels = dynamic(() => ModeExtras().then((m) => m.ZenPanels), { ssr: false });
const LibraryCounterPanel = dynamic(() => ModeExtras().then((m) => m.LibraryCounterPanel), { ssr: false });
const HubTimelineStrip = dynamic(() => ModeExtras().then((m) => m.HubTimelineStrip), { ssr: false });
const QuickStampDock = dynamic(() => import("@/components/QuickStampDock"), { ssr: false });
const UnifiedBoardSection = dynamic(() => import("@/components/sections/UnifiedBoardSection"), { ssr: false });
const OriginSheetSection = dynamic(() => import("@/components/sections/OriginSheetSection"), { ssr: false });
const ObservatorySection = dynamic(() => import("@/components/sections/ObservatorySection"), { ssr: false });

// 並び順の唯一の情報源。ラベルはPLAIN_TAB_LABELS(lib/theme.ts)を共通の
// 情報源にし、家庭モード管理タブ等の他の画面ともここで語彙がずれないようにする
const TAB_ORDER: TabKey[] = [
  "today",
  "todo",
  "projects",
  "master",
  "homeMaster",
  "template",
  "gantt",
  "aggregation",
  "charts",
  "heatmap",
  "attention",
  "overtime",
  "yearlyChart",
  "mandala",
  "memo",
  "board",
  "observatory",
  "report",
  "records",
  "appearance",
  "settings",
];
const TABS: TabDef[] = TAB_ORDER.map((key) => ({ key, label: PLAIN_TAB_LABELS[key] }));
// これより多くのタブが並ぶモードだけ、タブを分類ごとの2段にまとめる
const GROUP_TABS_MIN_COUNT = 10;

// 本日の作業を独自の画面に差し替えるモードで、本日の作業の操作をまとめたボタンの呼び名
const TOOLS_LABEL_BY_MODE: Record<string, string> = {
  adventurer: "道具袋",
  library: "司書",
  mountain: "装備",
  powerpro: "作戦",
  lobotomy: "指令",
  hayarigami: "手帳",
  natsuyasumi: "もちもの",
  terminal: "tools",
  zen: "道具",
  claude: "道具",
  hub: "道具",
  origin: "マクロ",
};

export default function HomePage() {
  const [active, setActive] = useState("today");
  const [showCloseCheck, setShowCloseCheck] = useState(false);
  // 育成選手モードのメインメニュー。家庭用ゲームのモード選択画面のように、
  // まずタイルの一覧を出し、選んだタブの中身へ入る。入った先の左上から戻れる
  const [menuOpen, setMenuOpen] = useState(true);
  // 期日リマインダーポップアップの「詳細確認」から、ToDoタブへ切り替えつつ該当タスクの
  // 詳細ダイアログを開いた状態にするための橋渡し。TodoSection側で消費されたらnullに戻す
  const [pendingTodoDetailId, setPendingTodoDetailId] = useState<string | null>(null);
  // 本日タブに表示された案件バッジの「編集」から、案件タブへ切り替えつつ該当案件の
  // 編集ダイアログを開いた状態にするための橋渡し。上と同じ仕組み
  const [pendingProjectEditId, setPendingProjectEditId] = useState<string | null>(null);
  // 統合ボードに置いたToDoカードの件名から、ToDoタブへ切り替えつつ検索欄でその項目に
  // 絞り込んだ状態にするための橋渡し。詳細ダイアログは開かず一覧の中で見せたいという
  // 要望のため、上のpendingTodoDetailIdとは別に持つ
  const [pendingTodoFilterId, setPendingTodoFilterId] = useState<string | null>(null);
  const { mode, wordingMode } = useVisualMode();
  // 起動直後は本文をCSSで伏せてある(html[data-booting])。最初に描画されるHTMLは
  // 必ずOFFモードの姿になるため、そのまま見せると一瞬だけ違うモードの画面が映る。
  // 演出テーマの設定を読み終えた時点で伏せを外す
  const themeSettingLoaded = useSettingLoaded("theme.visualMode");
  useEffect(() => {
    if (themeSettingLoaded) document.documentElement.removeAttribute("data-booting");
  }, [themeSettingLoaded]);
  // 設定のキーは育成選手モード専用だった頃のまま。名前を変えると、以前OFFにした人の
  // 設定が読めなくなってメニューが勝手に復活してしまうので、キーはそのままにしてある
  const [mainMenuStr] = useSetting("powerpro.mainMenu", "true");
  // メニューを出せるモードで、設定がONのときだけ
  const useMainMenu = menuSkinFor(mode) !== null && mainMenuStr === "true";
  const showMenu = useMainMenu && menuOpen;
  // 本日の作業(TodaySection)をそのまま使うモード。それ以外のモードは本日の作業を独自の画面に差し替える
  const todaySectionShown = !showMenu && active === "today" && ["off", "va11halla", "persona5", "home"].includes(mode);
  // 本日の作業には下部タブの左に打刻ボタンがある。本日の作業を独自の画面に差し替えるモードでは、
  // その「今日」の画面の右下に出す(他のタブでは一覧の操作ボタンに重なるので出さない)
  const showStampDock = !showMenu && active === "today" && !todaySectionShown;
  // ホーム画面ショートカットの打刻(/?stamp=1)は、メニュー画面を飛ばして「今日」を開き、
  // そこにある打刻ボタンの持ち主(本日の作業 or 右下のボタン)に受け取らせる
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("stamp") !== "1") return;
    setMenuOpen(false);
    setActive("today");
  }, []);

  // 統合ボードのタブに、開かなくても分かるよう「期限切れ・本日期日」件数のバッジを出す。
  // ボードに置いてある(boardXが設定された)ToDo・案件だけを対象にする(タブを開いた時に
  // 実際に目に入るものと一致させるため)
  const badgeDate = todayStr();
  const boardBadgeTodos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const boardBadgeProjects = useLiveQuery(() => db.projects.toArray(), []);
  const boardUrgentCount = useMemo(() => {
    let count = 0;
    for (const t of boardBadgeTodos ?? []) {
      if (t.completed || t.parentTaskId || t.boardX === undefined || !t.dueDate) continue;
      if (t.dueDate <= badgeDate) count++;
    }
    for (const p of boardBadgeProjects ?? []) {
      if (p.completedAt || p.boardX === undefined) continue;
      if (p.dueDate <= badgeDate) count++;
    }
    return count;
  }, [boardBadgeTodos, boardBadgeProjects, badgeDate]);

  // 森モード中、家庭モード管理タブでユーザー自身が個別に隠したタブ
  const [homeHiddenTabsJson] = useSetting("home.hiddenTabKeys", "[]");
  // タブを「分類(上段)+中のタブ(下段)」の2段にまとめて出すか(設定でOFFにできる)。
  // 森モードで試したのち全モードに広げた。禅・Claudeなどタブを絞ってあるモードでは
  // まとめるほどの数が無いので、タブが一定数を超える場合だけまとめる
  const [groupTabsStr] = useSetting("ui.groupTabs", "true");
  const homeHiddenTabs = useMemo(() => parseHiddenTabKeys(homeHiddenTabsJson), [homeHiddenTabsJson]);

  const tabs = useMemo(() => {
    const allKeys = TABS.map((t) => t.key as TabKey);
    const visibleKeys = new Set(visibleTabKeys(mode, allKeys, homeHiddenTabs));
    return TABS.filter((t) => visibleKeys.has(t.key as TabKey)).map((t) => ({
      key: t.key,
      label: tabLabel(t.key, wordingMode, t.label),
      badge: t.key === "board" ? boardUrgentCount : undefined,
    }));
  }, [mode, wordingMode, boardUrgentCount, homeHiddenTabs]);

  const groupTabs = groupTabsStr === "true" && tabs.length > GROUP_TABS_MIN_COUNT;

  // Claudeモードのようにタブ構成を絞るモードへ切り替えた際、今開いているタブが
  // 非表示になっていたら「本日の作業」タブへ戻す(存在しないタブが開いたままにならないように)
  useEffect(() => {
    if (!tabs.some((t) => t.key === active)) setActive("today");
  }, [tabs, active]);

  const date = todayStr();
  const todayTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const [provisionalEnabledStr, setProvisionalEnabledStr] = useSetting("today.provisionalEnabled", "false");
  const provisionalEnabled = provisionalEnabledStr === "true";
  const unfinishedTasks = useMemo(
    () => (todayTasks ?? []).filter((t) => !t.isProvisional && t.status !== "done"),
    [todayTasks]
  );

  // アプリを閉じようとした際、未計測がONのままだったり未完了の作業が残っていれば
  // 一旦離脱を止め、OFFにするか・完了にするかを選べる確認ダイアログを出す
  useEffect(() => {
    const shouldWarn = provisionalEnabled || unfinishedTasks.length > 0;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!shouldWarn) return;
      e.preventDefault();
      e.returnValue = "";
      setTimeout(() => setShowCloseCheck(true), 300);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [provisionalEnabled, unfinishedTasks.length]);

  async function turnOffProvisional() {
    const provisional = todayTasks?.find((t) => t.isProvisional && t.status !== "done");
    if (provisional) await finishDailyTask(provisional);
    await setProvisionalEnabledStr("false");
  }

  async function finishAllUnfinished() {
    for (const t of unfinishedTasks) {
      await finishDailyTask(t);
    }
  }

  return (
    <div>
      <ThemeInit />
      <VisualModeInit />
      <AccessibilityInit />
      <StoragePersistInit />
      <AutoBackupInit />
      <LobotomyOverrunWatcher />
      <ToastHost />
      <ConfettiHost />
      <OnboardingGuide />
      <CommandPalette
        tabs={tabs}
        onChangeTab={setActive}
        onOpenTodoDetail={(taskId) => {
          setPendingTodoDetailId(taskId);
          setActive("todo");
        }}
        onOpenProjectEdit={(projectId) => {
          setPendingProjectEditId(projectId);
          setActive("projects");
        }}
      />
      <OrphanTaskModal />
      <TodoReminderModal
        onViewDetail={(taskId) => {
          setPendingTodoDetailId(taskId);
          setActive("todo");
        }}
      />
      <TodoReminderPopup
        onViewDetail={(taskId) => {
          setPendingTodoDetailId(taskId);
          setActive("todo");
        }}
      />
      {/* モード選択メニュー中はタブ列を隠し、メニューだけを見せる。
          タブへ入ったら、タブ列の上に「◀ メニュー」を出して戻れるようにする */}
      {showMenu ? (
        <MainMenuSection
          onEnter={(tab) => {
            setActive(tab);
            setMenuOpen(false);
          }}
        />
      ) : (
        <>
          {useMainMenu && (
            <button
              className="btn-pill-outline mb-1 self-start text-xs"
              onClick={() => setMenuOpen(true)}
            >
              ◀ メニュー
            </button>
          )}
          {groupTabs ? (
            <GroupedTabNav tabs={tabs} active={active} onChange={setActive} />
          ) : (
            <TabNav tabs={tabs} active={active} onChange={setActive} />
          )}
        </>
      )}
      {/* 本日の作業は、他のタブ・メニュー画面・独自の画面に差し替えるモードの間も裏で動かし続ける。
          予定の時刻の自動開始・時間割の終わり・休憩の強制停止・未計測の自動計測・位置情報・通知は
          この画面の中にあり、以前は「今日」を開いている間しか動いていなかった(戻った時刻に遅れて
          開始され、記録の時刻がずれていた) */}
      <div hidden={!todaySectionShown}>
        <SectionBoundary label="本日の作業">
        <TodaySection
          background={!todaySectionShown}
          onOpenTodoDetail={(taskId) => {
            setPendingTodoDetailId(taskId);
            setActive("todo");
          }}
          onOpenProjectEdit={(projectId) => {
            setPendingProjectEditId(projectId);
            setActive("projects");
          }}
          onOpenMemo={() => setActive("memo")}
          onOpenTodoTab={() => setActive("todo")}
        />
        </SectionBoundary>
      </div>
      {!showMenu && (
      // タブごとに失敗を受け止める(読み込みの失敗・1画面の不具合でアプリ全体と裏の自動処理を止めない)。
      // タブを切り替えると受け止めた状態もリセットされる
      <SectionBoundary key={active}>
      {active === "today" && mode === "claude" && <ClaudeWorkspaceSection onOpenInsights={() => setActive("aggregation")} />}
      {active === "today" && mode === "natsuyasumi" && (
        <div className="space-y-4">
          <NatsuyasumiSection />
          <NatsuyasumiPanels />
        </div>
      )}
      {active === "today" && mode === "zen" && (
        <>
          <ZenSection />
          <ZenPanels />
        </>
      )}
      {active === "today" && mode === "terminal" && <TerminalDashboardSection />}
      {active === "today" && mode === "adventurer" && (
        <div className="space-y-4">
          <AdventurerQuestSection />
          <OverdueTodoPanel variant="adventurer" />
        </div>
      )}
      {active === "today" && mode === "hub" && <HubTimelineStrip />}
      {active === "today" && mode === "hub" && (
        <UnifiedBoardSection
          onOpenTodo={() => setActive("todo")}
          onOpenTodoDetail={(taskId) => {
            setPendingTodoFilterId(taskId);
            setActive("todo");
          }}
          onOpenProjectEdit={(projectId) => {
            setPendingProjectEditId(projectId);
            setActive("projects");
          }}
        />
      )}
      {active === "today" && mode === "powerpro" && (
        <div className="space-y-4">
          <PowerproTrainingSection />
          <PowerproInjuryPanel />
        </div>
      )}
      {active === "today" && mode === "mountain" && (
        <div className="space-y-4">
          <MountainSection />
          <MountainPlanPanel />
        </div>
      )}
      {active === "today" && mode === "hayarigami" && (
        <div className="space-y-4">
          <HayarigamiSection />
          <HayarigamiDeductionPanel />
        </div>
      )}
      {active === "today" && mode === "lobotomy" && (
        <div className="space-y-4">
          <OverdueTodoPanel variant="lobotomy" />
          <LobotomySection />
        </div>
      )}
      {active === "today" && mode === "library" && (
        <div className="space-y-4">
          <LibrarySection />
          <LibraryCounterPanel />
        </div>
      )}
      {active === "today" && mode === "origin" && <OriginSheetSection onOpenTodo={() => setActive("todo")} />}
      {active === "todo" && (
        <TodoSection
          initialDetailTaskId={pendingTodoDetailId}
          onInitialDetailConsumed={() => setPendingTodoDetailId(null)}
          initialFilterTaskId={pendingTodoFilterId}
          onInitialFilterConsumed={() => setPendingTodoFilterId(null)}
        />
      )}
      {active === "projects" && (
        <ProjectsSection
          onAddedToToday={(startedNow) => {
            // 「すぐに開始する」で追加した場合は、本日の作業タブを開いた時に
            // 実行中の一覧がすぐ見えるよう、表示中のタブも合わせて切り替える
            if (startedNow) db.settings.put({ key: "today.taskViewTab", value: "running" });
            setActive("today");
          }}
          initialEditProjectId={pendingProjectEditId}
          onInitialEditConsumed={() => setPendingProjectEditId(null)}
        />
      )}
      {active === "master" && <MasterSection />}
      {active === "homeMaster" && <HomeMasterSection />}
      {active === "template" && <TemplateSection />}
      {active === "gantt" && <GanttSection />}
      {active === "aggregation" && mode === "adventurer" && <AdventurerStatusSection />}
      {active === "aggregation" && mode === "claude" && <ClaudeInsightsSection />}
      {active === "aggregation" && mode !== "adventurer" && mode !== "claude" && <AggregationSection />}
      {active === "charts" && <ChartsSection />}
      {active === "heatmap" && <HeatmapSection />}
      {active === "attention" && <AttentionSection />}
      {active === "overtime" && <OvertimeSection />}
      {active === "yearlyChart" && <YearlyChartSection />}
      {active === "mandala" && (
        <MandalaSection
          onOpenTodoDetail={(taskId) => {
            setPendingTodoDetailId(taskId);
            setActive("todo");
          }}
        />
      )}
      {active === "memo" && <MemoSection />}
      {active === "board" && (
        <UnifiedBoardSection
          onOpenTodo={() => setActive("todo")}
          onOpenTodoDetail={(taskId) => {
            setPendingTodoFilterId(taskId);
            setActive("todo");
          }}
          onOpenProjectEdit={(projectId) => {
            setPendingProjectEditId(projectId);
            setActive("projects");
          }}
        />
      )}
      {active === "observatory" && <ObservatorySection />}
      {active === "report" && mode === "claude" && <ClaudeReportSection />}
      {active === "report" && mode !== "claude" && (
        <ReportSection
          onOpenTodoDetail={(taskId) => {
            setPendingTodoDetailId(taskId);
            setActive("todo");
          }}
        />
      )}
      {active === "records" && <RecordsSection />}
      {active === "appearance" && <AppearanceSection />}
      {active === "settings" && <SettingsSection />}
      </SectionBoundary>
      )}

      {showCloseCheck && (
        <Modal title="アプリを閉じますか?" onClose={() => setShowCloseCheck(false)}>
          <div className="space-y-3 text-sm text-cream/80">
            {provisionalEnabled && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>未計測の自動計測がONになっています。</span>
                <button className="btn-pill-outline text-xs" onClick={turnOffProvisional}>
                  OFFにする
                </button>
              </div>
            )}
            {unfinishedTasks.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>本日の未完了の作業が{unfinishedTasks.length}件あります。</span>
                <button className="btn-pill-outline text-xs" onClick={finishAllUnfinished}>
                  すべて完了にする
                </button>
              </div>
            )}
            {!provisionalEnabled && unfinishedTasks.length === 0 && (
              <p className="text-cream/50">対応する項目はありません。そのまま閉じて大丈夫です。</p>
            )}
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn-pill text-sm" onClick={() => setShowCloseCheck(false)}>
              閉じる
            </button>
          </div>
        </Modal>
      )}
      {showStampDock && <QuickStampDock toolsLabel={TOOLS_LABEL_BY_MODE[mode] ?? "道具"} />}
      {showStampDock && <RunningNowPill />}
    </div>
  );
}
