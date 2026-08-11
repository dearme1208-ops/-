import { CONDITION_LEVELS } from "./condition";
import { formatClock, formatHms } from "./time";
import type { ConditionLog, DailyTask } from "./types";

// その日の作業区間・体調記録を時系列に並べ、「あらすじ」として1行ずつのテキスト配列にする
export function computeTodayNarrative(tasks: DailyTask[], conditionLogs: ConditionLog[], now: number): string[] {
  type Item = { at: number; text: string };
  const items: Item[] = [];

  for (const t of tasks) {
    if (t.isProvisional) continue;
    for (const seg of t.segments) {
      const endLabel = seg.end !== undefined ? formatClock(seg.end) : "計測中";
      const durationSec = Math.round(((seg.end ?? now) - seg.start) / 1000);
      items.push({
        at: seg.start,
        text: `${formatClock(seg.start)}〜${endLabel} 「${t.category} / ${t.name}」（${formatHms(durationSec)}）`,
      });
    }
  }

  for (const log of conditionLogs) {
    const label = CONDITION_LEVELS.find((c) => c.level === log.level)?.label ?? log.level;
    items.push({ at: log.loggedAt, text: `${formatClock(log.loggedAt)} 💭 体調が「${label}」に変化` });
  }

  items.sort((a, b) => a.at - b.at);
  return items.map((i) => i.text);
}
