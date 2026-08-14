"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import { useSetting } from "@/lib/settings";

interface Step {
  icon: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: "👋",
    title: "工程表へようこそ",
    body: "作業時間の記録から集計・レポートまでを行える工程表アプリです。データはすべてこの端末の中だけに保存され、外部サーバーへは送信されません。数ステップで主要な使い方をご案内します。",
  },
  {
    icon: "⏱",
    title: "本日の作業",
    body: "その日にやる作業を並べ、開始/終了ボタンで時間を計測します。作業マスタや曜日別テンプレートから自動で並べることもできます。",
  },
  {
    icon: "✅",
    title: "ToDo・案件",
    body: "「ToDo」タブでは期日つきのタスクを管理でき、「案件」タブでは複数日にまたがる案件の進捗や段階を管理できます。どちらも本日の作業に追加して計測できます。",
  },
  {
    icon: "📊",
    title: "集計・レポート",
    body: "「集計・ランキング」「グラフ」「ヒートマップ」「要注意リスト」などのタブで、蓄積した記録を様々な角度から振り返れます。「週報・月報」では期間ごとのレポートも自動生成されます。",
  },
  {
    icon: "⚙️",
    title: "設定",
    body: "「設定」タブでは演出テーマの切り替えや、バックアップの書き出し・他端末への共有、通知のオンオフなどを行えます。困ったときはまずここを確認してください。",
  },
];

export default function OnboardingGuide() {
  const [completed, setCompleted] = useSetting("onboarding.completed", "false");
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  if (completed === "true" || dismissedThisSession) return null;

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  function finish() {
    setDismissedThisSession(true);
    setCompleted("true");
  }

  return (
    <Modal title={`${step.icon} ${step.title}`} onClose={finish}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-cream/80">{step.body}</p>
        <div className="flex items-center justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i === stepIndex ? "bg-alert" : "bg-cream/20"}`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button className="text-xs text-cream/50 hover:text-cream/80" onClick={finish}>
            スキップ
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button className="btn-pill-outline text-sm" onClick={() => setStepIndex((i) => i - 1)}>
                戻る
              </button>
            )}
            {isLast ? (
              <button className="btn-pill text-sm" onClick={finish}>
                はじめる
              </button>
            ) : (
              <button className="btn-pill text-sm" onClick={() => setStepIndex((i) => i + 1)}>
                次へ
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
