"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeTomorrowDraft } from "@/lib/tomorrowDraft";
import { formatDateJp, formatHms, shiftDateStr } from "@/lib/time";
import type { DailyTask } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export default function TomorrowDraftModal({ today, todayTasks, onClose }: { today: string; todayTasks: DailyTask[]; onClose: () => void }) {
  const targetDate = shiftDateStr(today, 1);
  const targetDow = useMemo(() => new Date(targetDate + "T12:00:00").getDay(), [targetDate]);

  const records = useLiveQuery(() => db.records.toArray(), []);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const existingTasksForTarget = useLiveQuery(() => db.dailyTasks.where("date").equals(targetDate).toArray(), [targetDate]);

  const suggestions = useMemo(() => {
    if (!records || !masterTasks || !todoTasks) return [];
    const existingKeys = new Set((existingTasksForTarget ?? []).map((t) => `${t.category}::${t.name}`));
    return computeTomorrowDraft({ targetDate, targetDow, records, masterTasks, todoTasks, todayTasks }).filter(
      (s) => !existingKeys.has(s.id)
    );
  }, [records, masterTasks, todoTasks, todayTasks, existingTasksForTarget, targetDate, targetDow]);

  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // 提案リストが決まったら、初期状態として全選択にしておく
  useEffect(() => {
    setChecked(new Set(suggestions.map((s) => s.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions.length]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applySelected() {
    const targets = suggestions.filter((s) => checked.has(s.id));
    if (targets.length === 0) return;
    const startOrder = (existingTasksForTarget ?? []).length;
    let order = startOrder;
    for (const s of targets) {
      const task: DailyTask = {
        id: uid(),
        date: targetDate,
        order: order++,
        masterTaskId: s.masterTaskId,
        category: s.category,
        name: s.name,
        estimatedSeconds: s.estimatedSeconds,
        hasPlan: s.estimatedSeconds > 0,
        status: "pending",
        segments: [],
        accumulatedMs: 0,
        isSpontaneous: true,
        todoTaskId: s.todoTaskId,
      };
      await db.dailyTasks.add(task);
    }
    setAddedIds(new Set(targets.map((s) => s.id)));
  }

  return (
    <Modal title={`🗓 ${formatDateJp(targetDate)}の下書き`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-cream/50">
          今日終わらなかった作業・この曜日によく行っている作業・期限が近いToDoから候補を集めました。追加したいものだけ選んでください。
        </p>
        {suggestions.length === 0 ? (
          <p className="text-sm text-cream/50">提案できる候補が見つかりませんでした。</p>
        ) : (
          <div className="space-y-1.5">
            {suggestions.map((s) => {
              const added = addedIds.has(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${added ? "bg-cream/5 opacity-50" : "bg-ink/50"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    disabled={added}
                    className="h-4 w-4 shrink-0 rounded border-cream/30 bg-ink accent-cream"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-cream">
                      {s.category} / {s.name}
                      {s.estimatedSeconds > 0 && <span className="ml-2 text-xs text-cream/40">目安 {formatHms(s.estimatedSeconds)}</span>}
                    </div>
                    <div className="text-[10px] text-cream/40">{s.reason}</div>
                  </div>
                  {added && <span className="shrink-0 text-xs text-cream/50">追加済み</span>}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-pill text-sm" onClick={applySelected} disabled={checked.size === 0}>
            選んだ{checked.size}件を{formatDateJp(targetDate)}に追加
          </button>
        </div>
      </div>
    </Modal>
  );
}
