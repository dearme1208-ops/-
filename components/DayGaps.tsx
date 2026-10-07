"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { parseBreakRanges } from "@/lib/breaks";
import { findDayGaps, findLongSpans, gapKey, type DayGap } from "@/lib/dayGaps";
import { recordSpanAsTask } from "@/lib/quickStamp";
import { useSetting } from "@/lib/settings";
import { formatClock, formatHms } from "@/lib/time";
import type { DailyTask, MasterTask } from "@/lib/types";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import { QuickStampPanel } from "@/components/sections/today/QuickStamp";

// 「今日の抜けを埋める」。1日の記録を整えるのに、振り返り・打刻の一覧・実績編集を行き来していたのを
// 今日のリング(components/viz/TodayViz.tsx)の下にまとめる。抜けはリングの上にも点線で描く。並べるのは次の3つ:
//  - 記録のない時間(最初に計り始めてから最後に止めるまでの、どの作業も計っていない時間。休憩時間は除く)
//  - まだ実績にしていない打刻
//  - 1回で3時間以上続いた計測(止め忘れの疑い)
// 記録のない時間は、作業を選べばその時間を計った作業として完了に並ぶ(打刻を実績にするのと同じ仕組み)

export function useDayGapCount(date: string, now: number): number {
  const { gaps, longSpans } = useDayGaps(date, now);
  return gaps.length + longSpans.length;
}

function safeParse(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 今日の抜け(記録のない時間・未記録の打刻・長すぎる計測)と、「記録しない」にする操作 */
export function useDayGaps(date: string, now: number) {
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const [breaksJson] = useSetting("today.provisionalBreakRanges", "[]");
  const [dismissedJson, setDismissedJson] = useSetting(`today.gapDismissed.${date}`, "[]");
  const dismissed = useMemo(() => new Set(safeParse(dismissedJson)), [dismissedJson]);
  const minute = Math.floor(now / 60_000);
  const gaps = useMemo(
    () => findDayGaps(tasks ?? [], date, parseBreakRanges(breaksJson), now).filter((g) => !dismissed.has(gapKey(g))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, date, breaksJson, minute, dismissed]
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const longSpans = useMemo(() => findLongSpans(tasks ?? [], now), [tasks, minute]);
  const pendingStamps =
    useLiveQuery(() => db.quickStamps.where("date").equals(date).filter((s) => !s.recordId && !s.skipped).count(), [date]) ?? 0;
  const dismiss = (g: DayGap) => setDismissedJson(JSON.stringify([...dismissed, gapKey(g)]));
  return { tasks: tasks ?? [], gaps, longSpans, pendingStamps, dismiss };
}

/** 今日のリングの下に並べる「抜けを埋める」一覧。openGap はリングで押された抜け(その行の作業選びを開く) */
export function DayGapsList({
  date,
  now,
  data,
  openGap,
  onOpenGap,
  onEditTask,
}: {
  date: string;
  now: number;
  data: ReturnType<typeof useDayGaps>;
  openGap: string | null;
  onOpenGap: (key: string | null) => void;
  onEditTask: (task: DailyTask) => void;
}) {
  const { tasks, gaps, longSpans, pendingStamps, dismiss } = data;
  const count = gaps.length + longSpans.length + pendingStamps;
  return (
    <div className="space-y-3 text-sm" data-testid="day-gaps">
      <h4 className="text-xs font-bold text-cream/80">
        🧩 抜けを埋める{count > 0 ? `（${count}）` : ""}
      </h4>
      {count === 0 && <p className="text-xs text-cream/55">埋める所はありません。今日の記録はつながっています。</p>}

      {gaps.length > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] text-cream/55">記録のない時間（輪の点線の所）</p>
          {gaps.map((g) => (
            <GapRow
              key={gapKey(g)}
              gap={g}
              date={date}
              open={openGap === gapKey(g)}
              onToggle={() => onOpenGap(openGap === gapKey(g) ? null : gapKey(g))}
              onDismiss={() => dismiss(g)}
            />
          ))}
        </section>
      )}

      {pendingStamps > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] text-cream/55">まだ実績にしていない打刻（{pendingStamps}）</p>
          <QuickStampPanel date={date} now={now} />
        </section>
      )}

      {longSpans.length > 0 && (
        <section className="space-y-2">
          <p className="text-[11px] text-cream/55">長すぎる計測（止め忘れかも）</p>
          {longSpans.map((l) => {
            const task = tasks.find((t) => t.id === l.taskId);
            return (
              <div key={`${l.taskId}-${l.start}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-alert/30 p-3">
                <div className="min-w-0">
                  <div className="truncate font-bold text-cream">{l.name}</div>
                  <div className="text-xs tabular-nums text-cream/60">
                    {formatClock(l.start)}〜{l.running ? "計測中" : formatClock(l.end)}（{formatHms(Math.round((l.end - l.start) / 1000))}）
                  </div>
                </div>
                {task && (
                  <button className="btn-pill-outline text-xs" onClick={() => onEditTask(task)}>
                    時刻を直す
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function GapRow({ gap, date, open, onToggle, onDismiss }: { gap: DayGap; date: string; open: boolean; onToggle: () => void; onDismiss: () => void }) {
  const [picked, setPicked] = useState<MasterTask | null>(null);
  const [busy, setBusy] = useState(false);
  const minutes = Math.round((gap.end - gap.start) / 60_000);
  return (
    <div className={`space-y-2 rounded-lg border p-3 ${open ? "border-alert/50" : "border-cream/15"}`} data-testid="day-gap">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="tabular-nums text-cream">
          {formatClock(gap.start)}〜{formatClock(gap.end)}
          <span className="ml-1 text-xs text-cream/55">（{minutes}分）</span>
        </div>
        <div className="flex gap-1.5">
          <button className={`${open ? "btn-pill" : "btn-pill-outline"} text-xs`} onClick={onToggle}>
            作業を選ぶ
          </button>
          <button className="btn-pill-outline text-xs" onClick={onDismiss} title="休憩・移動など、記録しない時間にする">
            記録しない
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-2">
          <div className="max-h-64 overflow-y-auto">
            <MasterTaskPicker selectedId={picked?.id} onSelect={setPicked} />
          </div>
          <button
            className="btn-pill w-full text-sm"
            disabled={!picked || busy}
            onClick={async () => {
              if (!picked) return;
              setBusy(true);
              await recordSpanAsTask(date, picked.category, picked.name, gap.start, gap.end);
              setBusy(false);
            }}
          >
            {picked ? `この${minutes}分を「${picked.name}」として記録` : "作業を選んでください"}
          </button>
        </div>
      )}
    </div>
  );
}
