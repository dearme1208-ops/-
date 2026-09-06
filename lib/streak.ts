import type { WorkRecord } from "./types";
import { todayStr } from "./time";

// 実績が記録されている日が連続何日続いているかを数える。
// 今日はまだ記録がなくてもストリークが途切れたとは判定しない（今日これから記録すれば伸びる余地を残す）。
// また、このアプリは曜日別テンプレートが月〜金しかないことからも分かるとおり平日の勤務を前提に
// しているため、記録のない土日はストリークを途切れさせず読み飛ばす（土日に働いた場合は
// その日も記録があるので、通常どおり1日として数える）。これがないと平日だけ働いている人の
// 連続記録日数が毎週末に必ず0へ戻ってしまう
export function computeStreakDays(records: WorkRecord[], today: string = todayStr()): number {
  const daysWithRecords = new Set(records.filter((r) => r.seconds > 0).map((r) => r.date));
  const cursor = new Date(today + "T00:00:00");
  if (!daysWithRecords.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  // 土日を読み飛ばし続けて無限に遡らないよう、遡る日数には上限を設ける
  for (let guard = 0; guard < 3660; guard++) {
    if (daysWithRecords.has(todayStr(cursor))) {
      streak++;
    } else {
      const dow = cursor.getDay();
      const isWeekend = dow === 0 || dow === 6;
      // 平日に記録がなければそこで途切れる。土日は記録がなくても飛ばす
      if (!isWeekend) break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
