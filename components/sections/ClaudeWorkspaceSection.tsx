"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { computeProjectProgress } from "@/lib/projectStage";
import { daysBetweenDateStrs, formatMsClock, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import { useVisualMode } from "@/lib/theme";
import { buildThinking, confidenceLabel } from "@/lib/claudeThinking";
import { claudeWordsFor } from "@/lib/claudeWords";
import { ConfidenceScale, Paper } from "@/components/claude/ClaudeCanvas";
import type { DailyTask, ProjectItem, ProjectStage, TodoTask } from "@/lib/types";

// Claudeモード専用の統合ワークスペース。
//
// 既存アプリは「本日の作業(計測)」「ToDo(単発タスク)」「案件(段階付きの大きな仕事)」を
// 別々のタブに分けているが、突き詰めるとどれも「いつかやること。任意でサブステップと
// 期日を持つ」という同じ概念で、タブを跨いで行き来する必要はないはずだとClaudeは判断した。
// そこでこの3タブを1つの連続した画面に統合し、どの項目からもその場で計測を
// 開始・一時停止・完了できるようにした(「まずタブを移動して計測を始める」という
// 手順そのものを無くす)。データは他モードと同じdailyTasks/todoTasks/projectsテーブルを
// そのまま使うため、モードを切り替えても記録は失われない
export default function ClaudeWorkspaceSection({ onOpenInsights }: { onOpenInsights?: () => void }) {
  const today = todayStr();
  const { wordingEnabled } = useVisualMode();
  const W = claudeWordsFor(wordingEnabled);
  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const allTodoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const lists = useLiveQuery(() => db.todoLists.orderBy("order").toArray(), []);
  // ワークスペースの見出しにも分析結果を1件だけ出す。インサイトタブと同じ
  // エンジン(lib/claudeThinking.ts)を呼ぶので、2つの画面で結論が食い違うことはない
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const [now, setNow] = useState(Date.now());
  const [captureText, setCaptureText] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectDue, setNewProjectDue] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState<Record<string, string>>({});

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const todos = useMemo(() => (allTodoTasks ?? []).filter((t) => !t.parentTaskId), [allTodoTasks]);
  const subtaskCountByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of allTodoTasks ?? []) {
      if (t.parentTaskId) map.set(t.parentTaskId, (map.get(t.parentTaskId) ?? 0) + 1);
    }
    return map;
  }, [allTodoTasks]);

  const runningDaily = (dailyTasks ?? []).find((d) => d.status === "running") ?? null;
  const dailyByTodoId = useMemo(() => {
    const map = new Map<string, DailyTask>();
    for (const d of dailyTasks ?? []) if (d.todoTaskId) map.set(d.todoTaskId, d);
    return map;
  }, [dailyTasks]);
  const dailyByProjectId = useMemo(() => {
    const map = new Map<string, DailyTask>();
    for (const d of dailyTasks ?? []) if (d.projectId && !d.stageId) map.set(d.projectId, d);
    return map;
  }, [dailyTasks]);

  const activeTodos = todos.filter((t) => !t.completed);
  const doneTodos = todos.filter((t) => t.completed);
  const activeProjects = (projects ?? []).filter((p) => !p.completedAt);
  const doneProjects = (projects ?? []).filter((p) => p.completedAt);

  function todoScore(t: TodoTask): number {
    if (!t.dueDate) return 1000 + t.order;
    return daysBetweenDateStrs(today, t.dueDate) * 10;
  }
  function projectScore(p: ProjectItem): number {
    const days = daysBetweenDateStrs(today, p.dueDate);
    const progress = computeProjectProgress(p.stages) ?? 0;
    return days * 10 - (1 - progress) * 15;
  }

  const sortedProjects = useMemo(
    () => [...activeProjects].sort((a, b) => projectScore(a) - projectScore(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProjects, today]
  );

  // 過去に使った@タグをよく使う順に並べる。タグは自己申告の自由入力なので、
  // 毎回書式を思い出して打ち直すよりも、クリックで挿入できた方が発見しやすい
  const recentTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of todos) {
      const c = (t.category ?? "").trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
  }, [todos]);

  function insertTag(tag: string) {
    const withoutTag = captureText.replace(/\s*@\S+\s*$/, "").trimEnd();
    setCaptureText(withoutTag ? `${withoutTag} @${tag}` : `@${tag}`);
  }

  // カテゴリ(@タグ)ごとに軽くまとめる。未分類は最後のグループにまとめる
  const todoGroups = useMemo(() => {
    const byCategory = new Map<string, TodoTask[]>();
    for (const t of activeTodos) {
      const key = (t.category ?? "").trim();
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(t);
    }
    const groups = [...byCategory.entries()].map(([category, items]) => ({
      category,
      items: items.sort((a, b) => todoScore(a) - todoScore(b)),
      minScore: Math.min(...items.map(todoScore)),
    }));
    groups.sort((a, b) => (a.category === "" ? 1 : b.category === "" ? -1 : a.minScore - b.minScore));
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTodos, today]);

  // Claudeが今いちばん取り組むべきと考える1件(プロジェクト・タスク横断)
  const suggestion = useMemo(() => {
    const candidates: { label: string; score: number; reason: string }[] = [];
    for (const p of activeProjects) {
      const days = daysBetweenDateStrs(today, p.dueDate);
      candidates.push({
        label: p.title,
        score: projectScore(p),
        reason: days < 0 ? "期日を過ぎているため" : days <= 3 ? "期日が近いため" : "進行中のプロジェクトのため",
      });
    }
    for (const t of activeTodos) {
      const days = t.dueDate ? daysBetweenDateStrs(today, t.dueDate) : null;
      candidates.push({
        label: t.title,
        score: todoScore(t),
        reason: days === null ? "登録が一番古いため" : days < 0 ? "期限を過ぎているため" : days === 0 ? "今日が期限のため" : "期限が近いため",
      });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjects, activeTodos, today]);

  // インサイトタブと同じ分析から、いちばん確度×影響の大きい1件だけを持ってくる
  const topFinding = useMemo(() => {
    if (!records || !masters || !allTodoTasks || !projects) return null;
    return buildThinking(records, masters, allTodoTasks, projects, today).findings[0] ?? null;
  }, [records, masters, allTodoTasks, projects, today]);

  // 案件ごとの、直近14日に充てた時間。インサイトタブの分析と同じ窓を使い、
  // 同じ画面で「順調です」と「14日間まったく進んでいません」が併存しないようにする
  const recentSecondsByProject = useMemo(() => {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
    const map = new Map<string, number>();
    for (const r of records ?? []) {
      if (r.excludedFromStats || r.date < sinceStr) continue;
      const ids = [r.projectId, ...(r.secondaryProjectIds ?? [])].filter(Boolean) as string[];
      for (const id of ids) map.set(id, (map.get(id) ?? 0) + r.seconds);
    }
    return map;
  }, [records]);

  const totalMsToday = (dailyTasks ?? []).reduce((sum, d) => sum + segmentsAccumulatedMs(d, now), 0);
  const doneCountToday = (dailyTasks ?? []).filter((d) => d.status === "done").length;

  // 既存のリストがあればそれを流用し、無ければ「ワークスペース」を1つだけ作る。
  // ここで作るタスクも通常のtodoListsに属する実在のリストに紐付けるため、
  // 他モードのToDoタブに切り替えても問題なく表示・編集できる
  async function ensureListId(): Promise<string> {
    if (lists && lists.length > 0) return lists[0].id;
    const id = uid();
    await db.todoLists.add({ id, title: "ワークスペース", order: 0, createdAt: Date.now() });
    return id;
  }

  async function addTodo() {
    const raw = captureText.trim();
    if (!raw) return;
    const match = raw.match(/^(.*?)\s*@(\S+)\s*$/);
    const title = match ? match[1].trim() : raw;
    const category = match ? match[2].trim() : undefined;
    if (!title) return;
    const listId = await ensureListId();
    const task: TodoTask = {
      id: uid(),
      listId,
      title,
      category,
      important: false,
      completed: false,
      order: todos.length,
      createdAt: Date.now(),
    };
    await db.todoTasks.add(task);
    setCaptureText("");
  }

  async function addProject() {
    const title = newProjectTitle.trim();
    if (!title || !newProjectDue) return;
    const item: ProjectItem = {
      id: uid(),
      title,
      category: "プロジェクト",
      workName: title,
      dueDate: newProjectDue,
      createdAt: Date.now(),
    };
    await db.projects.add(item);
    setNewProjectTitle("");
    setNewProjectDue("");
    setShowProjectForm(false);
  }

  async function pauseDaily(daily: DailyTask) {
    const closeAt = Date.now();
    const segments = daily.segments.map((s, i) =>
      i === daily.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(daily.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }

  async function startTodo(t: TodoTask) {
    if (runningDaily && runningDaily.todoTaskId !== t.id) await pauseDaily(runningDaily);
    const existing = dailyByTodoId.get(t.id);
    if (existing) {
      const segments = [...existing.segments, { start: Date.now() }];
      await db.dailyTasks.update(existing.id, { segments, status: "running" });
      return;
    }
    const category = t.category || "タスク";
    const master = await findOrCreateMasterTask(category, t.title, 0);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category,
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
    if (runningDaily && runningDaily.projectId !== p.id) await pauseDaily(runningDaily);
    const existing = dailyByProjectId.get(p.id);
    if (existing) {
      const segments = [...existing.segments, { start: Date.now() }];
      await db.dailyTasks.update(existing.id, { segments, status: "running" });
      return;
    }
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

  async function toggleTodoComplete(t: TodoTask) {
    await db.todoTasks.update(t.id, { completed: !t.completed, completedAt: !t.completed ? Date.now() : undefined });
  }

  async function toggleProjectComplete(p: ProjectItem) {
    await db.projects.update(p.id, { completedAt: p.completedAt ? undefined : Date.now(), autoCompletedByImport: false });
  }

  async function updateTodoTitle(t: TodoTask, title: string) {
    const trimmed = title.trim();
    if (!trimmed || trimmed === t.title) return;
    await db.todoTasks.update(t.id, { title: trimmed });
  }

  async function updateTodoDueDate(t: TodoTask, dueDate: string) {
    await db.todoTasks.update(t.id, { dueDate: dueDate || undefined });
  }

  async function deleteTodo(t: TodoTask) {
    const subs = (allTodoTasks ?? []).filter((s) => s.parentTaskId === t.id);
    await db.todoTasks.bulkDelete([t.id, ...subs.map((s) => s.id)]);
    showUndoToast(`「${t.title}」を取り消しました`, async () => {
      await db.todoTasks.bulkAdd([t, ...subs]);
    });
  }

  async function deleteProject(p: ProjectItem) {
    await db.projects.delete(p.id);
    showUndoToast(`「${p.title}」を取り消しました`, async () => {
      await db.projects.add(p);
    });
  }

  async function toggleStage(p: ProjectItem, stage: ProjectStage) {
    const stages = (p.stages ?? []).map((s) =>
      s.id === stage.id ? { ...s, completed: !s.completed, completedAt: !s.completed ? Date.now() : undefined } : s
    );
    await db.projects.update(p.id, { stages });
  }

  async function addStage(p: ProjectItem) {
    const title = (newStageTitle[p.id] ?? "").trim();
    if (!title) return;
    const stages = [...(p.stages ?? []), { id: uid(), title, completed: false }];
    await db.projects.update(p.id, { stages });
    setNewStageTitle((prev) => ({ ...prev, [p.id]: "" }));
  }

  function projectInsight(p: ProjectItem): string {
    const remaining = daysBetweenDateStrs(today, p.dueDate);
    const progress = computeProjectProgress(p.stages);
    const recentHours = (recentSecondsByProject.get(p.id) ?? 0) / 3600;
    if (remaining < 0) return `期日を${Math.abs(remaining)}日過ぎています。状況を見直すことをおすすめします。`;
    if (progress !== null && progress >= 1) return "すべての段階が完了しています。仕上げの確認をどうぞ。";
    // 残り日数だけを見て「順調」と言うと、手が付いていない案件まで順調に見えてしまう。
    // 直近の投入時間を先に確かめる
    if (recentHours === 0) return `直近14日間、この案件に時間を使っていません。期日まで残り${remaining}日です。`;
    if (remaining <= 3 && (progress ?? 0) < 0.5) return `期日まで残り${remaining}日です。優先度を上げることをおすすめします。`;
    if (remaining === 0) return "今日が期日です。";
    return `期日まで残り${remaining}日。直近14日で${recentHours.toFixed(1)}時間を充てています。`;
  }

  return (
    <div className="space-y-5">
      {/* ══ 見出し ══ */}
      <header className="space-y-1.5">
        <p className="text-[11px] tracking-[0.2em] text-cream/35">{today}</p>
        <h2 className="font-display text-2xl font-bold tracking-tight text-cream">ワークスペース</h2>
        <p className="text-[13px] text-cream/55">{W.todayLine(doneCountToday, formatMsClock(totalMsToday))}</p>
        {suggestion && (
          <p className="text-[13px] text-cream/60">
            次に取り組むなら「<span className="font-bold text-cream/80">{suggestion.label}</span>」です（
            {suggestion.reason}）。
          </p>
        )}
        <div className="h-px w-full bg-cream/10" />
      </header>

      {/* ══ 今いちばん気になっていること ══ */}
      {topFinding && (
        <article className="relative overflow-hidden rounded-xl border border-cream/12">
          <Paper seed={topFinding.id} className="absolute inset-0" />
          <div className="relative p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cream/35">{W.topFindingLead}</p>
            <h3 className="mt-1.5 font-display text-[15px] font-bold leading-snug text-cream">
              {topFinding.headline}
            </h3>
            {topFinding.action && (
              <p className="mt-2 border-l-2 border-alert/50 pl-3 text-[13px] leading-relaxed text-cream/70">
                {topFinding.action}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2.5">
              <span className="shrink-0 text-[10px] tracking-wider text-cream/40">{W.confidenceLabel}</span>
              <ConfidenceScale value={topFinding.confidence} className="min-w-0 flex-1" />
              <span className="shrink-0 text-[10px] tabular-nums text-cream/50">
                {Math.round(topFinding.confidence * 100)}%・{confidenceLabel(topFinding.confidence)}
              </span>
            </div>
            {onOpenInsights && (
              <button
                onClick={onOpenInsights}
                className="mt-3 text-[12px] text-alert underline decoration-alert/40 underline-offset-4 hover:decoration-alert"
              >
                {W.seeAll} →
              </button>
            )}
          </div>
        </article>
      )}

      {runningDaily && (
        <div className="rounded-xl border border-alert/30 bg-panel/70 p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-alert">
            <span className="claude-pulse-dot inline-flex h-1.5 w-1.5 rounded-full bg-alert" aria-hidden="true" />
            {W.focusTitle}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1 truncate font-display text-base font-bold text-cream">{runningDaily.name}</p>
            <span className="shrink-0 font-display text-2xl font-bold tabular-nums tracking-tight text-alert">
              {formatMsClock(segmentsAccumulatedMs(runningDaily, now))}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-pill-outline text-xs" onClick={() => pauseDaily(runningDaily)}>
              一時停止
            </button>
            <button
              className="btn-pill text-xs"
              onClick={async () => {
                await finishDailyTask(runningDaily);
              }}
            >
              完了にする
            </button>
          </div>
        </div>
      )}

      <div className="panel space-y-2 p-4">
        <label className="block text-[11px] font-bold uppercase tracking-[0.2em] text-cream/40">{W.captureLabel}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
            placeholder={W.capturePlaceholder}
            className="w-full min-w-0 flex-1 rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
          />
          <button className="btn-pill text-xs" onClick={addTodo} disabled={!captureText.trim()}>
            追加
          </button>
        </div>
        <p className="text-[11px] text-cream/40">
          末尾に「@分類名」を書くと、その分類でまとめられます。段階や期日で管理したい大きな仕事は
          <button className="ml-1 text-cream/60 underline" onClick={() => setShowProjectForm((v) => !v)}>
            プロジェクトとして登録
          </button>
          できます。
        </p>
        {recentTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-cream/30">よく使うタグ:</span>
            {recentTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => insertTag(tag)}
                className="rounded-full border border-cream/15 px-2 py-0.5 text-[11px] text-cream/60 hover:border-accent/50 hover:text-cream"
              >
                @{tag}
              </button>
            ))}
          </div>
        )}
        {showProjectForm && (
          <div className="flex flex-col gap-2 border-t border-cream/10 pt-2 sm:flex-row">
            <input
              value={newProjectTitle}
              onChange={(e) => setNewProjectTitle(e.target.value)}
              placeholder="例: 新サイトの制作"
              className="w-full min-w-0 flex-1 rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
            />
            <input
              type="date"
              value={newProjectDue}
              onChange={(e) => setNewProjectDue(e.target.value)}
              className="rounded-lg border border-cream/15 bg-ink px-3 py-2 text-sm text-cream"
            />
            <button className="btn-pill text-xs" onClick={addProject} disabled={!newProjectTitle.trim() || !newProjectDue}>
              登録
            </button>
          </div>
        )}
      </div>

      {sortedProjects.map((project) => {
        const progress = computeProjectProgress(project.stages);
        const daily = dailyByProjectId.get(project.id);
        const isRunning = daily?.status === "running";
        const isPaused = daily?.status === "paused";
        const overdue = project.dueDate < today;
        return (
          <div key={project.id} className={`panel space-y-3 p-4 ${overdue ? "ring-1 ring-alert/40" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="mr-1.5 rounded-full bg-alert/10 px-2 py-0.5 text-[10px] font-bold text-alert">プロジェクト</span>
                <h3 className="mt-1 font-display text-base font-bold text-cream">{project.title}</h3>
                <p className="text-xs text-cream/40">
                  期日 {project.dueDate}
                  {daily && !isRunning && (
                    <span className="ml-2">今日はこれまで {formatMsClock(segmentsAccumulatedMs(daily, now))}</span>
                  )}
                </p>
              </div>
              <button className="text-xs text-cream/30 hover:text-alert" onClick={() => deleteProject(project)}>
                ✕
              </button>
            </div>

            <p className={`text-sm ${overdue ? "font-bold text-alert" : "text-cream/60"}`}>
              <span className="text-cream/40">Claude: </span>
              {projectInsight(project)}
            </p>

            {progress !== null && (
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/40">
                <div className="h-full rounded-full bg-alert/70" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}

            {(project.stages ?? []).length > 0 && (
              <div className="space-y-1">
                {(project.stages ?? []).map((stage) => (
                  <label key={stage.id} className="flex items-center gap-2 text-sm text-cream/80">
                    <input
                      type="checkbox"
                      checked={stage.completed}
                      onChange={() => toggleStage(project, stage)}
                      className="h-4 w-4 rounded border-cream/30 bg-ink accent-alert"
                    />
                    <span className={stage.completed ? "text-cream/40 line-through" : ""}>{stage.title}</span>
                  </label>
                ))}
              </div>
            )}
            <input
              value={newStageTitle[project.id] ?? ""}
              onChange={(e) => setNewStageTitle((prev) => ({ ...prev, [project.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addStage(project)}
              placeholder="+ 段階を追加"
              className="w-40 rounded-lg border border-transparent bg-transparent px-1 py-1 text-xs text-cream/60 focus:border-cream/15 focus:outline-none"
            />

            <div className="flex flex-wrap gap-2 border-t border-cream/10 pt-2">
              {isRunning ? (
                <>
                  <span className="claude-pulse-dot inline-flex h-2 w-2 self-center rounded-full bg-alert" aria-hidden="true" />
                  <span className="self-center text-xs font-bold tabular-nums text-alert">
                    {formatMsClock(segmentsAccumulatedMs(daily!, now))}
                  </span>
                  <button className="btn-pill-outline text-xs" onClick={() => pauseDaily(daily!)}>
                    一時停止
                  </button>
                </>
              ) : (
                <button className="btn-pill-outline text-xs" onClick={() => startProject(project)}>
                  {isPaused ? "再開" : "今から取り組む"}
                </button>
              )}
              <button className="btn-pill-outline text-xs" onClick={() => toggleProjectComplete(project)}>
                完了にする
              </button>
            </div>
          </div>
        );
      })}

      {todoGroups.map((group) => (
        <div key={group.category || "__none__"} className="panel space-y-2 p-4">
          {group.category ? (
            <h3 className="font-display text-sm font-bold text-cream/70">@{group.category}</h3>
          ) : sortedProjects.length > 0 || todoGroups.length > 1 ? (
            <h3 className="font-display text-sm font-bold text-cream/70">タスク</h3>
          ) : null}
          <div className="space-y-1.5">
            {group.items.map((t) => {
              const overdue = !!t.dueDate && t.dueDate < today;
              const subCount = subtaskCountByParent.get(t.id) ?? 0;
              const daily = dailyByTodoId.get(t.id);
              const isRunning = daily?.status === "running";
              const isPaused = daily?.status === "paused";
              return (
                <div key={t.id} className="rounded-lg bg-ink/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleTodoComplete(t)}
                      aria-label="完了"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-cream/40"
                    />
                    <input
                      key={t.id + t.title}
                      defaultValue={t.title}
                      onBlur={(e) => updateTodoTitle(t, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      className="min-w-0 flex-1 bg-transparent text-sm text-cream focus:outline-none focus:ring-1 focus:ring-cream/30"
                    />
                    <button className="shrink-0 text-xs text-cream/30 hover:text-alert" onClick={() => deleteTodo(t)}>
                      ✕
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 pl-6">
                    <div className="flex items-center gap-2">
                      {isRunning ? (
                        <span className="flex items-center gap-1.5 text-xs font-bold tabular-nums text-alert">
                          <span className="claude-pulse-dot inline-flex h-2 w-2 rounded-full bg-alert" aria-hidden="true" />
                          {formatMsClock(segmentsAccumulatedMs(daily!, now))}
                        </span>
                      ) : (
                        <button
                          className="text-xs text-cream/40 hover:text-cream"
                          onClick={() => startTodo(t)}
                        >
                          {isPaused ? "▸ 再開" : "▸ 今から取り組む"}
                        </button>
                      )}
                      {isRunning && (
                        <button className="text-[11px] text-cream/40 hover:text-cream" onClick={() => pauseDaily(daily!)}>
                          一時停止
                        </button>
                      )}
                      {subCount > 0 && <span className="text-[10px] text-cream/30">{subCount}件のサブタスク</span>}
                    </div>
                    <input
                      key={t.id + (t.dueDate ?? "")}
                      type="date"
                      defaultValue={t.dueDate ?? ""}
                      onChange={(e) => updateTodoDueDate(t, e.target.value)}
                      className={`w-[8.5rem] shrink-0 rounded border border-transparent bg-transparent px-0.5 text-[11px] focus:border-cream/20 focus:outline-none ${
                        overdue ? "font-bold text-alert" : "text-cream/40"
                      }`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {activeTodos.length === 0 && sortedProjects.length === 0 && (
        <p className="px-1 py-6 text-center text-sm text-cream/40">
          今のところ何もありません。上の欄から始めてみましょう。
        </p>
      )}

      {(doneTodos.length > 0 || doneProjects.length > 0) && (
        <details className="panel p-4">
          <summary className="cursor-pointer font-display text-sm font-bold text-cream/60">
            完了済み {doneTodos.length + doneProjects.length}件
          </summary>
          <div className="mt-2 space-y-1.5">
            {doneProjects.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg bg-ink/20 px-3 py-1.5 opacity-60">
                <span className="text-sm text-cream/60 line-through">{p.title}</span>
                <button className="text-xs text-cream/40 hover:text-cream" onClick={() => toggleProjectComplete(p)}>
                  戻す
                </button>
              </div>
            ))}
            {doneTodos.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-ink/20 px-3 py-1.5 opacity-60">
                <span className="text-sm text-cream/60 line-through">{t.title}</span>
                <button className="text-xs text-cream/40 hover:text-cream" onClick={() => toggleTodoComplete(t)}>
                  戻す
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
