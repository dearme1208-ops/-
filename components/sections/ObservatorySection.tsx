"use client";

import dynamic from "next/dynamic";
import { useSetting } from "@/lib/settings";

// 「観測所」タブ。既存のタブが実績を表・グラフとして読ませる場所なのに対して、
// ここは同じ実績データを全く別の姿(年輪・生体モニタ・新聞・鉄道ダイヤ等)に変換して
// 見せるための場所。どの観測法も新しいデータは持たず、既存の記録だけから描く
const TreeRingsView = dynamic(() => import("@/components/observatory/TreeRingsView"), { ssr: false });
const VitalMonitorView = dynamic(() => import("@/components/observatory/VitalMonitorView"), { ssr: false });
const NewspaperView = dynamic(() => import("@/components/observatory/NewspaperView"), { ssr: false });
const TrainDiagramView = dynamic(() => import("@/components/observatory/TrainDiagramView"), { ssr: false });
const StrataView = dynamic(() => import("@/components/observatory/StrataView"), { ssr: false });
const WorkWeatherView = dynamic(() => import("@/components/observatory/WorkWeatherView"), { ssr: false });
const OrbitView = dynamic(() => import("@/components/observatory/OrbitView"), { ssr: false });
const SoundtrackView = dynamic(() => import("@/components/observatory/SoundtrackView"), { ssr: false });
const MetroMapView = dynamic(() => import("@/components/observatory/MetroMapView"), { ssr: false });
const ParallelWorldView = dynamic(() => import("@/components/observatory/ParallelWorldView"), { ssr: false });

interface ObservatoryDef {
  key: string;
  label: string;
  /** 一覧のタイルに出す一行の説明。何を何に変換して見せるのかだけを書く */
  summary: string;
}

const OBSERVATORIES: ObservatoryDef[] = [
  { key: "treeRings", label: "🪵 年輪", summary: "これまでの全記録を1枚の木の断面図に。月ごとの年輪の太さが作業時間" },
  { key: "vital", label: "💓 生体モニタ", summary: "今の負荷を心電図として常時表示。期限切れが増えると警報状態になる" },
  { key: "newspaper", label: "📰 朝刊一面", summary: "その日の実績を新聞の一面として自動組版する" },
  { key: "diagram", label: "🚆 運行図表", summary: "1日の作業を、鉄道のダイヤグラム(スジ)として引く" },
  { key: "strata", label: "⛏ 地層", summary: "手つかずの期間が長いToDoほど深く埋まる、先送りの地層断面" },
  { key: "weather", label: "🌦 業務天気予報", summary: "この先の期日の混み具合を週間天気予報として出す" },
  { key: "orbit", label: "🪐 軌道", summary: "案件を惑星、ToDoを衛星として公転させる。期限切れは軌道が崩れる" },
  { key: "soundtrack", label: "🎵 サウンドトラック", summary: "1日の実績を音楽に変換して再生する。カテゴリごとに音色が変わる" },
  { key: "metro", label: "🚇 路線図", summary: "案件を路線、段階を駅として地下鉄の路線図に描く" },
  { key: "parallel", label: "🌓 並行世界", summary: "理想通りに働いた並行世界の自分と、現実の自分の差を並べて見る" },
];

export default function ObservatorySection() {
  const [current, setCurrent] = useSetting("observatory.current", "treeRings");
  const def = OBSERVATORIES.find((o) => o.key === current) ?? OBSERVATORIES[0];

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="mb-1 font-display text-base font-bold">🔭 観測所</h3>
        <p className="mb-3 text-xs text-cream/50">
          同じ実績データを、表やグラフとは違う姿に変換して眺めるための場所です。新しく入力するものはありません。
        </p>
        <div className="flex flex-wrap gap-1.5">
          {OBSERVATORIES.map((o) => (
            <button
              key={o.key}
              onClick={() => setCurrent(o.key)}
              className={current === o.key ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              title={o.summary}
            >
              {o.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-cream/40">{def.summary}</p>
      </div>

      {current === "treeRings" && <TreeRingsView />}
      {current === "vital" && <VitalMonitorView />}
      {current === "newspaper" && <NewspaperView />}
      {current === "diagram" && <TrainDiagramView />}
      {current === "strata" && <StrataView />}
      {current === "weather" && <WorkWeatherView />}
      {current === "orbit" && <OrbitView />}
      {current === "soundtrack" && <SoundtrackView />}
      {current === "metro" && <MetroMapView />}
      {current === "parallel" && <ParallelWorldView />}
    </div>
  );
}
