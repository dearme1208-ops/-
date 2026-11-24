"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  baseAccumulatedMs,
  discardOrphanedDailyTask,
  extendsPastDayEnd,
  findOrphanedDailyTasks,
  finishOrphanedDailyTask,
  finishOrphanedDailyTaskAsIs,
  finishOrphanedDailyTaskNow,
  moveDailyTaskToToday,
  segmentsAccumulatedMs,
} from "@/lib/tasks";
import { formatDateJp, formatHms } from "@/lib/time";
import { cardOverrunClass, useVisualMode } from "@/lib/theme";
import Modal from "@/components/ui/Modal";
import { db } from "@/lib/db";
import { splitOrphanAtMidnight } from "@/lib/provisionalSplit";
import { showUndoToast } from "@/lib/toast";
import { useWorkContext } from "@/lib/useWorkContext";
import { useToday } from "@/lib/useToday";

// 「計測中」「一時停止中」のまま日をまたいで放置された作業をアプリ起動時に検出し、
// 終了するか・今日の作業として引き継ぐかをその場で選べるようにする。本日の作業タブは
// 日付ごとに絞り込んで表示するため、放置されたものは画面上からは見えなくなる一方、
// 計測中のものは内部的に時間が計測され続けてしまうため
export default function OrphanTaskModal() {
  const workCtx = useWorkContext();
  const today = useToday();
  const orphans = useLiveQuery(() => findOrphanedDailyTasks(today), [today]);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const { themedMode, wordingThemedMode } = useVisualMode();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!orphans || orphans.length === 0 || dismissed) return null;

  const title =
    wordingThemedMode === "va11halla"
      ? "未回収のオーダーがあります"
      : wordingThemedMode === "persona5"
        ? "予告状：未回収の獲物がいます"
        : wordingThemedMode === "natsuyasumi"
          ? "夏休みの絵日記が途中で止まっています"
          : wordingThemedMode === "lobotomy"
              ? "収容失敗：放置された個体があります"
              : "日をまたいで放置された作業があります";
  const body =
    wordingThemedMode === "va11halla"
      ? "前の営業日から下げられていないオーダーがあります。会計を締めるか、本日分として引き続き対応するか選んでください。"
      : wordingThemedMode === "persona5"
        ? "前回の潜入から連れ帰れていないターゲットがいます。ここで回収を終えるか、本日の作戦として続行するか選んでください。"
        : wordingThemedMode === "natsuyasumi"
          ? "前の日から書きかけのまま止まっているページがあります。ここで区切りをつけるか、今日のページとして続きを書くか選んでください。"
          : wordingThemedMode === "lobotomy"
              ? "前日以前より管理番号未確定のまま放置されている個体を検知しました。収容を終了するか、本日の観測対象として引き継ぐか選択してください。"
              : "前日以前から「計測中」または「一時停止中」のまま残っている作業が見つかりました。本日の作業タブは日付ごとの表示のため画面には出てきませんが、計測中のものは内部的に時間が計測され続けています。それぞれ終了するか、今日の作業として引き継ぐか選んでください。";

  return (
    <Modal title={title} onClose={() => setDismissed(true)}>
      <p className="mb-3 text-sm text-cream/70">{body}</p>
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {orphans.map((task) => {
          const elapsedMs = task.status === "running" ? segmentsAccumulatedMs(task, now) : baseAccumulatedMs(task);
          return (
            <div
              key={task.id}
              className={`rounded-lg border border-alert/30 bg-ink/50 p-3 ${
                themedMode ? cardOverrunClass(themedMode) : ""
              }`}
            >
              <div className="text-xs text-cream/50">
                {formatDateJp(task.date)}（{task.status === "running" ? "計測中" : "一時停止中"}）
              </div>
              <div className="text-sm font-bold text-cream">
                {task.category} / {workCtx.label(task)}
              </div>
              <div className="text-xs tabular-nums text-cream/60">経過 {formatHms(Math.round(elapsedMs / 1000))}</div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {task.status === "paused" ? (
                  <>
                  {extendsPastDayEnd(task) && (
                    <button
                      className="btn-pill-outline text-xs"
                      onClick={() => finishOrphanedDailyTask(task)}
                      title="今日の作業を始めた時に自動で一時停止した作業を、元の日の24:00までの分だけで完了にします"
                    >
                      終了する（{formatDateJp(task.date)} 24:00で打ち切り）
                    </button>
                  )}
                  {extendsPastDayEnd(task) && (
                    <button
                      className="btn-pill-outline text-xs"
                      onClick={() => splitOrphanAtMidnight(task, today)}
                      title="前の日の分は24:00で完了にし、0:00からの分を今日の作業として残します"
                    >
                      0時で分ける
                    </button>
                  )}
                  <button
                    className="btn-pill-outline text-xs"
                    onClick={() => finishOrphanedDailyTaskAsIs(task)}
                    title="一時停止した時点の実測時間のまま、追加の計測なしで完了にします"
                  >
                    そのまま完了する（{formatDateJp(task.date)}実績として）
                  </button>
                  </>
                ) : (
                  <>
                    <button className="btn-pill-outline text-xs" onClick={() => finishOrphanedDailyTask(task)}>
                      終了する（{formatDateJp(task.date)} 24:00で打ち切り）
                    </button>
                    <button
                      className="btn-pill-outline text-xs"
                      onClick={() => splitOrphanAtMidnight(task, today)}
                      title="前の日の分は24:00で完了にし、今日の0:00から同じ作業の続きを計測します"
                    >
                      0時で分ける（今日の分は計測を続ける）
                    </button>
                    <button
                      className="btn-pill-outline text-xs"
                      onClick={() => finishOrphanedDailyTaskNow(task)}
                      title="睡眠など日をまたいで続いていた作業を、今の時刻まで計測して前日の実績にします"
                    >
                      今の時刻で完了（{formatDateJp(task.date)}実績として計測）
                    </button>
                  </>
                )}
                <button
                  className="btn-pill-outline text-xs text-alert"
                  onClick={async () => {
                    // 確認は出さずに消し、「元に戻す」で消す前の作業(計測の区切りも含めて)をそのまま戻す
                    const snapshot = await db.dailyTasks.get(task.id);
                    await discardOrphanedDailyTask(task);
                    if (!snapshot) return;
                    showUndoToast(`「${workCtx.label(task)}」を記録せず削除しました`, async () => {
                      // 同じ作業がもう作り直されていたら、古い控えで上書きしない
                      if (!(await db.dailyTasks.get(snapshot.id))) await db.dailyTasks.add(snapshot);
                    });
                  }}
                >
                  記録せず削除
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
