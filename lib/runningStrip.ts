"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { computePredictedSecondsByTaskId, computeRunningOverrunTaskIds, segmentsAccumulatedMs } from "./tasks";
import { formatHms, todayStr } from "./time";

// 下部のタブバーは「実行中(3)」のように件数しか出さないため、何を計測しているのか・
// どれだけ経ったのかは一覧まで見に行かないと分からなかった。
// 計測中の作業を1件だけ帯で出すための材料をここで作る。
//
// 複数を並行して計測している場合に出すのは「いちばん長く回っているもの」。
// 止め忘れはたいてい最長のものなので、そちらを見せた方が気付ける
// (1件しか動いていない通常のケースではどちらを選んでも同じ)。
export interface RunningStripInfo {
  /** 作業名 */
  name: string;
  /** 業務区分 */
  category: string;
  /** 経過時間(00:12:34) */
  elapsedLabel: string;
  /** これ以外に計測中の作業が何件あるか */
  extraCount: number;
  /** この作業が想定時間を超過しているか */
  overrun: boolean;
}

export function useRunningTaskStrip(): RunningStripInfo | null {
  const date = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const running = (tasks ?? []).filter((t) => t.status === "running");
  const hasRunning = running.length > 0;

  // 経過時間を進めるための時計。計測中が無い間はタイマーごと止める
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasRunning) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  if (!hasRunning) return null;

  // 想定時間を超過している作業がある場合は、放置に気づけるようそちらを優先して出す
  // (無ければ従来通り、単に一番長く回っているものを出す)
  const predictedSecondsByTaskId = computePredictedSecondsByTaskId(tasks ?? [], masterTasks ?? [], now);
  const overrunIds = new Set(computeRunningOverrunTaskIds(tasks ?? [], predictedSecondsByTaskId, now));
  const overrunning = running.filter((t) => overrunIds.has(t.id));

  let primary: (typeof running)[number];
  if (overrunning.length > 0) {
    primary = overrunning[0];
    let worstOverBy = segmentsAccumulatedMs(primary, now) / 1000 - (predictedSecondsByTaskId.get(primary.id) ?? 0);
    for (const t of overrunning.slice(1)) {
      const overBy = segmentsAccumulatedMs(t, now) / 1000 - (predictedSecondsByTaskId.get(t.id) ?? 0);
      if (overBy > worstOverBy) {
        primary = t;
        worstOverBy = overBy;
      }
    }
  } else {
    primary = running[0];
    let longest = segmentsAccumulatedMs(primary, now);
    for (const t of running.slice(1)) {
      const ms = segmentsAccumulatedMs(t, now);
      if (ms > longest) {
        primary = t;
        longest = ms;
      }
    }
  }

  return {
    name: primary.name,
    category: primary.category,
    elapsedLabel: formatHms(Math.floor(segmentsAccumulatedMs(primary, now) / 1000)),
    extraCount: running.length - 1,
    overrun: overrunIds.has(primary.id),
  };
}
