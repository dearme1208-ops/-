"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import TabNav, { TabDef } from "@/components/TabNav";

const TodaySection = dynamic(() => import("@/components/sections/TodaySection"), { ssr: false });
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

const TABS: TabDef[] = [
  { key: "today", label: "本日の作業" },
  { key: "projects", label: "案件" },
  { key: "master", label: "作業マスタ" },
  { key: "template", label: "曜日別テンプレート" },
  { key: "gantt", label: "ガントチャート" },
  { key: "aggregation", label: "集計・ランキング" },
  { key: "charts", label: "グラフ" },
  { key: "heatmap", label: "ヒートマップ" },
  { key: "attention", label: "要注意リスト" },
  { key: "report", label: "週報・月報" },
  { key: "records", label: "実績編集" },
];

export default function HomePage() {
  const [active, setActive] = useState("today");

  return (
    <div>
      <TabNav tabs={TABS} active={active} onChange={setActive} />
      {active === "today" && <TodaySection />}
      {active === "projects" && <ProjectsSection />}
      {active === "master" && <MasterSection />}
      {active === "template" && <TemplateSection />}
      {active === "gantt" && <GanttSection />}
      {active === "aggregation" && <AggregationSection />}
      {active === "charts" && <ChartsSection />}
      {active === "heatmap" && <HeatmapSection />}
      {active === "attention" && <AttentionSection />}
      {active === "report" && <ReportSection />}
      {active === "records" && <RecordsSection />}
    </div>
  );
}
