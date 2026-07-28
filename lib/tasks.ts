import type { DailyTask } from "./types";

export function segmentsAccumulatedMs(task: DailyTask, now: number): number {
  let total = task.accumulatedMs;
  const running = task.segments.find((s) => s.end === undefined);
  if (running) total += now - running.start;
  return total;
}
