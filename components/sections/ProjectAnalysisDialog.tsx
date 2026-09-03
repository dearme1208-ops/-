"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import type { ProjectItem } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 案件を1つの「事業」に見立てて書き込む、定番の経営分析フレームワーク(SWOT/BSC/3C)。
// ITパスポート試験のストラテジ系にもよく出る定番3つを、案件編集とは別の軽量な
// メモ欄として持たせている(数値の自動集計はせず、あくまで自由記述のワークシート)
type AnalysisTab = "swot" | "bsc" | "threeC";

const DEFAULT_SWOT = { strengths: "", weaknesses: "", opportunities: "", threats: "" };
const DEFAULT_BSC = { financial: "", customer: "", process: "", growth: "" };
const DEFAULT_THREE_C = { customer: "", competitor: "", company: "" };

function AnalysisField({
  label,
  hint,
  value,
  onChange,
  toneClass,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  toneClass: string;
}) {
  return (
    <div className={`rounded-lg border p-2 ${toneClass}`}>
      <p className="mb-1 text-xs font-bold text-cream/80">{label}</p>
      <p className="mb-1 text-[10px] text-cream/40">{hint}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full resize-none rounded-md border border-cream/10 bg-ink/50 p-2 text-xs text-cream focus:outline-none"
        placeholder="箇条書きでOK"
      />
    </div>
  );
}

export default function ProjectAnalysisDialog({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  const [tab, setTab] = useState<AnalysisTab>("swot");
  const [swot, setSwot] = useState(project.swot ?? DEFAULT_SWOT);
  const [bsc, setBsc] = useState(project.bsc ?? DEFAULT_BSC);
  const [threeC, setThreeC] = useState(project.threeC ?? DEFAULT_THREE_C);

  async function save() {
    await db.projects.update(project.id, { swot, bsc, threeC });
    onClose();
  }

  return (
    <Modal title={`案件分析: ${project.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <button className={tab === "swot" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTab("swot")}>
            SWOT分析
          </button>
          <button className={tab === "bsc" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTab("bsc")}>
            BSC(バランススコアカード)
          </button>
          <button className={tab === "threeC" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTab("threeC")}>
            3C分析
          </button>
        </div>

        {tab === "swot" && (
          <div className="space-y-2">
            <p className="text-xs text-cream/50">
              内部要因(強み・弱み)と外部要因(機会・脅威)の2軸4象限で、この案件を取り巻く状況を整理します。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <AnalysisField
                label="強み (Strengths)"
                hint="この案件で有利に働く、自分たち側の強み"
                value={swot.strengths}
                onChange={(v) => setSwot((s) => ({ ...s, strengths: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="弱み (Weaknesses)"
                hint="この案件で不利に働く、自分たち側の弱み"
                value={swot.weaknesses}
                onChange={(v) => setSwot((s) => ({ ...s, weaknesses: v }))}
                toneClass="border-alert/20 bg-alert/[0.04]"
              />
              <AnalysisField
                label="機会 (Opportunities)"
                hint="追い風になりそうな、外部の状況変化"
                value={swot.opportunities}
                onChange={(v) => setSwot((s) => ({ ...s, opportunities: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="脅威 (Threats)"
                hint="向かい風になりそうな、外部の状況変化"
                value={swot.threats}
                onChange={(v) => setSwot((s) => ({ ...s, threats: v }))}
                toneClass="border-alert/20 bg-alert/[0.04]"
              />
            </div>
          </div>
        )}

        {tab === "bsc" && (
          <div className="space-y-2">
            <p className="text-xs text-cream/50">
              財務だけでなく4つの視点から目標・指標をバランスよく整理する、バランススコアカードの考え方です。
            </p>
            <div className="space-y-2">
              <AnalysisField
                label="財務の視点"
                hint="売上・コスト・利益など、お金に関する目標"
                value={bsc.financial}
                onChange={(v) => setBsc((s) => ({ ...s, financial: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="顧客の視点"
                hint="満足度・信頼・継続受注など、顧客に関する目標"
                value={bsc.customer}
                onChange={(v) => setBsc((s) => ({ ...s, customer: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="内部プロセスの視点"
                hint="品質・納期・作業の効率化など、進め方に関する目標"
                value={bsc.process}
                onChange={(v) => setBsc((s) => ({ ...s, process: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="学習と成長の視点"
                hint="スキルアップ・ノウハウの蓄積など、次につながる目標"
                value={bsc.growth}
                onChange={(v) => setBsc((s) => ({ ...s, growth: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
            </div>
          </div>
        )}

        {tab === "threeC" && (
          <div className="space-y-2">
            <p className="text-xs text-cream/50">顧客・競合・自社の3つの視点から、この案件の位置づけを整理します。</p>
            <div className="space-y-2">
              <AnalysisField
                label="Customer (顧客・市場)"
                hint="相手が本当に求めていること、市場の動き"
                value={threeC.customer}
                onChange={(v) => setThreeC((s) => ({ ...s, customer: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="Competitor (競合)"
                hint="比較される相手・代替手段"
                value={threeC.competitor}
                onChange={(v) => setThreeC((s) => ({ ...s, competitor: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
              <AnalysisField
                label="Company (自社)"
                hint="自分たちが持っている強み・リソース"
                value={threeC.company}
                onChange={(v) => setThreeC((s) => ({ ...s, company: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
              />
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}
