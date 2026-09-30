import { useMemo } from "react";
import { DEFAULT_WAITING_NUDGE_DAYS, DEFAULT_WAITING_TAGS } from "./changeTracking";
import { useSetting } from "./settings";
import { parseWaitingTags } from "./waiting";

// 「相手の返事待ち」とみなす対応状況と、催促の目安の日数(設定画面で変えられる)
export function useWaitingSettings(): { waitingTags: string[]; nudgeDays: number } {
  const [tagsJson] = useSetting("todo.waitingTags", JSON.stringify(DEFAULT_WAITING_TAGS));
  const [daysStr] = useSetting("todo.waitingNudgeDays", String(DEFAULT_WAITING_NUDGE_DAYS));
  const waitingTags = useMemo(() => parseWaitingTags(tagsJson, DEFAULT_WAITING_TAGS), [tagsJson]);
  const n = Number(daysStr);
  return { waitingTags, nudgeDays: Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_WAITING_NUDGE_DAYS };
}
