import { useMemo, useState } from "react";
import {
  ACTIVITY_DAYS,
  PROGRESS_STATUS_LABELS,
  PROGRESS_STATUS_ORDER,
  sortProgressRows,
  type ProgressRow,
  type ProgressSort,
  type ProgressStatus,
  type ProgressSummary,
} from "@/lib/progressOverview";
import { useSetting } from "@/lib/settings";

// 統合ボードの「📈 進捗」表示。ToDo・案件を1件1行で、どこまで進んだか(バー)、
// 期日に対して今どこまで進んでいてほしいか(▼)、最近動いているか(点)を並べる

// このアプリでは警告色(alert)はアクセント色と同じ色なので、状態は色の違いではなく
// 塗り(期限切れ)・枠(遅れ気味)・点線(停滞)・薄い文字(期日なし)の形で見分けられるようにする
const STATUS_CHIP: Record<ProgressStatus, string> = {
  overdue: "border-alert bg-alert font-bold text-ink",
  behind: "border-alert font-bold text-alert",
  stalled: "border-dashed border-cream/50 text-cream/80",
  onTrack: "border-cream/30 text-cream/80",
  noDue: "border-cream/15 text-cream/45",
};

const STATUS_ICON: Record<ProgressStatus, string> = {
  overdue: "⚠",
  behind: "▼",
  stalled: "…",
  onTrack: "✓",
  noDue: "－",
};

const SORT_LABELS: Record<ProgressSort, string> = {
  risk: "危ない順",
  due: "期日が近い順",
  progress: "進みが少ない順",
  idle: "止まっている順",
};

type KindFilter = "all" | "project" | "todo";

function dueLabel(r: ProgressRow): string {
  if (r.daysLeft === undefined) return "期日なし";
  if (r.daysLeft < 0) return `${-r.daysLeft}日超過`;
  if (r.daysLeft === 0) return "今日まで";
  return `あと${r.daysLeft}日`;
}

function ActivityDots({ counts, label }: { counts: number[]; label: string }) {
  return (
    <span className="flex shrink-0 items-end gap-[2px]" title={label} aria-label={label}>
      {counts.map((c, i) => (
        <span
          key={i}
          className="w-[5px] rounded-[1px]"
          style={{
            height: c === 0 ? 3 : Math.min(12, 5 + c * 3),
            backgroundColor: c === 0 ? "rgb(var(--cream-rgb) / 0.15)" : "rgb(var(--accent-rgb) / 0.85)",
          }}
        />
      ))}
    </span>
  );
}

function ProgressBar({ row }: { row: ProgressRow }) {
  const pct = row.progress * 100;
  const elapsedPct = row.elapsed !== undefined ? row.elapsed * 100 : undefined;
  // 予定(▼)まで届いていない分を斜線で示す。テーマによっては警告色が緑系になるので、
  // バーの色ではなく「足りない分の幅」で遅れを見せる
  const shortfall = row.total > 0 && elapsedPct !== undefined && elapsedPct > pct ? elapsedPct - pct : 0;
  return (
    <div className="relative h-2.5 flex-1 rounded-full bg-cream/10">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.max(row.total > 0 ? 2 : 0, pct)}%`, backgroundColor: "rgb(var(--cream-rgb) / 0.6)" }}
      />
      {shortfall > 0 && (
        <div
          className="absolute inset-y-0 rounded-r-full"
          style={{
            left: `${pct}%`,
            width: `${shortfall}%`,
            backgroundImage:
              "repeating-linear-gradient(135deg, rgb(var(--accent-rgb) / 0.85) 0 3px, transparent 3px 6px)",
          }}
          title={`予定より${Math.round(shortfall)}%遅れ`}
        />
      )}
      {elapsedPct !== undefined && (
        // 登録日から期日までのうち、今日までに経過した割合。ここまで進んでいれば予定どおり
        <span
          className="absolute -top-2 -translate-x-1/2 text-[9px] leading-none text-cream/80"
          style={{ left: `${Math.round(elapsedPct)}%` }}
          aria-hidden
        >
          ▼
        </span>
      )}
    </div>
  );
}

export default function ProgressView({
  rows,
  summary,
  onOpen,
}: {
  rows: ProgressRow[];
  summary: ProgressSummary;
  onOpen: (row: ProgressRow) => void;
}) {
  const [sortStr, setSortStr] = useSetting("board.progressSort", "risk");
  const sort = (Object.keys(SORT_LABELS).includes(sortStr) ? sortStr : "risk") as ProgressSort;
  const [kind, setKind] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ProgressStatus | null>(null);

  const shown = useMemo(
    () =>
      sortProgressRows(
        rows.filter((r) => (kind === "all" || r.kind === kind) && (!statusFilter || r.status === statusFilter)),
        sort
      ),
    [rows, kind, statusFilter, sort]
  );

  const maxDaily = Math.max(1, ...summary.daily);
  const weekDelta = summary.thisWeek - summary.lastWeek;

  return (
    <div className="space-y-3" data-testid="progress-view">
      <div className="panel space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {PROGRESS_STATUS_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              aria-pressed={statusFilter === s}
              className={`rounded-full border px-2.5 py-1 text-xs tabular-nums transition ${STATUS_CHIP[s]} ${
                statusFilter && statusFilter !== s ? "opacity-40" : ""
              }`}
              title={statusFilter === s ? "絞り込みを解除" : `「${PROGRESS_STATUS_LABELS[s]}」だけを表示`}
            >
              {STATUS_ICON[s]} {PROGRESS_STATUS_LABELS[s]} {summary.counts[s]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div>
            <p className="text-[10px] text-cream/50">この7日間に片付いた数（段階・サブタスク・ToDo・案件）</p>
            <p className="text-sm text-cream">
              <b className="font-display text-xl tabular-nums">{summary.thisWeek}</b>件
              <span className={`ml-2 text-xs tabular-nums ${weekDelta >= 0 ? "text-cream/60" : "text-alert"}`}>
                前の7日間 {summary.lastWeek}件（{weekDelta >= 0 ? "+" : ""}
                {weekDelta}）
              </span>
            </p>
          </div>
          <div className="flex h-10 flex-1 items-end gap-[3px]" style={{ minWidth: 140 }} aria-label={`直近${ACTIVITY_DAYS}日の片付いた数`}>
            {summary.daily.map((c, i) => (
              <span
                key={i}
                className="flex-1 rounded-t-sm"
                title={`${ACTIVITY_DAYS - 1 - i === 0 ? "今日" : `${ACTIVITY_DAYS - 1 - i}日前`}: ${c}件`}
                style={{
                  height: c === 0 ? 2 : `${(c / maxDaily) * 100}%`,
                  backgroundColor: i >= ACTIVITY_DAYS - 7 ? "rgb(var(--accent-rgb) / 0.85)" : "rgb(var(--cream-rgb) / 0.3)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "project", "todo"] as KindFilter[]).map((k) => (
          <button key={k} className={kind === k ? "btn-pill text-xs" : "btn-pill-outline text-xs"} onClick={() => setKind(k)}>
            {k === "all" ? "すべて" : k === "project" ? "📁 案件" : "☑ ToDo"}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSortStr(e.target.value)}
          className="ml-auto rounded-lg border border-cream/20 bg-ink px-2 py-1.5 text-xs text-cream"
          aria-label="並べ替え"
        >
          {(Object.keys(SORT_LABELS) as ProgressSort[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <p className="text-[10px] text-cream/45">
        バー＝段階・サブタスクの進み　▼＝登録日から期日までの経過（ここまで進んでいれば予定どおり）　斜線＝予定に足りない分　右の点＝直近{ACTIVITY_DAYS}日に片付いた日
      </p>

      {shown.length === 0 ? (
        <p className="panel p-4 text-center text-sm text-cream/50">該当するToDo・案件はありません。</p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <button
              key={r.key}
              onClick={() => onOpen(r)}
              className="panel block w-full space-y-1.5 p-3 text-left transition hover:bg-cream/5"
              data-testid="progress-row"
            >
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-sm" aria-label={r.kind === "project" ? "案件" : "ToDo"}>
                  {r.kind === "project" ? "📁" : "☑"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-cream">{r.title}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${STATUS_CHIP[r.status]}`}>
                  {STATUS_ICON[r.status]} {PROGRESS_STATUS_LABELS[r.status]}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <ProgressBar row={r} />
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-cream/70">
                  {r.total > 0 ? `${r.done}/${r.total}` : "―"}
                </span>
                <span
                  className={`w-16 shrink-0 text-right text-xs tabular-nums ${
                    r.daysLeft !== undefined && r.daysLeft < 0 ? "font-bold text-alert" : "text-cream/60"
                  }`}
                >
                  {dueLabel(r)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-cream/50">
                <span className="min-w-0 flex-1 truncate">
                  {r.next ? `次: ${r.next}` : r.total > 0 ? "残りなし" : "段階・サブタスクなし"}
                </span>
                <span className={`shrink-0 tabular-nums ${r.status === "stalled" ? "font-bold text-cream/80" : ""}`}>
                  {r.idleDays === 0 ? "今日動いた" : `${r.idleDays}日動きなし`}
                </span>
                <ActivityDots counts={r.activity} label={`直近${ACTIVITY_DAYS}日に片付いた数: ${r.activity.reduce((a, b) => a + b, 0)}件`} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
