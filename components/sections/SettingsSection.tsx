"use client";

import { useSetting } from "@/lib/settings";

export default function SettingsSection() {
  const [thresholdMinutesStr, setThresholdMinutesStr] = useSetting("today.untrackedThresholdMinutes", "5");
  const [provisionalEnabledStr, setProvisionalEnabledStr] = useSetting("today.provisionalEnabled", "false");
  const provisionalEnabled = provisionalEnabledStr === "true";
  const [provisionalNotifyEnabledStr, setProvisionalNotifyEnabledStr] = useSetting(
    "today.provisionalNotifyEnabled",
    "true"
  );
  const provisionalNotifyEnabled = provisionalNotifyEnabledStr === "true";
  const [emphasizeRunningStr, setEmphasizeRunningStr] = useSetting("today.emphasizeRunning", "false");
  const emphasizeRunning = emphasizeRunningStr === "true";

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-bold">設定</h2>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">未計測時間の自動計測</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={provisionalEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setProvisionalEnabledStr(provisionalEnabled ? "false" : "true")}
          >
            未計測の自動計測: {provisionalEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {provisionalEnabled && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <span>未計測が</span>
            <input
              type="number"
              min={1}
              value={thresholdMinutesStr}
              onChange={(e) => setThresholdMinutesStr(e.target.value)}
              className="w-14 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
            />
            <span>分以上続いたら、自動で仮計測を開始します</span>
            <button
              className={provisionalNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setProvisionalNotifyEnabledStr(provisionalNotifyEnabled ? "false" : "true")}
            >
              仮計測の通知: {provisionalNotifyEnabled ? "ON" : "OFF"}
            </button>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">本日の作業の表示</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={emphasizeRunning ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setEmphasizeRunningStr(emphasizeRunning ? "false" : "true")}
          >
            計測中の作業を強調表示: {emphasizeRunning ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-xs text-cream/50">
          ONにすると、計測中の作業がある間は他の作業が薄く表示され、ボタンも操作できなくなります（仮計測中と同様の見せ方です）。
        </p>
      </div>
    </div>
  );
}
