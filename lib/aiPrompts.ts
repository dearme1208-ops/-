import { buildEstimator } from "./dayPlan";
import { buildProgressRows, PROGRESS_STATUS_LABELS } from "./progressOverview";
import { UPDATE_FORMAT, SYNC_VERSION, type ProgressSnapshot } from "./progressSync";
import { buildWorkContextSources, workNameWithContext } from "./workContext";
import type { BreakRange, DailyTask, MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// 別のAI(Claudeなど)への依頼文。頼み方の説明と、必要なデータ(JSON)を1つの文章にまとめて
// ワンタップでコピーできるようにする。返ってきた「進捗の更新」は lib/progressSync.ts で取り込む

// ---------------- 時間割の相談データ ----------------

export interface TimeboxRequestTask {
  taskId: string;
  label: string;
  category: string;
  status: "未着手" | "一時停止中" | "計測中";
  /** 利用者が決めた予定時間(分)。無ければ省略 */
  plannedMinutes?: number;
  /** 過去の実績から見たこの作業のふだんの所要時間(分)。分からなければ省略 */
  typicalMinutes?: number;
  /** 今日すでに使った時間(分) */
  spentMinutes?: number;
  /** 紐付く案件の段階・案件・ToDoの期日のうち一番早いもの */
  dueDate?: string;
  /** 紐付く案件・ToDoの進み具合(「遅れ気味」「期限切れ」など) */
  progressStatus?: string;
  important?: boolean;
  /** すでに決まっている時間割の枠 */
  currentTimebox?: { start: string; end: string };
}

/** この工程表の使い道。仕事用と家庭用で別々に使っている人がいるので、依頼の言い回しと優先の付け方を変える */
export type LifeContext = "仕事" | "家庭";

export interface TimeboxRequest {
  format: "koutei-timebox-request";
  version: 1;
  date: string;
  context: LifeContext;
  /** 対象の日が今日なら、今の時刻(これより前に枠を置いても始まらない) */
  nowTime?: string;
  /** 枠を置いてよい時間帯(仕事なら勤務時間)。丸一日(00:00〜23:59など)の指定は「指定なし」として省く */
  activeHours?: { start: string; end: string };
  breaks: { start: string; end: string }[];
  gapMinutes: number;
  /** カレンダーから取り込んだ予定など、動かせない時刻の予定 */
  fixedEvents: { label: string; start: string; end?: string }[];
  tasks: TimeboxRequestTask[];
}

const minutes = (sec: number) => Math.max(1, Math.round(sec / 60));

export function buildTimeboxRequest({
  date,
  now,
  dailyTasks,
  masterTasks,
  records,
  projects,
  todoTasks,
  breaks,
  workStart,
  workEnd,
  gapMinutes,
  context = "仕事",
}: {
  date: string;
  now: Date;
  dailyTasks: DailyTask[];
  masterTasks: MasterTask[];
  records: WorkRecord[];
  projects: ProjectItem[];
  todoTasks: TodoTask[];
  breaks: BreakRange[];
  workStart: string;
  workEnd: string;
  gapMinutes: number;
  context?: LifeContext;
}): TimeboxRequest {
  const estimator = buildEstimator(masterTasks, records);
  const ctx = buildWorkContextSources(projects, todoTasks);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const todoById = new Map(todoTasks.map((t) => [t.id, t]));
  const subtasksByParent = new Map<string, TodoTask[]>();
  for (const t of todoTasks) if (t.parentTaskId) subtasksByParent.set(t.parentTaskId, [...(subtasksByParent.get(t.parentTaskId) ?? []), t]);
  const progress = buildProgressRows({
    todos: todoTasks.filter((t) => !t.parentTaskId && !t.completed),
    subtasksByParent,
    projects: projects.filter((p) => !p.completedAt),
    today: date,
  });
  const statusByKey = new Map(progress.map((r) => [r.key, PROGRESS_STATUS_LABELS[r.status]]));
  const isToday = date === todayOf(now);

  const dayTasks = dailyTasks.filter((t) => t.date === date && !t.isProvisional).sort((a, b) => a.order - b.order);
  const tasks: TimeboxRequestTask[] = [];
  const fixedEvents: TimeboxRequest["fixedEvents"] = [];
  for (const t of dayTasks) {
    if (t.status === "done") continue;
    // カレンダー予定の取り込みなど、時刻だけが決まっている作業は動かせない予定として渡す
    if (t.scheduledTime && !t.timeboxEnd && t.status === "pending") {
      fixedEvents.push({ label: workNameWithContext(t, ctx), start: t.scheduledTime });
      continue;
    }
    const project = t.projectId ? projectById.get(t.projectId) : undefined;
    const stage = project?.stages?.find((s) => s.id === t.stageId);
    const todo = t.todoTaskId ? todoById.get(t.todoTaskId) : undefined;
    const parentTodo = todo?.parentTaskId ? todoById.get(todo.parentTaskId) : todo;
    const dues = [stage?.dueDate, project?.dueDate, todo?.dueDate, parentTodo?.dueDate].filter((d): d is string => !!d).sort();
    const status =
      (project && statusByKey.get(`project:${project.id}`)) || (parentTodo && statusByKey.get(`todo:${parentTodo.id}`)) || undefined;
    const typical = estimator.forMaster(t.category, t.name);
    const spent = t.accumulatedMs + (t.manualAdjustmentMs ?? 0);
    tasks.push(
      clean({
        taskId: t.id,
        label: workNameWithContext(t, ctx),
        category: t.category,
        status: t.status === "running" ? "計測中" : t.status === "paused" ? "一時停止中" : "未着手",
        plannedMinutes: t.hasPlan !== false && t.estimatedSeconds > 0 ? minutes(t.estimatedSeconds) : undefined,
        typicalMinutes: typical ? minutes(typical.seconds) : undefined,
        spentMinutes: spent > 0 ? minutes(spent / 1000) : undefined,
        dueDate: dues[0],
        progressStatus: status,
        important: todo?.important || parentTodo?.important || undefined,
        currentTimebox: t.scheduledTime && t.timeboxEnd ? { start: t.scheduledTime, end: t.timeboxEnd } : undefined,
      }) as TimeboxRequestTask
    );
  }
  return {
    format: "koutei-timebox-request",
    version: 1,
    date,
    ...(isToday ? { nowTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` } : {}),
    context,
    ...(isWholeDay(workStart, workEnd) ? {} : { activeHours: { start: workStart, end: workEnd } }),
    breaks: breaks.map((b) => ({ start: b.start, end: b.end })),
    gapMinutes,
    fixedEvents,
    tasks,
  };
}

/** 始まりと終わりが丸一日(22時間以上)を覆う・逆転している指定は、時間帯の指定が無いものとして扱う */
function isWholeDay(start: string, end: string): boolean {
  const toMin = (hm: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const s = toMin(start);
  const e = toMin(end);
  return s === null || e === null || e <= s || e - s >= 22 * 60;
}

function todayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ---------------- 依頼文 ----------------

const json = (v: unknown) => "```json\n" + JSON.stringify(v, null, 2) + "\n```";

const REPLY_RULES = `## 返し方
- まず、何をどうするかを日本語の箇条書きで短く書いてください。
- そのあとに、取り込み用のJSONを1つのコードブロック(\`\`\`json … \`\`\`)にまとめてください。
- JSONの "format" は "${UPDATE_FORMAT}"、"version" は ${SYNC_VERSION} です。
- 判断がつかないことは推測で書かず、JSONの前に質問してください。`;

export function timeboxPrompt(request: TimeboxRequest): string {
  const home = request.context === "家庭";
  const intro = home
    ? `あなたは私の家庭での1日の時間割(タイムボックス)を組むアシスタントです。この工程表は家庭用で、家事・用事・趣味・家族のことなど、仕事以外の時間の使い方を管理しています。`
    : `あなたは私の仕事の1日の時間割(タイムボックス)を組むアシスタントです。`;
  const hours = request.activeHours
    ? `- activeHours(${home ? "活動できる時間帯" : "勤務時間"})の中に収め、breaks(休憩)と fixedEvents(動かせない予定)には重ねないでください。`
    : `- 時間帯の指定はありません。${home ? "睡眠・食事・身支度など生活の時間を考え、無理のない時間帯に置いてください(深夜・早朝には置かない)。" : "常識的な勤務時間の範囲に置いてください。"}breaks(休憩)と fixedEvents(動かせない予定)には重ねないでください。`;
  const priority = home
    ? `- 優先順位: progressStatus が「期限切れ」「遅れ気味」のもの、dueDate が近いもの、important のものを先に。集中が要るものは元気な時間帯に、家事のような細かい用事は短い枠にまとめてください。趣味や休む時間も大事な予定として扱い、寝る前に詰め込まないでください。`
    : `- 優先順位: progressStatus が「期限切れ」「遅れ気味」のもの、dueDate が近いもの、important のものを先に。頭を使う作業は午前の早い時間に、メール返信のような細かい作業は短い枠にまとめて後ろへ。`;
  return `${intro}
「全部急ぎ」で全部を気にしていると何も進まないので、やることごとに時間の枠を先に決め、枠の間はその1つだけに集中し、時間が来たら途中でも止めて次へ進む、というやり方をしています。
下の「時間割の相談データ」をもとに、${request.date} の時間割を組んでください。

## 組み方の決まり
- 枠に入れてよいのは tasks にあるものだけです(taskId で指定)。1つにつき枠は1つまで。
${hours}
- fixedEvents は終わりが無ければ30分とみなしてください。
- 枠と枠の間には gapMinutes 分の小休止を入れてください。${request.nowTime ? `\n- 今は ${request.nowTime} です。これより前に枠を置かないでください。status が「計測中」のものは、今まさにやっているので、今からの枠にしてください。` : ""}
- 枠の長さは typicalMinutes(過去の実績のふだんの所要時間)を基準に、無ければ plannedMinutes、どちらも無ければ25分。spentMinutes(今日すでに使った時間)があるものは残りの分だけにしてください。長いものは90分を上限に区切ってかまいません(続きは枠に入れなくてよい)。
${priority}
- 入りきらないものは無理に詰めず、入れなかったものとして箇条書きで理由を書いてください。

## 返すJSONの形
${json({
  format: UPDATE_FORMAT,
  version: SYNC_VERSION,
  operations: [{ op: "planTimebox", date: request.date, slots: [{ taskId: "(tasksのtaskId)", start: "09:00", end: "09:25" }] }],
})}
- start / end は "HH:MM"(24時間)。slots は時刻順でなくてもかまいません。
- 時間割に入れなかったものに前からある枠は、取り込むと外れます。

${REPLY_RULES}

## 時間割の相談データ
${json(request)}
`;
}

export function progressPrompt(spec: string, snapshot: ProgressSnapshot): string {
  return `あなたは私の案件・ToDoの進捗を「工程表」アプリに登録するアシスタントです。
下の仕様書を読み、現状のスナップショットをもとに、これから私が伝える進捗を「進捗の更新」JSONにしてください。
私が進捗を伝えるまでは、仕様を理解したことだけを短く返してください。

${REPLY_RULES}

## 仕様書
${spec}

## 現状のスナップショット
${json(snapshot)}
`;
}

export function notesToTodoPrompt(spec: string, snapshot: ProgressSnapshot): string {
  return `あなたは議事録・メールから、やるべきことを「工程表」アプリのToDo・案件に起こすアシスタントです。
下の仕様書を読み、現状のスナップショットと重複しないように、このあと私が貼る議事録・メールの内容から
ToDo(サブタスクつき)・案件・段階の追加と、既存のものの更新を「進捗の更新」JSONにしてください。
- 自分(私)がやることだけをToDoにし、相手の宿題は相手待ちとして既存のToDoの対応状況やメモに反映してください。
- 期日がはっきりしないものは期日を付けないでください。
- 既にあるToDo・案件に当たるものは新しく作らず、IDで更新してください。
私が議事録・メールを貼るまでは、仕様を理解したことだけを短く返してください。

${REPLY_RULES}

## 仕様書
${spec}

## 現状のスナップショット
${json(snapshot)}
`;
}
