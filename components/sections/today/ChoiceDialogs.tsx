"use client";

import type { ReactNode } from "react";
import { CONDITION_LEVELS } from "@/lib/condition";
import { WEEKDAY_LABELS, type DailyTask, type Weekday } from "@/lib/types";
import Modal from "@/components/ui/Modal";
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

// 未計測(仮計測)が計測中のまま、新しい作業の開始/完了済み作業の再開をしようとした場合の確認
export function ProvisionalConflictDialog({
  provisionalTask,
  variant,
  onMerge,
  onDiscard,
  onClose,
}: {
  provisionalTask: DailyTask;
  variant: "start" | "continue";
  onMerge: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="未計測(仮計測)が計測中です" onClose={onClose}>
      <p className="mb-4 text-sm text-cream/80">
        「{provisionalTask.category} / {provisionalTask.name}」として未計測の自動計測が現在進行中です。
        {variant === "start"
          ? "このまま新しい作業を開始すると二重に計測されてしまいます。どうしますか？"
          : "このまま作業を続けると二重に計測されてしまいます。どうしますか？"}
      </p>
      <div className="flex flex-col gap-2">
        <button className="btn-pill text-sm" onClick={onMerge}>
          今回の作業に合算する（未計測の開始時刻から続けて計測）
        </button>
        <button className="btn-pill-outline text-sm" onClick={onDiscard}>
          {variant === "start"
            ? "自動計測をやめる（未計測分は記録せず、今から計測開始）"
            : "自動計測をやめる（未計測分は記録せず、今から計測継続）"}
        </button>
        <button className="text-xs text-cream/50" onClick={onClose}>
          キャンセル
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
  return (
    <Modal title="作業を再開" onClose={onClose}>
      <p className="mb-4 text-sm text-cream/80">
        「{task.category} / {task.name}」を再開します。直前に完了した続きから計測しますか？
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
  return (
    <Modal title="まだこの作業中ですか?">
      <p className="mb-4 text-sm text-cream/80">「{task.name}」が予測時間を大幅に超過しています。</p>
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
