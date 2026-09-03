"use client";

import { useState } from "react";
import { db, uid } from "@/lib/db";
import type { ProjectItem } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 案件を1つの「事業」に見立てて書き込む、定番の経営分析フレームワーク(SWOT/クロスSWOT/BSC/3C)。
// ITパスポート試験のストラテジ系にもよく出る定番を、案件編集とは別の軽量な
// メモ欄として持たせている(数値の自動集計はせず、あくまで自由記述のワークシート)。
// 書いて終わりにならないよう、どの欄も1行ずつToDoへ変換して実行に移せるようにしている
type AnalysisTab = "swot" | "crossSwot" | "bsc" | "threeC";

const DEFAULT_SWOT = { strengths: "", weaknesses: "", opportunities: "", threats: "" };
const DEFAULT_CROSS_SWOT = { aggressive: "", differentiation: "", improvement: "", defensive: "" };
const DEFAULT_BSC = { financial: "", customer: "", process: "", growth: "" };
const DEFAULT_THREE_C = { customer: "", competitor: "", company: "" };

// 案件分析の各欄から1行ずつToDoを起こす。分析専用のリストが無ければ作る
async function convertLinesToTodo(lines: string, project: ProjectItem, sourceLabel: string): Promise<number> {
  const items = lines
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (items.length === 0) return 0;
  let list = await db.todoLists.orderBy("order").first();
  if (!list) {
    list = { id: uid(), title: "タスク", order: 0, createdAt: Date.now() };
    await db.todoLists.add(list);
  }
  const now = Date.now();
  await Promise.all(
    items.map((title, i) =>
      db.todoTasks.add({
        id: uid(),
        listId: list!.id,
        title,
        notes: `案件「${project.title}」の${sourceLabel}より`,
        important: false,
        completed: false,
        order: now + i,
        createdAt: now,
        projectId: project.id,
      })
    )
  );
  return items.length;
}

function AnalysisField({
  label,
  hint,
  value,
  onChange,
  toneClass,
  onConvert,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  toneClass: string;
  onConvert: () => void;
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
      <button
        className="mt-1 text-[10px] text-cream/50 underline decoration-dotted hover:text-cream/80 disabled:opacity-40 disabled:no-underline"
        onClick={onConvert}
        disabled={!value.trim()}
      >
        → ToDoに変換(1行ずつ)
      </button>
    </div>
  );
}

export default function ProjectAnalysisDialog({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  const [tab, setTab] = useState<AnalysisTab>("swot");
  const [swot, setSwot] = useState(project.swot ?? DEFAULT_SWOT);
  const [crossSwot, setCrossSwot] = useState(project.crossSwot ?? DEFAULT_CROSS_SWOT);
  const [bsc, setBsc] = useState(project.bsc ?? DEFAULT_BSC);
  const [threeC, setThreeC] = useState(project.threeC ?? DEFAULT_THREE_C);
  const [convertMsg, setConvertMsg] = useState<string | null>(null);

  async function save() {
    await db.projects.update(project.id, { swot, crossSwot, bsc, threeC });
    onClose();
  }

  async function handleConvert(text: string, sourceLabel: string) {
    const n = await convertLinesToTodo(text, project, sourceLabel);
    setConvertMsg(n > 0 ? `「${sourceLabel}」から${n}件のToDoを追加しました` : `「${sourceLabel}」は空欄です`);
    setTimeout(() => setConvertMsg(null), 3000);
  }

  return (
    <Modal title={`案件分析: ${project.title}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button className={tab === "swot" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTab("swot")}>
            SWOT分析
          </button>
          <button
            className={tab === "crossSwot" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setTab("crossSwot")}
          >
            クロスSWOT
          </button>
          <button className={tab === "bsc" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTab("bsc")}>
            BSC(バランススコアカード)
          </button>
          <button className={tab === "threeC" ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setTab("threeC")}>
            3C分析
          </button>
        </div>

        {convertMsg && <p className="rounded-md bg-cream/10 px-2 py-1 text-[11px] text-cream/80">{convertMsg}</p>}

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
                onConvert={() => handleConvert(swot.strengths, "SWOT: 強み")}
              />
              <AnalysisField
                label="弱み (Weaknesses)"
                hint="この案件で不利に働く、自分たち側の弱み"
                value={swot.weaknesses}
                onChange={(v) => setSwot((s) => ({ ...s, weaknesses: v }))}
                toneClass="border-alert/20 bg-alert/[0.04]"
                onConvert={() => handleConvert(swot.weaknesses, "SWOT: 弱み")}
              />
              <AnalysisField
                label="機会 (Opportunities)"
                hint="追い風になりそうな、外部の状況変化"
                value={swot.opportunities}
                onChange={(v) => setSwot((s) => ({ ...s, opportunities: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(swot.opportunities, "SWOT: 機会")}
              />
              <AnalysisField
                label="脅威 (Threats)"
                hint="向かい風になりそうな、外部の状況変化"
                value={swot.threats}
                onChange={(v) => setSwot((s) => ({ ...s, threats: v }))}
                toneClass="border-alert/20 bg-alert/[0.04]"
                onConvert={() => handleConvert(swot.threats, "SWOT: 脅威")}
              />
            </div>
          </div>
        )}

        {tab === "crossSwot" && (
          <div className="space-y-2">
            <p className="text-xs text-cream/50">
              SWOTの4象限を掛け合わせ、具体的な戦略に落とし込みます(TOWS分析)。SWOT分析タブに記入してからの方が書きやすいです。
            </p>
            <div className="space-y-2">
              <AnalysisField
                label="強み × 機会 → 積極戦略"
                hint="強みを活かして機会をつかむには"
                value={crossSwot.aggressive}
                onChange={(v) => setCrossSwot((s) => ({ ...s, aggressive: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(crossSwot.aggressive, "クロスSWOT: 積極戦略")}
              />
              <AnalysisField
                label="強み × 脅威 → 差別化戦略"
                hint="強みで脅威の影響を弱めるには"
                value={crossSwot.differentiation}
                onChange={(v) => setCrossSwot((s) => ({ ...s, differentiation: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(crossSwot.differentiation, "クロスSWOT: 差別化戦略")}
              />
              <AnalysisField
                label="弱み × 機会 → 改善戦略"
                hint="弱みを補強して機会を逃さないためには"
                value={crossSwot.improvement}
                onChange={(v) => setCrossSwot((s) => ({ ...s, improvement: v }))}
                toneClass="border-alert/20 bg-alert/[0.04]"
                onConvert={() => handleConvert(crossSwot.improvement, "クロスSWOT: 改善戦略")}
              />
              <AnalysisField
                label="弱み × 脅威 → 専守・撤退戦略"
                hint="最悪の事態を避けるための備え・撤退ライン"
                value={crossSwot.defensive}
                onChange={(v) => setCrossSwot((s) => ({ ...s, defensive: v }))}
                toneClass="border-alert/20 bg-alert/[0.04]"
                onConvert={() => handleConvert(crossSwot.defensive, "クロスSWOT: 専守・撤退戦略")}
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
                onConvert={() => handleConvert(bsc.financial, "BSC: 財務の視点")}
              />
              <AnalysisField
                label="顧客の視点"
                hint="満足度・信頼・継続受注など、顧客に関する目標"
                value={bsc.customer}
                onChange={(v) => setBsc((s) => ({ ...s, customer: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(bsc.customer, "BSC: 顧客の視点")}
              />
              <AnalysisField
                label="内部プロセスの視点"
                hint="品質・納期・作業の効率化など、進め方に関する目標"
                value={bsc.process}
                onChange={(v) => setBsc((s) => ({ ...s, process: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(bsc.process, "BSC: 内部プロセスの視点")}
              />
              <AnalysisField
                label="学習と成長の視点"
                hint="スキルアップ・ノウハウの蓄積など、次につながる目標"
                value={bsc.growth}
                onChange={(v) => setBsc((s) => ({ ...s, growth: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(bsc.growth, "BSC: 学習と成長の視点")}
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
                onConvert={() => handleConvert(threeC.customer, "3C: 顧客")}
              />
              <AnalysisField
                label="Competitor (競合)"
                hint="比較される相手・代替手段"
                value={threeC.competitor}
                onChange={(v) => setThreeC((s) => ({ ...s, competitor: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(threeC.competitor, "3C: 競合")}
              />
              <AnalysisField
                label="Company (自社)"
                hint="自分たちが持っている強み・リソース"
                value={threeC.company}
                onChange={(v) => setThreeC((s) => ({ ...s, company: v }))}
                toneClass="border-cream/15 bg-cream/[0.03]"
                onConvert={() => handleConvert(threeC.company, "3C: 自社")}
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
