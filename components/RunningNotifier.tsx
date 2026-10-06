"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { closeRunningNotification, showRunningNotification } from "@/lib/notifications";
import { useSetting } from "@/lib/settings";
import { finishDailyTask, pauseDailyTask } from "@/lib/tasks";
import { formatClock, todayStr } from "@/lib/time";

// 計測中の作業を、アプリを閉じている間だけ通知に出しておく(画面を開いている間は出さない)。
// 通知の「⏸ 一時停止」「✓ 完了」を押すと、Service Worker(worker/index.js)がアプリを前に出して
// 操作を渡してくるので、ここで実行する。アプリが閉じていた場合は ?nact= 付きで開かれる
export default function RunningNotifier() {
  const date = todayStr();
  const [enabledStr] = useSetting("today.runningNotification", "true");
  const enabled = enabledStr === "true";
  const running = useLiveQuery(
    () => db.dailyTasks.where("date").equals(date).filter((t) => t.status === "running" && !t.isProvisional).first(),
    [date]
  );

  // アプリが裏に回ったら出し、前に戻ったら消す。計測が終わったら消す
  useEffect(() => {
    const sync = () => {
      if (!enabled || !running || document.visibilityState === "visible") {
        void closeRunningNotification().catch(() => {});
        return;
      }
      const openStart = running.segments.find((s) => s.end === undefined)?.start ?? Date.now();
      void showRunningNotification(running, formatClock(openStart)).catch(() => {});
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [enabled, running]);

  // 通知のボタンから渡された操作を実行する
  useEffect(() => {
    const act = async (action: string, taskId: string | undefined) => {
      if (!taskId) return;
      const t = await db.dailyTasks.get(taskId);
      if (!t || t.status !== "running") return;
      if (action === "pause") await pauseDailyTask(t, Date.now());
      if (action === "finish") await finishDailyTask(t);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "koutei-notification-action") void act(e.data.action, e.data.taskId);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const params = new URLSearchParams(window.location.search);
    const nact = params.get("nact");
    if (nact) {
      window.history.replaceState({}, "", window.location.pathname);
      void act(nact, params.get("task") ?? undefined);
    }
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  return null;
}
