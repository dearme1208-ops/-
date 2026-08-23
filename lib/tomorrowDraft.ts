import type { DailyTask, MasterTask, TodoTask, WorkRecord } from "./types";
import { computeWeekdayAverages, computeWeekdayBreakdown } from "./weekday";
import { daysBetweenDateStrs } from "./time";

export interface DraftTaskSuggestion {
  id: string; // category::name。重複判定とチェックボックスのキーに使う
  category: string;
  name: string;
  estimatedSeconds: number;
  reason: string;
  masterTaskId?: string;
  todoTaskId?: string;
}

const WEEKDAY_HISTORY_TOP_N = 3;
const TODO_DUE_WINDOW_DAYS = 3;

// 分析・提案ではなく「明日の作業リストのたたき台」そのものを作る。
// (1)今日終わらなかった作業の繰り越し (2)明日の曜日によく行っている作業の履歴
// (3)期限が近い未完了ToDo、の3種類の手がかりから候補を集める。実際にリストへ
// 追加するかはユーザーが選ぶため、ここでは提案止まりにする
export function computeTomorrowDraft(input: {
  targetDate: string;
  targetDow: number; // 0=日 ... 6=土
  records: WorkRecord[];
  masterTasks: MasterTask[];
  todoTasks: TodoTask[];
  todayTasks: DailyTask[];
}): DraftTaskSuggestion[] {
  const suggestions: DraftTaskSuggestion[] = [];
  const seenKeys = new Set<string>();

  function addSuggestion(
    category: string,
    name: string,
    estimatedSeconds: number,
    reason: string,
    extra: { masterTaskId?: string; todoTaskId?: string } = {}
  ) {
    const key = `${category}::${name}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    suggestions.push({ id: key, category, name, estimatedSeconds, reason, ...extra });
  }

  for (const t of input.todayTasks) {
    if (t.isProvisional || t.status === "done") continue;
    addSuggestion(t.category, t.name, t.estimatedSeconds, "今日終わらなかった作業", { masterTaskId: t.masterTaskId });
  }

  const dayCount = computeWeekdayAverages(input.records).find((w) => w.dow === input.targetDow)?.dayCount ?? 0;
  if (dayCount >= 2) {
    const estimatedByKey = new Map<string, number>();
    for (const m of input.masterTasks) {
      if (m.estimatedSeconds > 0) estimatedByKey.set(`${m.category}::${m.name}`, m.estimatedSeconds);
    }
    const breakdown = computeWeekdayBreakdown(input.records, input.targetDow, dayCount)
      .filter((row) => !row.key.startsWith("__trouble__"))
      .slice(0, WEEKDAY_HISTORY_TOP_N);
    for (const row of breakdown) {
      const estimatedSeconds = estimatedByKey.get(`${row.category}::${row.name}`) ?? Math.round(row.avgSeconds);
      addSuggestion(row.category, row.name, estimatedSeconds, "この曜日によく行っている作業");
    }
  }

  for (const t of input.todoTasks) {
    if (t.completed || t.parentTaskId || !t.dueDate) continue;
    const diff = daysBetweenDateStrs(input.targetDate, t.dueDate);
    if (diff < 0 || diff > TODO_DUE_WINDOW_DAYS) continue;
    addSuggestion(t.category || "ToDo", t.title, 0, `期限が近いToDo（${t.dueDate}）`, { todoTaskId: t.id });
  }

  return suggestions;
}
