import { timeToMsOfDay } from "./breaks";
import { isStageDone } from "./projectStage";
import { daysBetweenDateStrs, shiftDateStr } from "./time";
import { buildWorkContextSources, workNameWithContext } from "./workContext";
import type { BreakRange, DailyTask, MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// 「今日の段取り」の自動提案。期日・段階の残り・過去の実績から見た所要時間(手段の違いも
// 反映)・今日の残り稼働時間をまとめて見て、「この順でやれば間に合う」という計画と、
// 数日先まで見ても間に合わない見込みのものを出す。
//
// 並べ方は「期日が近い順」(Earliest Deadline First)。1人で順番にこなす作業では、
// 期日が近い順に処理するのが期日遅れを最も起こしにくい並べ方になる。同じ期日の中では
// 重要なもの→短いものを先にする(短いものを先に片付けると、残りの見通しが立ちやすいため)

export const DEFAULT_ESTIMATE_SECONDS = 30 * 60;
export const PLAN_HORIZON_DAYS = 3;
// 作業時間の見積もりを手段別の平均に切り替えるのに必要な、その手段での実績件数
const MIN_METHOD_SAMPLES = 2;

export type PlanItemKind = "daily" | "stage" | "project" | "todo";

export interface PlanCandidate {
  key: string;
  kind: PlanItemKind;
  title: string;
  subtitle?: string;
  /** 本日の作業に追加する際の業務区分・詳細作業名 */
  category: string;
  name: string;
  dailyTaskId?: string;
  projectId?: string;
  stageId?: string;
  todoTaskId?: string;
  dueDate?: string;
  /** 期日が無いため並べ替え用に今日扱いにしている(表示では「期限」と出さない) */
  dueIsImplicit?: boolean;
  important: boolean;
  estimateSeconds: number;
  estimateSource: string;
  /** 本日の作業に並んでいる順(本日の作業由来の候補どうしの並びを崩さないため) */
  order: number;
}

export interface PlannedItem extends PlanCandidate {
  startMs: number;
  endMs: number;
  plannedSeconds: number;
  /** 今日の残り時間では収まりきらず、一部だけ着手する計画になっているもの */
  partial: boolean;
}

export interface AtRiskItem {
  candidate: PlanCandidate;
  /** 期日までの稼働時間に対して、見積もりの合計がどれだけはみ出すか */
  shortfallSeconds: number;
}

export interface DayPlan {
  dayStartMs: number;
  dayEndMs: number;
  /** 今日の残り稼働時間(休憩を除く) */
  remainingSeconds: number;
  /** 計測中の作業が見積もり上あと何秒続くか(計画はその後ろから始まる) */
  runningRemainingSeconds: number;
  runningTaskName?: string;
  scheduled: PlannedItem[];
  overflow: PlanCandidate[];
  atRisk: AtRiskItem[];
  totalDemandSeconds: number;
}

export interface DayPlanInput {
  now: number;
  today: string;
  workStart: string;
  workEnd: string;
  breaks: BreakRange[];
  dailyTasks: DailyTask[];
  projects: ProjectItem[];
  todoTasks: TodoTask[];
  masterTasks: MasterTask[];
  records: WorkRecord[];
  horizonDays?: number;
}

interface Interval {
  start: number;
  end: number;
}

// 稼働時間帯(始業〜終業)から休憩時間帯を除いた、実際に作業に使える区間の一覧
export function workingIntervals(dateStr: string, workStart: string, workEnd: string, breaks: BreakRange[]): Interval[] {
  const dayStart = timeToMsOfDay(dateStr, workStart);
  const dayEnd = timeToMsOfDay(dateStr, workEnd);
  if (!(dayEnd > dayStart)) return [];
  let intervals: Interval[] = [{ start: dayStart, end: dayEnd }];
  for (const b of breaks) {
    const bs = timeToMsOfDay(dateStr, b.start);
    const be = timeToMsOfDay(dateStr, b.end);
    if (!(be > bs)) continue;
    intervals = intervals.flatMap((iv) => {
      if (be <= iv.start || bs >= iv.end) return [iv];
      const parts: Interval[] = [];
      if (bs > iv.start) parts.push({ start: iv.start, end: bs });
      if (be < iv.end) parts.push({ start: be, end: iv.end });
      return parts;
    });
  }
  return intervals;
}

function clipFrom(intervals: Interval[], fromMs: number): Interval[] {
  return intervals
    .filter((iv) => iv.end > fromMs)
    .map((iv) => ({ start: Math.max(iv.start, fromMs), end: iv.end }));
}

function totalSeconds(intervals: Interval[]): number {
  return Math.round(intervals.reduce((s, iv) => s + (iv.end - iv.start), 0) / 1000);
}

// 区間の先頭からseconds秒分を消費し、[開始, 終了]と残りの区間を返す
function consume(intervals: Interval[], seconds: number): { start: number; end: number; rest: Interval[] } | null {
  if (intervals.length === 0 || seconds <= 0) return null;
  const start = intervals[0].start;
  let remainingMs = seconds * 1000;
  const rest = [...intervals];
  let end = start;
  while (rest.length > 0 && remainingMs > 0) {
    const iv = rest[0];
    const len = iv.end - iv.start;
    if (len <= remainingMs) {
      remainingMs -= len;
      end = iv.end;
      rest.shift();
    } else {
      end = iv.start + remainingMs;
      rest[0] = { start: end, end: iv.end };
      remainingMs = 0;
    }
  }
  return { start, end, rest };
}

interface Estimator {
  forMaster(category: string, name: string): { seconds: number; source: string } | null;
  forMasterByName(name: string): { seconds: number; source: string } | null;
}

// 作業マスタの見積もり(実績平均)。直近に使った手段で2件以上の実績があれば、
// マスタ全体の平均ではなくその手段での平均を使う(Excel→Claudeのように手段を
// 変えて速くなった作業を、昔の遅い実績に引っ張られて多く見積もらないように)
export function buildEstimator(masterTasks: MasterTask[], records: WorkRecord[]): Estimator {
  const byKey = new Map(masterTasks.map((m) => [`${m.category}::${m.name}`, m]));
  const recordsByMaster = new Map<string, WorkRecord[]>();
  for (const r of records) {
    if (!r.masterTaskId || r.excludedFromStats || r.seconds <= 0) continue;
    const list = recordsByMaster.get(r.masterTaskId) ?? [];
    list.push(r);
    recordsByMaster.set(r.masterTaskId, list);
  }

  function estimateMaster(m: MasterTask): { seconds: number; source: string } | null {
    const list = recordsByMaster.get(m.id) ?? [];
    const withMethod = list.filter((r) => r.method?.trim());
    if (withMethod.length > 0) {
      const latest = withMethod.reduce((a, b) => (b.endedAt > a.endedAt ? b : a));
      const method = latest.method!.trim();
      const same = withMethod.filter((r) => r.method!.trim() === method);
      if (same.length >= MIN_METHOD_SAMPLES) {
        const avg = Math.round(same.reduce((s, r) => s + r.seconds, 0) / same.length);
        if (avg > 0) return { seconds: avg, source: `手段「${method}」の実績平均` };
      }
    }
    if (m.estimatedSeconds > 0) return { seconds: m.estimatedSeconds, source: "過去の実績平均" };
    return null;
  }

  return {
    forMaster(category, name) {
      const m = byKey.get(`${category}::${name}`);
      return m ? estimateMaster(m) : null;
    },
    forMasterByName(name) {
      for (const m of masterTasks) {
        if (m.name !== name || m.archived) continue;
        const e = estimateMaster(m);
        if (e) return e;
      }
      return null;
    },
  };
}

function projectSpentSeconds(records: WorkRecord[], projectId: string): number {
  return records
    .filter((r) => !r.excludedFromStats && (r.projectId === projectId || r.secondaryProjectIds?.includes(projectId)))
    .reduce((s, r) => s + r.seconds, 0);
}

// 案件の残りを段階数で割った1段階あたりの見積もり(案件に見積もり総時間がある場合)
function perStageFromProject(p: ProjectItem, records: WorkRecord[]): number | null {
  if (!p.estimatedTotalSeconds) return null;
  const remainingStages = (p.stages ?? []).filter((s) => !isStageDone(s)).length || 1;
  const remaining = p.estimatedTotalSeconds - projectSpentSeconds(records, p.id);
  if (remaining <= 0) return null;
  return Math.round(remaining / remainingStages);
}

export function collectPlanCandidates(input: DayPlanInput): PlanCandidate[] {
  const { today, dailyTasks, projects, todoTasks, records } = input;
  const horizon = shiftDateStr(today, input.horizonDays ?? PLAN_HORIZON_DAYS);
  const estimator = buildEstimator(input.masterTasks, records);
  const candidates: PlanCandidate[] = [];

  const todays = dailyTasks.filter((t) => t.date === today && !t.isProvisional);
  // 既に本日の作業に入っている(未着手・計測中・一時停止中)ものは、案件・ToDo側から重ねて出さない
  const activeToday = todays.filter((t) => t.status !== "done");
  const linkedStages = new Set(activeToday.filter((t) => t.stageId).map((t) => t.stageId!));
  const linkedProjectsDirect = new Set(activeToday.filter((t) => t.projectId && !t.stageId).map((t) => t.projectId!));
  const linkedTodos = new Set(activeToday.filter((t) => t.todoTaskId).map((t) => t.todoTaskId!));

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const todoById = new Map(todoTasks.map((t) => [t.id, t]));
  // 案件の段階・ToDoのサブタスクから追加した作業は「案件名 › 作業名」にする
  const workCtx = buildWorkContextSources(projects, todoTasks);

  for (const t of todays) {
    if (t.status !== "pending" && t.status !== "paused") continue;
    const project = t.projectId ? projectById.get(t.projectId) : undefined;
    const stage = project?.stages?.find((s) => s.id === t.stageId);
    const todo = t.todoTaskId ? todoById.get(t.todoTaskId) : undefined;
    const est = (t.hasPlan !== false && t.estimatedSeconds > 0
      ? { seconds: t.estimatedSeconds, source: "設定した予定時間" }
      : null) ?? estimator.forMaster(t.category, t.name) ?? { seconds: DEFAULT_ESTIMATE_SECONDS, source: "実績がないため仮に30分" };
    const doneMs = t.status === "paused" ? t.accumulatedMs + (t.manualAdjustmentMs ?? 0) : 0;
    const remaining = Math.max(5 * 60, est.seconds - Math.round(doneMs / 1000));
    candidates.push({
      key: `daily:${t.id}`,
      kind: "daily",
      title: workNameWithContext(t, workCtx),
      subtitle: t.category,
      category: t.category,
      name: t.name,
      dailyTaskId: t.id,
      projectId: t.projectId,
      stageId: t.stageId,
      todoTaskId: t.todoTaskId,
      // 本日の作業に入れた時点で「今日やる」と決めたものなので、期日が無ければ今日扱いにする
      dueDate: minDate(stage?.dueDate ?? project?.dueDate, todo?.dueDate) ?? today,
      dueIsImplicit: !minDate(stage?.dueDate ?? project?.dueDate, todo?.dueDate),
      important: !!todo?.important,
      estimateSeconds: remaining,
      estimateSource: doneMs > 0 ? `${est.source}から着手済み分を差し引き` : est.source,
      order: t.order,
    });
  }

  for (const p of projects) {
    if (p.completedAt || p.archived) continue;
    const stages = p.stages ?? [];
    if (stages.length > 0) {
      const undone = stages.filter((s) => !isStageDone(s));
      // 段階に期日が無い場合は、案件の期日を引き継いだ「次の1段階」だけを候補にする
      // (段階が100件以上ある案件で、残り全部が一度に並ばないように)
      const nextUndated = undone.find((s) => !s.dueDate);
      for (const s of undone) {
        if (linkedStages.has(s.id)) continue;
        const due = s.dueDate ?? p.dueDate;
        if (!s.dueDate && s !== nextUndated) continue;
        if (!due || due > horizon) continue;
        const category = p.category || p.title;
        const est =
          estimator.forMaster(category, s.title) ??
          (perStageFromProject(p, records) != null
            ? { seconds: perStageFromProject(p, records)!, source: "案件の見積もり残りを段階数で割った目安" }
            : { seconds: DEFAULT_ESTIMATE_SECONDS, source: "実績がないため仮に30分" });
        candidates.push({
          key: `stage:${p.id}:${s.id}`,
          kind: "stage",
          title: s.title,
          subtitle: `案件「${p.title}」の段階`,
          category,
          name: s.title,
          projectId: p.id,
          stageId: s.id,
          dueDate: due,
          important: false,
          estimateSeconds: est.seconds,
          estimateSource: est.source,
          order: Number.MAX_SAFE_INTEGER,
        });
      }
    } else {
      if (linkedProjectsDirect.has(p.id)) continue;
      if (!p.dueDate || p.dueDate > horizon) continue;
      const category = p.category || p.title;
      const name = p.workName || p.title;
      const remainingFromProject = p.estimatedTotalSeconds
        ? p.estimatedTotalSeconds - projectSpentSeconds(records, p.id)
        : 0;
      const est =
        estimator.forMaster(category, name) ??
        (remainingFromProject > 0
          ? { seconds: remainingFromProject, source: "案件の見積もり総時間の残り" }
          : { seconds: DEFAULT_ESTIMATE_SECONDS, source: "実績がないため仮に30分" });
      candidates.push({
        key: `project:${p.id}`,
        kind: "project",
        title: p.title,
        subtitle: `案件（${category} / ${name}）`,
        category,
        name,
        projectId: p.id,
        dueDate: p.dueDate,
        important: false,
        estimateSeconds: est.seconds,
        estimateSource: est.source,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
  }

  const hasOpenChildren = new Set(
    todoTasks.filter((t) => t.parentTaskId && !t.completed && !t.archived).map((t) => t.parentTaskId!)
  );
  for (const t of todoTasks) {
    if (t.completed || t.archived) continue;
    if (linkedTodos.has(t.id)) continue;
    // 案件に反映済みのToDoは案件側の候補と重複するため除く。サブタスクが残っている
    // 親ToDoは、実際の作業単位であるサブタスクの方を候補にする
    if (t.projectId || hasOpenChildren.has(t.id)) continue;
    const parent = t.parentTaskId ? todoById.get(t.parentTaskId) : undefined;
    const due = t.dueDate ?? parent?.dueDate;
    const inMyDay = t.myDayDate === today;
    if (!inMyDay && (!due || due > horizon)) continue;
    const category = t.category || parent?.category || "ToDo";
    const est =
      estimator.forMaster(category, t.title) ??
      estimator.forMasterByName(t.title) ?? { seconds: DEFAULT_ESTIMATE_SECONDS, source: "実績がないため仮に30分" };
    candidates.push({
      key: `todo:${t.id}`,
      kind: "todo",
      title: t.title,
      subtitle: parent
        ? `ToDo「${parent.title}」のサブタスク`
        : [t.category, t.customer].filter(Boolean).join(" / ") || undefined,
      category,
      name: t.title,
      todoTaskId: t.id,
      dueDate: due ?? today,
      dueIsImplicit: !due,
      important: t.important || !!parent?.important,
      estimateSeconds: est.seconds,
      estimateSource: est.source,
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  return candidates;
}

function minDate(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function comparePlanCandidates(a: PlanCandidate, b: PlanCandidate): number {
  const da = a.dueDate ?? "9999-12-31";
  const dbd = b.dueDate ?? "9999-12-31";
  if (da !== dbd) return da < dbd ? -1 : 1;
  if (a.important !== b.important) return a.important ? -1 : 1;
  // 本日の作業に既に並んでいるものどうしは、ユーザーが並べた順を尊重する
  if (a.kind === "daily" && b.kind === "daily") return a.order - b.order;
  if (a.kind === "daily" || b.kind === "daily") return a.kind === "daily" ? -1 : 1;
  return a.estimateSeconds - b.estimateSeconds;
}

export function buildDayPlan(input: DayPlanInput): DayPlan {
  const { now, today, workStart, workEnd, breaks } = input;
  const dayIntervals = workingIntervals(today, workStart, workEnd, breaks);
  const dayStartMs = timeToMsOfDay(today, workStart);
  const dayEndMs = timeToMsOfDay(today, workEnd);
  let free = clipFrom(dayIntervals, Math.max(now, dayStartMs));

  // 計測中の作業は、見積もり上の残り分だけ先に枠を押さえる
  const running = input.dailyTasks.find((t) => t.date === today && t.status === "running" && !t.isProvisional);
  let runningRemainingSeconds = 0;
  if (running) {
    const est =
      (running.hasPlan !== false && running.estimatedSeconds > 0 ? running.estimatedSeconds : 0) ||
      buildEstimator(input.masterTasks, input.records).forMaster(running.category, running.name)?.seconds ||
      0;
    const elapsedMs =
      running.accumulatedMs +
      (running.manualAdjustmentMs ?? 0) +
      running.segments.filter((s) => s.end === undefined).reduce((sum, s) => sum + (now - s.start), 0);
    runningRemainingSeconds = Math.max(0, est - Math.round(elapsedMs / 1000));
    const used = consume(free, runningRemainingSeconds);
    if (used) free = used.rest;
  }
  const remainingSeconds = totalSeconds(free);

  const candidates = collectPlanCandidates(input).sort(comparePlanCandidates);
  const scheduled: PlannedItem[] = [];
  const overflow: PlanCandidate[] = [];
  for (const c of candidates) {
    const left = totalSeconds(free);
    if (left <= 0) {
      overflow.push(c);
      continue;
    }
    const fits = c.estimateSeconds <= left;
    // 収まらないものは、今日が期日(または期限切れ)なら入るところまで着手する計画にし、
    // 期日に余裕があるものは明日以降へ回す(中途半端に手を付けるより、別の作業を片付けた方がよいため)
    if (!fits && (c.dueDate ?? today) > today) {
      overflow.push(c);
      continue;
    }
    const plannedSeconds = Math.min(c.estimateSeconds, left);
    const slot = consume(free, plannedSeconds);
    if (!slot) {
      overflow.push(c);
      continue;
    }
    free = slot.rest;
    scheduled.push({ ...c, startMs: slot.start, endMs: slot.end, plannedSeconds, partial: !fits });
  }

  const atRisk = computeAtRisk(candidates, input, remainingSeconds);
  const totalDemandSeconds = candidates.reduce((s, c) => s + c.estimateSeconds, 0);

  return {
    dayStartMs,
    dayEndMs,
    remainingSeconds,
    runningRemainingSeconds,
    runningTaskName: running?.name,
    scheduled,
    overflow,
    atRisk,
    totalDemandSeconds,
  };
}

// 期日が近い順に並べたとき、その期日までの稼働時間(今日の残り+翌日以降の1日分×日数)に
// 見積もりの累計が収まるかを見て、収まらない最初の地点以降を「間に合わない見込み」とする。
// 土日も1日として数える簡易計算なので、実際より楽観的に出る(＝警告が出たら確実に危ない)
function computeAtRisk(sorted: PlanCandidate[], input: DayPlanInput, todayRemainingSeconds: number): AtRiskItem[] {
  const fullDaySeconds = totalSeconds(workingIntervals(input.today, input.workStart, input.workEnd, input.breaks));
  const atRisk: AtRiskItem[] = [];
  let cumulative = 0;
  for (const c of sorted) {
    cumulative += c.estimateSeconds;
    const due = c.dueDate ?? input.today;
    const daysAfterToday = Math.max(0, daysBetweenDateStrs(input.today, due));
    const capacity = todayRemainingSeconds + fullDaySeconds * daysAfterToday;
    if (cumulative > capacity) atRisk.push({ candidate: c, shortfallSeconds: cumulative - capacity });
  }
  return atRisk;
}
