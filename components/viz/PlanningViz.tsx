"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatDateJp, todayStr } from "@/lib/time";
import { dueTerrain, projectClimbs } from "@/lib/visuals";

// 案件タブ・ToDoタブに置く可視化。計算は lib/visuals.ts

const daysLeft = (due: string, today: string) =>
  Math.round((new Date(`${due}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);

/** 開閉を覚えておく見出し付きの枠 */
function Fold({ settingKey, title, children, testId }: { settingKey: string; title: string; children: React.ReactNode; testId: string }) {
  const [openStr, setOpenStr] = useSetting(settingKey, "true");
  const open = openStr === "true";
  return (
    <section className="panel p-4" data-testid={testId}>
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpenStr(open ? "false" : "true")} aria-expanded={open}>
        <h3 className="font-display text-sm font-bold text-cream/85">{title}</h3>
        <span className="text-xs text-cream/45">{open ? "▼ たたむ" : "▶ 開く"}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

// ---- 7. 案件の山登り ----
export function ProjectClimbPanel({ onOpen }: { onOpen?: (id: string) => void }) {
  const today = todayStr();
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const rows = useMemo(() => projectClimbs(projects ?? [], today), [projects, today]);
  if (rows.length === 0) return null;
  return (
    <Fold settingKey="viz.projectClimbOpen" title="⛰ 案件の山登り" testId="project-climb">
      <p className="mb-2 text-[11px] text-cream/50">
        ● が段階の進み具合、縦線が今日(登録から期日までのどこにいるか)、⚑ が期日です。縦線が ● より先なら遅れ気味です。
      </p>
      <ul className="space-y-3">
        {rows.slice(0, 8).map((r) => {
          const left = daysLeft(r.project.dueDate, today);
          const time = Math.min(1, Math.max(0, r.timeUsed));
          return (
            <li key={r.project.id}>
              <button className="w-full text-left" onClick={() => onOpen?.(r.project.id)}>
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={`min-w-0 truncate ${r.behind ? "font-bold text-alert" : "text-cream/85"}`}>{r.project.title}</span>
                  <span className={`shrink-0 tabular-nums ${left < 0 ? "font-bold text-alert" : "text-cream/55"}`}>
                    {r.progress !== undefined && `段階 ${Math.round(r.progress * (r.project.stages?.length ?? 0))}/${r.project.stages?.length}・`}
                    {left < 0 ? `${-left}日超過` : left === 0 ? "今日が期日" : `あと${left}日`}
                  </span>
                </div>
                <div className="relative mt-1 h-4" aria-hidden="true">
                  {/* 登山道 */}
                  <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-cream/12" />
                  {r.progress !== undefined && (
                    <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[rgb(var(--accent-rgb))]" style={{ width: `${r.progress * 100}%` }} />
                  )}
                  {/* 遅れている分 */}
                  {r.behind && r.progress !== undefined && time > r.progress && (
                    <div
                      className="absolute top-1/2 h-1 -translate-y-1/2 bg-alert/70"
                      style={{ left: `${r.progress * 100}%`, width: `${(time - r.progress) * 100}%` }}
                    />
                  )}
                  {/* 今日 */}
                  <div className="absolute top-0 h-4 w-0.5 rounded bg-cream/70" style={{ left: `calc(${time * 100}% - 1px)` }} />
                  {r.progress !== undefined && (
                    <div
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[rgb(var(--ink-rgb))] bg-[rgb(var(--accent-rgb))]"
                      style={{ left: `${r.progress * 100}%` }}
                    />
                  )}
                  <span className="absolute -right-1 -top-1 text-sm leading-none" title={`期日 ${formatDateJp(r.project.dueDate)}`}>
                    ⚑
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}

// ---- 10. 期日の山 ----
export function DueTerrainPanel() {
  const today = todayStr();
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const days = useMemo(() => dueTerrain(todos ?? [], projects ?? [], today), [todos, projects, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(...days.map((d) => d.todos.length + d.projects.length), 1);
  if (days.every((d) => d.todos.length + d.projects.length === 0)) return null;
  const wd = ["日", "月", "火", "水", "木", "金", "土"];
  const sel = days.find((d) => d.date === picked);
  return (
    <Fold settingKey="viz.dueTerrainOpen" title="🏔 これから2週間の期日" testId="due-terrain">
      <div className="flex h-28 items-end gap-1">
        {days.map((d) => {
          const n = d.todos.length + d.projects.length;
          const dow = new Date(`${d.date}T00:00:00`).getDay();
          return (
            <button
              key={d.date}
              className={`flex h-full flex-1 flex-col items-center justify-end gap-0.5 rounded-md ${picked === d.date ? "bg-cream/10" : ""}`}
              onClick={() => setPicked(picked === d.date ? null : d.date)}
              title={[...d.projects.map((p) => `📁 ${p}`), ...d.todos.map((t) => `📌 ${t}`)].join("\n") || "期日なし"}
              aria-label={`${formatDateJp(d.date)} 期日${n}件`}
            >
              <span className="text-[10px] tabular-nums text-cream/60">{n || ""}</span>
              <div className="flex w-full max-w-[1.6rem] flex-col-reverse gap-[2px]" style={{ height: `${(n / max) * 70}%` }}>
                {d.todos.length > 0 && <div className="rounded-b-[4px] last:rounded-t-[4px]" style={{ flexGrow: d.todos.length, background: "var(--viz-1)" }} />}
                {d.projects.length > 0 && <div className="rounded-t-[4px] first:rounded-b-[4px]" style={{ flexGrow: d.projects.length, background: "var(--viz-2)" }} />}
              </div>
              <span className={`text-[9px] leading-none ${d.date === today ? "font-bold text-cream" : dow === 0 || dow === 6 ? "text-cream/40" : "text-cream/55"}`}>
                {Number(d.date.slice(8))}
                <br />
                {wd[dow]}
              </span>
            </button>
          );
        })}
      </div>
      <ul className="mt-2 flex gap-3 text-[11px] text-cream/70">
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-1)" }} />
          ToDo
        </li>
        <li className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-2)" }} />
          案件・段階
        </li>
        <li className="text-cream/45">日付を押すと中身が出ます</li>
      </ul>
      {sel && (
        <div className="mt-2 rounded-lg border border-cream/10 p-2 text-xs" data-testid="due-terrain-day">
          <div className="mb-1 font-bold text-cream">{formatDateJp(sel.date)}の期日</div>
          {sel.projects.length + sel.todos.length === 0 && <div className="text-cream/50">ありません</div>}
          {sel.projects.map((p) => (
            <div key={p} className="truncate text-cream/80">📁 {p}</div>
          ))}
          {sel.todos.map((t) => (
            <div key={t} className="truncate text-cream/80">📌 {t}</div>
          ))}
        </div>
      )}
    </Fold>
  );
}
