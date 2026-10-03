"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { computeProjectProgress } from "@/lib/projectStage";
import { daysBetweenDateStrs, formatMsClock, shiftDateStr, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import { useSetting } from "@/lib/settings";
import { useVisualMode } from "@/lib/theme";
import { buildThinking, confidenceLabel } from "@/lib/claudeThinking";
import { claudeWordsFor } from "@/lib/claudeWords";
import { ConfidenceScale, Paper } from "@/components/claude/ClaudeCanvas";
import { Composer, DueEditor, MemoryPanel, SparkMark, WorkingLine } from "@/components/claude/ClaudeParts";
import { dueLabel } from "@/lib/claudeCompose";
import ProgressSyncModal from "@/components/ProgressSyncModal";
import { copyText } from "@/components/ai/aiData";
import { buildHandoff, deriveMemories, parseForgotten, parseNotes } from "@/lib/claudeMemory";
import type { ComposeResult } from "@/lib/claudeCompose";
import type { DailyTask, ProjectItem, ProjectStage, TodoTask } from "@/lib/types";
import { useWorkContext } from "@/lib/useWorkContext";

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
  const workCtx = useWorkContext();
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
  const [showSync, setShowSync] = useState(false);
  // 覚えていること(lib/claudeMemory.ts)。忘れたものと、自分で書き足したものは設定に残す
  const [forgottenJson, setForgottenJson] = useSetting("claude.memory.forgotten", "[]");
  const [notesJson, setNotesJson] = useSetting("claude.memory.notes", "[]");
  const forgotten = useMemo(() => parseForgotten(forgottenJson), [forgottenJson]);
  const notes = useMemo(() => parseNotes(notesJson), [notesJson]);
  const [newStageTitle, setNewStageTitle] = useState<Record<string, string>>({});
  // 完了済みの段階・サブタスクを表示するかどうか。段階側は案件タブ・統合ボードと同じ
  // 設定キー(projects.showCompletedStages)を共有し、どちらで切り替えても一致させる
  const [showCompletedStagesStr, setShowCompletedStagesStr] = useSetting("projects.showCompletedStages", "true");
  const showCompletedStages = showCompletedStagesStr === "true";
  const [showCompletedSubtasksStr, setShowCompletedSubtasksStr] = useSetting("todo.showCompletedSubtasks", "true");
  const showCompletedSubtasks = showCompletedSubtasksStr === "true";

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
  // 「N件のサブタスク」をタップした時に、その場でチェックリストとして開閉するために使う。
  // ここもタブを跨がず完結させたいというこの画面の方針(冒頭コメント参照)に合わせている
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const t of allTodoTasks ?? []) {
      if (t.parentTaskId) map.set(t.parentTaskId, [...(map.get(t.parentTaskId) ?? []), t]);
    }
    return map;
  }, [allTodoTasks]);
  const [expandedSubtasksOf, setExpandedSubtasksOf] = useState<Set<string>>(new Set());
  function toggleSubtasksExpanded(parentId: string) {
    setExpandedSubtasksOf((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }
  async function toggleSubtaskComplete(sub: TodoTask) {
    await db.todoTasks.update(sub.id, { completed: !sub.completed, completedAt: !sub.completed ? Date.now() : undefined });
  }

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

  const allMemories = useMemo(
    () => (records && allTodoTasks ? deriveMemories(records, allTodoTasks, today) : []),
    [records, allTodoTasks, today]
  );
  const memories = allMemories.filter((m) => !forgotten.includes(m.id));

  async function copyHandoff() {
    const text = buildHandoff({
      today,
      memories,
      notes,
      running: runningDaily,
      todos: allTodoTasks ?? [],
      projects: projects ?? [],
    });
    const ok = await copyText(text);
    showUndoToast(ok ? "コピーしました。Claudeとの会話に貼り付けてください" : "コピーできませんでした");
  }

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

  // 入力欄から送られた内容を、タスクかプロジェクトとして登録する。
  // プロジェクトで期日が書かれていなければ、案件タブと同じく1週間後を期日にする
  async function submitCompose(parsed: ComposeResult, asProject: boolean) {
    if (asProject) {
      const due = parsed.dueDate ?? shiftDateStr(today, 7);
      await db.projects.add({
        id: uid(),
        title: parsed.title,
        category: parsed.category || "プロジェクト",
        workName: parsed.title,
        dueDate: due,
        createdAt: Date.now(),
      });
      return;
    }
    const listId = await ensureListId();
    await db.todoTasks.add({
      id: uid(),
      listId,
      title: parsed.title,
      category: parsed.category,
      dueDate: parsed.dueDate,
      estimateMinutes: parsed.estimateMin,
      important: parsed.important,
      completed: false,
      order: todos.length,
      createdAt: Date.now(),
    });
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
    const estimatedSeconds = (t.estimateMinutes ?? 0) * 60;
    const master = await findOrCreateMasterTask(category, t.title, estimatedSeconds);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: (dailyTasks ?? []).length,
      masterTaskId: master.id,
      category,
      name: t.title,
      estimatedSeconds,
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
      {/* ══ 見出し: 本家Claudeの最初の画面のように、スパークと時刻の挨拶から始める ══ */}
      <header className="space-y-2 pt-2" data-testid="claude-greeting">
        <div className="flex items-center gap-3">
          <SparkMark className="h-8 w-8 shrink-0" spin />
          <h2 className="claude-display text-[28px] leading-tight text-cream">{W.greeting(new Date(now).getHours())}</h2>
        </div>
        <p className="text-[14px] leading-relaxed text-cream/60">{W.todayLine(doneCountToday, formatMsClock(totalMsToday))}</p>
        {suggestion && (
          <p className="text-[14px] leading-relaxed text-cream/60">
            次に取り組むなら「<span className="font-medium text-cream">{suggestion.label}</span>」です（{suggestion.reason}）。
          </p>
        )}
      </header>

      <Composer today={today} words={W} recentTags={recentTags} onSubmit={submitCompose} />

      {runningDaily && (
        <div className="claude-card claude-card-working" data-testid="claude-working">
          <WorkingLine verbs={W.workingVerbs} seed={runningDaily.id.charCodeAt(0)} />
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1 truncate text-[16px] font-medium text-cream">{workCtx.label(runningDaily)}</p>
            <span className="shrink-0 text-[24px] tabular-nums tracking-tight text-cream">
              {formatMsClock(segmentsAccumulatedMs(runningDaily, now))}
            </span>
          </div>
          {runningDaily.estimatedSeconds > 0 && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-cream/10">
              <div
                className="h-full rounded-full bg-[rgb(var(--accent-rgb))]"
                style={{ width: `${Math.min(100, (segmentsAccumulatedMs(runningDaily, now) / (runningDaily.estimatedSeconds * 1000)) * 100)}%` }}
              />
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button className="btn-pill-outline text-xs" onClick={() => pauseDaily(runningDaily)}>
              一時停止
            </button>
            <button className="btn-pill text-xs" onClick={() => finishDailyTask(runningDaily)}>
              完了にする
            </button>
          </div>
        </div>
      )}

      {/* ══ 今いちばん気になっていること ══ */}
      {topFinding && (
        <article className="claude-card relative overflow-hidden">
          <Paper seed={topFinding.id} className="absolute inset-0" />
          <div className="relative">
            <p className="claude-eyebrow">{W.topFindingLead}</p>
            <h3 className="claude-display mt-1.5 text-[17px] leading-snug text-cream">{topFinding.headline}</h3>
            {topFinding.action && (
              <p className="mt-2 border-l-2 border-[rgb(var(--accent-rgb)/0.5)] pl-3 text-[13px] leading-relaxed text-cream/70">
                {topFinding.action}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2.5">
              <span className="shrink-0 text-[11px] text-cream/45">{W.confidenceLabel}</span>
              <ConfidenceScale value={topFinding.confidence} className="min-w-0 flex-1" />
              <span className="shrink-0 text-[11px] tabular-nums text-cream/50">
                {Math.round(topFinding.confidence * 100)}%・{confidenceLabel(topFinding.confidence)}
              </span>
            </div>
            {onOpenInsights && (
              <button onClick={onOpenInsights} className="claude-link mt-3 text-[13px]">
                {W.seeAll} →
              </button>
            )}
          </div>
        </article>
      )}

      {(sortedProjects.length > 0 || activeTodos.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[12px] text-cream/45">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showCompletedStages}
              onChange={(e) => setShowCompletedStagesStr(e.target.checked ? "true" : "false")}
              className="claude-check"
            />
            完了した段階も表示
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showCompletedSubtasks}
              onChange={(e) => setShowCompletedSubtasksStr(e.target.checked ? "true" : "false")}
              className="claude-check"
            />
            完了したサブタスクも表示
          </label>
        </div>
      )}

      {sortedProjects.map((project) => {
        const progress = computeProjectProgress(project.stages);
        const daily = dailyByProjectId.get(project.id);
        const isRunning = daily?.status === "running";
        const isPaused = daily?.status === "paused";
        const overdue = project.dueDate < today;
        return (
          <section key={project.id} className={`claude-card space-y-3 ${overdue ? "claude-card-alert" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="claude-eyebrow">プロジェクト・期日 {dueLabel(project.dueDate, today)}</p>
                <h3 className="claude-display mt-1 text-[20px] leading-snug text-cream">{project.title}</h3>
                {daily && !isRunning && (
                  <p className="mt-0.5 text-[12px] text-cream/45">今日はこれまで {formatMsClock(segmentsAccumulatedMs(daily, now))}</p>
                )}
              </div>
              <button
                className="-m-1 shrink-0 p-2 text-[13px] text-cream/35 hover:text-cream"
                onClick={() => deleteProject(project)}
                aria-label={`「${project.title}」を削除`}
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2.5">
              <SparkMark className="mt-0.5 h-4 w-4 shrink-0" />
              <p className={`text-[14px] leading-relaxed ${overdue ? "font-medium text-alert" : "text-cream/70"}`}>{projectInsight(project)}</p>
            </div>

            {progress !== null && (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-cream/10">
                  <div className="h-full rounded-full bg-[rgb(var(--accent-rgb))]" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <span className="text-[11px] tabular-nums text-cream/45">{Math.round(progress * 100)}%</span>
              </div>
            )}

            {(project.stages ?? []).length > 0 && (() => {
              const allStages = project.stages ?? [];
              const visibleStages = showCompletedStages ? allStages : allStages.filter((s) => !s.completed);
              const hiddenCount = allStages.length - visibleStages.length;
              return (
                <div className="space-y-0.5">
                  {visibleStages.map((stage) => (
                    <label key={stage.id} className="flex items-center gap-2.5 py-1 text-[14px] text-cream/85">
                      <input type="checkbox" checked={stage.completed} onChange={() => toggleStage(project, stage)} className="claude-check" />
                      <span className={stage.completed ? "text-cream/40 line-through" : ""}>{stage.title}</span>
                    </label>
                  ))}
                  {hiddenCount > 0 && <p className="text-[11px] text-cream/35">完了した{hiddenCount}件を隠しています</p>}
                </div>
              );
            })()}
            <input
              value={newStageTitle[project.id] ?? ""}
              onChange={(e) => setNewStageTitle((prev) => ({ ...prev, [project.id]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && addStage(project)}
              placeholder="+ 段階を追加"
              className="w-full rounded-md bg-transparent px-1 py-1 text-[13px] text-cream/60 placeholder:text-cream/35 focus:bg-cream/5 focus:outline-none"
            />

            <div className="flex flex-wrap items-center gap-2 border-t border-cream/10 pt-3">
              {isRunning ? (
                <>
                  <WorkingLine verbs={W.workingVerbs} seed={project.id.charCodeAt(0)} />
                  <span className="text-[13px] tabular-nums text-cream">{formatMsClock(segmentsAccumulatedMs(daily!, now))}</span>
                  <button className="btn-pill-outline ml-auto text-xs" onClick={() => pauseDaily(daily!)}>
                    一時停止
                  </button>
                </>
              ) : (
                <button className="btn-pill-outline text-xs" onClick={() => startProject(project)}>
                  {isPaused ? "▸ 再開" : "▸ 今から取り組む"}
                </button>
              )}
              <button className="btn-pill-outline text-xs" onClick={() => toggleProjectComplete(project)}>
                完了にする
              </button>
            </div>
          </section>
        );
      })}

      {todoGroups.map((group) => (
        <section key={group.category || "__none__"} className="claude-card">
          {(group.category || sortedProjects.length > 0 || todoGroups.length > 1) && (
            <p className="claude-eyebrow mb-1">{group.category ? `@${group.category}` : "タスク"}</p>
          )}
          <ul className="divide-y divide-cream/10">
            {group.items.map((t) => {
              const subCount = subtaskCountByParent.get(t.id) ?? 0;
              const daily = dailyByTodoId.get(t.id);
              const isRunning = daily?.status === "running";
              const isPaused = daily?.status === "paused";
              return (
                <li key={t.id} className="py-2.5" data-testid="claude-todo">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleTodoComplete(t)}
                      aria-label={`「${t.title}」を完了`}
                      className="claude-circle mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        key={t.id + t.title}
                        defaultValue={t.title}
                        onBlur={(e) => updateTodoTitle(t, e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLInputElement).blur()}
                        className="w-full rounded bg-transparent text-[15px] text-cream focus:bg-cream/5 focus:outline-none"
                      />
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {t.important && <span className="text-[12px] text-[rgb(var(--accent-rgb))]">★ 重要</span>}
                        <DueEditor value={t.dueDate} today={today} onChange={(v) => updateTodoDueDate(t, v)} />
                        {t.estimateMinutes ? <span className="text-[12px] text-cream/45">見込み {t.estimateMinutes}分</span> : null}
                        {isRunning ? (
                          <>
                            <WorkingLine verbs={W.workingVerbs} seed={t.id.charCodeAt(0)} />
                            <span className="text-[12px] tabular-nums text-cream">{formatMsClock(segmentsAccumulatedMs(daily!, now))}</span>
                            <button className="text-[12px] text-cream/50 underline decoration-dotted hover:text-cream" onClick={() => pauseDaily(daily!)}>
                              一時停止
                            </button>
                          </>
                        ) : (
                          <button className="claude-link text-[12px]" onClick={() => startTodo(t)}>
                            {isPaused ? "▸ 再開" : "▸ 今から取り組む"}
                          </button>
                        )}
                        {subCount > 0 && (
                          <button className="text-[12px] text-cream/45 hover:text-cream" onClick={() => toggleSubtasksExpanded(t.id)}>
                            {expandedSubtasksOf.has(t.id) ? "▾" : "▸"} サブタスク{subCount}件
                          </button>
                        )}
                      </div>
                    </div>
                    <button
                      className="-m-1 shrink-0 p-2 text-[13px] text-cream/30 hover:text-cream"
                      onClick={() => deleteTodo(t)}
                      aria-label={`「${t.title}」を削除`}
                    >
                      ✕
                    </button>
                  </div>
                  {subCount > 0 && expandedSubtasksOf.has(t.id) && (() => {
                    const allSubs = subtasksByParent.get(t.id) ?? [];
                    const visibleSubs = showCompletedSubtasks ? allSubs : allSubs.filter((s) => !s.completed);
                    const hiddenCount = allSubs.length - visibleSubs.length;
                    return (
                      <div className="mt-2 space-y-1 pl-8">
                        {visibleSubs.map((sub) => (
                          <label key={sub.id} className="flex items-center gap-2">
                            <input type="checkbox" checked={sub.completed} onChange={() => toggleSubtaskComplete(sub)} className="claude-check" />
                            <span className={`text-[13px] ${sub.completed ? "text-cream/35 line-through" : "text-cream/75"}`}>{sub.title}</span>
                          </label>
                        ))}
                        {hiddenCount > 0 && <p className="text-[11px] text-cream/30">完了した{hiddenCount}件を隠しています</p>}
                      </div>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {activeTodos.length === 0 && sortedProjects.length === 0 && (
        <p className="px-1 py-6 text-center text-[14px] text-cream/45">今のところ何もありません。上の欄に、進めたいことを書いてみてください。</p>
      )}

      {(doneTodos.length > 0 || doneProjects.length > 0) && (
        <details className="claude-card">
          <summary className="cursor-pointer list-none text-[13px] text-cream/55">完了したもの {doneTodos.length + doneProjects.length}件 ›</summary>
          <ul className="mt-2 divide-y divide-cream/10">
            {[...doneProjects.map((p) => ({ id: p.id, title: p.title, undo: () => toggleProjectComplete(p) })),
              ...doneTodos.map((t) => ({ id: t.id, title: t.title, undo: () => toggleTodoComplete(t) }))].map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-[14px] text-cream/45 line-through">{x.title}</span>
                <button className="shrink-0 text-[12px] text-cream/50 underline decoration-dotted hover:text-cream" onClick={x.undo}>
                  戻す
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ══ 覚えていること ══ */}
      <MemoryPanel
        words={W}
        memories={memories}
        notes={notes}
        forgottenCount={allMemories.length - memories.length}
        onForget={(id) => setForgottenJson(JSON.stringify([...forgotten, id]))}
        onRestoreAll={() => setForgottenJson("[]")}
        onAddNote={(text) => setNotesJson(JSON.stringify([...notes, { id: uid(), text, createdAt: Date.now() }]))}
        onRemoveNote={(id) => setNotesJson(JSON.stringify(notes.filter((n) => n.id !== id)))}
      />

      {/* ══ 本物のClaudeと続ける ══ */}
      <section className="claude-card claude-card-dark space-y-3" data-testid="claude-connect">
        <div className="flex items-center gap-2">
          <SparkMark className="h-5 w-5" />
          <p className="claude-display text-[18px]">{W.connectTitle}</p>
        </div>
        <p className="text-[13px] leading-relaxed opacity-75">{W.connectLead}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill text-xs" onClick={copyHandoff}>
            引き継ぎ文をコピー
          </button>
          <a className="btn-pill-outline text-xs" href="https://claude.ai/new" target="_blank" rel="noreferrer">
            Claudeを開く ↗
          </a>
          <button className="btn-pill-outline text-xs" onClick={() => setShowSync(true)}>
            進捗・時間割をやり取りする
          </button>
        </div>
      </section>
      {showSync && <ProgressSyncModal onClose={() => setShowSync(false)} />}
    </div>
  );
}
