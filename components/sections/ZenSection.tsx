"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { computeProjectProgress } from "@/lib/projectStage";
import { daysBetweenDateStrs, formatMsClock, todayStr } from "@/lib/time";
import type { DailyTask, ProjectItem, TodoTask } from "@/lib/types";

// 禅モード専用の画面。「今やるべき1件だけを見せる。他は見せない」という引き算を、
// タブ構成(today/settingsのみ)だけでなくこの画面自体でも徹底する。ToDo一覧も
// 案件一覧もレポートも出さず、Claudeが選んだ(あるいは既に進行中の)ただ1件だけを
// 円相(禅画で悟りや静けさを表す、書き切らない一筆書きの円)とともに中央に置く
export default function ZenSection() {
  const today = todayStr();
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const lists = useLiveQuery(() => db.todoLists.orderBy("order").toArray(), []);
  const [now, setNow] = useState(Date.now());
  const [showCapture, setShowCapture] = useState(false);
  const [captureText, setCaptureText] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const runningDaily = (dailyTasks ?? []).find((d) => d.status === "running") ?? null;

  const activeTodos = useMemo(() => (todos ?? []).filter((t) => !t.completed && !t.parentTaskId), [todos]);
  const activeProjects = useMemo(() => (projects ?? []).filter((p) => !p.completedAt), [projects]);

  function todoScore(t: TodoTask): number {
    if (!t.dueDate) return 1000 + t.order;
    return daysBetweenDateStrs(today, t.dueDate) * 10;
  }
  function projectScore(p: ProjectItem): number {
    const days = daysBetweenDateStrs(today, p.dueDate);
    const progress = computeProjectProgress(p.stages) ?? 0;
    return days * 10 - (1 - progress) * 15;
  }

  // 実行中があればそれを最優先で見せる(「今、ここ」にあるものより優先すべきものは無い)。
  // 無ければ期日・進み具合から最も静かに気にかかっている1件だけを選ぶ
  const picked = useMemo(() => {
    if (runningDaily) return null;
    type Candidate = { kind: "todo"; item: TodoTask; score: number } | { kind: "project"; item: ProjectItem; score: number };
    const candidates: Candidate[] = [];
    for (const t of activeTodos) candidates.push({ kind: "todo", item: t, score: todoScore(t) });
    for (const p of activeProjects) candidates.push({ kind: "project", item: p, score: projectScore(p) });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTodos, activeProjects, today, runningDaily]);

  const runningElapsedMs = runningDaily ? segmentsAccumulatedMs(runningDaily, now) : 0;

  async function ensureListId(): Promise<string> {
    if (lists && lists.length > 0) return lists[0].id;
    const id = uid();
    await db.todoLists.add({ id, title: "今", order: 0, createdAt: Date.now() });
    return id;
  }

  async function startTodo(t: TodoTask) {
    const category = t.category || "";
    const master = await findOrCreateMasterTask(category || "タスク", t.title, 0);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category: category || "タスク",
      name: t.title,
      estimatedSeconds: 0,
      hasPlan: false,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
      todoTaskId: t.id,
    };
    await db.dailyTasks.add(task);
  }

  async function startProject(p: ProjectItem) {
    const master = await findOrCreateMasterTask(p.category, p.workName, 0);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category: p.category,
      name: p.workName,
      estimatedSeconds: 0,
      hasPlan: false,
      status: "running",
      segments: [{ start: Date.now() }],
      accumulatedMs: 0,
      startedAt: Date.now(),
      isSpontaneous: true,
      projectId: p.id,
    };
    await db.dailyTasks.add(task);
  }

  async function start() {
    if (!picked) return;
    if (picked.kind === "todo") await startTodo(picked.item);
    else await startProject(picked.item);
  }

  async function pause() {
    if (!runningDaily) return;
    const closeAt = Date.now();
    const segments = runningDaily.segments.map((s, i) =>
      i === runningDaily.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(runningDaily.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }

  async function complete() {
    if (!runningDaily) return;
    await finishDailyTask(runningDaily);
  }

  async function addQuick() {
    const title = captureText.trim();
    if (!title) return;
    const listId = await ensureListId();
    const task: TodoTask = {
      id: uid(),
      listId,
      title,
      important: false,
      completed: false,
      order: (todos ?? []).length,
      createdAt: Date.now(),
    };
    await db.todoTasks.add(task);
    setCaptureText("");
    setShowCapture(false);
  }

  const title = runningDaily ? runningDaily.name : picked ? (picked.kind === "todo" ? picked.item.title : picked.item.title) : null;
  const category = runningDaily ? runningDaily.category : picked ? (picked.kind === "todo" ? picked.item.category : picked.item.category) : null;
  const dueDate = picked?.kind === "todo" ? picked.item.dueDate : picked?.kind === "project" ? picked.item.dueDate : undefined;

  return (
    <div className="zen-stage">
      <div className="zen-enso" aria-hidden="true">
        <svg viewBox="0 0 240 240" className="h-full w-full">
          <circle
            cx="120"
            cy="120"
            r="96"
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray="565 40"
            strokeDashoffset="-18"
            transform="rotate(-98 120 120)"
          />
        </svg>
      </div>

      <div className="zen-content">
        {title ? (
          <>
            {category && <p className="zen-category">{category}</p>}
            <h1 className="zen-title">{title}</h1>
            {dueDate && <p className="zen-meta">期日 {dueDate}</p>}
            {runningDaily && <p className="zen-meta zen-clock tabular-nums">{formatMsClock(runningElapsedMs)}</p>}
            <div className="zen-actions">
              {runningDaily ? (
                <>
                  <button className="zen-btn zen-btn-primary" onClick={complete}>
                    完了にする
                  </button>
                  <button className="zen-btn" onClick={pause}>
                    一時停止
                  </button>
                </>
              ) : (
                <button className="zen-btn zen-btn-primary" onClick={start}>
                  はじめる
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="zen-category">今</p>
            <h1 className="zen-title zen-title-empty">何もありません</h1>
            <p className="zen-meta">静かな時間です。</p>
          </>
        )}
      </div>

      <div className="zen-footer">
        {showCapture ? (
          <input
            autoFocus
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addQuick()}
            onBlur={() => !captureText.trim() && setShowCapture(false)}
            placeholder="ひとことで"
            className="zen-input"
          />
        ) : (
          <button className="zen-link" onClick={() => setShowCapture(true)}>
            + 何かを加える
          </button>
        )}
      </div>
    </div>
  );
}
