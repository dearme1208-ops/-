"use client";

import type { ReactNode } from "react";
import { CONDITION_LEVELS } from "@/lib/condition";
import { WEEKDAY_LABELS, type DailyTask, type Weekday } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import { formatClock } from "@/lib/time";
import { useWorkContext } from "@/lib/useWorkContext";
import ConditionGlyph from "@/components/ui/ConditionGlyph";

// 本日の作業タブで、ある操作の途中にユーザーの判断を仰ぐための小さな確認ダイアログ群。
// 判断の結果どうするか(記録の書き換え)は呼び出し側が持ち、ここは表示と選択の受け渡しだけを行う

export function TemplateConfirmDialog({
  weekday,
  itemCount,
  existingCount,
  onConfirm,
  onClose,
}: {
  weekday: Weekday;
  itemCount: number;
  existingCount: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="本日の作業リストを生成" onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <p>
          {WEEKDAY_LABELS[weekday]}曜日のテンプレート（{itemCount}件）から、本日の作業リストを作成します。
        </p>
        {existingCount > 0 && (
          <p className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-alert">
            本日の作業リストには既に{existingCount}件あります。生成すると、これらは削除され進行中の記録も失われます。
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill text-sm" onClick={onConfirm}>
            生成する
          </button>
        </div>
      </div>
    </Modal>
  );
}

// 未計測(仮計測)が計測中のまま、新しい作業の開始/完了済み作業の再開をしようとした場合の確認。
// 「未計測」「二重に計測」のような仕組みの言葉ではなく、「◯時◯分から何をしていたか」を
// 具体的な時刻・長さ・作業名で聞き、選んだ結果がそのまま思い浮かぶ文言にする
export function ProvisionalConflictDialog({
  provisionalTask,
  variant,
  targetName,
  onMerge,
  onDiscard,
  onClose,
}: {
  provisionalTask: DailyTask;
  variant: "start" | "continue";
  /** これから始める(続ける)作業の名前 */
  targetName?: string;
  onMerge: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  const from = provisionalTask.startedAt ?? provisionalTask.segments[0]?.start ?? Date.now();
  const fromLabel = formatClock(from);
  const minutes = Math.max(0, Math.round((Date.now() - from) / 60000));
  const what = targetName ? `「${targetName}」` : "この作業";
  return (
    <Modal title={`${fromLabel}から、記録のない時間が続いています`} onClose={onClose}>
      <p className="mb-4 text-sm leading-relaxed text-cream/80">
        {fromLabel}から今までの<b className="text-cream">{minutes}分</b>は、何の作業か決まっていない時間として仮に計っています。
        {variant === "start" ? `${what}を始める前に、この${minutes}分をどうするか選んでください。` : `${what}を続ける前に、この${minutes}分をどうするか選んでください。`}
      </p>
      <div className="flex flex-col gap-2">
        <button className="btn-pill flex flex-col items-center gap-0.5 py-2.5 text-sm" onClick={onMerge}>
          {fromLabel}から{what}をしていた
          <span className="block text-[11px] font-normal opacity-75">この{minutes}分も{what}の時間に入れる</span>
        </button>
        <button className="btn-pill-outline flex flex-col items-center gap-0.5 py-2.5 text-sm" onClick={onDiscard}>
          今から{variant === "start" ? "始める" : "続ける"}
          <span className="block text-[11px] font-normal opacity-75">{fromLabel}〜今の{minutes}分は記録しない</span>
        </button>
        <button className="text-xs text-cream/50" onClick={onClose}>
          やめる（何もしない）
        </button>
      </div>
    </Modal>
  );
}

export function RestartChoiceDialog({
  task,
  onContinue,
  onRestartNew,
  onClose,
}: {
  task: DailyTask;
  onContinue: () => void;
  onRestartNew: () => void;
  onClose: () => void;
}) {
  const workCtx = useWorkContext();
  return (
    <Modal title="作業を再開" onClose={onClose}>
      <p className="mb-4 text-sm text-cream/80">
        「{task.category} / {workCtx.label(task)}」を再開します。直前に完了した続きから計測しますか？
        それとも新しい作業として開始しますか？
      </p>
      <div className="flex flex-col gap-2">
        <button className="btn-pill text-sm" onClick={onContinue}>
          続きから開始する（直前の記録に続けて計測）
        </button>
        <button className="btn-pill-outline text-sm" onClick={onRestartNew}>
          新しく開始する（別の記録として開始）
        </button>
        <button className="text-xs text-cream/50" onClick={onClose}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}

export function OverrunPromptDialog({
  task,
  onKeepGoing,
  onFinish,
}: {
  task: DailyTask;
  onKeepGoing: () => void;
  onFinish: () => void;
}) {
  const workCtx = useWorkContext();
  return (
    <Modal title="まだこの作業中ですか?">
      <p className="mb-4 text-sm text-cream/80">「{workCtx.label(task)}」が予測時間を大幅に超過しています。</p>
      <div className="flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={onKeepGoing}>
          続けている
        </button>
        <button className="btn-pill text-sm" onClick={onFinish}>
          終了する
        </button>
      </div>
    </Modal>
  );
}

// 当日最初の作業を始める直前に、体調を記録するか尋ねる。閉じる・スキップでも開始はする
export function ConditionStartDialog({
  onPick,
  onSkip,
}: {
  onPick: (level: string) => void;
  onSkip: () => void;
}) {
  return (
    <Modal title="体調を記録してから始めますか?" onClose={onSkip}>
      <p className="mb-3 text-sm text-cream/80">今日最初の作業を開始します。今の体調を記録しておきますか?</p>
      <div className="flex flex-wrap gap-2">
        {CONDITION_LEVELS.map((c) => (
          <button
            key={c.level}
            className="btn-pill-outline p-1.5"
            aria-label={c.label}
            title={c.label}
            onClick={() => onPick(c.level)}
          >
            <ConditionGlyph level={c.level} size={28} />
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="text-xs text-cream/50 hover:text-cream" onClick={onSkip}>
          スキップして開始
        </button>
      </div>
    </Modal>
  );
}

// 予定時刻・位置情報の到着など、自動で始めようとした作業が計測中の作業とぶつかった場合の確認
export function RunningConflictDialog({
  title,
  children,
  onResolve,
}: {
  title: string;
  children: ReactNode;
  onResolve: (startNew: boolean) => void;
}) {
  return (
    <Modal title={title} onClose={() => onResolve(false)}>
      <p className="mb-3 text-sm text-cream/80">{children}</p>
      <div className="flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={() => onResolve(false)}>
          今の作業を続ける
        </button>
        <button className="btn-pill text-sm" onClick={() => onResolve(true)}>
          一時停止して開始する
        </button>
      </div>
    </Modal>
  );
}
