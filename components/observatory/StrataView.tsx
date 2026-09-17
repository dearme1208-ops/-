"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { daysBetweenDateStrs, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { TodoTask } from "@/lib/types";

// 先送りを地質断面として見る観測法。上が地表(今日)で、下に行くほど古い。
// 未完了のToDoは作られてからの経過日数に応じた深さへ沈んでいき、
// 深い層に埋まったものほど「掘り起こす」のに勇気が要る、という体験をそのまま図にする
interface Layer {
  key: string;
  label: string;
  /** この層に入る経過日数の下限(この値以上) */
  minDays: number;
  /** 地層の色。下へ行くほど暗く、硬そうな色にする */
  fill: string;
  pattern: "soil" | "sand" | "clay" | "rock" | "bedrock";
}

const LAYERS: Layer[] = [
  { key: "surface", label: "表土（1週間以内）", minDays: 0, fill: "rgb(var(--cream-rgb) / 0.22)", pattern: "soil" },
  { key: "sand", label: "砂層（1か月以内）", minDays: 7, fill: "rgb(var(--cream-rgb) / 0.17)", pattern: "sand" },
  { key: "clay", label: "粘土層（3か月以内）", minDays: 30, fill: "rgb(var(--cream-rgb) / 0.13)", pattern: "clay" },
  { key: "rock", label: "岩盤（半年以内）", minDays: 90, fill: "rgb(var(--cream-rgb) / 0.1)", pattern: "rock" },
  { key: "deep", label: "深層（1年以内）", minDays: 180, fill: "rgb(var(--cream-rgb) / 0.07)", pattern: "rock" },
  { key: "bedrock", label: "基盤岩（1年以上）", minDays: 365, fill: "rgb(var(--cream-rgb) / 0.05)", pattern: "bedrock" },
];

function layerOf(ageDays: number): Layer {
  let found = LAYERS[0];
  for (const l of LAYERS) if (ageDays >= l.minDays) found = l;
  return found;
}

export default function StrataView() {
  const today = todayStr();
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);

  const buried = useMemo(() => {
    const active = (todos ?? []).filter((t) => !t.completed && !t.parentTaskId);
    return active
      .map((t) => {
        const ageDays = Math.max(0, daysBetweenDateStrs(todayStr(new Date(t.createdAt)), today));
        return { task: t, ageDays, layer: layerOf(ageDays) };
      })
      .sort((a, b) => b.ageDays - a.ageDays);
  }, [todos, today]);

  const byLayer = useMemo(() => {
    const map = new Map<string, { task: TodoTask; ageDays: number }[]>();
    for (const l of LAYERS) map.set(l.key, []);
    for (const b of buried) map.get(b.layer.key)!.push({ task: b.task, ageDays: b.ageDays });
    return map;
  }, [buried]);

  async function excavate(task: TodoTask) {
    // 掘り起こす = 今日のマイデイに引き上げる。ToDoそのものは書き換えない
    await db.todoTasks.update(task.id, { myDayDate: today });
    showUndoToast(`「${task.title}」を掘り起こしてマイデイに入れました`, async () => {
      await db.todoTasks.update(task.id, { myDayDate: task.myDayDate });
    });
  }

  if (!todos) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;

  const deepest = buried[0];

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold">⛏ 地層</h3>
        <p className="text-xs text-cream/50">
          未完了 {buried.length}件
          {deepest && `　最も深いもの: 「${deepest.task.title}」（${deepest.ageDays}日前）`}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-cream/20">
        {/* 地表 */}
        <div className="flex items-center justify-between bg-cream/25 px-3 py-1 text-[10px] font-bold text-cream">
          <span>― 地表（今日 {today}）―</span>
          <span className="font-normal text-cream/70">下へ行くほど、作られてから時間が経っています</span>
        </div>
        {LAYERS.map((layer) => {
          const items = byLayer.get(layer.key) ?? [];
          return (
            <div
              key={layer.key}
              className="relative border-t border-cream/15 px-3 py-2"
              style={{ backgroundColor: layer.fill, minHeight: 64 }}
            >
              {/* 地層の縞模様。層ごとに粒度を変えて、硬さの違いを見た目に出す */}
              <div
                className="pointer-events-none absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    layer.pattern === "soil"
                      ? "repeating-linear-gradient(92deg, rgb(var(--cream-rgb) / 0.12) 0 2px, transparent 2px 7px)"
                      : layer.pattern === "sand"
                        ? "repeating-linear-gradient(88deg, rgb(var(--cream-rgb) / 0.1) 0 1px, transparent 1px 5px)"
                        : layer.pattern === "clay"
                          ? "repeating-linear-gradient(180deg, rgb(var(--cream-rgb) / 0.09) 0 1px, transparent 1px 9px)"
                          : layer.pattern === "rock"
                            ? "repeating-linear-gradient(45deg, rgb(var(--cream-rgb) / 0.08) 0 3px, transparent 3px 12px)"
                            : "repeating-linear-gradient(135deg, rgb(var(--cream-rgb) / 0.07) 0 5px, transparent 5px 16px)",
                }}
              />
              <div className="relative">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-cream/60">{layer.label}</span>
                  <span className="text-[10px] tabular-nums text-cream/40">{items.length}件</span>
                </div>
                {items.length === 0 ? (
                  <p className="text-[10px] text-cream/25">この層には何も埋まっていません</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(({ task, ageDays }) => (
                      <button
                        key={task.id}
                        onClick={() => excavate(task)}
                        title={`${ageDays}日前に作られたまま未完了。押すと掘り起こしてマイデイに入れます`}
                        className={`max-w-[240px] truncate rounded border px-2 py-1 text-[11px] transition-colors hover:border-cream hover:bg-cream/15 ${
                          ageDays >= 180
                            ? "border-cream/20 text-cream/45"
                            : ageDays >= 30
                              ? "border-cream/25 text-cream/65"
                              : "border-cream/35 text-cream/85"
                        } ${task.myDayDate === today ? "border-alert/70" : ""}`}
                      >
                        {task.myDayDate === today ? "⛏ " : ""}
                        {task.title}
                        <span className="ml-1.5 tabular-nums text-cream/40">{ageDays}日</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-cream/40">
        押すと「掘り起こし」= その項目を今日のマイデイに入れます（ToDoそのものは変わりません）。
        期日や重要フラグの有無に関係なく、作られてからの日数だけで深さが決まります。
      </p>
    </div>
  );
}
