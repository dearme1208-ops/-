"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useVisualMode } from "@/lib/theme";
import { computePredictedSecondsByTaskId, computeRunningOverrunTaskIds } from "@/lib/tasks";
import { todayStr } from "@/lib/time";

// ロボトミー風テーマの走査線オーバーレイ(globals.cssの.crt-scanlines)を、常時ではなく
// 予測時間を超過して計測中の作業がある時だけ点灯させるための監視役。タブに関わらず
// アプリ全体(<html>)にdata-lobotomy-warning属性を立て、globals.css側で可視化を切り替える
export default function LobotomyOverrunWatcher() {
  const { themedMode } = useVisualMode();
  const date = todayStr();
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (themedMode !== "lobotomy") return;
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, [themedMode]);

  useEffect(() => {
    if (themedMode !== "lobotomy" || !tasks || !masterTasks) {
      document.documentElement.setAttribute("data-lobotomy-warning", "false");
      return;
    }
    const predicted = computePredictedSecondsByTaskId(tasks, masterTasks, now);
    const overrunIds = computeRunningOverrunTaskIds(tasks, predicted, now);
    document.documentElement.setAttribute("data-lobotomy-warning", overrunIds.length > 0 ? "true" : "false");
  }, [themedMode, tasks, masterTasks, now]);

  return null;
}
