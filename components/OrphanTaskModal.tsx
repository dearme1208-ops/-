"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  baseAccumulatedMs,
  findOrphanedDailyTasks,
  finishOrphanedDailyTask,
  moveDailyTaskToToday,
  segmentsAccumulatedMs,
} from "@/lib/tasks";
import { formatDateJp, formatHms, todayStr } from "@/lib/time";
import Modal from "@/components/ui/Modal";

// 「計測中」「一時停止中」のまま日をまたいで放置された作業をアプリ起動時に検出し、
// 終了するか・今日の作業として引き継ぐかをその場で選べるようにする。本日の作業タブは
// 日付ごとに絞り込んで表示するため、放置されたものは画面上からは見えなくなる一方、
// 計測中のものは内部的に時間が計測され続けてしまうため
export default function OrphanTaskModal() {
  const today = todayStr();
  const orphans = useLiveQuery(() => findOrphanedDailyTasks(today), [today]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!orphans || orphans.length === 0 || dismissed) return null;

  return (
    <Modal title="日をまたいで放置された作業があります" onClose={() => setDismissed(true)}>
      <p className="mb-3 text-sm text-cream/70">
        前日以前から「計測中」または「一時停止中」のまま残っている作業が見つかりました。本日の作業タブは日付ごとの表示のため画面には出てきませんが、計測中のものは内部的に時間が計測され続けています。それぞれ終了するか、今日の作業として引き継ぐか選んでください。
      </p>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {orphans.map((task) => {
          const elapsedMs = task.status === "running" ? segmentsAccumulatedMs(task, now) : baseAccumulatedMs(task);
          return (
            <div key={task.id} className="rounded-lg border border-alert/30 bg-ink/50 p-3">
              <div className="text-xs text-cream/50">
                {formatDateJp(task.date)}（{task.status === "running" ? "計測中" : "一時停止中"}）
              </div>
              <div className="text-sm font-bold text-cream">
                {task.category} / {task.name}
              </div>
              <div className="text-xs tabular-nums text-cream/60">経過 {formatHms(Math.round(elapsedMs / 1000))}</div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button className="btn-pill-outline text-xs" onClick={() => finishOrphanedDailyTask(task)}>
                  終了する（{formatDateJp(task.date)} 24:00で打ち切り）
                </button>
                <button className="btn-pill text-xs" onClick={() => moveDailyTaskToToday(task, today)}>
                  今日の作業として続ける
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
