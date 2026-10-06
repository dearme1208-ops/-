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
import Modal from "@/components/ui/Modal";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import { QuickStampPanel } from "@/components/sections/today/QuickStamp";

// 「今日の抜けを埋める」。1日の記録を整えるのに、振り返り・打刻の一覧・実績編集を行き来していたのを
// 1画面にまとめる。並べるのは次の3つ:
//  - 記録のない時間(最初に計り始めてから最後に止めるまでの、どの作業も計っていない時間。休憩時間は除く)
//  - まだ実績にしていない打刻
//  - 1回で3時間以上続いた計測(止め忘れの疑い)
// 記録のない時間は、作業を選べばその時間を計った作業として完了に並ぶ(打刻を実績にするのと同じ仕組み)

export function useDayGapCount(date: string, now: number): number {
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const [breaksJson] = useSetting("today.provisionalBreakRanges", "[]");
  const [dismissedJson] = useSetting(`today.gapDismissed.${date}`, "[]");
  return useMemo(() => {
    const dismissed = new Set<string>(safeParse(dismissedJson));
    const gaps = findDayGaps(tasks ?? [], date, parseBreakRanges(breaksJson), now).filter((g) => !dismissed.has(gapKey(g)));
    // 1分ごとにしか変わらない数なので、秒の刻みで再計算しないよう分に丸めた時刻で数える
    return gaps.length + findLongSpans(tasks ?? [], now).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, breaksJson, dismissedJson, date, Math.floor(now / 60_000)]);
}

function safeParse(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function DayGapsModal({
  date,
  now,
  onEditTask,
  onClose,
}: {
  date: string;
  now: number;
  onEditTask: (task: DailyTask) => void;
  onClose: () => void;
}) {
  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const [breaksJson] = useSetting("today.provisionalBreakRanges", "[]");
  const [dismissedJson, setDismissedJson] = useSetting(`today.gapDismissed.${date}`, "[]");
  const dismissed = useMemo(() => new Set(safeParse(dismissedJson)), [dismissedJson]);
  const gaps = useMemo(
    () => findDayGaps(tasks ?? [], date, parseBreakRanges(breaksJson), now).filter((g) => !dismissed.has(gapKey(g))),
    [tasks, date, breaksJson, now, dismissed]
  );
  const longSpans = useMemo(() => findLongSpans(tasks ?? [], now), [tasks, now]);
  const pendingStamps = useLiveQuery(
    () => db.quickStamps.where("date").equals(date).filter((s) => !s.recordId && !s.skipped).count(),
    [date]
  );
  const nothing = gaps.length === 0 && longSpans.length === 0 && !pendingStamps;

  return (
    <Modal title="🧩 今日の抜けを埋める" onClose={onClose}>
      <div className="space-y-4 text-sm" data-testid="day-gaps">
        {nothing && (
          <p className="rounded-lg border border-cream/15 p-4 text-center text-cream/70">
            埋める所はありません。今日の記録はつながっています。
          </p>
        )}

        {gaps.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-xs font-bold text-cream/80">記録のない時間（{gaps.length}）</h4>
            {gaps.map((g) => (
              <GapRow
                key={gapKey(g)}
                gap={g}
                date={date}
                onDismiss={() => setDismissedJson(JSON.stringify([...dismissed, gapKey(g)]))}
              />
            ))}
          </section>
        )}

        {!!pendingStamps && (
          <section className="space-y-2">
            <h4 className="text-xs font-bold text-cream/80">まだ実績にしていない打刻（{pendingStamps}）</h4>
            <QuickStampPanel date={date} now={now} />
          </section>
        )}

        {longSpans.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-xs font-bold text-cream/80">長すぎる計測（止め忘れかも）</h4>
            {longSpans.map((l) => {
              const task = tasks?.find((t) => t.id === l.taskId);
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
    </Modal>
  );
}

function GapRow({ gap, date, onDismiss }: { gap: DayGap; date: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<MasterTask | null>(null);
  const [busy, setBusy] = useState(false);
  const minutes = Math.round((gap.end - gap.start) / 60_000);
  return (
    <div className="space-y-2 rounded-lg border border-cream/15 p-3" data-testid="day-gap">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="tabular-nums text-cream">
          {formatClock(gap.start)}〜{formatClock(gap.end)}
          <span className="ml-1 text-xs text-cream/55">（{minutes}分）</span>
        </div>
        <div className="flex gap-1.5">
          <button className={`${open ? "btn-pill" : "btn-pill-outline"} text-xs`} onClick={() => setOpen((v) => !v)}>
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
