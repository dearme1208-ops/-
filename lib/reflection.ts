import type { AppSetting } from "./types";

export const REFLECTION_KEY_PREFIX = "reflection.daily.";

export interface DailyReflection {
  satisfaction: number; // 1(いまいち)〜5(最高)
  bestThing: string;
  carryOver: string;
  answeredAt: number;
}

export interface ReflectionEntry {
  date: string;
  reflection: DailyReflection;
}

export function serializeReflection(r: DailyReflection): string {
  return JSON.stringify(r);
}

export function parseReflection(value: string): DailyReflection | null {
  try {
    const obj = JSON.parse(value);
    if (typeof obj.satisfaction !== "number") return null;
    return {
      satisfaction: obj.satisfaction,
      bestThing: typeof obj.bestThing === "string" ? obj.bestThing : "",
      carryOver: typeof obj.carryOver === "string" ? obj.carryOver : "",
      answeredAt: typeof obj.answeredAt === "number" ? obj.answeredAt : 0,
    };
  } catch {
    return null;
  }
}

// 「今日の記録」(自由記述の journal)と同じ考え方で、reflection.daily.<date> という
// キーで設定テーブルに保存されているその日の振り返り回答を取り出す
export function reflectionEntriesFromSettings(settings: AppSetting[]): ReflectionEntry[] {
  const out: ReflectionEntry[] = [];
  for (const s of settings) {
    if (!s.key.startsWith(REFLECTION_KEY_PREFIX)) continue;
    const parsed = parseReflection(s.value);
    if (!parsed) continue;
    out.push({ date: s.key.slice(REFLECTION_KEY_PREFIX.length), reflection: parsed });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
