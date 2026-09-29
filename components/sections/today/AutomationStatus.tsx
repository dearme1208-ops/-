"use client";

import type { CurrentWeatherReading, WeatherAlert } from "@/lib/weather";
import { formatClock, formatDateJp, todayStr } from "@/lib/time";

// 本日の作業タブで自動処理(移動検知・地点到着検知・天気変化の通知)が動いていることと、
// その状態(エラー・最新の取得結果)を知らせる帯

export function GeoTrackingStatus({
  error,
  distanceThresholdMeters,
  category,
  taskName,
  stillMs,
}: {
  error: string | null;
  distanceThresholdMeters: number;
  category: string;
  taskName: string;
  stillMs: number;
}) {
  return (
    <div className="panel flex items-center gap-2 p-3 text-xs">
      {error ? (
        <span className="text-alert">📍 {error}</span>
      ) : (
        <span className="text-cream/50">
          📍 移動検知中（{distanceThresholdMeters}m以上の移動で「{category || "移動"} / {taskName || "移動"}」を自動計測・
          {Math.round((stillMs / 60000) * 10) / 10}分以上停止で自動終了）
        </span>
      )}
    </div>
  );
}

export function GeoArrivalStatus({
  error,
  placeCount,
  wakeLockActive,
  wakeLockError,
}: {
  error: string | null;
  placeCount: number;
  wakeLockActive: boolean;
  wakeLockError: string | null;
}) {
  return (
    <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-xs">
      {error ? (
        <span className="text-alert">📍 {error}</span>
      ) : (
        <span className="text-cream/50">📍 地点到着検知中（登録地点{placeCount}件。到着すると紐づく作業を自動開始）</span>
      )}
      {wakeLockActive ? (
        <span className="text-cream/50">💡 画面常時点灯 ON（バッテリー消費が増えます）</span>
      ) : wakeLockError ? (
        <span className="text-cream/40">💡 {wakeLockError}</span>
      ) : null}
    </div>
  );
}

// 天気変化通知の「次に閾値を超える時刻」表示用。予報は当日〜翌日早朝まで含むため、
// 日付が今日と異なる場合(=翌日の予報)は時刻だけでなく日付も明示し、日をまたいだ
// 見込みを取り違えないようにする
export function formatCrossingDateTime(atIso: string): string {
  const d = new Date(atIso);
  const dateLabel = todayStr(d) !== todayStr() ? `${formatDateJp(todayStr(d))} ` : "";
  return `${dateLabel}${formatClock(d.getTime())}`;
}

export function WeatherStatus({
  placeCount,
  thresholdPercent,
  leadHours,
  error,
  checking,
  lastCheckedAt,
  current,
  nextCrossings,
  onCheckNow,
}: {
  placeCount: number;
  thresholdPercent: string;
  leadHours: string;
  error: string | null;
  checking: boolean;
  lastCheckedAt: number | null;
  current: CurrentWeatherReading[];
  nextCrossings: WeatherAlert[];
  onCheckNow: () => void;
}) {
  return (
    <div className="panel flex flex-col gap-1.5 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {error ? (
          <span className="text-alert">🌤 {error}</span>
        ) : (
          <span className="text-cream/50">
            🌤 天気変化の通知 ON（登録地点{placeCount}件。降水確率{thresholdPercent}%以上が{leadHours}時間以内に近づくと通知
            {lastCheckedAt ? `・最終取得 ${formatClock(lastCheckedAt)}` : ""}）
          </span>
        )}
        <button className="btn-pill-outline text-xs" onClick={onCheckNow} disabled={checking}>
          {checking ? "取得中..." : "🔄 今すぐ取得"}
        </button>
      </div>
      {current.length === 0 && !error && <p className="text-cream/40">取得中...（初回は数秒かかることがあります）</p>}
      {current.length > 0 && (
        <div className="flex flex-col gap-1 text-cream/70">
          {current.map((c) => {
            const next = nextCrossings.find((n) => n.placeId === c.placeId);
            return (
              <span key={c.placeId}>
                {c.placeLabel}: 現在 降水確率{c.precipProbability}%（{formatClock(new Date(c.atIso).getTime())}時点）
                {next
                  ? next.hoursUntil <= 0.01
                    ? `・すでに${thresholdPercent}%以上です`
                    : `・次に${thresholdPercent}%以上: ${formatCrossingDateTime(next.atIso)}頃（${next.precipProbability}%）`
                  : `・当面${thresholdPercent}%以上の予報なし`}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
