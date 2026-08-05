import type { WorkRecord } from "./types";
import { todayStr } from "./time";

// 実績が記録されている日が連続何日続いているかを数える。
// 今日はまだ記録がなくてもストリークが途切れたとは判定しない（今日これから記録すれば伸びる余地を残す）
export function computeStreakDays(records: WorkRecord[], today: string = todayStr()): number {
  const daysWithRecords = new Set(records.filter((r) => r.seconds > 0).map((r) => r.date));
  const cursor = new Date(today + "T00:00:00");
  if (!daysWithRecords.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (daysWithRecords.has(todayStr(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
