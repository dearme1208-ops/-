import { db } from "./db";
import { shiftDateStr, todayStr } from "./time";

// 日付ごとに作られる「その日限り」の設定(閉じた印・処理済みの印など)。
// 何日も経つと使われないのに残り続けるので、起動時に古い分を消す。
// 日記・振り返りなど、あとで読み返す中身(journal.daily. / reflection.daily. / natsuyasumi.diary.)は対象外
export const DAILY_SETTING_PREFIXES = [
  "today.gapDismissed.",
  "today.breakStopHandled.",
  "handoff.dismissed.",
  "powerpro.rest.",
  "hayarigami.rank.",
  "hayarigami.keywords.",
] as const;

/** 何日分を残すか(今日を含めず、これより前の日付のものを消す) */
export const DAILY_SETTING_KEEP_DAYS = 7;

const LAST_RUN_KEY = "koutei.dailySettingsCleanup";

/** 消してよい古いキーか。末尾が日付(YYYY-MM-DD)で、today の KEEP_DAYS 日より前のもの */
export function isStaleDailySettingKey(key: string, today: string, keepDays = DAILY_SETTING_KEEP_DAYS): boolean {
  const prefix = DAILY_SETTING_PREFIXES.find((p) => key.startsWith(p));
  if (!prefix) return false;
  const date = key.slice(prefix.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date < shiftDateStr(today, -keepDays);
}

/** 古い日付ごとの設定を消す。消した件数を返す */
export async function cleanupDailySettings(today: string = todayStr()): Promise<number> {
  const stale: string[] = [];
  for (const prefix of DAILY_SETTING_PREFIXES) {
    const keys = (await db.settings.where("key").startsWith(prefix).primaryKeys()) as string[];
    stale.push(...keys.filter((k) => isStaleDailySettingKey(k, today)));
  }
  if (stale.length > 0) await db.settings.bulkDelete(stale);
  return stale.length;
}

/** 1日1回だけ掃除する(起動のたびに数える手間を省く)。印はlocalStorageに置く */
export async function cleanupDailySettingsOncePerDay(today: string = todayStr()): Promise<void> {
  try {
    if (localStorage.getItem(LAST_RUN_KEY) === today) return;
  } catch {
    // localStorageが使えなくても掃除自体はできる
  }
  await cleanupDailySettings(today);
  try {
    localStorage.setItem(LAST_RUN_KEY, today);
  } catch {
    // 印が残せなくても次の起動でまた掃除するだけ
  }
}
