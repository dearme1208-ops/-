"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { DOW_LABELS, buildWeekGrid, type WeekViewMode } from "@/lib/calendarGrid";
import { formatClock, formatHms, todayStr } from "@/lib/time";
import type { DailyTask } from "@/lib/types";
import { usePinchZoom, useSwipeNavigate } from "@/lib/gestures";

const DEFAULT_HOUR_PX = 44;
const MIN_HOUR_PX = 18;
const MAX_HOUR_PX = 140;
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;
const MIN_BLOCK_PX = 13;
// 「見やすい大きさに拡大」ボタンが目指す、一番短いブロックの最低表示高さ(px)。
// これより低いと、MIN_BLOCK_PXの床上げ分同士が重なって隣接ブロックが折り重なって見えてしまう
const MIN_READABLE_BLOCK_PX = 20;
// 二度打ち等による極端に短い区間(1秒未満など)を外れ値とみなし、拡大の基準から除外する
const MIN_CONSIDERED_DURATION_HOUR = 0.5 / 60;

interface WeekBlock {
  key: string;
  taskName: string;
  category: string;
  startHour: number;
  endHour: number;
  ongoing: boolean;
  overPlan: boolean;
  kind: "actual" | "scheduled";
  detail: string; // 作業名・区分・時刻をまとめた説明文(タップ時の詳細パネル、PCでのホバー時ツールチップ両方に使う)
}

// 縦の時間軸上に置くブロック。左右いっぱいに広がる(横幅は列=曜日の幅に合わせる)ため、
// GanttSection.tsxのHoverBar(左右とも数値pxで指定する横長バー向け)とは別に用意する。
// スマホでは列の幅が狭く作業名が省略され読み切れないことがあるため、タップで詳細パネルを
// 開けるようにする(1日表示への切り替えは日付見出しのタップに任せ、ブロックのタップでは
// 画面遷移しない。タップ即座に1日表示へ切り替わると、週全体を見比べたい操作の途中で
// 意図せず画面が変わってしまうため)
function WeekBlockBar({
  top,
  height,
  className,
  textClassName,
  tooltip,
  label,
  onTap,
}: {
  top: number;
  height: number;
  className: string;
  textClassName: string;
  tooltip: string;
  label: string;
  onTap: () => void;
}) {
  // ブロックの高さに余裕がある時は、1行で省略せずに折り返して表示する
  // (短いブロックは従来通り1行+省略記号のまま。タップすれば詳細パネルで全文も見られる)
  const canWrap = height >= 30;
  return (
    <button
      type="button"
      onClick={onTap}
      className="group absolute inset-x-0.5 appearance-none border-0 bg-transparent p-0 text-left"
      style={{ top, height }}
    >
      <div className={`h-full w-full overflow-hidden ${className}`}>
        <span
          className={`block px-1 pt-0.5 text-[9px] leading-tight ${
            canWrap ? "whitespace-normal break-words" : "truncate"
          } ${textClassName}`}
        >
          {label}
        </span>
      </div>
      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-pre rounded border border-cream/30 bg-ink px-2 py-1 text-[10px] leading-tight text-cream shadow-lg group-hover:block">
        {tooltip}
      </div>
    </button>
  );
}

// 同じ大項目・作業名の実績区間が間を空けず連続する場合のみ1つのブロックにまとめる
// (GanttSectionの1日表示と同じ考え方。日をまたぐ心配が無いので日付ごとに独立して処理する)
function mergeAdjacentSegments(
  flat: { start: number; end: number; category: string; name: string; ongoing: boolean }[]
): { start: number; end: number; category: string; name: string; ongoing: boolean }[] {
  const sorted = [...flat].sort((a, b) => a.start - b.start);
  const merged: typeof sorted = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.category === iv.category && last.name === iv.name) {
      last.end = Math.max(last.end, iv.end);
      last.ongoing = iv.ongoing;
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

// ガントチャートを、Googleカレンダーの週表示のように「曜日を列・時刻を縦軸」にして見せる
// 代替ビュー。1日表示(GanttSection本体)の詳細な予定/予測バーとは違い、実績とカレンダー予定
// インポート分だけを、実際の時刻に沿って一目で見渡せることを目的にした簡易な表示にする
export default function GanttWeekView({
  anchorDate,
  onSelectDate,
  onShiftWeek,
}: {
  anchorDate: string;
  onSelectDate: (date: string) => void;
  onShiftWeek: (deltaDays: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [hourPx, setHourPx] = useState(DEFAULT_HOUR_PX);
  const [weekViewMode] = useSetting("calendar.weekViewMode", "fixedStart");
  const [weekStartDayStr] = useSetting("calendar.weekStartDay", "0");
  const weekStartDay = Number(weekStartDayStr);
  const gridRef = useRef<HTMLDivElement>(null);
  // ブロックをタップした時に、画面を切り替えずその場で詳細(作業名・区分・時刻)を見せるためのパネル。
  // 週全体を見比べている途中でタップのたびに1日表示へ飛んでしまうと不便なため、
  // 明示的に「この日を1日表示で見る」ボタンを押した時だけ画面を切り替える
  const [selected, setSelected] = useState<{ ds: string; block: WeekBlock } | null>(null);

  // タッチパネルの2本指ピンチで時間軸の縦の詰まり具合(hourPx)を拡大縮小する
  usePinchZoom(gridRef, (factor) => {
    setHourPx((v) => Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, Math.round(v * factor))));
  });
  // 1本指の横スワイプで前の週・次の週へ移動する(このグリッドは横スクロールしないため常に発火する)
  useSwipeNavigate(gridRef, {
    onSwipeLeft: () => onShiftWeek(7),
    onSwipeRight: () => onShiftWeek(-7),
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // 週を移動したら、古い週の詳細パネルが残らないよう閉じる
  useEffect(() => {
    setSelected(null);
  }, [anchorDate]);

  const weekDays = useMemo(() => {
    const anchor = new Date(anchorDate + "T00:00:00");
    return buildWeekGrid(anchor, weekViewMode as WeekViewMode, weekStartDay);
  }, [anchorDate, weekViewMode, weekStartDay]);
  const weekDateStrs = useMemo(() => weekDays.map((d) => todayStr(d)), [weekDays]);
  const weekDateStrsKey = weekDateStrs.join(",");
  const todayDateStr = todayStr(new Date(now));

  const weekTasks = useLiveQuery(() => db.dailyTasks.where("date").anyOf(weekDateStrs).toArray(), [weekDateStrsKey]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, DailyTask[]>();
    for (const t of weekTasks ?? []) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date)!.push(t);
    }
    return map;
  }, [weekTasks]);

  // 各日の実績区間・カレンダー予定を、その日の0時からの経過時間(小数の時)に変換してブロック化する
  const blocksByDate = useMemo(() => {
    const map = new Map<string, WeekBlock[]>();
    for (const ds of weekDateStrs) {
      const dayBase = new Date(ds + "T00:00:00").getTime();
      const tasks = tasksByDate.get(ds) ?? [];
      const flatSegments: { start: number; end: number; category: string; name: string; ongoing: boolean }[] = [];
      for (const t of tasks) {
        for (const seg of t.segments) {
          const end = seg.end ?? now;
          if (end <= seg.start) continue;
          flatSegments.push({ start: seg.start, end, category: t.category, name: t.name, ongoing: seg.end === undefined });
        }
      }
      const merged = mergeAdjacentSegments(flatSegments);
      const blocks: WeekBlock[] = merged.map((seg, i) => {
        const task = tasks.find((t) => t.category === seg.category && t.name === seg.name);
        const overPlan =
          !!task &&
          task.estimatedSeconds > 0 &&
          (task.status === "done" || task.status === "paused") &&
          (seg.end - seg.start) / 1000 > task.estimatedSeconds;
        const detail = `${seg.name}（実績）\n${seg.category}\n${formatClock(seg.start)} 〜 ${
          seg.ongoing ? "計測中" : formatClock(seg.end)
        }`;
        return {
          key: `actual-${ds}-${i}`,
          taskName: seg.name,
          category: seg.category,
          startHour: (seg.start - dayBase) / 3600000,
          endHour: (seg.end - dayBase) / 3600000,
          ongoing: seg.ongoing,
          overPlan,
          kind: "actual",
          detail,
        };
      });
      for (const t of tasks) {
        if (!t.scheduledTime) continue;
        const [hh, mm] = t.scheduledTime.split(":").map(Number);
        const startHour = hh + mm / 60;
        const durHour = Math.max(t.estimatedSeconds / 3600, 1 / 60);
        const startMs = dayBase + startHour * 3600000;
        const detail = `${t.name}（カレンダー予定）\n${t.category}\n${formatClock(startMs)} 〜 見込み ${formatHms(
          Math.max(durHour * 3600, 0)
        )}`;
        blocks.push({
          key: `sched-${t.id}`,
          taskName: t.name,
          category: t.category,
          startHour,
          endHour: startHour + durHour,
          ongoing: false,
          overPlan: false,
          kind: "scheduled",
          detail,
        });
      }
      map.set(ds, blocks);
    }
    return map;
  }, [weekDateStrs, tasksByDate, now]);

  // 表示する時間範囲: 週内の全ブロック(+今日なら現在時刻)を包む範囲に自動フィットする。
  // データが無ければ朝〜夜(6-22時)を既定にする
  const { startHour, endHour } = useMemo(() => {
    let min = DEFAULT_START_HOUR;
    let max = DEFAULT_END_HOUR;
    let hasData = false;
    for (const blocks of blocksByDate.values()) {
      for (const b of blocks) {
        if (!hasData) {
          min = b.startHour;
          max = b.endHour;
          hasData = true;
        } else {
          min = Math.min(min, b.startHour);
          max = Math.max(max, b.endHour);
        }
      }
    }
    if (weekDateStrs.includes(todayDateStr)) {
      const nowHour = (now - new Date(todayDateStr + "T00:00:00").getTime()) / 3600000;
      min = Math.min(min, nowHour);
      max = Math.max(max, nowHour);
    }
    min = Math.max(0, Math.floor(Math.min(min, DEFAULT_START_HOUR)));
    max = Math.min(24, Math.ceil(Math.max(max, DEFAULT_END_HOUR)));
    if (max - min < 8) max = Math.min(24, min + 8);
    return { startHour: min, endHour: max };
  }, [blocksByDate, weekDateStrs, todayDateStr, now]);

  // 「見やすい大きさに拡大」: 一番短いブロックでも最低MIN_READABLE_BLOCK_PXの高さで
  // 表示できる大きさまで自動でズームする(短い作業が近い時刻に連続していると、
  // MIN_BLOCK_PXの床上げ分同士が重なって隣接ブロックが折り重なって見えてしまうため)
  function fitToReadableSize() {
    const durationsHour = [...blocksByDate.values()]
      .flatMap((blocks) => blocks.map((b) => b.endHour - b.startHour))
      .filter((d) => d >= MIN_CONSIDERED_DURATION_HOUR);
    if (durationsHour.length === 0) return;
    const minDurationHour = Math.min(...durationsHour);
    const desired = MIN_READABLE_BLOCK_PX / minDurationHour;
    setHourPx(Math.min(MAX_HOUR_PX, Math.max(MIN_HOUR_PX, Math.round(desired))));
  }

  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const totalHeight = (endHour - startHour) * hourPx;
  const nowHourToday = (now - new Date(todayDateStr + "T00:00:00").getTime()) / 3600000;
  const showNowLine = weekDateStrs.includes(todayDateStr) && nowHourToday >= startHour && nowHourToday <= endHour;

  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-end gap-1">
        <button
          className="btn-pill-outline px-3 py-1 text-sm"
          onClick={() => setHourPx((v) => Math.max(MIN_HOUR_PX, Math.round(v / 1.3)))}
          aria-label="縮小"
        >
          －
        </button>
        <button
          className="btn-pill-outline px-3 py-1 text-sm"
          onClick={() => setHourPx((v) => Math.min(MAX_HOUR_PX, Math.round(v * 1.3)))}
          aria-label="拡大"
        >
          ＋
        </button>
        <button
          className="btn-pill-outline text-xs"
          onClick={fitToReadableSize}
          title="一番短いブロックでも重ならずに見分けられる大きさまで拡大します"
        >
          見やすい大きさに拡大
        </button>
      </div>
      <div className="flex">
        <div className="w-12 shrink-0 sm:w-14" />
        <div className="flex flex-1">
          {weekDays.map((d, i) => {
            const ds = weekDateStrs[i];
            const isToday = ds === todayDateStr;
            return (
              <button
                key={ds}
                onClick={() => onSelectDate(ds)}
                className={`flex-1 rounded-lg px-1 py-1.5 text-center text-xs transition-colors hover:bg-cream/10 ${
                  isToday ? "bg-cream/15 font-bold text-cream" : "text-cream/70"
                }`}
              >
                <div className="text-[10px] text-cream/50">{DOW_LABELS[d.getDay()]}</div>
                <div className="tabular-nums">{d.getDate()}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div ref={gridRef} className="mt-2 flex max-h-[560px] overflow-y-auto border-t border-cream/10 pt-2">
        <div className="w-12 shrink-0 sm:w-14">
          {hours.map((h) => (
            <div key={h} className="relative text-right text-[10px] text-cream/40" style={{ height: hourPx }}>
              <span className="absolute -top-2 right-1">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>
        <div className="relative flex flex-1" style={{ height: totalHeight }}>
          <div className="pointer-events-none absolute inset-0">
            {hours.map((h, i) => (
              <div key={h} className="absolute left-0 right-0 border-t border-cream/[0.06]" style={{ top: i * hourPx }} />
            ))}
            {showNowLine && (
              <div className="absolute left-0 right-0 z-10 flex items-center" style={{ top: (nowHourToday - startHour) * hourPx }}>
                <div className="h-2 w-2 shrink-0 rounded-full bg-alert" />
                <div className="h-px flex-1 bg-alert/70" />
              </div>
            )}
          </div>
          {weekDateStrs.map((ds, i) => (
            <div key={ds} className={`relative flex-1 ${i > 0 ? "border-l border-cream/[0.06]" : ""}`}>
              {(blocksByDate.get(ds) ?? []).map((b) => {
                const top = Math.max(0, (b.startHour - startHour) * hourPx);
                const height = Math.max((b.endHour - b.startHour) * hourPx, MIN_BLOCK_PX);
                // bg-creamは明るい背景色のため、通常の実績ブロックだけラベルを暗い文字色にする
                // (超過=bg-alert・カレンダー予定=bg-ink/60はどちらも暗い背景なのでcreamの明るい文字のまま)。
                // 超過の背景は常に単色のbg-alertにする(GanttSectionのganttOverrunClassは1日表示の
                // 横長バー向けに走査線状の派手なグラデーションを敷く演出で、この週表示のような
                // 狭いブロックに使うと文字が完全に埋もれて読めなくなるため、ここでは使わない)。
                // 代わりにweek-block-overrun-glowで縁をテーマのアクセントカラーでパルス発光させ、
                // 演出テーマらしさを保ちつつ文字は読めるようにする
                const isLightBackground = b.kind === "actual" && !b.overPlan;
                return (
                  <WeekBlockBar
                    key={b.key}
                    top={top}
                    height={height}
                    label={b.taskName}
                    tooltip={b.detail}
                    textClassName={isLightBackground ? "text-ink/90" : "text-cream/90"}
                    className={
                      b.kind === "scheduled"
                        ? "rounded border-2 border-cream/70 bg-ink/60"
                        : `rounded ${b.overPlan ? "bg-alert week-block-overrun-glow" : "bg-cream"} opacity-90`
                    }
                    onTap={() => setSelected({ ds, block: b })}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="mt-3 rounded-lg border border-cream/20 bg-ink p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 whitespace-pre-line break-words text-sm text-cream">{selected.block.detail}</p>
            <button
              className="shrink-0 text-lg leading-none text-cream/50 hover:text-cream"
              onClick={() => setSelected(null)}
              aria-label="詳細を閉じる"
            >
              ×
            </button>
          </div>
          <button
            className="btn-pill-outline mt-3 text-xs"
            onClick={() => {
              onSelectDate(selected.ds);
              setSelected(null);
            }}
          >
            {selected.ds} を1日表示で見る
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-cream/60">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-cream" /> 実績
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-alert" /> 実績（超過）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border-2 border-cream/70 bg-ink/60" /> カレンダー予定（実時刻）
        </span>
        <span className="text-cream/40">
          日付見出しをタップすると1日表示に切り替わります／ブロックをタップすると詳細を表示します／2本指ピンチで拡大縮小、左右スワイプで前後の週へ移動できます
        </span>
      </div>
    </div>
  );
}
