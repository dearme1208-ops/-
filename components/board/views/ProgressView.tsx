import { useMemo, useState } from "react";
import {
  ACTIVITY_DAYS,
  buildBurnup,
  PROGRESS_STATUS_LABELS,
  PROGRESS_STATUS_ORDER,
  sortProgressRows,
  type ProgressRow,
  type ProgressSort,
  type ProgressStatus,
  type ProgressSummary,
} from "@/lib/progressOverview";
import { useSetting } from "@/lib/settings";
import { daysBetweenDateStrs, todayStr } from "@/lib/time";

// 統合ボードの「📈 進捗」表示。ToDo・案件を1件1行で、どこまで進んだか(バー)、
// 期日に対して今どこまで進んでいてほしいか(▼)、最近動いているか(点)を並べる

// このアプリでは警告色(alert)はアクセント色と同じ色なので、状態は色の違いではなく
// 塗り(期限切れ)・枠(遅れ気味)・点線(停滞)・薄い文字(期日なし)の形で見分けられるようにする
const STATUS_CHIP: Record<ProgressStatus, string> = {
  overdue: "border-alert bg-alert font-bold text-ink",
  behind: "border-alert font-bold text-alert",
  waiting: "border-cream/50 bg-cream/10 text-cream",
  stalled: "border-dashed border-cream/50 text-cream/80",
  onTrack: "border-cream/30 text-cream/80",
  noDue: "border-cream/15 text-cream/45",
};

const STATUS_ICON: Record<ProgressStatus, string> = {
  overdue: "⚠",
  behind: "▼",
  waiting: "⏳",
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
              "repeating-linear-gradient(135deg, rgb(var(--alert-rgb) / 0.85) 0 3px, transparent 3px 6px)",
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

function md(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function perWeek(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
}

/** 「このペースだと◯/◯頃」「間に合わせるには週◯件」の一言。残りが無い・測れないものは出さない */
export function paceLine(r: ProgressRow): { text: string; late: boolean } | null {
  const remaining = r.total - r.done;
  if (r.total === 0 || remaining <= 0) return null;
  const parts: string[] = [];
  let late = false;
  if (r.forecastDate) {
    parts.push(`このペースだと${md(r.forecastDate)}頃に完了`);
    if (r.dueDate) {
      const diff = daysBetweenDateStrs(r.dueDate, r.forecastDate);
      late = diff > 0;
      parts.push(late ? `（期日を${diff}日超過）` : "（期日に間に合う見込み）");
    }
  } else {
    parts.push("まだ1つも片付いていません");
  }
  if (r.neededPerWeek !== undefined && r.dueDate) {
    parts.push(`／間に合わせるには週${perWeek(r.neededPerWeek)}件${r.pacePerWeek !== undefined ? `（これまで週${perWeek(r.pacePerWeek)}件）` : ""}`);
  }
  return { text: parts.join(""), late };
}

// 累計の片付き(実線)と、登録日→期日の理想の線(点線)。今日の位置に縦線を引く
function BurnupChart({ row, today }: { row: ProgressRow; today: string }) {
  const points = buildBurnup(row, today);
  const W = 300;
  const H = 90;
  const pad = 4;
  const n = Math.max(1, points.length - 1);
  const maxY = Math.max(1, row.total);
  const x = (i: number) => pad + (i / n) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / maxY) * (H - pad * 2);
  const path = (vals: (number | undefined)[]) =>
    vals
      .map((v, i) => (v === undefined ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter((p): p is string => p !== null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${p}`)
      .join(" ");
  const todayIdx = points.findIndex((p) => p.date === today);
  const dueIdx = row.dueDate ? points.findIndex((p) => p.date === row.dueDate) : -1;
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="累計の片付きと理想の線">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad} x2={W - pad} y1={y(maxY * f)} y2={y(maxY * f)} stroke="rgb(var(--cream-rgb) / 0.08)" />
        ))}
        {dueIdx >= 0 && (
          <line x1={x(dueIdx)} x2={x(dueIdx)} y1={pad} y2={H - pad} stroke="rgb(var(--cream-rgb) / 0.35)" strokeDasharray="2 3" />
        )}
        {todayIdx >= 0 && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad} y2={H - pad} stroke="rgb(var(--accent-rgb) / 0.6)" />}
        <path d={path(points.map((p) => p.ideal))} fill="none" stroke="rgb(var(--cream-rgb) / 0.45)" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={path(points.map((p) => p.done))} fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 text-[10px] text-cream/50">
        <span>━ 片付いた累計</span>
        <span>┅ 期日に間に合う理想の線</span>
        <span>｜今日{row.dueDate ? ` ／ ┊期日 ${md(row.dueDate)}` : ""}</span>
        <span className="ml-auto tabular-nums">
          {md(row.start)}〜
        </span>
      </figcaption>
    </figure>
  );
}

export default function ProgressView({
  rows,
  summary,
  today,
  inTodayKeys,
  onOpen,
  onCompleteStep,
  onAddStepToToday,
}: {
  rows: ProgressRow[];
  summary: ProgressSummary;
  today: string;
  /** 本日の作業にまだ終わっていない状態で入っている手順(stage:ID / todo:ID) */
  inTodayKeys: Set<string>;
  onOpen: (row: ProgressRow) => void;
  onCompleteStep: (row: ProgressRow, stepId: string) => void;
  onAddStepToToday: (row: ProgressRow, stepId: string) => void;
}) {
  const [sortStr, setSortStr] = useSetting("board.progressSort", "risk");
  const sort = (Object.keys(SORT_LABELS).includes(sortStr) ? sortStr : "risk") as ProgressSort;
  const [kind, setKind] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ProgressStatus | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showDoneSteps, setShowDoneSteps] = useState(false);

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
  const stepKey = (r: ProgressRow, stepId: string) => (r.kind === "project" ? `stage:${stepId}` : `todo:${stepId}`);

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
            {summary.dueSoonRemaining > 0 && (
              <p className="mt-0.5 text-xs text-cream/70" data-testid="progress-due-soon">
                期日まで7日以内の残り <b className="tabular-nums text-cream">{summary.dueSoonRemaining}</b>件
              </p>
            )}
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
        バー＝段階・サブタスクの進み　▼＝登録日から期日までの経過（ここまで進んでいれば予定どおり）　斜線＝予定に足りない分　右の点＝直近{ACTIVITY_DAYS}日に片付いた日。押すと残りの手順を開き、その場で完了・今日やるにできます
      </p>

      {shown.length === 0 ? (
        <p className="panel p-4 text-center text-sm text-cream/50">該当するToDo・案件はありません。</p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => {
            const open = openKey === r.key;
            const pace = paceLine(r);
            const remainingSteps = r.steps.filter((st) => !st.done);
            const doneSteps = r.steps.filter((st) => st.done);
            return (
              <div key={r.key} className="panel" data-testid="progress-row">
                <button
                  onClick={() => setOpenKey(open ? null : r.key)}
                  aria-expanded={open}
                  className="block w-full space-y-1.5 p-3 text-left transition hover:bg-cream/5"
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
                  {pace && (
                    <p className={`text-[11px] ${pace.late ? "font-bold text-alert" : "text-cream/60"}`} data-testid="progress-pace">
                      {pace.text}
                    </p>
                  )}
                  {r.waiting && (
                    <p className={`text-[11px] ${r.waiting.nudge ? "font-bold text-alert" : "text-cream/70"}`}>
                      ⏳ {r.waiting.tag}
                      {r.waiting.days !== undefined && ` ${r.waiting.days}日目`}
                      {r.waiting.nudge && "（催促の目安を過ぎています）"}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-cream/50">
                    <span className="min-w-0 flex-1 truncate">
                      {r.next ? `次: ${r.next}` : r.total > 0 ? "残りなし" : "段階・サブタスクなし"}
                      {r.postponeCount > 0 && `　延期${r.postponeCount}回`}
                    </span>
                    <span className={`shrink-0 tabular-nums ${r.status === "stalled" ? "font-bold text-cream/80" : ""}`}>
                      {r.idleDays === 0 ? "今日動いた" : `${r.idleDays}日動きなし`}
                    </span>
                    <ActivityDots counts={r.activity} label={`直近${ACTIVITY_DAYS}日に片付いた数: ${r.activity.reduce((a, b) => a + b, 0)}件`} />
                  </div>
                </button>

                {open && (
                  <div className="space-y-3 border-t border-cream/10 p-3" data-testid="progress-detail">
                    {r.total > 0 && <BurnupChart row={r} today={today} />}
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-bold text-cream/70">
                        残り {remainingSteps.length}件{r.kind === "project" ? "の段階" : r.total > 0 ? "のサブタスク" : ""}
                      </p>
                      {remainingSteps.map((st) => {
                        const inToday = inTodayKeys.has(stepKey(r, st.id));
                        const overdue = !!st.dueDate && st.dueDate < today;
                        return (
                          <div key={st.id} className="flex items-center gap-2 rounded-lg bg-cream/5 px-2 py-1.5" data-testid="progress-step">
                            {st.countLabel ? (
                              <span className="w-12 shrink-0 text-center text-[10px] tabular-nums text-cream/60" title="件数で進める段階は案件の画面で件数を入れます">
                                {st.countLabel}
                              </span>
                            ) : (
                              <button
                                onClick={() => onCompleteStep(r, st.id)}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-cream/40 text-[10px] text-cream/0 hover:border-cream hover:text-cream"
                                aria-label={`「${st.title}」を完了にする`}
                                title="完了にする"
                              >
                                ✓
                              </button>
                            )}
                            <span className="min-w-0 flex-1 truncate text-xs text-cream">{st.title}</span>
                            {st.dueDate && (
                              <span className={`shrink-0 text-[10px] tabular-nums ${overdue ? "font-bold text-alert" : "text-cream/50"}`}>
                                {md(st.dueDate)}
                              </span>
                            )}
                            {inToday ? (
                              <span className="shrink-0 text-[10px] text-cream/50">今日の作業に入っています</span>
                            ) : (
                              <button
                                className="btn-pill-outline shrink-0 whitespace-nowrap px-2 py-0.5 text-[11px]"
                                onClick={() => onAddStepToToday(r, st.id)}
                                title="本日の作業に未着手として入れます"
                              >
                                ▶ 今日やる
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {doneSteps.length > 0 && (
                        <button className="text-[10px] text-cream/45 underline decoration-dotted" onClick={() => setShowDoneSteps((v) => !v)}>
                          {showDoneSteps ? "片付いたものを隠す" : `片付いた${doneSteps.length}件を表示`}
                        </button>
                      )}
                      {showDoneSteps &&
                        doneSteps.map((st) => (
                          <p key={st.id} className="flex items-center gap-2 px-2 text-xs text-cream/40 line-through">
                            <span className="no-underline">✓</span>
                            <span className="min-w-0 flex-1 truncate">{st.title}</span>
                            {st.completedAt && <span className="shrink-0 text-[10px] tabular-nums no-underline">{md(todayStr(new Date(st.completedAt)))}</span>}
                          </p>
                        ))}
                    </div>
                    <div className="flex justify-end">
                      <button className="btn-pill-outline text-xs" onClick={() => onOpen(r)}>
                        {r.kind === "project" ? "案件を開く" : "ToDoの詳細を開く"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
