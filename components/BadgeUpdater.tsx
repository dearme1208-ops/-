"use client";

import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { setAppBadge } from "@/lib/badge";
import { useToday } from "@/lib/useToday";

// 本日の未着手作業数をアプリアイコンのバッジに反映する
export default function BadgeUpdater() {
  const date = useToday();
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
