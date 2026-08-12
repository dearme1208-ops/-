"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { segmentsAccumulatedMs } from "@/lib/tasks";
import { formatClock, formatHms, todayStr } from "@/lib/time";
import type { DailyTask } from "@/lib/types";
import { CONDITION_LEVELS } from "@/lib/condition";
import ConditionGlyph from "@/components/ui/ConditionGlyph";
import { useVisualMode } from "@/lib/theme";

const DEFAULT_PX_PER_MIN = 6;
const MIN_PX_PER_MIN = 0.05;
const MAX_PX_PER_MIN = 160;
const ROW_H_OVERLAP = 46;
const ROW_H_STACKED = 64;
const DAY_MINUTES = 24 * 60;
// 1本化表示で隣り合う別々のバーが視覚的に1本に繋がって見えないよう、間に隙間を空ける
const COMPACT_BAR_GAP_PX = 2;

type RangeMode = "auto" | "24h";

function baseAtHour(dateStr: string, hour: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0).getTime();
}

// バーにカーソルを合わせた際、作業名・開始/終了時刻・作業時間をまとめて表示する
function segmentTooltip(name: string, startMs: number, endMs: number, ongoing: boolean): string {
  const durSec = Math.max(0, (endMs - startMs) / 1000);
  const endLabel = ongoing ? "計測中" : formatClock(endMs);
  return `${name}（実績）\n開始 ${formatClock(startMs)} 〜 終了 ${endLabel}\n作業時間 ${formatHms(durSec)}`;
}

function predictedTooltip(name: string, startMs: number, endMs: number, predictedSeconds: number): string {
  return `${name}\n予測 ${formatClock(startMs)} 〜 ${formatClock(endMs)}\n実績ベースの見込み時間 ${formatHms(predictedSeconds)}`;
}

function personalPlanTooltip(name: string, estimatedSeconds: number): string {
  return `${name}（個人目標）\n設定した予定時間 ${formatHms(estimatedSeconds)}`;
}

// 詰めて配置するためのカーソルが1つの作業にどれだけの「幅」(分)を使うかを決める。
// 完了済み・一時停止中の作業は、理論上の予測ではなく実際にかかった時間ぶんだけ使う。
// 一時停止中は「これからどれだけかかるか」を予測できない(いつ再開するか分からない)ため、
// 実績のみを場所取りに使うことで、間に別の作業を詰めて差し込めるようにする。
// 計測中・未着手の作業は、これからの見込みとして予定/予測の大きい方を使う
function planLayoutMinutes(
  status: DailyTask["status"],
  actualMin: number,
  estimatedSeconds: number,
  predictedSeconds: number
): number {
  if (status === "done" || status === "paused") return actualMin;
  return Math.max(estimatedSeconds, predictedSeconds) / 60;
}

// バー自体が数pxしかないことがあり、ブラウザ標準のtitleツールチップは狙ってホバーしにくく
// 表示されないことがあるため、CSSのgroup-hoverで即座に確実に出る独自ツールチップを使う
function HoverBar({
  left,
  width,
  top,
  height,
  className,
  style,
  tooltip,
}: {
  left: number;
  width: number;
  top: number;
  height: number;
  className: string;
  style?: CSSProperties;
  tooltip: string;
}) {
  return (
    <div className="group absolute" style={{ left, width, top, height }}>
      <div className={`h-full w-full ${className}`} style={style} />
      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-pre rounded border border-cream/30 bg-ink px-2 py-1 text-[10px] leading-tight text-cream shadow-lg group-hover:block">
        {tooltip}
      </div>
    </div>
  );
}

export default function GanttSection() {
  const [date, setDate] = useState(todayStr());
  const [now, setNow] = useState(() => Date.now());
  const [pxPerMin, setPxPerMin] = useState(DEFAULT_PX_PER_MIN);
  const [startHourStr, setStartHourStr] = useSetting("gantt.startHour", "8");
  const [rangeMode, setRangeMode] = useSetting("gantt.rangeMode", "auto");
  // ガントチャートを開いた際の初期スクロール位置。「現在時刻」を基準にするか、
  // 従来通り左端(「表示開始時刻」設定・または最初の実績/体調記録の時刻)のままにするかを選べる
  const [initialAnchor, setInitialAnchor] = useSetting("gantt.initialAnchor", "start");
  const [stackBarsStr, setStackBarsStr] = useSetting("gantt.stackBars", "false");
  const [compactViewStr, setCompactViewStr] = useSetting("gantt.compactView", "false");
  const [groupModeStr, setGroupModeStr] = useSetting("gantt.groupMode", "detail");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { va11hallaMode, themedMode } = useVisualMode();

  const startHour = Math.min(23, Math.max(0, Number(startHourStr) || 0));
  const stackBars = stackBarsStr === "true";
  const compactView = compactViewStr === "true";
  const groupMode: "detail" | "category" = groupModeStr === "category" ? "category" : "detail";
  const ROW_H = compactView ? ROW_H_OVERLAP : stackBars ? ROW_H_STACKED : ROW_H_OVERLAP;
  const planBarTop = stackBars ? 15 : 14;
  const planBarHeight = stackBars ? 14 : 20;
  const actualBarTop = stackBars ? 31 : 14;
  const actualBarHeight = stackBars ? 14 : 20;
  const endLabelTop = stackBars ? 47 : 34;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).sortBy("order"), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const conditionLogs = useLiveQuery(() => db.conditionLogs.where("date").equals(date).sortBy("loggedAt"), [date]);
  const masterMap = useMemo(() => new Map((masterTasks ?? []).map((m) => [m.id, m])), [masterTasks]);

  // 予定バーの起点: 実際に最初に計測を開始した作業の開始時刻、または最初に
  // 体調を記録した時刻のうち、より早い方を優先する（体調だけ計測開始前に記録した
  // 場合でも表示範囲外にならないようにする）。どちらもなければ「表示開始時刻」の設定に
  // フォールバックする
  const timelineBase = useMemo(() => {
    const starts: number[] = [];
    if (tasks) {
      for (const t of tasks) if (t.startedAt) starts.push(t.startedAt);
    }
    if (conditionLogs) {
      for (const log of conditionLogs) starts.push(log.loggedAt);
    }
    if (starts.length > 0) return Math.min(...starts);
    return baseAtHour(date, startHour);
  }, [tasks, conditionLogs, date, startHour]);

  const rows = useMemo(() => {
    if (!tasks) return [];
    const base = tasks.map((task) => {
      // マスタの平均から出る「予測」の生値（同日中の繰り越し調整前）
      const rawPredictedSeconds = task.masterTaskId ? masterMap.get(task.masterTaskId)?.estimatedSeconds ?? task.estimatedSeconds : task.estimatedSeconds;

      // 一時停止・再開を挟んだ場合、区間ごとに実際の開始/終了を保持する。
      // 間に別の作業を挟んで後から再開したことが分かるよう、1本にまとめずセグメント単位で扱う
      const actualSegments = task.segments
        .map((s) => ({
          startMin: (s.start - timelineBase) / 60000,
          endMin: ((s.end ?? now) - timelineBase) / 60000,
          ongoing: s.end === undefined,
        }))
        .filter((s) => s.endMin > s.startMin);

      const actualSeconds = segmentsAccumulatedMs(task, now) / 1000;

      return {
        task,
        rawPredictedSeconds,
        actualSegments,
        actualStartMin: actualSegments.length > 0 ? actualSegments[0].startMin : null,
        actualSeconds,
      };
    });

    // 同じ大項目・詳細作業名を同日中に複数回登録した場合:
    // - 「予測」は、既に今日その作業に積み上がった実績分を差し引いた「残り予測」にする
    // - 超過判定も予測を基準に行う（工程・改善は実績ベースの予測を軸にするという方針のため、
    //   個人が設定した「予定」があっても超過判定の基準には使わない。予定はあくまで目標表示）
    const predictedByTaskId = new Map<string, number>();
    const overPlanByTaskId = new Map<string, boolean>();
    const groups = new Map<string, typeof base>();
    for (const r of base) {
      const key = `${r.task.category}::${r.task.name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    for (const group of groups.values()) {
      const sorted = [...group].sort((a, b) => a.task.order - b.task.order);
      const rawPredicted = sorted[0]?.rawPredictedSeconds ?? 0;
      let cumulative = 0;
      for (const r of sorted) {
        // 前のインスタンスまでの実績がすでに想定時間を使い切っている場合、残りを0にすると
        // 予測バーが潰れてしまうため、新しい試行として改めて生の平均値を予測とする
        const remaining = rawPredicted - cumulative;
        predictedByTaskId.set(r.task.id, remaining > 0 ? remaining : rawPredicted);
        cumulative += r.actualSeconds;
        overPlanByTaskId.set(r.task.id, rawPredicted > 0 && cumulative > rawPredicted);
      }
    }

    // 詰めて配置するためのカーソル: 既に完了した作業は理論上の予測幅ではなく実際に
    // かかった時間ぶんだけカーソルを進める。そうしないと、超過した作業があった場合に
    // 後続の予測位置が現実とずれ、間延びして見えたり終了時刻を正しく可視化できなくなる。
    // まだ完了していない作業は、これからの見込みとして予定/予測の大きい方を使う
    let cursor = 0; // minutes from timelineBase
    const withLayout = base.map((r) => {
      const predictedSeconds = predictedByTaskId.get(r.task.id) ?? r.rawPredictedSeconds;
      const layoutDurationMin = planLayoutMinutes(r.task.status, r.actualSeconds / 60, r.task.estimatedSeconds, predictedSeconds);
      const scheduledStartMin = cursor;
      cursor += Math.max(layoutDurationMin, 1);
      return { ...r, predictedSeconds, scheduledStartMin, layoutMin: layoutDurationMin };
    });

    return withLayout.map((r) => ({ ...r, overPlan: overPlanByTaskId.get(r.task.id) ?? false }));
  }, [tasks, masterMap, now, timelineBase]);

  // 「予定・実績を1本ずつの行で表示」時、違う作業まで1本にまとめてしまうと
  // どれをどこまで行ったか分からなくなるため、異なる作業のバーは分けたまま表示する。
  // 一時停止・再開で同じ作業に何度も戻ってきた場合も、間に別の作業を挟んでいれば
  // 区別できるよう、タスク単位ではなく実際の作業セグメント単位で時系列に並べてから
  // 直前と完全に同じ大項目・作業名が連続する場合のみまとめる
  const mergedActualIntervals = useMemo(() => {
    const flat: { start: number; end: number; category: string; name: string; overPlan: boolean; ongoing: boolean }[] = [];
    for (const r of rows) {
      for (const seg of r.actualSegments) {
        flat.push({
          start: seg.startMin,
          end: seg.endMin,
          category: r.task.category,
          name: r.task.name,
          overPlan: r.overPlan,
          ongoing: seg.ongoing,
        });
      }
    }
    flat.sort((a, b) => a.start - b.start);

    const merged: typeof flat = [];
    for (const iv of flat) {
      const last = merged[merged.length - 1];
      if (last && last.category === iv.category && last.name === iv.name) {
        last.end = Math.max(last.end, iv.end);
        last.overPlan = last.overPlan || iv.overPlan;
        last.ongoing = iv.ongoing;
      } else {
        merged.push({ ...iv });
      }
    }
    return merged;
  }, [rows]);

  // 1本化しない通常表示: 1日の流れを上から下へ段々に追えるよう、実際の作業区間
  // （一時停止・再開で分かれた区間）単位で並べる。同じ作業が間に別の作業を挟まず
  // 連続する場合のみ1つのブロックにまとめる（mergedActualIntervalsと同じ考え方）。
  // 「詳細作業別」ではブロックごとに1行、「大項目別」では同じ大項目のブロックを
  // 同じ行（レーン）にまとめて表示する。まだ着手していない作業は予定順で末尾に並べる
  const ganttRows = useMemo(() => {
    type GanttItem = {
      task: DailyTask;
      scheduledStartMin: number;
      predictedSeconds: number;
      overPlan: boolean;
      block: { start: number; end: number; ongoing: boolean } | null;
      showPlan: boolean; // 同じ作業の2回目以降のブロックでは予定バーを重複表示しない
    };
    type GanttRow = { key: string; label: string; sublabel: string; items: GanttItem[] };
    type Block = {
      task: DailyTask;
      start: number;
      end: number;
      ongoing: boolean;
      overPlan: boolean;
      scheduledStartMin: number;
      predictedSeconds: number;
    };

    const flat: { start: number; end: number; ongoing: boolean; r: (typeof rows)[number] }[] = [];
    for (const r of rows) {
      for (const seg of r.actualSegments) {
        flat.push({ start: seg.startMin, end: seg.endMin, ongoing: seg.ongoing, r });
      }
    }
    flat.sort((a, b) => a.start - b.start);

    const blocks: Block[] = [];
    for (const iv of flat) {
      const last = blocks[blocks.length - 1];
      if (last && last.task.category === iv.r.task.category && last.task.name === iv.r.task.name) {
        last.end = Math.max(last.end, iv.end);
        last.ongoing = iv.ongoing;
        last.overPlan = last.overPlan || iv.r.overPlan;
        continue;
      }
      blocks.push({
        task: iv.r.task,
        start: iv.start,
        end: iv.end,
        ongoing: iv.ongoing,
        overPlan: iv.r.overPlan,
        scheduledStartMin: iv.r.scheduledStartMin,
        predictedSeconds: iv.r.predictedSeconds,
      });
    }

    const pendingTasksSorted = rows
      .filter((r) => r.actualSegments.length === 0)
      .sort((a, b) => a.scheduledStartMin - b.scheduledStartMin);

    function stackPlans(items: GanttItem[]) {
      let cursor = 0;
      for (const item of items) {
        if (!item.showPlan) continue;
        item.scheduledStartMin = cursor;
        const actualMin = item.block ? item.block.end - item.block.start : 0;
        const durationMin = planLayoutMinutes(item.task.status, actualMin, item.task.estimatedSeconds, item.predictedSeconds);
        cursor += Math.max(durationMin, 1);
      }
    }

    if (groupMode === "detail") {
      const seenTaskIds = new Set<string>();
      const blockRows: GanttRow[] = blocks.map((b, i) => {
        const showPlan = !seenTaskIds.has(b.task.id);
        seenTaskIds.add(b.task.id);
        return {
          key: `block-${i}`,
          label: b.task.name,
          sublabel: b.task.category,
          items: [
            {
              task: b.task,
              scheduledStartMin: b.scheduledStartMin,
              predictedSeconds: b.predictedSeconds,
              overPlan: b.overPlan,
              block: { start: b.start, end: b.end, ongoing: b.ongoing },
              showPlan,
            },
          ],
        };
      });
      const pendingRows: GanttRow[] = pendingTasksSorted.map((r) => ({
        key: `pending-${r.task.id}`,
        label: r.task.name,
        sublabel: r.task.category,
        items: [
          {
            task: r.task,
            scheduledStartMin: r.scheduledStartMin,
            predictedSeconds: r.predictedSeconds,
            overPlan: r.overPlan,
            block: null,
            showPlan: true,
          },
        ],
      }));
      const combined = [...blockRows, ...pendingRows];
      // 詳細作業別では、上から下への並び順どおりにグローバルに予定バーを積み上げる
      stackPlans(combined.flatMap((row) => row.items));
      return combined;
    }

    // 大項目別: 同じ大項目のブロック・未着手タスクを1つの行（レーン）にまとめる
    const order: string[] = [];
    const byCategory = new Map<string, { blocks: Block[]; pending: (typeof rows)[number][] }>();
    for (const b of blocks) {
      if (!byCategory.has(b.task.category)) {
        byCategory.set(b.task.category, { blocks: [], pending: [] });
        order.push(b.task.category);
      }
      byCategory.get(b.task.category)!.blocks.push(b);
    }
    for (const r of pendingTasksSorted) {
      if (!byCategory.has(r.task.category)) {
        byCategory.set(r.task.category, { blocks: [], pending: [] });
        order.push(r.task.category);
      }
      byCategory.get(r.task.category)!.pending.push(r);
    }

    return order.map((category) => {
      const entry = byCategory.get(category)!;
      const seenTaskIds = new Set<string>();
      const items: GanttItem[] = entry.blocks.map((b) => {
        const showPlan = !seenTaskIds.has(b.task.id);
        seenTaskIds.add(b.task.id);
        return {
          task: b.task,
          scheduledStartMin: b.scheduledStartMin,
          predictedSeconds: b.predictedSeconds,
          overPlan: b.overPlan,
          block: { start: b.start, end: b.end, ongoing: b.ongoing },
          showPlan,
        };
      });
      for (const r of entry.pending) {
        items.push({
          task: r.task,
          scheduledStartMin: r.scheduledStartMin,
          predictedSeconds: r.predictedSeconds,
          overPlan: r.overPlan,
          block: null,
          showPlan: !seenTaskIds.has(r.task.id),
        });
        seenTaskIds.add(r.task.id);
      }
      // 大項目別では、行（レーン）ごとに独立して予定バーを積み上げる
      stackPlans(items);
      return { key: `cat-${category}`, label: category, sublabel: "", items };
    });
  }, [rows, groupMode]);

  const autoMinutes = Math.max(
    ...rows.map((r) => r.scheduledStartMin + Math.max(r.task.estimatedSeconds, r.predictedSeconds) / 60),
    ...rows.flatMap((r) => r.actualSegments.map((s) => s.endMin)),
    ...ganttRows
      .flatMap((row) => row.items)
      .filter((item) => item.showPlan)
      .map((item) => item.scheduledStartMin + Math.max(item.task.estimatedSeconds, item.predictedSeconds) / 60),
    480
  );
  const totalMinutes = rangeMode === "24h" ? Math.max(DAY_MINUTES, autoMinutes) : autoMinutes;
  const hourMarks = Array.from({ length: Math.ceil(totalMinutes / 60) + 1 }, (_, i) => i);
  // ズームアウト時にラベルが重なって読めなくなるのを防ぐため、間引いて表示する
  const MIN_LABEL_SPACING_PX = 34;
  const labelStepHours = Math.max(1, Math.ceil(MIN_LABEL_SPACING_PX / (60 * pxPerMin)));
  // 時間線が1時間刻みで表示できるくらいズームしている時だけ、10分刻みの補助線を表示する
  const MIN_GRIDLINE_SPACING_PX = 4;
  const minuteStep = labelStepHours > 1 ? 0 : pxPerMin * 10 >= MIN_GRIDLINE_SPACING_PX ? 10 : pxPerMin * 30 >= MIN_GRIDLINE_SPACING_PX ? 30 : 0;
  const minuteMarks: number[] = [];
  if (minuteStep > 0) {
    for (let m = 0; m <= totalMinutes; m += minuteStep) {
      if (m % 60 !== 0) minuteMarks.push(m);
    }
  }

  // 体調が記録された時刻を、タイムライン上の位置(分)に変換する。表示範囲外は除く
  const conditionMarkers = (conditionLogs ?? [])
    .map((log) => ({ log, minutes: (log.loggedAt - timelineBase) / 60000 }))
    .filter((m) => m.minutes >= 0 && m.minutes <= totalMinutes);

  // カレンダー予定インポート(scheduledTime)で登録された作業は、所要時間の積み上げではなく
  // 実際の時刻に基づく別軸として表示する。予測・予定はあくまで所要時間の見込みだが、
  // こちらは「その時刻に決まっている予定」という性質が異なるため区別する
  const scheduleItems = (tasks ?? [])
    .filter((t) => !!t.scheduledTime)
    .map((t) => {
      const [hh, mm] = t.scheduledTime!.split(":").map(Number);
      const startMs = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`).getTime();
      const startMin = (startMs - timelineBase) / 60000;
      const durMin = Math.max(t.estimatedSeconds / 60, 1);
      return { task: t, startMin, endMin: startMin + durMin };
    })
    .filter((it) => it.endMin > 0 && it.startMin < totalMinutes);

  function zoomIn() {
    setPxPerMin((v) => Math.min(MAX_PX_PER_MIN, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerMin((v) => Math.max(MIN_PX_PER_MIN, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const containerWidth = scrollRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0 || totalMinutes <= 0) return;
    const fit = Math.max(0, containerWidth - 40) / totalMinutes;
    setPxPerMin(Math.min(MAX_PX_PER_MIN, Math.max(MIN_PX_PER_MIN, +fit.toFixed(3))));
  }

  // 「現在時刻」を初期位置にする設定の場合、日付・拡大縮小を変えるたびに
  // 現在時刻の位置が見える所までスクロールする(「設定時刻」の場合は既定の左端=0のままにする)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (initialAnchor !== "now") {
      el.scrollLeft = 0;
      return;
    }
    const nowMin = (Date.now() - timelineBase) / 60000;
    el.scrollLeft = Math.max(0, nowMin * pxPerMin - el.clientWidth / 2);
  }, [date, initialAnchor, pxPerMin, totalMinutes, timelineBase]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-cream/70">日付</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomOut} aria-label="縮小">
            －
          </button>
          <button className="btn-pill-outline px-3 py-1.5 text-sm" onClick={zoomIn} aria-label="拡大">
            ＋
          </button>
          <button className="btn-pill-outline text-xs" onClick={fitToView}>
            全体表示
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-cream/60">初期表示位置</label>
          <button
            className={initialAnchor === "start" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setInitialAnchor("start")}
          >
            設定時刻
          </button>
          <button
            className={initialAnchor === "now" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setInitialAnchor("now")}
          >
            現在時刻
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-cream/60">表示開始時刻（未着手の日のみ）</label>
          <select
            value={startHour}
            onChange={(e) => setStartHourStr(e.target.value)}
            className="rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={rangeMode === "auto" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setRangeMode("auto" satisfies RangeMode)}
          >
            作業に合わせる
          </button>
          <button
            className={rangeMode === "24h" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setRangeMode("24h" satisfies RangeMode)}
          >
            24時間表示
          </button>
        </div>
        {!compactView && (
          <label className="flex items-center gap-2 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={stackBars}
              onChange={(e) => setStackBarsStr(e.target.checked ? "true" : "false")}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            予定と実績を重ねずに表示
          </label>
        )}
        {!compactView && (
          <label className="flex items-center gap-2 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={groupMode === "category"}
              onChange={(e) => setGroupModeStr(e.target.checked ? "category" : "detail")}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            大項目でまとめて表示
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-cream/60">
          <input
            type="checkbox"
            checked={compactView}
            onChange={(e) => setCompactViewStr(e.target.checked ? "true" : "false")}
            className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
          />
          予定・実績を1本ずつの行で表示
        </label>
      </div>

      <div className="panel flex p-4">
        {/* 固定ラベル列: 横スクロールしても常に見える */}
        <div className="w-32 shrink-0 pr-2 sm:w-44">
          <div className="mb-2 h-6 border-b border-cream/20" />
          {/* 右側のタイムライン列に体調マーカー・カレンダー予定レーンがある場合、ラベル列がずれないよう
              同じマークアップ(見えない状態)で同じ高さのスペーサーを確保する */}
          {conditionMarkers.length > 0 && <div className="mb-1 h-5" />}
          {scheduleItems.length > 0 && (
            <div className="mb-4">
              <div className="mb-1 text-[10px] leading-normal opacity-0">カレンダー予定</div>
              <div style={{ height: 24 }} />
            </div>
          )}
          {compactView ? (
            <>
              <div className="flex items-center text-[11px] font-bold text-cream/70" style={{ height: ROW_H }}>
                予測
              </div>
              <div className="flex items-center text-[11px] font-bold text-cream/70" style={{ height: ROW_H }}>
                実績
              </div>
            </>
          ) : (
            ganttRows.map((row) => (
              <div
                key={row.key}
                className="flex flex-col justify-center overflow-hidden text-[11px] leading-tight text-cream/70"
                style={{ height: ROW_H }}
                title={row.sublabel ? `${row.sublabel} / ${row.label}` : row.label}
              >
                {row.sublabel && <span className="truncate text-cream/50">{row.sublabel}</span>}
                <span className="truncate">{row.label}</span>
              </div>
            ))
          )}
        </div>

        {/* スクロール可能なタイムライン */}
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div style={{ width: totalMinutes * pxPerMin + 40 }}>
            {/* axis */}
            <div className="relative mb-2 h-6 border-b border-cream/20 text-xs text-cream/50">
              {hourMarks
                .filter((h) => h % labelStepHours === 0)
                .map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 border-l border-cream/10 pl-1"
                    style={{ left: h * 60 * pxPerMin }}
                  >
                    {formatClock(timelineBase + h * 60 * 60000)}
                  </div>
                ))}
            </div>

            {/* 体調の変化: 記録された時刻にアイコンを表示する */}
            {conditionMarkers.length > 0 && (
              <div className="relative mb-1 h-5">
                {conditionMarkers.map(({ log, minutes }) => (
                  <div
                    key={log.id}
                    className="group absolute -translate-x-1/2"
                    style={{ left: minutes * pxPerMin }}
                  >
                    <ConditionGlyph level={log.level} size={16} />
                    <div className="pointer-events-none absolute top-full left-1/2 z-20 mt-1 hidden -translate-x-1/2 whitespace-pre rounded border border-cream/30 bg-ink px-2 py-1 text-[10px] leading-tight text-cream shadow-lg group-hover:block">
                      {formatClock(log.loggedAt)} 体調:{" "}
                      {CONDITION_LEVELS.find((c) => c.level === log.level)?.label ?? log.level}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* カレンダー予定インポート: 所要時間の積み上げではなく、実際の時刻に基づく別軸として表示する。
                下の予測/実績の帯と重ならないよう、ラベルは通常フロー・バー領域は独立した高さで確保する */}
            {scheduleItems.length > 0 && (
              <div className="mb-4">
                <div className="mb-1 text-[10px] text-cream/40">カレンダー予定</div>
                <div className="relative" style={{ height: 24 }}>
                  {scheduleItems.map(({ task, startMin, endMin }) => (
                    <div
                      key={`sched-${task.id}`}
                      className="group absolute flex items-center overflow-hidden rounded border-2 border-cream/70 bg-ink/60 px-1 text-[10px] leading-none text-cream/90"
                      style={{ left: startMin * pxPerMin, width: Math.max((endMin - startMin) * pxPerMin, 3), top: 0, height: 20 }}
                    >
                      <span className="truncate">{task.name}</span>
                      <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-pre rounded border border-cream/30 bg-ink px-2 py-1 text-[10px] leading-tight text-cream shadow-lg group-hover:block">
                        {`${task.name}（カレンダー予定）\n${task.scheduledTime} 〜 ${formatClock(timelineBase + endMin * 60000)}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="relative" style={{ height: (compactView ? 2 : ganttRows.length) * ROW_H }}>
              {minuteMarks.map((m) => (
                <div
                  key={`m${m}`}
                  className="absolute top-0 bottom-0 border-l border-cream/[0.04]"
                  style={{ left: m * pxPerMin }}
                />
              ))}
              {hourMarks
                .filter((h) => h % labelStepHours === 0)
                .map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 border-l border-cream/5"
                    style={{ left: h * 60 * pxPerMin }}
                  />
                ))}
              {conditionMarkers.map(({ log, minutes }) => (
                <div
                  key={`condline-${log.id}`}
                  className="absolute top-0 bottom-0 border-l border-dashed border-alert/40"
                  style={{ left: minutes * pxPerMin }}
                />
              ))}
              {compactView ? (
                <>
                  {/* 予測行: 全作業の予測バーを1本の行にまとめて表示（実績ベースの見込みを主役にする）。
                      完了済みの作業は、幅も理論上の予測ではなく実際にかかった時間で描画し、
                      隙間や重なりが出ないよう隣同士がぴったり詰まるようにする（詰めて配置
                      することで、超過があっても後続の位置・終了時刻を正しく可視化できる） */}
                  {rows.map((r) => {
                    const startMin = r.scheduledStartMin;
                    const planLeft = startMin * pxPerMin;
                    const planWidth = Math.max((r.task.estimatedSeconds / 60) * pxPerMin, 3);
                    const predWidth = Math.max(r.layoutMin * pxPerMin, 3);
                    const predEndMin = startMin + r.layoutMin;
                    const predEndLabel = formatClock(timelineBase + predEndMin * 60000);
                    const gapLeft = planLeft + COMPACT_BAR_GAP_PX / 2;
                    const gapPredWidth = Math.max(predWidth - COMPACT_BAR_GAP_PX, 3);
                    const gapPlanWidth = Math.max(planWidth - COMPACT_BAR_GAP_PX, 3);
                    return (
                      <div key={`plan-${r.task.id}`} className="absolute left-0 right-0" style={{ top: 0, height: ROW_H }}>
                        <div
                          className="absolute whitespace-nowrap text-[10px] font-medium leading-3 text-cream/90"
                          style={{ left: planLeft + 2, top: 1 }}
                        >
                          {r.task.name}
                        </div>
                        <HoverBar
                          left={gapLeft}
                          width={gapPredWidth}
                          top={14}
                          height={20}
                          className="rounded bg-cream/70"
                          tooltip={predictedTooltip(
                            r.task.name,
                            timelineBase + startMin * 60000,
                            timelineBase + predEndMin * 60000,
                            r.predictedSeconds
                          )}
                        />
                        {/* 個人が設定した「予定」(任意)は、目標ラインとして予測バーに重ねて薄く表示するだけに留める */}
                        {r.task.hasPlan === true && (
                          <HoverBar
                            left={gapLeft}
                            width={gapPlanWidth}
                            top={14}
                            height={20}
                            className="rounded border border-dashed border-cream/70"
                            tooltip={personalPlanTooltip(r.task.name, r.task.estimatedSeconds)}
                          />
                        )}
                        <div
                          className="absolute whitespace-nowrap text-[10px] leading-3 text-cream/60"
                          style={{ left: planLeft + predWidth + 3, top: 34 }}
                        >
                          {predEndLabel}
                        </div>
                      </div>
                    );
                  })}
                  {/* 実績行: 全作業の実績バーを1本の行にまとめて表示。
                      異なる作業は分けたまま、同じ作業が連続する場合のみ1本のバーにまとめる */}
                  {mergedActualIntervals.map((iv, idx) => {
                    const actualLeft = iv.start * pxPerMin;
                    const actualWidth = Math.max((iv.end - iv.start) * pxPerMin, 3);
                    const actualEndLabel = formatClock(timelineBase + iv.end * 60000);
                    const label = iv.name;
                    const gapLeft = actualLeft + COMPACT_BAR_GAP_PX / 2;
                    const gapWidth = Math.max(actualWidth - COMPACT_BAR_GAP_PX, 3);
                    return (
                      <div key={`actual-${idx}`} className="absolute left-0 right-0" style={{ top: ROW_H, height: ROW_H }}>
                        <div
                          className="absolute whitespace-nowrap text-[10px] font-medium leading-3 text-cream/90"
                          style={{ left: actualLeft + 2, top: 1 }}
                        >
                          {label}
                        </div>
                        <HoverBar
                          left={gapLeft}
                          width={gapWidth}
                          top={14}
                          height={20}
                          className={`rounded ${
                            iv.overPlan
                              ? `bg-alert ${themedMode ? (va11hallaMode ? "gantt-bar-overrun-v11" : "gantt-bar-overrun") : ""}`
                              : "bg-cream"
                          } opacity-90`}
                          style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
                          tooltip={segmentTooltip(
                            label,
                            timelineBase + iv.start * 60000,
                            timelineBase + iv.end * 60000,
                            iv.ongoing
                          )}
                        />
                        <div
                          className="absolute whitespace-nowrap text-[10px] leading-3 text-cream/60"
                          style={{ left: actualLeft + actualWidth + 3, top: 34 }}
                        >
                          {actualEndLabel}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                ganttRows.map((row, idx) => {
                  const top = idx * ROW_H;
                  return (
                    <div key={row.key} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                      {row.items.map((item, itemIdx) => {
                        // 完了済み・一時停止中の作業は、幅も理論上の予測ではなく実際にかかった
                        // 時間(ブロックの長さ)で描画し、後続の位置・終了時刻とぴったり詰まるようにする
                        const layoutDurationMin = planLayoutMinutes(
                          item.task.status,
                          item.block ? item.block.end - item.block.start : 0,
                          item.task.estimatedSeconds,
                          item.predictedSeconds
                        );
                        const planLeft = item.scheduledStartMin * pxPerMin;
                        const planWidth = Math.max((item.task.estimatedSeconds / 60) * pxPerMin, 3);
                        const predWidth = Math.max(layoutDurationMin * pxPerMin, 3);
                        const predEndMin = item.scheduledStartMin + layoutDurationMin;
                        const hasActual = item.block !== null;
                        const nameLeft = hasActual ? item.block!.start * pxPerMin : planLeft;
                        const endMin = hasActual ? item.block!.end : predEndMin;
                        const endLeft = endMin * pxPerMin;
                        const endLabel = formatClock(timelineBase + endMin * 60000);
                        return (
                          <div key={itemIdx}>
                            {/* 作業名ラベル */}
                            <div
                              className="absolute whitespace-nowrap text-[10px] font-medium leading-3 text-cream/90"
                              style={{ left: nameLeft + 2, top: 1 }}
                            >
                              {item.task.name}
                            </div>
                            {/* 予測バー（実線・主役）・個人が設定した予定(点線・任意): 同じ作業の2回目以降のブロックでは重複表示しない */}
                            {item.showPlan && (
                              <>
                                <HoverBar
                                  left={planLeft}
                                  width={predWidth}
                                  top={planBarTop}
                                  height={planBarHeight}
                                  className="rounded bg-cream/70"
                                  tooltip={predictedTooltip(
                                    item.task.name,
                                    timelineBase + item.scheduledStartMin * 60000,
                                    timelineBase + predEndMin * 60000,
                                    item.predictedSeconds
                                  )}
                                />
                                {item.task.hasPlan === true && (
                                  <HoverBar
                                    left={planLeft}
                                    width={planWidth}
                                    top={planBarTop}
                                    height={planBarHeight}
                                    className="rounded border border-dashed border-cream/70"
                                    tooltip={personalPlanTooltip(item.task.name, item.task.estimatedSeconds)}
                                  />
                                )}
                              </>
                            )}
                            {/* 実績バー: 一時停止・再開で区切られた区間ごとに描画される */}
                            {item.block && (
                              <HoverBar
                                left={item.block.start * pxPerMin}
                                width={Math.max((item.block.end - item.block.start) * pxPerMin, 3)}
                                top={actualBarTop}
                                height={actualBarHeight}
                                className={`rounded ${
                                  item.overPlan
                                    ? `bg-alert ${themedMode ? (va11hallaMode ? "gantt-bar-overrun-v11" : "gantt-bar-overrun") : ""}`
                                    : "bg-cream"
                                } opacity-90`}
                                style={{ boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
                                tooltip={segmentTooltip(
                                  item.task.name,
                                  timelineBase + item.block.start * 60000,
                                  timelineBase + item.block.end * 60000,
                                  item.block.ongoing
                                )}
                              />
                            )}
                            {/* 終了時刻ラベル */}
                            <div
                              className="absolute whitespace-nowrap text-[10px] leading-3 text-cream/60"
                              style={{ left: endLeft + 3, top: endLabelTop }}
                            >
                              {endLabel}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-cream/60">
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-cream/70" /> 予測（実績ベースの見込み）</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-dashed border-cream/70" /> 予定（個人が設定した目標。任意）</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-cream" /> 実績</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-alert" /> 実績（超過）</span>
        {scheduleItems.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border-2 border-cream/70 bg-ink/60" /> カレンダー予定（実時刻）
          </span>
        )}
        <span className="flex items-center gap-1">
          <ConditionGlyph level="3" size={14} /> 体調の変化（縦線が記録時刻）
        </span>
      </div>

      {(!tasks || tasks.length === 0) && (
        <p className="text-sm text-cream/50">この日の作業リストがありません。</p>
      )}
    </div>
  );
}
