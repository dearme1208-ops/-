"use client";

import { useState } from "react";
import type { BreakRange, DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";

// 強制ストップされた休憩帯について、「実は移動やミーティングで作業していた」場合に
// その時間帯を後から作業へ割り当てるためのダイアログ。既存の(未完了の)本日の作業へ
// 割り当てるか、その場で新しい作業として登録して割り当てるかを選べる
export default function BreakAssignDialog({
  range,
  candidateTasks,
  onAssignExisting,
  onAssignNew,
  onClose,
}: {
  range: BreakRange;
  candidateTasks: DailyTask[];
  onAssignExisting: (task: DailyTask) => void;
  onAssignNew: (category: string, workName: string) => void;
  onClose: () => void;
}) {
  const [showNewDialog, setShowNewDialog] = useState(false);

  return (
    <>
      <Modal title="休憩時間を作業に割り当てる" onClose={onClose}>
        <p className="mb-3 text-sm text-cream/70">
          {range.start}〜{range.end} は休憩扱いになっていますが、実際には移動やミーティングなどで作業していた場合、
          どの作業に割り当てますか？
        </p>
        {candidateTasks.length > 0 && (
          <div className="mb-3 space-y-2">
            {candidateTasks.map((t) => (
              <button
                key={t.id}
                className="w-full rounded-lg bg-ink/50 px-3 py-2 text-left text-sm text-cream transition hover:bg-ink/70"
                onClick={() => onAssignExisting(t)}
              >
                <div className="text-xs text-cream/50">{t.category}</div>
                <div>{t.name}</div>
              </button>
            ))}
          </div>
        )}
        <button className="btn-pill-outline w-full text-sm" onClick={() => setShowNewDialog(true)}>
          + 新しい作業として登録して割り当てる
        </button>
      </Modal>
      {showNewDialog && (
        <CategoryWorkNameDialog
          title="新しい作業を登録"
          confirmLabel="この作業に割り当てる"
          onConfirm={(category, workName) => {
            setShowNewDialog(false);
            onAssignNew(category, workName);
          }}
          onClose={() => setShowNewDialog(false)}
        />
      )}
    </>
  );
}
