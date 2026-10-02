"use client";

import { db } from "@/lib/db";
import { cardOverrunClass, cardRunningClass, emphasisTextClass, getRiskTier, hazardBarClass, overrunLabel, riskBadgeClasses, riskBadgeLabel, runningLabel } from "@/lib/theme";
import { baseAccumulatedMs, segmentsAccumulatedMs } from "@/lib/tasks";
import { CONDITION_LEVELS } from "@/lib/condition";
import { isStageDone } from "@/lib/projectStage";
import { formatClock, formatHms, formatMsClock } from "@/lib/time";
import { todoParentTitle } from "@/lib/todoLabel";
import RadialTimer from "@/components/ui/RadialTimer";
import ConditionGlyph from "@/components/ui/ConditionGlyph";
import type { AutoAllocationResult } from "@/lib/allocate";
import type { ThemedMode } from "@/lib/theme";
import type { ConditionLog, DailyTask, ProjectItem, TodoTask } from "@/lib/types";

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

// 作業カード1枚分に必要な、本日の作業タブ全体で共有している状態と操作。
// 作業ごとに変わるのはtaskだけなので、それ以外はまとめて1つのオブジェクトで受け取る
export interface TaskCardContext {
  now: number;
  themedMode: ThemedMode | null;
  va11hallaMode: boolean;
  wordingThemedMode: ThemedMode | null;
  emphasizeRunning: boolean;
  conditionEnabled: boolean;
  standardWorkEnd: string;
  nextTaskId: string | null;
  provisionalActive: boolean;
  effectiveLastStopTime: number | null;
  runningTaskIds: Set<string>;
  runningTaskKeys: Set<string>;
  favoriteMasterIds: Set<string>;
  predictedSecondsByTaskId: Map<string, number>;
  projectedFinishByTaskId: Map<string, number>;
  topRankedKeys: Map<string, number>;
  effectiveAllocation: AutoAllocationResult | null;
  projectMap: Map<string, ProjectItem>;
  projectTotalSeconds: Map<string, number>;
  todoTaskMap: Map<string, TodoTask>;
  draggingTaskId: string | null;
  setDraggingTaskId: (id: string | null) => void;
  conditionEditTaskId: string | null;
  setConditionEditTaskId: (id: string | null) => void;
  taskOwnConditionLog: (task: DailyTask) => ConditionLog | null;
  taskDisplayConditionLevel: (task: DailyTask) => string | null;
  startTask: (task: DailyTask, startAt?: number) => Promise<void>;
  pauseTask: (task: DailyTask) => Promise<void>;
  finishTask: (task: DailyTask, endAtOverride?: number) => Promise<void>;
  deleteTask: (task: DailyTask) => Promise<void>;
  reorderPendingTask: (draggedId: string, targetId: string) => Promise<void>;
  toggleTaskFavorite: (task: DailyTask) => Promise<void>;
  toggleAutoStart: (task: DailyTask) => Promise<void>;
  toggleLinkedProjectComplete: (project: ProjectItem) => Promise<void>;
  completeLinkedTodo: (todoTaskId: string) => Promise<void>;
  setTaskCondition: (task: DailyTask, level: string) => Promise<void>;
  clearTaskCondition: (task: DailyTask) => Promise<void>;
  onRequestStageConfirm: (task: DailyTask) => void;
  setEditingTask: (task: DailyTask | null) => void;
  setDeletingCompletedTask: (task: DailyTask | null) => void;
  setAddTimeTask: (task: DailyTask | null) => void;
  setManualFinishTaskTarget: (task: DailyTask | null) => void;
  setFinishAtTask: (task: DailyTask | null) => void;
  setSecondaryProjectsTask: (task: DailyTask | null) => void;
  onOpenTodoDetail: (taskId: string) => void;
  onOpenProjectEdit: (projectId: string) => void;
}

// 本日の作業タブの作業カード1枚(状態・経過・予測・紐づく案件/ToDo・操作ボタン)
export default function TaskCard({ task, ctx }: { task: DailyTask; ctx: TaskCardContext }) {
  const {
    now,
    themedMode,
    va11hallaMode,
    wordingThemedMode,
    emphasizeRunning,
    conditionEnabled,
    standardWorkEnd,
    nextTaskId,
    provisionalActive,
    effectiveLastStopTime,
    runningTaskIds,
    runningTaskKeys,
    favoriteMasterIds,
    predictedSecondsByTaskId,
    projectedFinishByTaskId,
    topRankedKeys,
    effectiveAllocation,
    projectMap,
    projectTotalSeconds,
    todoTaskMap,
    draggingTaskId,
    setDraggingTaskId,
    conditionEditTaskId,
    setConditionEditTaskId,
    taskOwnConditionLog,
    taskDisplayConditionLevel,
    startTask,
    pauseTask,
    finishTask,
    deleteTask,
    reorderPendingTask,
    toggleTaskFavorite,
    toggleAutoStart,
    toggleLinkedProjectComplete,
    completeLinkedTodo,
    setTaskCondition,
    clearTaskCondition,
    onRequestStageConfirm,
    setEditingTask,
    setDeletingCompletedTask,
    setAddTimeTask,
    setManualFinishTaskTarget,
    setFinishAtTask,
    setSecondaryProjectsTask,
    onOpenTodoDetail,
    onOpenProjectEdit,
  } = ctx;
  const elapsedMs = segmentsAccumulatedMs(task, now);
  const estMs = task.estimatedSeconds * 1000;
  const predictedSecondsForTask = predictedSecondsByTaskId.get(task.id) ?? 0;
  const predMs = predictedSecondsForTask * 1000;
  const overEstimate = predictedSecondsForTask > 0 && elapsedMs > predMs;
  const remainingMs = predMs - elapsedMs;
  const isNext = task.id === nextTaskId;
  const taskRankKey = task.masterTaskId ?? `${task.category}::${task.name}`;
  const topRank = topRankedKeys.get(taskRankKey);
  const isRunningOverrun = task.status === "running" && overEstimate;
  const riskTier =
    themedMode && isRunningOverrun && predictedSecondsForTask > 0
      ? getRiskTier(elapsedMs / predMs, themedMode)
      : null;
  const overrunCardAnim = themedMode ? cardOverrunClass(themedMode) : "card-overrun";
  const runningCardAnim = themedMode ? cardRunningClass(themedMode) : "card-running";
  const cardClass =
    task.status === "running"
      ? isRunningOverrun
        ? va11hallaMode
          ? `border-v11-pink ring-2 ring-v11-pink/70 bg-v11-pink/[0.06] ${overrunCardAnim}`
          : `border-alert ring-2 ring-alert/70 bg-alert/[0.05] ${overrunCardAnim}`
        : va11hallaMode
          ? `border-v11-cyan ring-2 ring-v11-cyan/50 bg-v11-cyan/[0.05] ${runningCardAnim}`
          : `border-cream ring-2 ring-cream/50 bg-cream/[0.04] ${runningCardAnim}`
      : task.status === "paused"
        ? "border-cream/40"
        : isNext
          ? "border-cream/60 ring-1 ring-cream/40"
          : "";
  const isBlockedByEmphasis = emphasizeRunning && runningTaskIds.size > 0 && !runningTaskIds.has(task.id);
  const dimmed = task.status !== "done" && (provisionalActive || isBlockedByEmphasis);
  const duplicateRunning =
    task.status !== "running" && runningTaskKeys.has(`${task.category}::${task.name}`);
  const controlsDisabled = provisionalActive || isBlockedByEmphasis;
  // 図書館モードではカードスタックのスワイプ操作(左スワイプ=後回し)がドラッグ並べ替えを
  // 兼ねるため、ネイティブdraggableは無効にする(有効のままだとポインタベースのスワイプ検知と
  // ブラウザのHTML5ドラッグが競合し、スワイプが反応しなくなる)
  const isDraggable = task.status === "pending";
  return (
    <div
      key={task.id}
      draggable={isDraggable}
      onDragStart={isDraggable ? () => setDraggingTaskId(task.id) : undefined}
      onDragEnd={isDraggable ? () => setDraggingTaskId(null) : undefined}
      onDragOver={isDraggable ? (e) => e.preventDefault() : undefined}
      onDrop={
        isDraggable
          ? (e) => {
              e.preventDefault();
              if (draggingTaskId) reorderPendingTask(draggingTaskId, task.id);
              setDraggingTaskId(null);
            }
          : undefined
      }
      className={`panel relative p-4 transition-opacity ${cardClass} ${
        task.status === "done" ? "opacity-50" : dimmed ? "opacity-40" : ""
      } ${isDraggable ? "cursor-grab active:cursor-grabbing" : ""} ${
        draggingTaskId === task.id ? "opacity-30" : ""
      } ${draggingTaskId && draggingTaskId !== task.id && isDraggable ? "border-dashed" : ""}`}
    >
      {isRunningOverrun && (
        <div className={`absolute inset-x-0 top-0 rounded-t-2xl ${themedMode ? hazardBarClass(themedMode) : "hazard-bar"}`} />
      )}
      {task.status !== "done" && (
        <button
          onClick={() => deleteTask(task)}
          className="absolute right-3 top-3 text-cream/40 hover:text-alert"
          aria-label="削除"
        >
          ✕
        </button>
      )}
      {isDraggable && (
        <span className="absolute left-1 top-3 text-cream/30" aria-hidden title="ドラッグで並べ替え">
          ⠿
        </span>
      )}
      <div className={`flex flex-wrap items-center justify-between gap-3 pr-6 ${isDraggable ? "pl-4" : ""}`}>
        <div>
          <div className="flex items-center gap-2 text-xs text-cream/60">
            <span className="flex items-center gap-1">
              {task.status === "running" && !isRunningOverrun && (
                <span className={`flex items-center gap-1 font-bold ${va11hallaMode ? "text-v11-cyan" : "text-cream"}`}>
                  <span className={`h-2 w-2 animate-pulse rounded-full ${va11hallaMode ? "bg-v11-cyan" : "bg-alert"}`} />
                  {runningLabel(wordingThemedMode)}
                </span>
              )}
              {isRunningOverrun && (
                <span
                  className={`overrun-badge flex items-center gap-1 font-bold ${va11hallaMode ? "text-v11-pink" : themedMode ? emphasisTextClass(themedMode) : "text-alert"}`}
                >
                  <span className={`h-2 w-2 rounded-full ${va11hallaMode ? "bg-v11-pink" : "bg-alert"}`} />
                  {overrunLabel(wordingThemedMode)}
                </span>
              )}
              {riskTier && themedMode && (
                <span
                  className={riskBadgeClasses(riskTier.level, themedMode)}
                  title={
                    wordingThemedMode === "va11halla"
                      ? "VA-11 HALL-A風モード: 予測超過の度合いに応じた注文階級"
                      : wordingThemedMode === "persona5"
                        ? "ペルソナ5風モード: 予告状に至るまでの盛り上がり階級"
                        : wordingThemedMode === "natsuyasumi"
                          ? "ぼくのなつやすみ風モード: 夏の天気になぞらえた進み具合"
                          : wordingThemedMode === "lobotomy"
                              ? "ロボトミーコーポレーション風モード: 予測超過の度合いに応じた警戒階級"
                              : "予測超過の度合いに応じた危険度バッジです"
                  }
                >
                  {riskBadgeLabel(riskTier, wordingThemedMode)}
                </span>
              )}
              {task.status === "paused" && <span className="text-cream/70">‖ 一時停止中</span>}
              {task.category} {task.isSpontaneous && <span className="ml-1 text-alert">突発</span>}
              {isNext && task.status === "pending" && <span className="ml-2 text-cream">▶ 次の作業</span>}
            </span>
            <button
              onClick={() => toggleTaskFavorite(task)}
              className={favoriteMasterIds.has(task.masterTaskId ?? "") ? "text-alert" : "text-cream/40 hover:text-cream"}
              aria-label={favoriteMasterIds.has(task.masterTaskId ?? "") ? "お気に入り解除" : "お気に入りに追加"}
              title={favoriteMasterIds.has(task.masterTaskId ?? "") ? "お気に入り解除" : "お気に入りに追加"}
            >
              {favoriteMasterIds.has(task.masterTaskId ?? "") ? "★" : "☆"}
            </button>
            <button
              onClick={() => setEditingTask(task)}
              className="text-cream/40 hover:text-cream"
              aria-label="編集"
            >
              ✎
            </button>
            <button
              onClick={() => setSecondaryProjectsTask(task)}
              className={(task.secondaryProjectIds?.length ?? 0) > 0 ? "text-alert" : "text-cream/40 hover:text-cream"}
              aria-label="追加の案件タグ"
              title="兼務・並行作業向けに、主案件以外の案件にも時間を按分できます"
            >
              🏷️{(task.secondaryProjectIds?.length ?? 0) > 0 ? task.secondaryProjectIds!.length : ""}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-base font-bold">{task.name}</span>
            {topRank !== undefined && (
              <span className="rounded-full bg-alert/20 px-2 py-0.5 text-[10px] font-bold text-alert">
                {RANK_MEDALS[topRank]} 集計ランキング{topRank + 1}位
              </span>
            )}
          </div>
          {task.projectId &&
            projectMap.get(task.projectId) &&
            (() => {
              const linkedProject = projectMap.get(task.projectId!)!;
              const linkedStage = task.stageId ? linkedProject.stages?.find((s) => s.id === task.stageId) : undefined;
              const stageDone = linkedStage ? isStageDone(linkedStage) : false;
              const stageCountBased = linkedStage?.targetCount != null;
              return (
                <>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-full border border-cream/30 px-2 py-0.5 text-cream/80">
                      案件: {linkedProject.title}
                    </span>
                    {(projectTotalSeconds.get(task.projectId!) ?? 0) > 0 && (
                      <span className="font-bold tabular-nums text-cream/70">
                        この案件の累計 {formatHms(projectTotalSeconds.get(task.projectId!)!)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-cream/15 bg-ink/40 px-2.5 py-1.5 text-xs">
                    <span className="text-cream/50">📁 元案件:</span>
                    <button
                      onClick={() => onOpenProjectEdit(linkedProject.id)}
                      className={`font-bold hover:underline ${
                        linkedProject.completedAt ? "text-cream/40 line-through" : "text-cream"
                      }`}
                    >
                      {linkedProject.title}
                      {linkedStage && `／${linkedStage.title}`}
                    </button>
                    {linkedStage ? (
                      stageDone ? (
                        <span className="text-[10px] text-cream/40">
                          段階完了済み{stageCountBased && `（${linkedStage.completedCount ?? 0}/${linkedStage.targetCount}件）`}
                        </span>
                      ) : (
                        <button
                          className="btn-pill-outline px-2 py-0.5 text-[10px]"
                          onClick={() => onRequestStageConfirm(task)}
                        >
                          {stageCountBased ? "件数を進める" : "✓ 段階を完了にする"}
                        </button>
                      )
                    ) : linkedProject.completedAt ? (
                      <span className="text-[10px] text-cream/40">案件完了済み</span>
                    ) : (
                      <button
                        className="btn-pill-outline px-2 py-0.5 text-[10px]"
                        onClick={() => toggleLinkedProjectComplete(linkedProject)}
                      >
                        ✓ 案件を完了にする
                      </button>
                    )}
                    <button
                      className="text-cream/40 hover:text-cream"
                      onClick={() => onOpenProjectEdit(linkedProject.id)}
                      aria-label="編集"
                      title="案件タブで詳細を編集"
                    >
                      ✎
                    </button>
                  </div>
                </>
              );
            })()}
          {task.todoTaskId &&
            todoTaskMap.get(task.todoTaskId) &&
            (() => {
              const linkedTodo = todoTaskMap.get(task.todoTaskId!)!;
              return (
                <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-cream/15 bg-ink/40 px-2.5 py-1.5 text-xs">
                  <span className="text-cream/50">📌 元Todo:</span>
                  <button
                    onClick={() => onOpenTodoDetail(linkedTodo.id)}
                    className={`font-bold hover:underline ${
                      linkedTodo.completed ? "text-cream/40 line-through" : "text-cream"
                    }`}
                  >
                    {/* サブタスクは単体の名前では分からないため、親タスク名を添える */}
                    {todoParentTitle(linkedTodo, todoTaskMap) && (
                      <span className="font-normal text-cream/50">{todoParentTitle(linkedTodo, todoTaskMap)} › </span>
                    )}
                    {linkedTodo.title}
                  </button>
                  {linkedTodo.completed ? (
                    <span className="text-[10px] text-cream/40">完了済み</span>
                  ) : (
                    <button
                      className="btn-pill-outline px-2 py-0.5 text-[10px]"
                      onClick={() => completeLinkedTodo(task.todoTaskId!)}
                    >
                      ✓ Todoを完了にする
                    </button>
                  )}
                  <button
                    className="text-cream/40 hover:text-cream"
                    onClick={() => onOpenTodoDetail(linkedTodo.id)}
                    aria-label="編集"
                    title="Todoタブで詳細を編集"
                  >
                    ✎
                  </button>
                </div>
              );
            })()}
          {task.scheduledTime && task.status === "pending" && (
            <div className="flex items-center gap-2 text-xs">
              {task.autoStartDisabled ? (
                <span className="text-cream/50" title="この時刻になっても自動的には開始されません">
                  ⏰ {task.scheduledTime}{task.timeboxEnd ? `〜${task.timeboxEnd}` : ""}（自動開始OFF）
                </span>
              ) : (
                <span className="font-bold text-alert" title="この時刻になったら自動的に差し込み開始されます">
                  ⏰ {task.timeboxEnd ? `${task.scheduledTime}〜${task.timeboxEnd} の枠で自動開始` : `${task.scheduledTime} に自動開始`}
                </span>
              )}
              <button
                onClick={() => toggleAutoStart(task)}
                className="text-cream/40 underline hover:text-cream"
              >
                {task.autoStartDisabled ? "自動開始をONにする" : "自動開始をOFFにする"}
              </button>
            </div>
          )}
          <div className="text-xs text-cream/50">
            {predictedSecondsForTask > 0 ? (
              <span className="font-bold text-cream/70">予測 {formatMsClock(predMs)}</span>
            ) : (
              <span className="text-cream/40" title="マスタの実績がまだ十分にないため、目安の「予測」を算出できません">
                予測 データ不足
              </span>
            )}
            {task.hasPlan === true && (
              <span className="ml-2 text-cream/40" title="この作業に個人で設定した目標時間です（工程の判断には使われません）">
                （個人目標 {formatMsClock(estMs)}）
              </span>
            )}
            {projectedFinishByTaskId.has(task.id) && (
              <span className="ml-2 text-cream/70">
                終了予定 {formatClock(projectedFinishByTaskId.get(task.id)!)}
              </span>
            )}
            {effectiveAllocation?.allocatedMsByTaskId.has(task.id) && (
              <span
                className="ml-2 text-cream/50"
                title={`${standardWorkEnd}までに収めるための目標ペース（自動配分）`}
              >
                配分目安 {formatMsClock(effectiveAllocation.allocatedMsByTaskId.get(task.id)!)}
              </span>
            )}
          </div>
          {task.note && <div className="mt-0.5 text-xs italic text-cream/50">📝 {task.note}</div>}
          {duplicateRunning && (
            <div className="text-xs text-alert">同じ作業を計測中のため開始できません</div>
          )}
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            {task.status === "running" && predictedSecondsForTask > 0 && (
              <RadialTimer progressPct={(elapsedMs / predMs) * 100} overEstimate={overEstimate} />
            )}
            <div
              className={`font-display text-2xl font-bold tabular-nums ${
                overEstimate ? (va11hallaMode ? "text-v11-pink" : "text-alert") : "text-cream"
              } ${isRunningOverrun ? (themedMode ? "overrun-flicker-intense" : "overrun-flicker") : ""}`}
            >
              {formatMsClock(elapsedMs)}
            </div>
          </div>
          {predictedSecondsForTask > 0 && (task.status === "running" || task.status === "paused") && (
            <div
              className={`text-xs tabular-nums ${
                remainingMs < 0 ? (va11hallaMode ? "text-v11-pink" : "text-alert") : "text-cream/60"
              }`}
            >
              {remainingMs >= 0 ? `残り ${formatMsClock(remainingMs)}` : `超過 ${formatMsClock(-remainingMs)}`}
            </div>
          )}
          {task.status !== "done" && (
            <div className="mt-1 flex items-center justify-end gap-1 text-xs text-cream/40">
              <span title="開始前後に自分で予想を立てておくと、完了時に的中度が見られます">🎯予想</span>
              <input
                type="number"
                min={0}
                value={task.guessSeconds ? Math.round(task.guessSeconds / 60) : ""}
                onChange={(e) => {
                  const min = Number(e.target.value);
                  db.dailyTasks.update(task.id, {
                    guessSeconds: Number.isFinite(min) && min > 0 ? Math.round(min * 60) : undefined,
                  });
                }}
                placeholder="-"
                className="w-12 rounded border border-cream/20 bg-ink px-1 py-0.5 text-right tabular-nums text-cream"
              />
              <span>分</span>
            </div>
          )}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            {task.status === "pending" && (
              <>
                <button
                  className="btn-pill text-xs"
                  disabled={controlsDisabled || duplicateRunning}
                  onClick={() => startTask(task)}
                >
                  開始
                </button>
                {/* 前の作業を止めた時刻が今とほぼ同じなら、ふつうの開始/再開と区別がつかないので出さない */}
                {effectiveLastStopTime && now - effectiveLastStopTime >= 60_000 && (
                  <button
                    className="btn-pill-outline text-xs"
                    disabled={controlsDisabled || duplicateRunning}
                    onClick={() => startTask(task, effectiveLastStopTime)}
                    title="前の作業が終了/一時停止した時刻から、この作業が始まっていたことにします"
                  >
                    {formatClock(effectiveLastStopTime)}から開始
                  </button>
                )}
                <button
                  className="btn-pill-outline text-xs"
                  disabled={controlsDisabled}
                  onClick={() => setManualFinishTaskTarget(task)}
                >
                  手動で記録
                </button>
              </>
            )}
            {task.status === "running" && (
              <>
                <button className="btn-pill-outline text-xs" disabled={controlsDisabled} onClick={() => pauseTask(task)}>
                  一時停止
                </button>
                <button
                  className="btn-pill-outline text-xs"
                  disabled={controlsDisabled}
                  onClick={() => setAddTimeTask(task)}
                >
                  時間を加算
                </button>
                <button className="btn-pill text-xs" disabled={controlsDisabled} onClick={() => finishTask(task)}>
                  終了
                </button>
                <button
                  className="btn-pill-outline text-xs"
                  disabled={controlsDisabled}
                  onClick={() => setFinishAtTask(task)}
                  title="止め忘れていた場合、実際に終わった時刻を指定して終了します"
                >
                  🕐 時刻を指定して終了
                </button>
              </>
            )}
            {task.status === "paused" && (
              <>
                <button
                  className="btn-pill-outline text-xs"
                  disabled={controlsDisabled || duplicateRunning}
                  onClick={() => startTask(task)}
                >
                  再開
                </button>
                {/* 前の作業を止めた時刻が今とほぼ同じなら、ふつうの開始/再開と区別がつかないので出さない */}
                {effectiveLastStopTime && now - effectiveLastStopTime >= 60_000 && (
                  <button
                    className="btn-pill-outline text-xs"
                    disabled={controlsDisabled || duplicateRunning}
                    onClick={() => startTask(task, effectiveLastStopTime)}
                    title="前の作業が終了/一時停止した時刻から、この作業が再開していたことにします"
                  >
                    {formatClock(effectiveLastStopTime)}から再開
                  </button>
                )}
                <button
                  className="btn-pill-outline text-xs"
                  disabled={controlsDisabled}
                  onClick={() => setAddTimeTask(task)}
                >
                  時間を加算
                </button>
                <button className="btn-pill text-xs" disabled={controlsDisabled} onClick={() => finishTask(task)}>
                  終了
                </button>
                <button
                  className="btn-pill-outline text-xs"
                  disabled={controlsDisabled}
                  onClick={() => setManualFinishTaskTarget(task)}
                >
                  手動で記録
                </button>
              </>
            )}
            {task.status === "done" && (
              <div className="text-right">
                <span className="text-xs text-cream/50">完了</span>
                {task.startedAt && task.endedAt && (
                  <div className="text-xs tabular-nums text-cream/40">
                    {formatClock(task.startedAt)}〜{formatClock(task.endedAt)}
                  </div>
                )}
                {!!task.guessSeconds &&
                  (() => {
                    const actualSeconds = Math.round(baseAccumulatedMs(task) / 1000);
                    if (actualSeconds <= 0) return null;
                    const guessMin = Math.round(task.guessSeconds! / 60);
                    const actualMin = Math.round(actualSeconds / 60);
                    const diffPct = Math.round((Math.abs(actualSeconds - task.guessSeconds!) / task.guessSeconds!) * 100);
                    const label =
                      diffPct <= 10 ? "🎯ほぼ的中" : actualSeconds > task.guessSeconds! ? `${diffPct}%長引いた` : `${diffPct}%早く終わった`;
                    return (
                      <div className="text-xs tabular-nums text-cream/40">
                        予想{guessMin}分→実績{actualMin}分・{label}
                      </div>
                    );
                  })()}
                <button
                  className="mt-1 text-xs text-cream/40 hover:text-alert"
                  onClick={() => setDeletingCompletedTask(task)}
                >
                  削除
                </button>
              </div>
            )}
          </div>
        </div>
        {conditionEnabled && task.status === "done" && (
          <div className="mt-2 border-t border-cream/10 pt-2">
            {(() => {
              const ownLog = taskOwnConditionLog(task);
              const displayLevel = taskDisplayConditionLevel(task);
              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConditionEditTaskId(conditionEditTaskId === task.id ? null : task.id)}
                    className="flex items-center gap-1 text-xs text-cream/50 hover:text-cream"
                  >
                    {displayLevel ? (
                      <>
                        <ConditionGlyph level={displayLevel} size={16} />
                        <span>
                          {CONDITION_LEVELS.find((c) => c.level === displayLevel)?.label ?? displayLevel}
                          {!ownLog && <span className="text-cream/30">（直前から）</span>}
                        </span>
                      </>
                    ) : (
                      <span>体調: 記録なし（タップして記録）</span>
                    )}
                  </button>
                  {conditionEditTaskId === task.id && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {CONDITION_LEVELS.map((c) => (
                        <button
                          key={c.level}
                          onClick={() => setTaskCondition(task, c.level)}
                          aria-label={c.label}
                          title={c.label}
                          className={displayLevel === c.level ? "btn-pill p-1" : "btn-pill-outline p-1"}
                        >
                          <ConditionGlyph level={c.level} size={18} />
                        </button>
                      ))}
                      {ownLog && (
                        <button
                          onClick={() => clearTaskCondition(task)}
                          className="text-xs text-cream/40 hover:text-alert"
                        >
                          記録を削除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );}
