import { formatMsClock } from "@/lib/time";
import { reviewTimeboxes, timeboxNow, type TimeboxOnDay } from "@/lib/timebox";
import type { DailyTask } from "@/lib/types";

// 本日の作業の上に出す、タイムボックス(時間割)の帯。
// 枠の中なら「今はこれだけ」と残り時間、枠の外なら次の枠までの時間、
// 全部の枠が終わったら「時間どおりに始めた/止めた」枠の数を出す

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TimeboxBand({
  boxes,
  now,
  workLabel,
  onEdit,
}: {
  boxes: TimeboxOnDay[];
  now: number;
  workLabel: (t: DailyTask) => string;
  onEdit: () => void;
}) {
  if (boxes.length === 0) return null;
  const { current, next } = timeboxNow(boxes, now);
  const review = reviewTimeboxes(boxes, now);
  const ended = review.filter((r) => now >= r.endMs);
  const keptStart = ended.filter((r) => r.startedOnTime).length;
  const keptStop = ended.filter((r) => r.stoppedOnTime).length;
  const doneIdx = boxes.filter((b) => now >= b.endMs).length;

  return (
    <div className="panel space-y-2 border border-cream/25 p-3" data-testid="timebox-band">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-cream/70">⏱ 時間割</span>
        <span className="text-[10px] tabular-nums text-cream/45">
          {doneIdx}/{boxes.length}枠
        </span>
        {/* 枠の並びを小さく。今の枠を強調、終わった枠は薄く */}
        <span className="flex min-w-0 flex-1 gap-0.5" aria-hidden>
          {boxes.map((b) => (
            <span
              key={b.task.id}
              className="h-1.5 flex-1 rounded-full"
              style={{
                backgroundColor:
                  b === current
                    ? "rgb(var(--accent-rgb))"
                    : now >= b.endMs
                      ? "rgb(var(--cream-rgb) / 0.45)"
                      : "rgb(var(--cream-rgb) / 0.15)",
              }}
            />
          ))}
        </span>
        <button className="shrink-0 text-[11px] text-cream/55 underline decoration-dotted hover:text-cream" onClick={onEdit}>
          時間割を編集
        </button>
      </div>

      {current ? (
        <div className="space-y-1">
          <p className="text-[11px] text-cream/55">
            今はこれだけ（{hm(current.startMs)}〜{hm(current.endMs)}）。メールやチャットは閉じて、時間が来たら途中でも止める
          </p>
          <div className="flex items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate font-display text-lg font-bold text-cream">{workLabel(current.task)}</span>
            <span className="shrink-0 font-display text-2xl font-bold tabular-nums text-cream" data-testid="timebox-remaining">
              {formatMsClock(Math.max(0, current.endMs - now))}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-cream/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, ((now - current.startMs) / (current.endMs - current.startMs)) * 100)}%`,
                backgroundColor: "rgb(var(--accent-rgb) / 0.85)",
              }}
            />
          </div>
          {current.task.status !== "running" && (
            <p className="text-[11px] font-bold text-alert">この枠の作業がまだ計測されていません</p>
          )}
          {next && (
            <p className="truncate text-[11px] text-cream/50">
              次 {hm(next.startMs)} {workLabel(next.task)}
            </p>
          )}
        </div>
      ) : next ? (
        <p className="text-sm text-cream/80">
          次の枠 <b className="tabular-nums">{hm(next.startMs)}</b> {workLabel(next.task)}
          <span className="ml-2 text-xs tabular-nums text-cream/50">あと{formatMsClock(next.startMs - now)}</span>
        </p>
      ) : (
        <p className="text-sm text-cream/80" data-testid="timebox-review">
          今日の時間割はおしまい。時間どおりに始めた枠 <b className="tabular-nums">{keptStart}/{ended.length}</b>・止めた枠{" "}
          <b className="tabular-nums">
            {keptStop}/{ended.filter((r) => r.started).length}
          </b>
        </p>
      )}
    </div>
  );
}
