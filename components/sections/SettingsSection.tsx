"use client";

import { useSetting } from "@/lib/settings";
import { parseBreakRanges, serializeBreakRanges } from "@/lib/breaks";
import { DEFAULT_TAG_PRESETS } from "@/lib/todo";
import type { BreakRange } from "@/lib/types";

export default function SettingsSection() {
  const [thresholdMinutesStr, setThresholdMinutesStr] = useSetting("today.untrackedThresholdMinutes", "5");
  const [provisionalEnabledStr, setProvisionalEnabledStr] = useSetting("today.provisionalEnabled", "false");
  const provisionalEnabled = provisionalEnabledStr === "true";
  const [provisionalNotifyEnabledStr, setProvisionalNotifyEnabledStr] = useSetting(
    "today.provisionalNotifyEnabled",
    "true"
  );
  const provisionalNotifyEnabled = provisionalNotifyEnabledStr === "true";
  const [breakRangesStr, setBreakRangesStr] = useSetting("today.provisionalBreakRanges", "[]");
  const breakRanges = parseBreakRanges(breakRangesStr);
  const [provisionalIdleHoursStr, setProvisionalIdleHoursStr] = useSetting("today.provisionalIdleThresholdHours", "3");
  const [emphasizeRunningStr, setEmphasizeRunningStr] = useSetting("today.emphasizeRunning", "false");
  const emphasizeRunning = emphasizeRunningStr === "true";
  const [masterEditModeStr, setMasterEditModeStr] = useSetting("records.masterEditMode", "relink");
  const [autoImportantTag, setAutoImportantTag] = useSetting("todo.autoImportantTag", "対応中");

  function addBreakRange() {
    setBreakRangesStr(serializeBreakRanges([...breakRanges, { start: "12:00", end: "13:00" }]));
  }
  function updateBreakRange(index: number, patch: Partial<BreakRange>) {
    const next = breakRanges.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setBreakRangesStr(serializeBreakRanges(next));
  }
  function removeBreakRange(index: number) {
    setBreakRangesStr(serializeBreakRanges(breakRanges.filter((_, i) => i !== index)));
  }

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
              min={0}
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

        {provisionalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <p className="text-xs text-cream/60">
              除外する時間帯（休憩など）。この時間帯は未計測の自動開始が始まらず、「さかのぼって開始/再開」でも対象に含まれません。
            </p>
            {breakRanges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
                <input
                  type="time"
                  value={r.start}
                  onChange={(e) => updateBreakRange(i, { start: e.target.value })}
                  className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <span>〜</span>
                <input
                  type="time"
                  value={r.end}
                  onChange={(e) => updateBreakRange(i, { end: e.target.value })}
                  className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <button className="text-alert" onClick={() => removeBreakRange(i)} aria-label="削除">
                  ✕
                </button>
              </div>
            ))}
            <button className="btn-pill-outline text-xs" onClick={addBreakRange}>
              + 時間帯を追加
            </button>
          </div>
        )}

        {provisionalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
              <span>放置</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={provisionalIdleHoursStr}
                onChange={(e) => setProvisionalIdleHoursStr(e.target.value)}
                className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>時間以上マウス/キーボード操作がなければ、未計測の計測を最後に操作していた時刻で自動的に打ち切ります</span>
            </div>
            <p className="text-[10px] text-cream/40">
              定時後・休日にPCを開いたまま放置しても、際限なく計測され続けないようにするための保険です。
            </p>
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

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">実績編集で名称・区分を変更した時の挙動</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={masterEditModeStr === "relink" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMasterEditModeStr("relink")}
          >
            別のマスタに繋ぎ変える
          </button>
          <button
            className={masterEditModeStr === "rename" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMasterEditModeStr("rename")}
          >
            マスタ自体もリネームする
          </button>
        </div>
        <p className="text-xs text-cream/50">
          {masterEditModeStr === "rename"
            ? "この実績が紐づく作業マスタの名称・区分もそのまま書き換えます。同じマスタに紐づく他の日の実績の表示も一緒に変わります。"
            : "新しい名称・区分の作業マスタが既にあればそこに繋ぎ変え、なければ新規作成して繋ぎ変えます。元のマスタや、それに紐づく他の実績には影響しません。"}
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">ToDoのタグによる自動重要化</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={!autoImportantTag ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setAutoImportantTag("")}
          >
            なし
          </button>
          {DEFAULT_TAG_PRESETS.map((t) => (
            <button
              key={t}
              className={autoImportantTag === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setAutoImportantTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-cream/50">
          {autoImportantTag
            ? `ToDoのタスク登録・編集時にタグ「${autoImportantTag}」を選ぶと、自動的に★重要にします（タグを外しても重要フラグは自動では解除しません）。`
            : "自動重要化は無効です。タグを選んでも★重要は自動では変わりません。"}
        </p>
      </div>
    </div>
  );
}
