"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { parseBreakRanges } from "@/lib/breaks";
import { buildDayPlan, PLAN_HORIZON_DAYS, type PlanCandidate, type PlannedItem } from "@/lib/dayPlan";
import { applyPlanToToday } from "@/lib/dayPlanApply";
import { useSetting } from "@/lib/settings";
import { daysBetweenDateStrs, formatClock, formatDateJp, formatHms } from "@/lib/time";
import Modal from "@/components/ui/Modal";

const KIND_LABEL: Record<PlanCandidate["kind"], string> = {
  daily: "本日の作業",
  stage: "案件の段階",
  project: "案件",
  todo: "ToDo",
};

function dueLabel(c: PlanCandidate, today: string): { text: string; urgent: boolean } {
  const dueDate = c.dueDate;
  if (!dueDate || c.dueIsImplicit) return { text: c.kind === "daily" ? "今日の予定" : "期日なし", urgent: false };
  const days = daysBetweenDateStrs(today, dueDate);
  if (days < 0) return { text: `${-days}日超過`, urgent: true };
  if (days === 0) return { text: "本日期限", urgent: true };
  if (days === 1) return { text: "明日期限", urgent: false };
  return { text: `あと${days}日`, urgent: false };
}

// 「今日の段取り」。期日・見積もり(手段の違いを含む実績平均)・今日の残り稼働時間から、
// この順でやれば間に合うという計画と、間に合わない見込みのものを提案する
export default function DayPlanModal({ today, onClose }: { today: string; onClose: () => void }) {
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const [workStart] = useSetting("today.standardWorkStart", "08:00");
  const [workEnd] = useSetting("today.standardWorkEnd", "17:00");
  const [breakRangesStr] = useSetting("today.provisionalBreakRanges", "[]");
  // 計画は開いた時点の時刻で固定する(見ている間に毎秒並びが変わると落ち着いて読めないため)
  const [now] = useState(() => Date.now());
  const [applied, setApplied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(() => {
    if (!dailyTasks || !projects || !todoTasks || !masterTasks || !records) return null;
    return buildDayPlan({
      now,
      today,
      workStart,
      workEnd,
      breaks: parseBreakRanges(breakRangesStr),
      dailyTasks,
      projects,
      todoTasks,
      masterTasks,
      records,
    });
    // 反映後に本日の作業が変わっても、計画自体は開いた時点のものを見せ続ける
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyTasks === undefined, projects === undefined, todoTasks === undefined, masterTasks === undefined, records === undefined]);

  async function apply() {
    if (!plan || plan.scheduled.length === 0) return;
    setBusy(true);
    const added = await applyPlanToToday(plan.scheduled, today);
    setBusy(false);
    setApplied(
      added > 0
        ? `${added}件を本日の作業に追加し、計画の順に並べ替えました。`
        : "本日の作業の未着手の並びを計画の順に並べ替えました。"
    );
  }

  if (!plan) {
    return (
      <Modal title="🧭 今日の段取り" onClose={onClose}>
        <p className="text-sm text-cream/60">計算しています…</p>
      </Modal>
    );
  }

  const newCount = plan.scheduled.filter((s) => s.kind !== "daily").length;

  return (
    <Modal title="🧭 今日の段取り" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="今日の残り稼働" value={formatHms(plan.remainingSeconds)} note={`〜${workEnd}・休憩除く`} />
          <Stat label="今日に入る作業" value={`${plan.scheduled.length}件`} note={formatHms(plan.scheduled.reduce((s, i) => s + i.plannedSeconds, 0))} />
          <Stat
            label="間に合わない見込み"
            value={`${plan.atRisk.length}件`}
            note={plan.atRisk.length > 0 ? "下で確認" : "なし"}
            alert={plan.atRisk.length > 0}
          />
        </div>

        {plan.runningTaskName && plan.runningRemainingSeconds > 0 && (
          <p className="text-xs text-cream/50">
            計測中の「{plan.runningTaskName}」は見積もり上あと{formatHms(plan.runningRemainingSeconds)}かかる想定で、その後ろから計画しています。
          </p>
        )}

        {plan.remainingSeconds <= 0 && (
          <p className="rounded-lg border border-cream/15 p-3 text-sm text-cream/70">
            今日の稼働時間（{workStart}〜{workEnd}）はもう残っていません。下の「明日以降」を参考にしてください。
          </p>
        )}

        {plan.atRisk.length > 0 && (
          <div className="rounded-lg border border-alert/50 bg-alert/5 p-3">
            <h3 className="mb-1 text-sm font-bold text-alert">⚠ このままだと期日に間に合わない見込み</h3>
            <p className="mb-2 text-[11px] text-cream/50">
              期日が近い順にこなしても、期日までの稼働時間（今日の残り＋翌日以降は1日{workStart}〜{workEnd}）に見積もりが収まりません。期日の相談・分担・手段の見直しを検討してください。
            </p>
            <ul className="space-y-1">
              {plan.atRisk.map(({ candidate, shortfallSeconds }) => (
                <li key={candidate.key} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-cream">
                    {candidate.title}
                    <span className="ml-1 text-[11px] text-cream/40">{candidate.dueDate && formatDateJp(candidate.dueDate)}期限</span>
                  </span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-alert">約{formatHms(shortfallSeconds)}不足</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.scheduled.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-bold text-cream/80">この順で進めると…</h3>
            <ol className="space-y-1.5">
              {plan.scheduled.map((item) => (
                <PlanRow key={item.key} item={item} today={today} />
              ))}
            </ol>
          </div>
        )}

        {plan.overflow.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-bold text-cream/60">明日以降に回るもの（{plan.overflow.length}件）</h3>
            <ul className="space-y-1">
              {plan.overflow.map((c) => {
                const due = dueLabel(c, today);
                return (
                  <li key={c.key} className="flex items-baseline justify-between gap-2 text-xs text-cream/60">
                    <span className="min-w-0 truncate">{c.title}</span>
                    <span className={`shrink-0 tabular-nums ${due.urgent ? "text-alert" : ""}`}>
                      {due.text}・{formatHms(c.estimateSeconds)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {plan.scheduled.length === 0 && plan.overflow.length === 0 && (
          <p className="text-sm text-cream/60">
            {`今日から${PLAN_HORIZON_DAYS}日以内が期日の案件・ToDoや、未着手の本日の作業はありません。`}
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-cream/40">
          並べ方は「期日が近い順（同じ期日なら重要→短いもの）」です。所要時間はその作業の過去の実績平均で、直近に使った手段で2件以上の実績があればその手段の平均を使います。
        </p>

        {applied ? (
          <p className="rounded-lg bg-cream/10 p-3 text-sm text-cream">{applied}</p>
        ) : (
          plan.scheduled.length > 0 && (
            <button className="btn-pill w-full text-sm" onClick={apply} disabled={busy}>
              {newCount > 0 ? `この計画を本日の作業に反映（新規${newCount}件を追加・並べ替え）` : "この計画の順に本日の作業を並べ替える"}
            </button>
          )
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, note, alert }: { label: string; value: string; note: string; alert?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${alert ? "border-alert/50" : "border-cream/15"}`}>
      <div className="text-[10px] text-cream/50">{label}</div>
      <div className={`text-base font-bold tabular-nums ${alert ? "text-alert" : "text-cream"}`}>{value}</div>
      <div className="text-[10px] text-cream/40">{note}</div>
    </div>
  );
}

function PlanRow({ item, today }: { item: PlannedItem; today: string }) {
  const due = dueLabel(item, today);
  return (
    <li className="rounded-lg border border-cream/10 bg-ink/40 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-xs font-bold tabular-nums text-cream/70">
          {formatClock(item.startMs)}〜{formatClock(item.endMs)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-cream">{item.title}</span>
        <span className={`shrink-0 text-[11px] ${due.urgent ? "font-bold text-alert" : "text-cream/50"}`}>{due.text}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-cream/45">
        <span>{KIND_LABEL[item.kind]}</span>
        {item.subtitle && <span>{item.subtitle}</span>}
        <span>
          見積もり {formatHms(item.estimateSeconds)}（{item.estimateSource}）
        </span>
        {item.partial && <span className="font-bold text-alert">今日は{formatHms(item.plannedSeconds)}だけ着手</span>}
      </div>
    </li>
  );
}
