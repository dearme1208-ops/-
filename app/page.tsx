"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useLiveQuery } from "dexie-react-hooks";
import TabNav, { TabDef } from "@/components/TabNav";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { finishDailyTask } from "@/lib/tasks";
import { todayStr } from "@/lib/time";
import Modal from "@/components/ui/Modal";
import ThemeInit from "@/components/ThemeInit";
import VisualModeInit from "@/components/VisualModeInit";
import AccessibilityInit from "@/components/AccessibilityInit";
import LobotomyOverrunWatcher from "@/components/LobotomyOverrunWatcher";
import ToastHost from "@/components/ui/ToastHost";
import ConfettiHost from "@/components/ui/ConfettiHost";
import CommandPalette from "@/components/CommandPalette";
import OrphanTaskModal from "@/components/OrphanTaskModal";
import TodoReminderModal from "@/components/TodoReminderModal";
import OnboardingGuide from "@/components/OnboardingGuide";
import { tabLabel, useVisualMode, visibleTabKeys, type TabKey } from "@/lib/theme";

const TodaySection = dynamic(() => import("@/components/sections/TodaySection"), { ssr: false });
const ClaudeWorkspaceSection = dynamic(() => import("@/components/sections/ClaudeWorkspaceSection"), { ssr: false });
const TodoSection = dynamic(() => import("@/components/sections/TodoSection"), { ssr: false });
const ProjectsSection = dynamic(() => import("@/components/sections/ProjectsSection"), { ssr: false });
const ClaudeReportSection = dynamic(() => import("@/components/sections/ClaudeReportSection"), { ssr: false });
const MasterSection = dynamic(() => import("@/components/sections/MasterSection"), { ssr: false });
const TemplateSection = dynamic(() => import("@/components/sections/TemplateSection"), { ssr: false });
const GanttSection = dynamic(() => import("@/components/sections/GanttSection"), { ssr: false });
const AggregationSection = dynamic(() => import("@/components/sections/AggregationSection"), { ssr: false });
const ChartsSection = dynamic(() => import("@/components/sections/ChartsSection"), { ssr: false });
const HeatmapSection = dynamic(() => import("@/components/sections/HeatmapSection"), { ssr: false });
const AttentionSection = dynamic(() => import("@/components/sections/AttentionSection"), { ssr: false });
const ReportSection = dynamic(() => import("@/components/sections/ReportSection"), { ssr: false });
const RecordsSection = dynamic(() => import("@/components/sections/RecordsSection"), { ssr: false });
const SettingsSection = dynamic(() => import("@/components/sections/SettingsSection"), { ssr: false });
const OvertimeSection = dynamic(() => import("@/components/sections/OvertimeSection"), { ssr: false });
const YearlyChartSection = dynamic(() => import("@/components/sections/YearlyChartSection"), { ssr: false });

const TABS: TabDef[] = [
  { key: "today", label: "本日の作業" },
  { key: "todo", label: "ToDo" },
  { key: "projects", label: "案件" },
  { key: "master", label: "作業マスタ" },
  { key: "template", label: "曜日別テンプレート" },
  { key: "gantt", label: "ガントチャート" },
  { key: "aggregation", label: "集計・ランキング" },
  { key: "charts", label: "グラフ" },
  { key: "heatmap", label: "ヒートマップ" },
  { key: "attention", label: "要注意リスト" },
  { key: "overtime", label: "残業分析" },
  { key: "yearlyChart", label: "年表" },
  { key: "report", label: "週報・月報" },
  { key: "records", label: "実績編集" },
  { key: "settings", label: "設定" },
];

export default function HomePage() {
  const [active, setActive] = useState("today");
  const [showCloseCheck, setShowCloseCheck] = useState(false);
  // 期日リマインダーポップアップの「詳細確認」から、ToDoタブへ切り替えつつ該当タスクの
  // 詳細ダイアログを開いた状態にするための橋渡し。TodoSection側で消費されたらnullに戻す
  const [pendingTodoDetailId, setPendingTodoDetailId] = useState<string | null>(null);
  // 本日タブに表示された案件バッジの「編集」から、案件タブへ切り替えつつ該当案件の
  // 編集ダイアログを開いた状態にするための橋渡し。上と同じ仕組み
  const [pendingProjectEditId, setPendingProjectEditId] = useState<string | null>(null);
  const { mode, wordingMode } = useVisualMode();
  const tabs = useMemo(() => {
    const allKeys = TABS.map((t) => t.key as TabKey);
    const visibleKeys = new Set(visibleTabKeys(mode, allKeys));
    return TABS.filter((t) => visibleKeys.has(t.key as TabKey)).map((t) => ({
      key: t.key,
      label: tabLabel(t.key, wordingMode, t.label),
    }));
  }, [mode, wordingMode]);

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
      <TabNav tabs={tabs} active={active} onChange={setActive} />
      {active === "today" && mode === "claude" && <ClaudeWorkspaceSection />}
      {active === "today" && mode !== "claude" && (
        <TodaySection
          onOpenTodoDetail={(taskId) => {
            setPendingTodoDetailId(taskId);
            setActive("todo");
          }}
          onOpenProjectEdit={(projectId) => {
            setPendingProjectEditId(projectId);
            setActive("projects");
          }}
        />
      )}
      {active === "todo" && (
        <TodoSection
          initialDetailTaskId={pendingTodoDetailId}
          onInitialDetailConsumed={() => setPendingTodoDetailId(null)}
        />
      )}
      {active === "projects" && (
        <ProjectsSection
          onAddedToToday={() => setActive("today")}
          initialEditProjectId={pendingProjectEditId}
          onInitialEditConsumed={() => setPendingProjectEditId(null)}
        />
      )}
      {active === "master" && <MasterSection />}
      {active === "template" && <TemplateSection />}
      {active === "gantt" && <GanttSection />}
      {active === "aggregation" && <AggregationSection />}
      {active === "charts" && <ChartsSection />}
      {active === "heatmap" && <HeatmapSection />}
      {active === "attention" && <AttentionSection />}
      {active === "overtime" && <OvertimeSection />}
      {active === "yearlyChart" && <YearlyChartSection />}
      {active === "report" && mode === "claude" && <ClaudeReportSection />}
      {active === "report" && mode !== "claude" && <ReportSection />}
      {active === "records" && <RecordsSection />}
      {active === "settings" && <SettingsSection />}

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
    </div>
  );
}
