"use client";

import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  buildDailySummaryBody,
  buildMonthlySummary,
  buildMorningDigestBody,
  isPastTimeOfDay,
  type DueSummary,
} from "@/lib/automation";
import { notify } from "@/lib/notifications";
import { computeAfterHoursBreakdown } from "@/lib/overtime";
import { getPeriodRange, isDateStrInRange } from "@/lib/period";
import type { SuggestedTask } from "@/lib/suggest";
import { formatHms } from "@/lib/time";
import type { ConditionLog, WorkRecord } from "@/lib/types";

// 通知に使う設定と既定値。1回のクエリでまとめて読む(下記)
const SETTING_DEFAULTS = {
  "notify.patternSuggestEnabled": "false",
  "notify.patternSuggestNotifiedKey": "",
  "notify.afterHoursWeeklyEnabled": "false",
  "notify.afterHoursWeeklyThresholdHours": "5",
  "notify.afterHoursWeeklyNotifiedWeek": "",
  "notify.dailySummaryEnabled": "false",
  "notify.dailySummaryTime": "18:00",
  "notify.dailySummaryNotifiedDate": "",
  "notify.monthlySummaryEnabled": "false",
  "notify.monthlySummaryNotifiedMonth": "",
  "notify.morningDigestEnabled": "false",
  "notify.morningDigestTime": "08:00",
  "notify.morningDigestNotifiedDate": "",
} as const;
type SettingKey = keyof typeof SETTING_DEFAULTS;
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

function putSetting(key: SettingKey, value: string) {
  db.settings.put({ key, value });
}

// 本日の作業タブを開いている間に判定して送る、時刻・状況をきっかけにした通知
// (声かけ・週の定時以降・1日の終わり・月初・朝)。それぞれ設定でON/OFFでき、
// 同じ通知は日/週/月ごとに1回だけ送る。
// 設定は1回のクエリでまとめて読み、読み終わるまでは何も判定しない。設定ごとに別々に
// 読むと「ON」だけ先に読めて「本日通知済み」がまだ既定値(未通知)のまま、という瞬間ができ、
// アプリを開くたびに同じ通知を送り直してしまっていた。
// 同様に、本文に使うデータ(作業・ToDo・案件・体調)が読み終わるまで待つ(読み込み中は
// 空として数えてしまい「本日の予定 0件」のような誤った内容になっていた)。
// 設定の書き込み(IndexedDB経由)は反映に一拍かかるため、書き込み完了前に別の変化で
// effectが再実行されても二重に通知しないよう、同期的なrefで先にラッチしているものがある
export function useTodayNotifications(p: {
  date: string;
  now: number;
  records: WorkRecord[] | undefined;
  conditionLogs: ConditionLog[] | undefined;
  afterHoursCutoff: string;
  suggestedTask: SuggestedTask | null;
  /** 朝の通知の本文に使う作業・ToDo・案件を読み終わったか */
  dueDataReady: boolean;
  pendingCount: number;
  dueSummary: DueSummary;
}) {
  const { date, now, records, conditionLogs, afterHoursCutoff, suggestedTask } = p;
  const settings = useLiveQuery(async () => {
    const rows = await db.settings.bulkGet(SETTING_KEYS);
    const values = {} as Record<SettingKey, string>;
    SETTING_KEYS.forEach((key, i) => (values[key] = rows[i]?.value ?? SETTING_DEFAULTS[key]));
    return values;
  }, []);

  // パターン学習型の声かけ通知。「そろそろこの作業では?」の提案が出た最初のタイミングで、
  // パネル表示に加えて通知も送る(同じ提案は1日1回まで)
  const patternSuggestFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings || settings["notify.patternSuggestEnabled"] !== "true" || !suggestedTask) return;
    const key = `${date}::${suggestedTask.category}::${suggestedTask.name}`;
    if (settings["notify.patternSuggestNotifiedKey"] === key) return;
    if (patternSuggestFiredRef.current === key) return;
    patternSuggestFiredRef.current = key;
    notify(
      "💡 そろそろこの作業では?",
      `${suggestedTask.category} / ${suggestedTask.name}（同じ曜日のこの時間帯によく行っています）`,
      `pattern-suggest-${key}`
    );
    putSetting("notify.patternSuggestNotifiedKey", key);
  }, [settings, suggestedTask, date]);

  // 今週の「定時以降の業務」合計が週次基準を超えたら通知する（週ごとに1回だけ）
  useEffect(() => {
    if (!settings || settings["notify.afterHoursWeeklyEnabled"] !== "true" || !records) return;
    const thresholdSeconds = Math.max(0, Number(settings["notify.afterHoursWeeklyThresholdHours"]) || 0) * 3600;
    if (thresholdSeconds <= 0) return;
    const range = getPeriodRange({ type: "week" });
    if (!range) return;
    const weekKey = range.start.toISOString().slice(0, 10);
    if (settings["notify.afterHoursWeeklyNotifiedWeek"] === weekKey) return;
    const periodRecords = records.filter((r) => isDateStrInRange(r.date, range));
    const { totalSeconds } = computeAfterHoursBreakdown(periodRecords, afterHoursCutoff);
    if (totalSeconds >= thresholdSeconds) {
      notify("定時以降の業務が週次基準を超えました", `今週の定時以降の業務が ${formatHms(totalSeconds)} になりました`);
      putSetting("notify.afterHoursWeeklyNotifiedWeek", weekKey);
    }
  }, [settings, records, afterHoursCutoff]);

  // 1日の終わりに、その日の合計作業時間（と体調記録があればその内容）を通知する（1日1回）
  const dailySummaryFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings || settings["notify.dailySummaryEnabled"] !== "true" || !records || !conditionLogs) return;
    if (settings["notify.dailySummaryNotifiedDate"] === date) return;
    if (dailySummaryFiredRef.current === date) return;
    if (!isPastTimeOfDay(now, settings["notify.dailySummaryTime"], 18)) return;
    dailySummaryFiredRef.current = date;
    notify("今日の作業サマリー", buildDailySummaryBody(records, date, conditionLogs), "daily-summary");
    putSetting("notify.dailySummaryNotifiedDate", date);
  }, [settings, records, conditionLogs, date, now]);

  // 月が変わって初めてアプリを開いたタイミングで、先月の合計時間・最多区分を通知する(月1回)。
  // 日次サマリーと同じ「アプリを開いている間に判定する」方式で、特定の時刻は問わない
  const monthlySummaryFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings || settings["notify.monthlySummaryEnabled"] !== "true" || !records) return;
    const currentMonth = date.slice(0, 7);
    if (settings["notify.monthlySummaryNotifiedMonth"] === currentMonth) return;
    if (monthlySummaryFiredRef.current === currentMonth) return;
    monthlySummaryFiredRef.current = currentMonth;
    const summary = buildMonthlySummary(records, currentMonth);
    if (summary) notify(summary.title, summary.body, "monthly-summary");
    putSetting("notify.monthlySummaryNotifiedMonth", currentMonth);
  }, [settings, records, date]);

  // 朝、指定した時刻になったら、本日の予定件数とToDo・案件の期限状況をまとめて通知する(1日1回)。
  // 外部のカレンダー連携ルーティン等に頼らず、アプリ単体で確実に動くようにする
  const morningDigestFiredRef = useRef<string | null>(null);
  const { dueDataReady, pendingCount, dueSummary } = p;
  useEffect(() => {
    if (!settings || settings["notify.morningDigestEnabled"] !== "true" || !dueDataReady) return;
    if (settings["notify.morningDigestNotifiedDate"] === date) return;
    if (morningDigestFiredRef.current === date) return;
    if (!isPastTimeOfDay(now, settings["notify.morningDigestTime"], 8)) return;
    morningDigestFiredRef.current = date;
    notify("おはようございます", buildMorningDigestBody(pendingCount, dueSummary), "morning-digest");
    putSetting("notify.morningDigestNotifiedDate", date);
  }, [settings, dueDataReady, pendingCount, dueSummary, date, now]);
}
