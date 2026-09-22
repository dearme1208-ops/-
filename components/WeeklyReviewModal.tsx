"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { buildWeeklyReviewQueue, type ReviewItem } from "@/lib/weeklyReview";
import { formatDateJp, shiftDateStr, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";

// 大量のToDo・案件を抱えていると、期日切れ・期日未設定のまま放置された項目が
// 一覧に埋もれて見逃されがちになる。ここでは一括選択ではなく、対象を1件ずつ見せて
// 「今日やる/期日を変える/もう追わない(アーカイブ)/今は決めない」をその場で選べる
// ガイド付きの棚卸しフローにする(GTDの週次レビューに近い考え方)
export default function WeeklyReviewModal({ onClose }: { onClose: () => void }) {
  const today = todayStr();
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  // キューは開いた時点のスナップショットで固定する。レビュー中に他の項目の状態が
  // 動いて対象の並びがガクガク変わると、落ち着いて見直せなくなるため
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  useEffect(() => {
    if (queue !== null || !todoTasks || !projects) return;
    setQueue(buildWeeklyReviewQueue(todoTasks, projects, today));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoTasks, projects]);

  const [index, setIndex] = useState(0);
  const current = queue?.[index];

  function advance() {
    setIndex((i) => i + 1);
  }

  async function handleMyDay() {
    if (!current || current.kind !== "todo") return;
    await db.todoTasks.update(current.id, { myDayDate: today });
    showUndoToast(`「${current.title}」を本日のマイデイに追加しました`, async () => {
      await db.todoTasks.update(current.id, { myDayDate: undefined });
    });
    advance();
  }

  async function handleReschedule(days: number) {
    if (!current) return;
    const newDate = shiftDateStr(today, days);
    if (current.kind === "todo") {
      await db.todoTasks.update(current.id, { dueDate: newDate });
    } else {
      await db.projects.update(current.id, { dueDate: newDate });
    }
    showUndoToast(`「${current.title}」の期日を${formatDateJp(newDate)}に変更しました`);
    advance();
  }

  async function handleArchive() {
    if (!current) return;
    if (current.kind === "todo") {
      await db.todoTasks.update(current.id, { archived: true });
    } else {
      await db.projects.update(current.id, { archived: true });
    }
    showUndoToast(`「${current.title}」をアーカイブしました`, async () => {
      if (current.kind === "todo") await db.todoTasks.update(current.id, { archived: false });
      else await db.projects.update(current.id, { archived: false });
    });
    advance();
  }

  if (queue === null) {
    return (
      <Modal title="週次レビュー" onClose={onClose}>
        <p className="text-sm text-cream/60">対象を集計しています…</p>
      </Modal>
    );
  }

  if (queue.length === 0) {
    return (
      <Modal title="週次レビュー" onClose={onClose}>
        <p className="text-sm text-cream/70">🎉 期日切れ・放置されたToDo・案件はありません。</p>
      </Modal>
    );
  }

  if (!current) {
    return (
      <Modal title="週次レビュー" onClose={onClose}>
        <p className="mb-4 text-sm text-cream/80">お疲れさまでした。{queue.length}件を見直しました。</p>
        <button className="btn-pill text-sm" onClick={onClose}>
          閉じる
        </button>
      </Modal>
    );
  }

  return (
    <Modal title={`週次レビュー（${index + 1}/${queue.length}）`} onClose={onClose}>
      <div className="space-y-4">
        <div className="panel border border-alert/30 p-4">
          <div className="mb-1 flex items-center gap-2 text-xs text-cream/50">
            <span>{current.kind === "todo" ? "✅ ToDo" : "📁 案件"}</span>
            {current.subtitle && <span>{current.subtitle}</span>}
          </div>
          <div className="text-lg font-bold text-cream">{current.title}</div>
          <div className="mt-2 text-sm font-bold text-alert">
            {current.reason === "overdue"
              ? `⚠ 期日 ${current.dueDate ? formatDateJp(current.dueDate) : ""}（${current.daysOverdue}日超過）`
              : `😴 期日未設定のまま${current.daysSinceCreated}日放置`}
          </div>
        </div>

        <div className="space-y-2">
          {current.kind === "todo" && (
            <button className="btn-pill w-full text-sm" onClick={handleMyDay}>
              ☀ 今日やる（マイデイに追加）
            </button>
          )}
          <div className="flex gap-2">
            <button className="btn-pill-outline flex-1 text-sm" onClick={() => handleReschedule(1)}>
              明日に変更
            </button>
            <button className="btn-pill-outline flex-1 text-sm" onClick={() => handleReschedule(7)}>
              1週間後に変更
            </button>
          </div>
          <button className="btn-pill-outline w-full text-sm" onClick={handleArchive}>
            🗄 もう追わない（アーカイブ）
          </button>
          <button className="w-full text-xs text-cream/50 hover:text-cream" onClick={advance}>
            スキップ（今は決めない）
          </button>
        </div>
      </div>
    </Modal>
  );
}
