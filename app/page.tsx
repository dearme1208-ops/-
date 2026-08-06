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

const TodaySection = dynamic(() => import("@/components/sections/TodaySection"), { ssr: false });
const TodoSection = dynamic(() => import("@/components/sections/TodoSection"), { ssr: false });
const ProjectsSection = dynamic(() => import("@/components/sections/ProjectsSection"), { ssr: false });
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
  { key: "report", label: "週報・月報" },
  { key: "records", label: "実績編集" },
  { key: "settings", label: "設定" },
];

export default function HomePage() {
  const [active, setActive] = useState("today");
  const [showCloseCheck, setShowCloseCheck] = useState(false);

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
      <TabNav tabs={TABS} active={active} onChange={setActive} />
      {active === "today" && <TodaySection />}
      {active === "todo" && <TodoSection />}
      {active === "projects" && <ProjectsSection onAddedToToday={() => setActive("today")} />}
      {active === "master" && <MasterSection />}
      {active === "template" && <TemplateSection />}
      {active === "gantt" && <GanttSection />}
      {active === "aggregation" && <AggregationSection />}
      {active === "charts" && <ChartsSection />}
      {active === "heatmap" && <HeatmapSection />}
      {active === "attention" && <AttentionSection />}
      {active === "overtime" && <OvertimeSection />}
      {active === "report" && <ReportSection />}
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
