"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useSetting } from "@/lib/settings";
import { baseAccumulatedMs } from "@/lib/tasks";
import { parseReflection } from "@/lib/reflection";
import { formatHms, shiftDateStr } from "@/lib/time";

// 終業の振り返り(EndOfDayReflectionModal)で書いた「明日に持ち越したいこと」は、
// これまで記録タブの履歴を遡らないと二度と目に入らなかった。ここでは前日分を
// 当日の作業を始める前にもう一度見せ、あわせて期限切れのまま止まっているToDo・
// 案件も一緒に出すことで、「昨日の自分から今日の自分への申し送り」として機能させる
export default function TodayHandoffPanel({ today }: { today: string }) {
  const yesterday = shiftDateStr(today, -1);
  const [dismissedStr, setDismissed] = useSetting(`handoff.dismissed.${today}`, "false");
  const dismissed = dismissedStr === "true";

  const reflectionRow = useLiveQuery(() => db.settings.get(`reflection.daily.${yesterday}`), [yesterday]);
  const yesterdayTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(yesterday).toArray(), [yesterday]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  if (dismissed) return null;
  if (reflectionRow === undefined || yesterdayTasks === undefined || todoTasks === undefined || projects === undefined) {
    return null;
  }

  const reflection = reflectionRow ? parseReflection(reflectionRow.value) : null;
  const carryOver = reflection?.carryOver.trim() || "";

  const doneYesterday = yesterdayTasks.filter((t) => t.status === "done");
  const yesterdaySeconds = doneYesterday.reduce((sum, t) => sum + Math.round(baseAccumulatedMs(t) / 1000), 0);

  // 引き継ぎとして見せるのはトップレベルのToDoのみ(サブタスクまで出すと数が多くなりすぎる)
  const overdueTodos = todoTasks
    .filter((t) => !t.completed && !t.parentTaskId && !!t.dueDate && t.dueDate < today)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const overdueProjects = projects
    .filter((p) => !p.completedAt && p.dueDate < today)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const overdueExtra = Math.max(0, overdueTodos.length - 3) + Math.max(0, overdueProjects.length - 3);

  const hasContent = !!carryOver || overdueTodos.length > 0 || overdueProjects.length > 0 || doneYesterday.length > 0;
  if (!hasContent) return null;

  return (
    <div className="panel space-y-2.5 border-l-4 border-l-cream/30 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-cream/80">🌅 昨日からの引き継ぎ</h3>
        <button
          className="text-xs text-cream/40 hover:text-cream"
          onClick={() => setDismissed("true")}
          title="今日はもう表示しない"
        >
          閉じる
        </button>
      </div>
      {doneYesterday.length > 0 && (
        <p className="text-xs text-cream/50">
          昨日は {doneYesterday.length}件完了・合計 {formatHms(yesterdaySeconds)}
        </p>
      )}
      {carryOver && (
        <div className="rounded-lg border border-cream/15 bg-ink/40 px-3 py-2 text-sm text-cream/90">
          <span className="mr-1.5 text-cream/40">➡️ 昨日の自分から:</span>
          {carryOver}
        </div>
      )}
      {(overdueTodos.length > 0 || overdueProjects.length > 0) && (
        <div className="space-y-1 text-xs">
          {overdueTodos.slice(0, 3).map((t) => (
            <div key={t.id} className="flex items-center gap-1.5 text-alert">
              <span>⏰</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="shrink-0 text-cream/40">期日 {t.dueDate}</span>
            </div>
          ))}
          {overdueProjects.slice(0, 3).map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 text-alert">
              <span>⏰</span>
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="shrink-0 text-cream/40">期日 {p.dueDate}</span>
            </div>
          ))}
          {overdueExtra > 0 && <p className="text-cream/40">他 {overdueExtra}件</p>}
        </div>
      )}
    </div>
  );
}
