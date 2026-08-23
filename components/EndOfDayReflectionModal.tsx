"use client";

import { useState } from "react";
import { db } from "@/lib/db";
import { CONDITION_LEVELS } from "@/lib/condition";
import { serializeReflection } from "@/lib/reflection";
import { formatHms } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";
import ConditionGlyph from "@/components/ui/ConditionGlyph";

const STEPS = ["satisfaction", "bestThing", "carryOver"] as const;
type Step = (typeof STEPS)[number];

// 受動的なダッシュボードではなく、終業のタイミングで2〜3問だけ答える小さな内省の儀式。
// 1問ずつ順番に見せることで、レポート画面の自由記述欄よりも「立ち止まって振り返る」
// 感覚を出す。すべて任意で、途中でスキップして終えても良い
export default function EndOfDayReflectionModal({
  date,
  totalSeconds,
  doneCount,
  onClose,
}: {
  date: string;
  totalSeconds: number;
  doneCount: number;
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [bestThing, setBestThing] = useState("");
  const [carryOver, setCarryOver] = useState("");
  const [done, setDone] = useState(false);

  const step: Step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  function next() {
    if (isLast) {
      finish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  async function finish() {
    await db.settings.put({
      key: `reflection.daily.${date}`,
      value: serializeReflection({
        satisfaction: satisfaction ?? 3,
        bestThing: bestThing.trim(),
        carryOver: carryOver.trim(),
        answeredAt: Date.now(),
      }),
    });
    setDone(true);
    showUndoToast("🌙 今日の振り返りを保存しました");
  }

  if (done) {
    return (
      <Modal title="🌙 終業の振り返り" onClose={onClose}>
        <p className="text-sm text-cream/80">お疲れさまでした。今日の振り返りを保存しました。</p>
        <div className="mt-4 flex justify-end">
          <button className="btn-pill text-sm" onClick={onClose}>
            閉じる
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="🌙 終業の振り返り" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-cream/40">
          <span>
            今日 {doneCount}件完了・合計 {formatHms(totalSeconds)}
          </span>
          <span>
            {stepIndex + 1} / {STEPS.length}
          </span>
        </div>

        {step === "satisfaction" && (
          <div>
            <p className="mb-3 text-sm text-cream">今日の満足度は?</p>
            <div className="flex justify-between gap-2">
              {[...CONDITION_LEVELS].reverse().map((c) => (
                <button
                  key={c.level}
                  onClick={() => setSatisfaction(Number(c.level))}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-lg border py-3 ${
                    satisfaction === Number(c.level) ? "border-alert bg-alert/10" : "border-cream/15 bg-ink/40"
                  }`}
                  aria-label={c.label}
                >
                  <ConditionGlyph level={c.level} size={28} />
                  <span className="text-[10px] text-cream/50">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "bestThing" && (
          <div>
            <p className="mb-2 text-sm text-cream">今日、一番良かったことは?</p>
            <textarea
              value={bestThing}
              onChange={(e) => setBestThing(e.target.value)}
              placeholder="一言で構いません（空欄でも大丈夫です）"
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
          </div>
        )}

        {step === "carryOver" && (
          <div>
            <p className="mb-2 text-sm text-cream">明日に持ち越したいことは?</p>
            <textarea
              value={carryOver}
              onChange={(e) => setCarryOver(e.target.value)}
              placeholder="一言で構いません（空欄でも大丈夫です）"
              rows={3}
              autoFocus
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
          </div>
        )}

        <div className="flex justify-end gap-2">
          {!isLast && (
            <button className="btn-pill-outline text-sm" onClick={next}>
              スキップ
            </button>
          )}
          <button className="btn-pill text-sm" onClick={next}>
            {isLast ? "保存して終わる" : "次へ"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
