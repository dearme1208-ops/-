"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import { useSetting } from "@/lib/settings";
import { formatDateJp, formatHms } from "@/lib/time";
import { buildWeeklySummary, summaryWeek } from "@/lib/weeklySummary";

// 「今週のまとめ」(金〜日)・「先週のまとめ」(月曜)。週ごとに1回、閉じれば次の週まで出さない
export default function WeeklySummaryCard({ today }: { today: string }) {
  const week = summaryWeek(today);
  const [dismissed, setDismissed] = useSetting("today.weeklySummaryDismissed", "");
  const [enabledStr] = useSetting("today.showWeeklySummary", "true");
  const from = week?.weekStart ?? today;
  const records = useHomeFilteredRecords(useLiveQuery(() => db.records.where("date").aboveOrEqual(from).toArray(), [from]));
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").aboveOrEqual(from).toArray(), [from]);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const s = useMemo(
    () =>
      week && records && dailyTasks && todos && projects
        ? buildWeeklySummary(week.weekStart, week.label, { records, dailyTasks, todos, projects })
        : null,
    [week?.weekStart, week?.label, records, dailyTasks, todos, projects]
  );
  if (enabledStr !== "true" || !week || !s || dismissed === week.weekStart || s.totalSeconds === 0) return null;

  return (
    <section className="panel space-y-3 p-4" data-testid="weekly-summary">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold text-cream">📅 {s.label}のまとめ</h3>
          <p className="text-[11px] text-cream/50">
            {formatDateJp(s.weekStart)}〜{formatDateJp(s.weekEnd)}・記録 <b className="tabular-nums text-cream/80">{formatHms(s.totalSeconds)}</b>
          </p>
        </div>
        <button className="text-xs text-cream/45 hover:text-cream" onClick={() => setDismissed(week.weekStart)} aria-label="今週は閉じる">
          閉じる
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Block title="時間を使った作業">
          {s.topWorks.map((w) => (
            <Line key={w.label} left={w.label} right={formatHms(w.seconds)} />
          ))}
        </Block>
        {s.overruns.length > 0 && (
          <Block title="予定より長引いた作業">
            {s.overruns.map((o) => (
              <Line key={o.label} left={o.label} right={`+${formatHms(o.overSeconds)}`} alert />
            ))}
          </Block>
        )}
        {(s.doneTodos.length > 0 || s.doneProjects.length > 0) && (
          <Block title={`終えたこと（${s.doneTodos.length + s.doneProjects.length}）`}>
            {[...s.doneProjects.map((t) => `📁 ${t}`), ...s.doneTodos.map((t) => `✓ ${t}`)].slice(0, 5).map((t) => (
              <Line key={t} left={t} />
            ))}
          </Block>
        )}
        {s.upcoming.length > 0 && (
          <Block title={`${s.label === "今週" ? "来週" : "今週"}が期日`}>
            {s.upcoming.map((u) => (
              <Line key={u.kind + u.title} left={`${u.kind === "project" ? "📁" : "📌"} ${u.title}`} right={formatDateJp(u.dueDate)} />
            ))}
          </Block>
        )}
      </div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-bold tracking-wider text-cream/55">{title}</h4>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function Line({ left, right, alert }: { left: string; right?: string; alert?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-sm">
      <span className="min-w-0 truncate text-cream/85">{left}</span>
      {right && <span className={`shrink-0 text-xs tabular-nums ${alert ? "text-alert" : "text-cream/55"}`}>{right}</span>}
    </li>
  );
}
