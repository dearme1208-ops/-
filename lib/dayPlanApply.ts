import { db, uid } from "./db";
import { findOrCreateMasterTask } from "./master";
import type { PlanCandidate } from "./dayPlan";
import type { DailyTask } from "./types";

// 段取りの計画を本日の作業へ反映する。案件の段階・案件・ToDoの候補は、それぞれの画面の
// 「本日の作業に追加」と同じ紐付け(projectId/stageId/todoTaskId)で未着手として追加し、
// 本日の作業の未着手の並びを計画の順番に揃える(計画に無い作業はその後ろへ元の順のまま続ける)
export async function applyPlanToToday(items: PlanCandidate[], today: string): Promise<number> {
  const todayTasks = await db.dailyTasks.where("date").equals(today).toArray();
  const todoByProjectId = new Map(
    (await db.todoTasks.toArray()).filter((t) => t.projectId).map((t) => [t.projectId!, t.id])
  );

  const planOrderIds: string[] = [];
  let added = 0;
  for (const item of items) {
    if (item.kind === "daily" && item.dailyTaskId) {
      planOrderIds.push(item.dailyTaskId);
      continue;
    }
    const master = await findOrCreateMasterTask(item.category, item.name, 0);
    const task: DailyTask = {
      id: uid(),
      date: today,
      order: 0,
      masterTaskId: master.id,
      category: item.category,
      name: item.name,
      estimatedSeconds: item.estimateSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
      projectId: item.projectId,
      stageId: item.stageId,
      todoTaskId: item.todoTaskId ?? (item.projectId ? todoByProjectId.get(item.projectId) : undefined),
    };
    await db.dailyTasks.add(task);
    planOrderIds.push(task.id);
    added++;
  }

  const planned = new Set(planOrderIds);
  const rest = todayTasks
    .filter((t) => !planned.has(t.id))
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);
  await db.transaction("rw", db.dailyTasks, async () => {
    const ordered = [...planOrderIds, ...rest];
    for (let i = 0; i < ordered.length; i++) await db.dailyTasks.update(ordered[i], { order: i });
  });
  return added;
}
