"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 完了済みの作業を本日の作業リストから削除する際、あわせて実績(この日の記録)・
// 作業マスタも削除するかどうかを選べる確認ダイアログ
export default function DeleteCompletedTaskDialog({
  task,
  onDelete,
  onClose,
}: {
  task: DailyTask;
  onDelete: (deleteRecord: boolean, deleteMaster: boolean) => void;
  onClose: () => void;
}) {
  const [deleteRecord, setDeleteRecord] = useState(true);
  const [deleteMaster, setDeleteMaster] = useState(true);

  // このマスタが、今日以外の日にも実績を持っているか。持っている場合、ここでマスタごと
  // 削除すると他の日から見た想定時間の平均・お気に入り登録などの情報も一緒に失われてしまうため、
  // この画面からのマスタ削除は不可にする(他の日の実績自体を消すわけではないが、
  // 「今日のこの1件を消すつもりが他の日にも影響する」誤操作を防ぐ)
  const otherDayRecordCount = useLiveQuery(async () => {
    if (!task.masterTaskId) return 0;
    return db.records
      .where("masterTaskId")
      .equals(task.masterTaskId)
      .filter((r) => r.date !== task.date)
      .count();
  }, [task.masterTaskId, task.date]);
  const canDeleteMaster = !task.masterTaskId || otherDayRecordCount === 0;
  const effectiveDeleteMaster = canDeleteMaster && deleteMaster;

  return (
    <Modal title="完了した作業を削除" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-cream">
          「{task.category} / {task.name}」を本日の作業リストから削除します。
        </p>
        <label className="flex items-start gap-2 text-sm text-cream/80">
          <input
            type="checkbox"
            checked={deleteRecord}
            onChange={(e) => setDeleteRecord(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
          />
          <span>
            実績（この日の記録）も削除する
            <span className="block text-xs text-cream/50">
              集計・ランキング・週報などから、この作業分の時間も除かれます。
            </span>
          </span>
        </label>
        <label className={`flex items-start gap-2 text-sm ${canDeleteMaster ? "text-cream/80" : "text-cream/40"}`}>
          <input
            type="checkbox"
            checked={effectiveDeleteMaster}
            disabled={!canDeleteMaster}
            onChange={(e) => setDeleteMaster(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-cream/30 bg-ink accent-cream disabled:opacity-40"
          />
          <span>
            作業マスタも削除する
            <span className="block text-xs text-cream/50">
              {canDeleteMaster
                ? "想定時間の平均・お気に入り登録など、このマスタが持つ情報が失われます。他の日の実績データ自体は消えません。"
                : "他の日にもこの作業名の実績があるため、この画面からは削除できません（「作業マスタ」タブから削除してください）。"}
            </span>
          </span>
        </label>
        <p className="text-xs text-cream/40">削除後もしばらくの間は「元に戻す」から取り消せます。</p>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill-outline text-sm" onClick={onClose}>
          キャンセル
        </button>
        <button className="btn-pill text-sm bg-alert text-cream" onClick={() => onDelete(deleteRecord, effectiveDeleteMaster)}>
          削除する
        </button>
      </div>
    </Modal>
  );
}
