"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import { pickTodayHint } from "@/lib/todayHint";

// 要注意リストタブにしか出ていなかった分析結果から、今この瞬間に効くものを1つだけ
// 本日タブへ返す。出すのは常に1件で、該当が無ければ何も出さない
export default function TodayHintPanel() {
  const recordsRaw = useLiveQuery(() => db.records.toArray(), []);
  const records = useHomeFilteredRecords(recordsRaw);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.toArray(), []);

  // 時間帯をまたいだら中身も変わるべきなので、時だけ見張る(分単位の精度は要らない)
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = window.setInterval(() => setHour(new Date().getHours()), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const hint = useMemo(() => {
    if (!records || !masterTasks || !conditionLogs) return null;
    return pickTodayHint({ records, masterTasks, conditionLogs, now: new Date() });
    // hourは「時間帯が変わったら選び直す」ためだけの依存
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, masterTasks, conditionLogs, hour]);

  if (!hint) return null;

  return (
    <div
      className={`panel p-3 ${hint.tone === "caution" ? "border border-alert/40" : "border border-cream/15"}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true">{hint.icon}</span>
        <div className="min-w-0">
          <p className={`text-sm font-bold ${hint.tone === "caution" ? "text-alert" : "text-cream"}`}>
            {hint.title}
          </p>
          <p className="mt-0.5 text-xs text-cream/60">{hint.body}</p>
        </div>
      </div>
    </div>
  );
}
