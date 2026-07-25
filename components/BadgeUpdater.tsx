"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/time";
import { setAppBadge } from "@/lib/badge";

// 本日の未着手作業数をアプリアイコンのバッジに反映する
export default function BadgeUpdater() {
  const date = todayStr();
  const pendingCount = useLiveQuery(
    () => db.dailyTasks.where("date").equals(date).filter((t) => t.status === "pending").count(),
    [date]
  );

  useEffect(() => {
    if (pendingCount === undefined) return;
    setAppBadge(pendingCount);
  }, [pendingCount]);

  return null;
}
