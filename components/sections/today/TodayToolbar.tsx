"use client";

import { useRef, type ReactNode } from "react";
import { computeGrowthStage } from "@/lib/growth";
import { DEFAULT_IMPORT_DAYS } from "@/lib/icsImport";
import type { ThemedMode } from "@/lib/theme";
import { formatHms } from "@/lib/time";
import { useSetting } from "@/lib/settings";
import type { WeekdayAverage } from "@/lib/weekday";

// 「簡易表示（アイコンのみ）」設定のON/OFFで、アイコンだけのボタンと文言付きのボタンを
// 出し分ける。ボタンを1つ足すたびに両方の形を書かなくて済むよう、ここにまとめている
function ModeButton({
  simple,
  icon,
  label,
  title,
  ariaLabel,
  danger,
  compact,
  onClick,
}: {
  simple: boolean;
  /** 簡易表示で出すアイコン */
  icon: ReactNode;
  /** 通常表示で出す文言(アイコン込み) */
  label: ReactNode;
  /** 簡易表示のツールチップ */
  title: string;
  /** 簡易表示の読み上げ名。省略時はtitle */
  ariaLabel?: string;
  danger?: boolean;
  /** 2段目の補助の操作。小さめにして、狭い画面では1行の横スクロールに収める */
  compact?: boolean;
  onClick: () => void;
}) {
  const base = danger ? "btn-pill-danger" : "btn-pill-outline";
  return simple ? (
    <button className={`${base} shrink-0 px-3 py-2 text-base`} onClick={onClick} title={title} aria-label={ariaLabel ?? title}>
      {icon}
    </button>
  ) : (
    <button className={`${base} shrink-0 whitespace-nowrap ${compact ? "px-3 py-1.5 text-xs" : "text-sm"}`} onClick={onClick}>
      {label}
    </button>
  );
}

export interface TodayToolbarProps {
  date: string;
  simpleButtons: boolean;
  themedMode: ThemedMode | null;
  streakDays: number;
  growthStageEnabled: boolean;
  todayTotalSeconds: number;
  sameWeekdayAvg: WeekdayAverage | null;
  reflectionAnsweredToday: boolean;
  hasTasks: boolean;
  voice: {
    available: boolean;
    listening: boolean;
    handsFree: boolean;
    onToggle: () => void;
  };
  showScheduleCsvTools: boolean;
  onTrouble: () => void;
  onAddTask: () => void;
  onDayCard: () => void;
  onDayPlan: () => void;
  onTomorrowDraft: () => void;
  onTimebox: () => void;
  onReflection: () => void;
  onDownloadScheduleTemplate: () => void;
  onImportScheduleFile: (file: File) => void;
  onRegenerate: () => void;
}

// 本日の作業リストの見出し(日付・連続日数・育成度・同曜日比)と、右側の操作ボタン群
export default function TodayToolbar(props: TodayToolbarProps) {
  const { date, simpleButtons: simple, todayTotalSeconds, sameWeekdayAvg, voice } = props;
  const scheduleFileInputRef = useRef<HTMLInputElement>(null);
  // たまにしか使わない操作(今日の一枚・予定の取り込み・再生成)は「その他」に畳む。
  // スマホでは9個のボタンが作業リストの前に約260pxも並び、リストが下へ押し出されていた
  const [moreOpenStr, setMoreOpenStr] = useSetting("today.toolbarMoreOpen", "false");
  const moreOpen = moreOpenStr === "true";

  return (
    // 右のボタン群が多いので、狭い画面では折り返して段を分ける。折り返しがないと
    // 見出し側が押し潰されて「2026-」「09-06」「の作業」「リスト」の4行になっていた
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold whitespace-nowrap">{date} の作業リスト</h2>
        {props.streakDays > 0 && (
          <span
            className="rounded-full bg-alert/15 px-2 py-0.5 text-xs font-bold text-alert"
            title="実績が記録されている連続日数"
          >
            🔥 連続{props.streakDays}日
          </span>
        )}
        {props.growthStageEnabled &&
          todayTotalSeconds > 0 &&
          (() => {
            const { stage } = computeGrowthStage(props.themedMode, todayTotalSeconds);
            return (
              <span
                className="rounded-full bg-cream/10 px-2 py-0.5 text-xs text-cream/70"
                title={`本日の作業時間(${formatHms(todayTotalSeconds)})に応じた育成度`}
              >
                {stage.icon} {stage.label}
              </span>
            );
          })()}
        {todayTotalSeconds > 0 && sameWeekdayAvg && sameWeekdayAvg.dayCount >= 2 && (
          <span
            className="rounded-full bg-cream/10 px-2 py-0.5 text-xs text-cream/70"
            title={`過去の${sameWeekdayAvg.label}曜日${sameWeekdayAvg.dayCount}日分の平均との比較`}
          >
            {sameWeekdayAvg.label}曜平均比{" "}
            {todayTotalSeconds >= sameWeekdayAvg.avgSeconds ? "+" : "-"}
            {Math.round((Math.abs(todayTotalSeconds - sameWeekdayAvg.avgSeconds) / sameWeekdayAvg.avgSeconds) * 100)}%
          </span>
        )}
      </div>
      {/* よく使う2つ(トラブル・突発作業)を1段目に大きく、ほかの補助の操作は2段目に小さく並べる。
          スマホで7つのボタンが4段も並び、計測中の作業が画面の外へ押し出されていた。
          2段目は狭い画面では1行の横スクロールにする(右端が少し切れて、続きがあると分かる) */}
      <div className="flex w-full flex-col gap-2 sm:w-auto">
      <div className="flex gap-2">
        <ModeButton simple={simple} danger icon="⚡" label="⚡ トラブル発生" title="トラブル発生" onClick={props.onTrouble} />
        <ModeButton simple={simple} icon="➕" label="+ 突発作業を追加" title="突発作業を追加" onClick={props.onAddTask} />
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible" data-testid="today-toolbar-sub">
        <ModeButton simple={simple} compact icon="🧭" label="🧭 今日の段取り" title="今日の段取りを提案" onClick={props.onDayPlan} />
        <ModeButton simple={simple} compact icon="🗓" label="🗓 明日の下書き" title="明日の下書きを作る" onClick={props.onTomorrowDraft} />
        <ModeButton
          simple={simple}
          icon="⏱"
          compact
          label="⏱ 時間割"
          title="作業ごとに時間の枠を決める(タイムボックス)"
          ariaLabel="時間割を作る"
          onClick={props.onTimebox}
        />
        <ModeButton
          simple={simple}
          compact
          icon={props.reflectionAnsweredToday ? "🌙✓" : "🌙"}
          label={`🌙 ${props.reflectionAnsweredToday ? "振り返り済み" : "終業の振り返り"}`}
          title={props.reflectionAnsweredToday ? "終業の振り返り(回答済み)" : "終業の振り返り"}
          ariaLabel="終業の振り返り"
          onClick={props.onReflection}
        />
        {voice.available &&
          (simple ? (
            <button
              className={voice.listening ? "btn-pill-danger px-3 py-2 text-base" : "btn-pill-outline px-3 py-2 text-base"}
              onClick={voice.onToggle}
              title={
                voice.listening
                  ? voice.handsFree
                    ? "ハンズフリーで聞き取り中..."
                    : "聞き取り中..."
                  : `音声で操作(「〇〇を開始」「終了」のように話しかけて操作できます)${voice.handsFree ? " / ハンズフリーモードON" : ""}`
              }
              aria-label={voice.listening ? "聞き取り中" : "音声で操作"}
            >
              {voice.handsFree ? "🎧" : "🎤"}
            </button>
          ) : (
            <button
              className={`${voice.listening ? "btn-pill-danger" : "btn-pill-outline"} shrink-0 whitespace-nowrap px-3 py-1.5 text-xs`}
              onClick={voice.onToggle}
              title={`「〇〇を開始」「終了」のように話しかけて操作できます${voice.handsFree ? " / ハンズフリーモードON(連続で聞き取り、結果を読み上げます)" : ""}`}
            >
              {voice.listening
                ? voice.handsFree
                  ? "🎧 ハンズフリー中..."
                  : "🎤 聞き取り中..."
                : voice.handsFree
                  ? "🎧 音声で操作(ハンズフリー)"
                  : "🎤 音声で操作"}
            </button>
          ))}
        <button
          className={`${moreOpen ? "btn-pill" : "btn-pill-outline"} shrink-0 whitespace-nowrap ${simple ? "px-3 py-2 text-base" : "px-3 py-1.5 text-xs"}`}
          onClick={() => setMoreOpenStr(moreOpen ? "false" : "true")}
          aria-expanded={moreOpen}
          aria-label="その他の操作"
          title="今日の一枚・予定の取り込み・再生成など"
        >
          {simple ? "⋯" : `⋯ その他 ${moreOpen ? "▲" : "▼"}`}
        </button>
      </div>
        {moreOpen && (
          <div className="flex w-full flex-wrap gap-2 border-t border-cream/10 pt-2" data-testid="today-toolbar-more">
            {todayTotalSeconds > 0 && (
              <ModeButton
                simple={simple}
                icon="🖼"
                label="🖼 今日の一枚"
                title="今日の一枚(画像で保存)"
                ariaLabel="今日の一枚"
                onClick={props.onDayCard}
              />
            )}
            {props.showScheduleCsvTools && (
              <>
                <button className="btn-pill-outline text-sm" onClick={props.onDownloadScheduleTemplate}>
                  予定CSVテンプレート
                </button>
                <button
                  className="btn-pill-outline text-sm"
                  onClick={() => scheduleFileInputRef.current?.click()}
                  title={`予定CSV、またはカレンダーの.icsファイル（今日から${DEFAULT_IMPORT_DAYS}日以内の予定）を取り込みます`}
                >
                  予定インポート（CSV/.ics）
                </button>
                <input
                  ref={scheduleFileInputRef}
                  type="file"
                  accept=".csv,.ics,text/csv,text/calendar"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) props.onImportScheduleFile(file);
                    e.target.value = "";
                  }}
                />
              </>
            )}
            {props.hasTasks && (
              <button className="btn-pill-outline text-sm" onClick={props.onRegenerate}>
                再生成
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
