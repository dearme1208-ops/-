"use client";

import { useEffect, useRef } from "react";
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
import { useSetting } from "@/lib/settings";
import type { SuggestedTask } from "@/lib/suggest";
import { formatHms } from "@/lib/time";
import type { ConditionLog, WorkRecord } from "@/lib/types";

// 本日の作業タブを開いている間に判定して送る、時刻・状況をきっかけにした通知
// (声かけ・週の定時以降・1日の終わり・月初・朝)。それぞれ設定でON/OFFでき、
// 同じ通知は日/週/月ごとに1回だけ送る。
// 設定の書き込み(IndexedDB経由)は反映に一拍かかるため、書き込み完了前に別の変化で
// effectが再実行されても二重に通知しないよう、同期的なrefで先にラッチしているものがある
export function useTodayNotifications(p: {
  date: string;
  now: number;
  records: WorkRecord[] | undefined;
  conditionLogs: ConditionLog[] | undefined;
  afterHoursCutoff: string;
  suggestedTask: SuggestedTask | null;
  pendingCount: number;
  dueSummary: DueSummary;
}) {
  const { date, now, records, conditionLogs, afterHoursCutoff, suggestedTask } = p;

  // パターン学習型の声かけ通知。「そろそろこの作業では?」の提案が出た最初のタイミングで、
  // パネル表示に加えて通知も送る(同じ提案は1日1回まで)
  const [patternSuggestNotifyEnabledStr] = useSetting("notify.patternSuggestEnabled", "false");
  const patternSuggestNotifyEnabled = patternSuggestNotifyEnabledStr === "true";
  const [patternSuggestNotifiedKey, setPatternSuggestNotifiedKey] = useSetting("notify.patternSuggestNotifiedKey", "");
  const patternSuggestFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!patternSuggestNotifyEnabled || !suggestedTask) return;
    const key = `${date}::${suggestedTask.category}::${suggestedTask.name}`;
    if (patternSuggestNotifiedKey === key) return;
    if (patternSuggestFiredRef.current === key) return;
    patternSuggestFiredRef.current = key;
    notify(
      "💡 そろそろこの作業では?",
      `${suggestedTask.category} / ${suggestedTask.name}（同じ曜日のこの時間帯によく行っています）`,
      `pattern-suggest-${key}`
    );
    setPatternSuggestNotifiedKey(key);
  }, [patternSuggestNotifyEnabled, suggestedTask, date, patternSuggestNotifiedKey, setPatternSuggestNotifiedKey]);

  // 今週の「定時以降の業務」合計が週次基準を超えたら通知する（週ごとに1回だけ）
  const [weeklyAfterHoursNotifyEnabledStr] = useSetting("notify.afterHoursWeeklyEnabled", "false");
  const weeklyAfterHoursNotifyEnabled = weeklyAfterHoursNotifyEnabledStr === "true";
  const [weeklyAfterHoursThresholdStr] = useSetting("notify.afterHoursWeeklyThresholdHours", "5");
  const [weeklyAfterHoursNotifiedWeek, setWeeklyAfterHoursNotifiedWeek] = useSetting(
    "notify.afterHoursWeeklyNotifiedWeek",
    ""
  );
  useEffect(() => {
    if (!weeklyAfterHoursNotifyEnabled || !records) return;
    const thresholdSeconds = Math.max(0, Number(weeklyAfterHoursThresholdStr) || 0) * 3600;
    if (thresholdSeconds <= 0) return;
    const range = getPeriodRange({ type: "week" });
    if (!range) return;
    const weekKey = range.start.toISOString().slice(0, 10);
    if (weeklyAfterHoursNotifiedWeek === weekKey) return;
    const periodRecords = records.filter((r) => isDateStrInRange(r.date, range));
    const { totalSeconds } = computeAfterHoursBreakdown(periodRecords, afterHoursCutoff);
    if (totalSeconds >= thresholdSeconds) {
      notify("定時以降の業務が週次基準を超えました", `今週の定時以降の業務が ${formatHms(totalSeconds)} になりました`);
      setWeeklyAfterHoursNotifiedWeek(weekKey);
    }
  }, [
    weeklyAfterHoursNotifyEnabled,
    records,
    afterHoursCutoff,
    weeklyAfterHoursThresholdStr,
    weeklyAfterHoursNotifiedWeek,
    setWeeklyAfterHoursNotifiedWeek,
  ]);

  // 1日の終わりに、その日の合計作業時間（と体調記録があればその内容）を通知する（1日1回）
  const [dailySummaryEnabledStr] = useSetting("notify.dailySummaryEnabled", "false");
  const dailySummaryEnabled = dailySummaryEnabledStr === "true";
  const [dailySummaryTime] = useSetting("notify.dailySummaryTime", "18:00");
  const [dailySummaryNotifiedDate, setDailySummaryNotifiedDate] = useSetting("notify.dailySummaryNotifiedDate", "");
  useEffect(() => {
    if (!dailySummaryEnabled || !records) return;
    if (dailySummaryNotifiedDate === date) return;
    if (!isPastTimeOfDay(now, dailySummaryTime, 18)) return;
    notify("今日の作業サマリー", buildDailySummaryBody(records, date, conditionLogs ?? []), "daily-summary");
    setDailySummaryNotifiedDate(date);
  }, [
    dailySummaryEnabled,
    dailySummaryNotifiedDate,
    dailySummaryTime,
    records,
    conditionLogs,
    date,
    now,
    setDailySummaryNotifiedDate,
  ]);

  // 月が変わって初めてアプリを開いたタイミングで、先月の合計時間・最多区分を通知する(月1回)。
  // 日次サマリーと同じ「アプリを開いている間に判定する」方式で、特定の時刻は問わない
  const [monthlySummaryEnabledStr] = useSetting("notify.monthlySummaryEnabled", "false");
  const monthlySummaryEnabled = monthlySummaryEnabledStr === "true";
  const [monthlySummaryNotifiedMonth, setMonthlySummaryNotifiedMonth] = useSetting(
    "notify.monthlySummaryNotifiedMonth",
    ""
  );
  const monthlySummaryFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!monthlySummaryEnabled || !records) return;
    const currentMonth = date.slice(0, 7);
    if (monthlySummaryNotifiedMonth === currentMonth) return;
    if (monthlySummaryFiredRef.current === currentMonth) return;
    monthlySummaryFiredRef.current = currentMonth;
    const summary = buildMonthlySummary(records, currentMonth);
    if (summary) notify(summary.title, summary.body, "monthly-summary");
    setMonthlySummaryNotifiedMonth(currentMonth);
  }, [monthlySummaryEnabled, monthlySummaryNotifiedMonth, records, date, setMonthlySummaryNotifiedMonth]);

  // 朝、指定した時刻になったら、本日の予定件数とToDo・案件の期限状況をまとめて通知する(1日1回)。
  // 外部のカレンダー連携ルーティン等に頼らず、アプリ単体で確実に動くようにする
  const [morningDigestEnabledStr] = useSetting("notify.morningDigestEnabled", "false");
  const morningDigestEnabled = morningDigestEnabledStr === "true";
  const [morningDigestTime] = useSetting("notify.morningDigestTime", "08:00");
  const [morningDigestNotifiedDate, setMorningDigestNotifiedDate] = useSetting("notify.morningDigestNotifiedDate", "");
  const morningDigestFiredRef = useRef<string | null>(null);
  const { pendingCount, dueSummary } = p;
  useEffect(() => {
    if (!morningDigestEnabled) return;
    if (morningDigestNotifiedDate === date) return;
    if (morningDigestFiredRef.current === date) return;
    if (!isPastTimeOfDay(now, morningDigestTime, 8)) return;
    morningDigestFiredRef.current = date;
    notify("おはようございます", buildMorningDigestBody(pendingCount, dueSummary), "morning-digest");
    setMorningDigestNotifiedDate(date);
  }, [
    morningDigestEnabled,
    morningDigestNotifiedDate,
    morningDigestTime,
    pendingCount,
    dueSummary,
    date,
    now,
    setMorningDigestNotifiedDate,
  ]);
}
