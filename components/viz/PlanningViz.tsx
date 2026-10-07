"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { formatDateJp, todayStr } from "@/lib/time";
import { dueTerrain, projectClimbs, waitingSand } from "@/lib/visuals";
import { DEFAULT_TAG_PRESETS, parsePresetList } from "@/lib/todo";
import { collectWaitingItems } from "@/lib/waiting";
import { useWaitingSettings } from "@/lib/waitingSettings";
import type { ProjectItem, TodoTask } from "@/lib/types";

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
        <h3 className="min-w-0 font-display text-sm font-bold text-cream/85">{title}</h3>
        <span className="shrink-0 whitespace-nowrap text-xs text-cream/45">{open ? "▼ たたむ" : "▶ 開く"}</span>
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

// ---- 相手待ちの砂時計 ----
/** 上の砂が落ちきったら催促の目安。落ちきると下にたまった砂が警告の色になる */
function SandGlass({ sandLeft, overdue }: { sandLeft: number; overdue: boolean }) {
  const top = 10 * sandLeft; // 上の砂の高さ(最大10)
  const bottom = 10 * (1 - sandLeft);
  const sand = overdue ? "rgb(var(--alert-rgb))" : "rgb(var(--accent-rgb))";
  return (
    <svg viewBox="0 0 16 26" width={16} height={26} className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="sg-top">
          <path d="M2 2 H14 L8 13 Z" />
        </clipPath>
        <clipPath id="sg-bottom">
          <path d="M8 13 L14 24 H2 Z" />
        </clipPath>
      </defs>
      <rect x={2} y={13 - top} width={12} height={top} fill={sand} clipPath="url(#sg-top)" />
      <rect x={2} y={24 - bottom} width={12} height={bottom} fill={sand} clipPath="url(#sg-bottom)" />
      {sandLeft > 0 && <line x1={8} y1={13} x2={8} y2={24} stroke={sand} strokeWidth={0.8} strokeDasharray="1 1.5" />}
      <path d="M2 2 H14 L8 13 L14 24 H2 L8 13 Z" fill="none" stroke="rgb(var(--cream-rgb) / 0.6)" strokeWidth={1} strokeLinejoin="round" />
      <line x1={1} y1={1.5} x2={15} y2={1.5} stroke="rgb(var(--cream-rgb) / 0.6)" strokeWidth={1.2} />
      <line x1={1} y1={24.5} x2={15} y2={24.5} stroke="rgb(var(--cream-rgb) / 0.6)" strokeWidth={1.2} />
    </svg>
  );
}

/**
 * 相手の返事を待っているToDo・案件を、待った日数の棒と砂時計で並べる。
 * 縦の点線が催促の目安(設定の日数)。kind で ToDo タブ・案件タブそれぞれの分だけを出す
 */
export function WaitingHourglassPanel({ kind, onOpen }: { kind: "todo" | "project"; onOpen?: (id: string) => void }) {
  const todos = useLiveQuery<TodoTask[]>(() => (kind === "todo" ? db.todoTasks.toArray() : []), [kind]);
  const projects = useLiveQuery<ProjectItem[]>(() => (kind === "project" ? db.projects.toArray() : []), [kind]);
  const { waitingTags, nudgeDays } = useWaitingSettings();
  const [tagPresetsJson] = useSetting("todo.tagPresets", JSON.stringify(DEFAULT_TAG_PRESETS));
  const priority = useMemo(() => parsePresetList(tagPresetsJson), [tagPresetsJson]);
  const today = todayStr();
  const items = useMemo(
    () => collectWaitingItems(todos ?? [], projects ?? [], priority, waitingTags, nudgeDays, Date.now()),
    // 日付が変われば日数も変わる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todos, projects, priority, waitingTags, nudgeDays, today]
  );
  const sands = useMemo(() => waitingSand(items.map((i) => i.days), nudgeDays), [items, nudgeDays]);
  if (items.length === 0) return null;
  const overdueCount = items.filter((i) => i.overdue).length;
  const nudgeAt = sands.find((x) => x)?.nudgeAt;
  return (
    <Fold settingKey={`viz.waitingOpen.${kind}`} title="⏳ 相手待ちの砂時計" testId="waiting-hourglass">
      <p className="text-xs text-cream/80">
        {items.length}件待ち
        {overdueCount > 0 && <span className="ml-1 font-bold text-alert">・催促どき {overdueCount}件 ⏰</span>}
      </p>
      <p className="mb-2 text-[11px] text-cream/50">
        待ち始めてから{nudgeDays}日で砂が落ちきり、催促の目安です(点線)。目安を過ぎた分は赤で伸びます。
      </p>
      <ul className="space-y-2.5">
        {items.slice(0, 10).map((item, i) => {
          const s = sands[i];
          return (
            <li key={`${item.kind}-${item.id}`} data-testid="waiting-row">
              <button className="flex w-full items-center gap-2 text-left" onClick={() => onOpen?.(item.id)}>
                <SandGlass sandLeft={s?.sandLeft ?? 1} overdue={item.overdue} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className={`min-w-0 truncate ${item.overdue ? "font-bold text-alert" : "text-cream/85"}`}>{item.label}</span>
                    <span className={`shrink-0 tabular-nums ${item.overdue ? "font-bold text-alert" : "text-cream/55"}`}>
                      {item.tag}・{item.days === null ? "日数不明" : `${item.days}日目`}
                      {item.overdue && " ⏰"}
                    </span>
                  </div>
                  {s && (
                    <div className="relative mt-1 h-2" aria-hidden="true">
                      <div className="absolute inset-0 rounded-full bg-cream/10" />
                      <div
                        className="absolute inset-y-0 left-0 rounded-l-full bg-[rgb(var(--accent-rgb))]"
                        style={{ width: `${Math.min(s.bar, s.nudgeAt) * 100}%`, borderTopRightRadius: s.bar <= s.nudgeAt ? 9999 : 0, borderBottomRightRadius: s.bar <= s.nudgeAt ? 9999 : 0 }}
                      />
                      {s.bar > s.nudgeAt && (
                        <div
                          className="absolute inset-y-0 rounded-r-full bg-alert"
                          style={{ left: `calc(${s.nudgeAt * 100}% + 2px)`, width: `calc(${(s.bar - s.nudgeAt) * 100}% - 2px)` }}
                        />
                      )}
                      <div
                        className="absolute -inset-y-1 w-0 border-l border-dashed border-cream/60"
                        style={{ left: `${s.nudgeAt * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > 10 && <p className="mt-2 text-[11px] text-cream/45">ほか{items.length - 10}件</p>}
      {nudgeAt !== undefined && <p className="mt-2 text-[11px] text-cream/45">催促の目安の日数は設定タブで変えられます。</p>}
    </Fold>
  );
}
