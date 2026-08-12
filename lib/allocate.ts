import { baseAccumulatedMs, segmentsAccumulatedMs } from "./tasks";
import type { DailyTask } from "./types";

export interface AutoAllocationResult {
  scale: number; // 1 = 余裕あり(圧縮なし)、1未満 = 業務時間に収めるための圧縮率
  remainingWorkMs: number; // 業務終了時刻までの残り時間
  totalRemainingPredictedMs: number; // 未完了作業の予測残り時間の合計(圧縮前)
  allocatedMsByTaskId: Map<string, number>;
}

// 残りの業務時間内に、今日の未完了作業(の予測残り時間)を収めるには、それぞれの作業を
// どれくらいのペースでこなせばよいかを計算する。「予定」の代わりに使う自動配分機能。
// 合計の予測残り時間が業務時間に収まっていればそのまま(圧縮なし)、超えていれば
// 全作業に同じ比率(scale)を掛けて圧縮した「配分目安」を返す
export function computeAutoAllocation(
  tasks: DailyTask[],
  predictedSecondsByTaskId: Map<string, number>,
  date: string,
  workEndHm: string,
  now: number
): AutoAllocationResult {
  const dayStart = new Date(date + "T00:00:00").getTime();
  const [eh, em] = workEndHm.split(":").map(Number);
  const workEndMs = dayStart + ((Number.isFinite(eh) ? eh : 17) * 60 + (Number.isFinite(em) ? em : 0)) * 60000;
  const remainingWorkMs = Math.max(0, workEndMs - now);

  const remainingByTaskId = new Map<string, number>();
  let total = 0;
  for (const t of tasks) {
    if (t.status === "done") continue;
    const predictedMs = (predictedSecondsByTaskId.get(t.id) ?? 0) * 1000;
    if (predictedMs <= 0) continue;
    let remainingMs: number;
    if (t.status === "running") {
      remainingMs = Math.max(0, predictedMs - segmentsAccumulatedMs(t, now));
    } else if (t.status === "paused") {
      remainingMs = Math.max(0, predictedMs - baseAccumulatedMs(t));
    } else {
      remainingMs = predictedMs;
    }
    if (remainingMs <= 0) continue;
    remainingByTaskId.set(t.id, remainingMs);
    total += remainingMs;
  }

  const scale = total > 0 && total > remainingWorkMs ? remainingWorkMs / total : 1;
  const allocatedMsByTaskId = new Map<string, number>();
  for (const [id, ms] of remainingByTaskId) {
    allocatedMsByTaskId.set(id, ms * scale);
  }

  return { scale, remainingWorkMs, totalRemainingPredictedMs: total, allocatedMsByTaskId };
}
