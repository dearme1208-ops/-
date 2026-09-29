"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { useSetting } from "@/lib/settings";
import { formatClock, todayStr } from "@/lib/time";
import { refreshWeatherAndFindAlerts, type CurrentWeatherReading, type WeatherAlert } from "@/lib/weather";

// 登録地点の天気変化通知(降水確率が閾値を超える見込みが近づいたら通知)。
// アプリを開いている間だけ、定期的に降水確率予報を取得・保存し、閾値を超える見込みの
// 時刻が指定時間以内に近づいていれば通知する(地点到着検知と同じく、ブラウザ/PWAの
// 仕様上フォアグラウンドでのみ動作し、閉じている間は情報が更新されない)
export function useWeatherWatch() {
  const [notifyEnabledStr] = useSetting("weather.notifyEnabled", "false");
  const notifyEnabled = notifyEnabledStr === "true";
  const [leadHoursStr] = useSetting("weather.notifyLeadHours", "3");
  const [thresholdStr] = useSetting("weather.precipThreshold", "50");
  // 天気変化の通知用の登録地点。地点到着検知(geoPlaces)とは別の独立した一覧
  const places = useLiveQuery(() => db.weatherPlaces.toArray(), []);
  const [alert, setAlert] = useState<WeatherAlert | null>(null);
  const [current, setCurrent] = useState<CurrentWeatherReading[]>([]);
  const [nextCrossings, setNextCrossings] = useState<WeatherAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);

  // force=trueなら「今すぐ取得」ボタンからの呼び出しで、30分キャッシュを無視して必ず再取得する
  const check = useCallback(
    async (force: boolean) => {
      if (!places || places.length === 0) return;
      const leadHours = Math.max(0.5, Number(leadHoursStr) || 3);
      const thresholdPct = Math.min(100, Math.max(0, Number(thresholdStr) || 50));
      setChecking(true);
      try {
        const result = await refreshWeatherAndFindAlerts(places, {
          leadHours,
          thresholdPct,
          nowMs: Date.now(),
          todayDateStr: todayStr(),
          force,
        });
        setError(null);
        setLastCheckedAt(Date.now());
        setCurrent(result.current);
        setNextCrossings(result.nextCrossings);
        for (const a of result.alerts) {
          const hourLabel = formatClock(new Date(a.atIso).getTime());
          notify(
            "☔ 天気の変化が近づいています",
            `${a.placeLabel}: ${hourLabel}頃に降水確率${a.precipProbability}%の見込みです`,
            `weather-${a.placeId}-${a.atIso}`
          );
        }
        if (result.alerts.length > 0) setAlert(result.alerts[0]);
      } catch {
        setError("天気予報を取得できませんでした");
      } finally {
        setChecking(false);
      }
    },
    [places, leadHoursStr, thresholdStr]
  );

  useEffect(() => {
    if (!notifyEnabled || !places || places.length === 0) {
      setError(null);
      return;
    }
    check(false);
    // 内部で30分キャッシュされるためAPI呼び出し自体はもっと少ない頻度になる
    const id = setInterval(() => check(false), 15 * 60000);
    return () => clearInterval(id);
  }, [notifyEnabled, places, check]);

  return {
    notifyEnabled,
    places,
    leadHoursStr,
    thresholdStr,
    alert,
    dismissAlert: () => setAlert(null),
    current,
    nextCrossings,
    error,
    checking,
    lastCheckedAt,
    checkNow: () => check(true),
  };
}
