import type { MasterTask, TodoTask, WorkRecord } from "./types";
import { computeSuggestedTask } from "./suggest";
import { formatHms, parseHourStr } from "./time";

export interface NextTaskPick {
  category: string;
  name: string;
  estimatedSeconds: number;
  reason: string;
  masterTaskId?: string;
  todoTaskId?: string;
}

const SHORT_ON_TIME_SECONDS = 3600; // 終業までこれ未満なら「残り時間」を考慮した提案に切り替える

// 既存の「そろそろこの作業では?」(曜日・時間帯パターン)は、普段通りの一手を教えてくれる一方、
// 締切や残り時間までは見ていない。これはその隙間を埋めるためのもので、
// (1)期限が今日以前の未完了ToDoがあれば最優先でそれを、
// (2)終業までの残り時間が少なく、いつもの提案がそれに収まらない場合は、
//    お気に入り作業の中から残り時間に収まる短めの代替を提案する。
// どちらにも該当しなければ(=いつも通りの提案で十分)、既存パネルに任せてnullを返す
export function computeNextTaskPick(input: {
  records: WorkRecord[];
  masterTasks: MasterTask[];
  todoTasks: TodoTask[];
  favoriteMasterIds: Set<string>;
  today: string;
  now: Date;
  afterHoursCutoff: string; // "HH:MM"
}): NextTaskPick | null {
  const dueTodos = input.todoTasks
    .filter((t) => !t.completed && !t.parentTaskId && t.dueDate && t.dueDate <= input.today)
    .sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    });
  if (dueTodos.length > 0) {
    const t = dueTodos[0];
    const reason = t.dueDate! < input.today ? `期限を過ぎているToDoです（${t.dueDate}）` : "今日が期限のToDoです";
    return { category: t.category || "ToDo", name: t.title, estimatedSeconds: 0, reason, todoTaskId: t.id };
  }

  const cutoffHour = parseHourStr(input.afterHoursCutoff, 18);
  const nowHour = input.now.getHours() + input.now.getMinutes() / 60;
  const remainingSeconds = Math.round((cutoffHour - nowHour) * 3600);
  if (remainingSeconds <= 0 || remainingSeconds >= SHORT_ON_TIME_SECONDS) return null;

  const estimatedByKey = new Map<string, number>();
  for (const m of input.masterTasks) {
    if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }
  const weekdaySuggestion = computeSuggestedTask(input.records, input.now.getDay(), input.now.getHours());
  if (weekdaySuggestion) {
    const suggestedEstimated = estimatedByKey.get(`${weekdaySuggestion.category}::${weekdaySuggestion.name}`) ?? 0;
    if (suggestedEstimated > 0 && suggestedEstimated <= remainingSeconds) return null; // 普段の提案で十分間に合う
  }

  const alt = input.masterTasks
    .filter((m) => input.favoriteMasterIds.has(m.id) && !m.archived && m.estimatedSeconds > 0 && m.estimatedSeconds <= remainingSeconds)
    .sort((a, b) => b.estimatedSeconds - a.estimatedSeconds)[0];
  if (!alt) return null;

  return {
    category: alt.category,
    name: alt.name,
    estimatedSeconds: alt.estimatedSeconds,
    reason: `終業まで残り${formatHms(remainingSeconds)}のため、短時間で終えられるこちらはいかがですか`,
    masterTaskId: alt.id,
  };
}
