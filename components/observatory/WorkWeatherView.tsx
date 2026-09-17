"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { formatDateJp, formatHms, shiftDateStr, todayStr } from "@/lib/time";

// これから来る期日の混み具合を、週間天気予報として見る観測法。
// 実際の天気ではなく「その日に締切が何件集まっているか」を天気に変換する。
// 嵐の日が見えていれば、手前の晴れの日に前倒しできる——という使い方を想定している
const FORECAST_DAYS = 14;
const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

interface DayForecast {
  date: string;
  dueTodos: number;
  dueProjects: number;
  dueStages: number;
  plannedSeconds: number;
  load: number;
}

function weatherOf(load: number): { icon: string; label: string; tone: "clear" | "cloud" | "rain" | "storm" } {
  if (load <= 0) return { icon: "☀", label: "快晴", tone: "clear" };
  if (load <= 1) return { icon: "🌤", label: "晴れ", tone: "clear" };
  if (load <= 2) return { icon: "⛅", label: "薄曇り", tone: "cloud" };
  if (load <= 4) return { icon: "☁", label: "曇り", tone: "cloud" };
  if (load <= 6) return { icon: "🌧", label: "雨", tone: "rain" };
  if (load <= 9) return { icon: "⛈", label: "荒天", tone: "storm" };
  return { icon: "🌀", label: "暴風雨", tone: "storm" };
}

export default function WorkWeatherView() {
  const today = todayStr();
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const dailyTasks = useLiveQuery(() => db.dailyTasks.toArray(), []);

  const forecast = useMemo<DayForecast[]>(() => {
    const days: DayForecast[] = [];
    for (let i = 0; i < FORECAST_DAYS; i++) {
      const date = shiftDateStr(today, i);
      const dueTodos = (todos ?? []).filter((t) => !t.completed && t.dueDate === date).length;
      const dueProjects = (projects ?? []).filter((p) => !p.completedAt && p.dueDate === date).length;
      const dueStages = (projects ?? []).reduce(
        (sum, p) => sum + (p.stages ?? []).filter((s) => !s.completed && s.dueDate === date).length,
        0
      );
      const plannedSeconds = (dailyTasks ?? [])
        .filter((t) => t.date === date && t.status !== "done" && t.hasPlan !== false)
        .reduce((sum, t) => sum + t.estimatedSeconds, 0);
      // 案件の期日は1件の重みを大きく取る(ToDo1件より重い)。予定時間も1時間ごとに0.5だけ効かせる
      const load = dueTodos + dueProjects * 2 + dueStages * 1.5 + (plannedSeconds / 3600) * 0.5;
      days.push({ date, dueTodos, dueProjects, dueStages, plannedSeconds, load });
    }
    return days;
  }, [todos, projects, dailyTasks, today]);

  const overdue = useMemo(() => {
    const t = (todos ?? []).filter((x) => !x.completed && !x.parentTaskId && !!x.dueDate && x.dueDate < today).length;
    const p = (projects ?? []).filter((x) => !x.completedAt && x.dueDate < today).length;
    return { todos: t, projects: p, total: t + p };
  }, [todos, projects, today]);

  const maxLoad = Math.max(1, ...forecast.map((d) => d.load));
  const worst = forecast.reduce((best, d) => (d.load > best.load ? d : best), forecast[0]);
  const calmBeforeStorm = useMemo(() => {
    if (!worst || worst.load < 5) return null;
    // 嵐の日より前で、一番空いている日を「前倒し先」として案内する
    const before = forecast.filter((d) => d.date < worst.date);
    if (before.length === 0) return null;
    return before.reduce((best, d) => (d.load < best.load ? d : best), before[0]);
  }, [forecast, worst]);

  if (!todos || !projects) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;

  return (
    <div className="space-y-3">
      {overdue.total > 0 && (
        <div className="panel border border-alert/60 bg-alert/10 p-3">
          <p className="text-sm font-bold text-alert">
            ⚠ 警報発令中：すでに期日を過ぎたものが {overdue.total}件（ToDo {overdue.todos} / 案件 {overdue.projects}）
          </p>
          <p className="mt-0.5 text-xs text-cream/60">過ぎた分は予報には含めず、警報として別に出しています。</p>
        </div>
      )}

      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-base font-bold">🌦 業務天気予報</h3>
          <p className="text-xs text-cream/50">
            {worst && worst.load >= 5
              ? `${formatDateJp(worst.date)}に${weatherOf(worst.load).label}の予報`
              : "向こう2週間は大きな荒れなし"}
            {calmBeforeStorm && `　前倒しするなら ${formatDateJp(calmBeforeStorm.date)} が狙い目`}
          </p>
        </div>

        {/* 週間予報のカード列 */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {forecast.map((d) => {
            const w = weatherOf(d.load);
            const dow = new Date(d.date + "T00:00:00").getDay();
            const isToday = d.date === today;
            return (
              <div
                key={d.date}
                className={`w-[92px] shrink-0 rounded-lg border p-2 text-center ${
                  isToday ? "border-cream/60 bg-cream/5" : "border-cream/15"
                } ${w.tone === "storm" ? "bg-alert/10" : ""}`}
                title={`ToDo ${d.dueTodos}件 / 案件 ${d.dueProjects}件 / 段階 ${d.dueStages}件${
                  d.plannedSeconds > 0 ? ` / 予定 ${formatHms(d.plannedSeconds)}` : ""
                }`}
              >
                <div className={`text-[10px] ${dow === 0 ? "text-alert/80" : dow === 6 ? "text-cream/60" : "text-cream/50"}`}>
                  {formatDateJp(d.date)}（{WEEKDAY_JP[dow]}）
                </div>
                <div className="my-0.5 text-2xl leading-none">{w.icon}</div>
                <div className={`text-[10px] font-bold ${w.tone === "storm" ? "text-alert" : "text-cream/70"}`}>{w.label}</div>
                <div className="mt-1 text-[10px] tabular-nums text-cream/50">
                  {d.dueTodos + d.dueProjects + d.dueStages}件
                </div>
                {d.plannedSeconds > 0 && (
                  <div className="text-[9px] tabular-nums text-cream/40">{Math.round(d.plannedSeconds / 360) / 10}h</div>
                )}
              </div>
            );
          })}
        </div>

        {/* 雨雲レーダー風の負荷バー */}
        <div className="mt-3">
          <p className="mb-1 text-[10px] text-cream/50">負荷レーダー（右へ行くほど先の日付）</p>
          <div className="flex h-16 items-end gap-[3px]">
            {forecast.map((d) => {
              const h = Math.max(3, (d.load / maxLoad) * 100);
              const w = weatherOf(d.load);
              return (
                <div
                  key={d.date}
                  className={`flex-1 rounded-t ${
                    w.tone === "storm" ? "bg-alert" : w.tone === "rain" ? "bg-alert/60" : w.tone === "cloud" ? "bg-cream/40" : "bg-cream/20"
                  }`}
                  style={{ height: `${h}%` }}
                  title={`${formatDateJp(d.date)}　負荷指数 ${d.load.toFixed(1)}`}
                />
              );
            })}
          </div>
        </div>

        <p className="mt-2 text-[10px] leading-relaxed text-cream/40">
          天気は「その日に期日が来るもの」の重みから決めています（ToDo1件=1、案件1件=2、段階1件=1.5、予定時間1時間=0.5）。
          実際の空模様とは関係ありません。
        </p>
      </div>
    </div>
  );
}
