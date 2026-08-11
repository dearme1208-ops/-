import { CONDITION_LEVELS } from "./condition";
import { formatClock, formatHms } from "./time";
import type { ConditionLog, DailyTask } from "./types";

// 業務区分の文字列から、内容を推測してざっくり絵文字を割り当てる（完全一致ではなく
// キーワードによる簡易マッチ。当てはまらなければ既定の📌を返す）
const CATEGORY_EMOJI_RULES: [RegExp, string][] = [
  [/家事|掃除|洗濯|料理|片付|皿洗/, "🧹"],
  [/仕事|業務|会議|打ち合わせ|資料|営業|案件|開発/, "💼"],
  [/回復|休憩|睡眠|仮眠|休息/, "😴"],
  [/移動|通勤|外出/, "🚗"],
  [/買い物|購入/, "🛒"],
  [/勉強|学習|読書|研修/, "📚"],
  [/運動|筋トレ|ジム|散歩|スポーツ/, "🏃"],
  [/食事|外食|ご飯|昼食|夕食|朝食/, "🍽️"],
  [/子供|育児|保育|子育て/, "🧒"],
  [/通院|病院|診察|治療/, "🏥"],
  [/趣味|ゲーム|音楽|動画|映画/, "🎮"],
  [/トラブル/, "⚡"],
];

export function categoryEmoji(category: string): string {
  for (const [re, emoji] of CATEGORY_EMOJI_RULES) {
    if (re.test(category)) return emoji;
  }
  return "📌";
}

export type NarrativeItemType = "task" | "condition" | "gap";

export interface NarrativeItem {
  type: NarrativeItemType;
  at: number; // 並び替え・タイムライン上の位置に使う時刻
  icon: string;
  title: string;
  subtitle?: string;
}

// これ未満の空白は丸め誤差等のノイズとみなし「空白」としては表示しない
const MIN_GAP_MS = 60_000;

// その日の作業区間・体調記録・空白(未計測)区間を時系列に並べ、タイムライン表示用の
// 構造化データにする
export function computeTodayNarrative(tasks: DailyTask[], conditionLogs: ConditionLog[], now: number): NarrativeItem[] {
  const items: NarrativeItem[] = [];
  const segments: { start: number; end: number; ongoing: boolean; task: DailyTask }[] = [];

  for (const t of tasks) {
    if (t.isProvisional) continue;
    for (const seg of t.segments) {
      segments.push({ start: seg.start, end: seg.end ?? now, ongoing: seg.end === undefined, task: t });
    }
  }
  segments.sort((a, b) => a.start - b.start);

  for (const seg of segments) {
    const endLabel = seg.ongoing ? "計測中" : formatClock(seg.end);
    const durationSec = Math.round((seg.end - seg.start) / 1000);
    items.push({
      type: "task",
      at: seg.start,
      icon: categoryEmoji(seg.task.category),
      title: `${seg.task.category} / ${seg.task.name}`,
      subtitle: `${formatClock(seg.start)}〜${endLabel}（${formatHms(durationSec)}）`,
    });
  }

  // 隣り合うセグメントの間で何も記録していない時間帯を「空白」として表示する
  for (let i = 1; i < segments.length; i++) {
    const gapStart = segments[i - 1].end;
    const gapEnd = segments[i].start;
    if (gapEnd - gapStart >= MIN_GAP_MS) {
      items.push({
        type: "gap",
        at: gapStart,
        icon: "⏳",
        title: "空白（未計測）",
        subtitle: `${formatClock(gapStart)}〜${formatClock(gapEnd)}（${formatHms(Math.round((gapEnd - gapStart) / 1000))}）`,
      });
    }
  }

  for (const log of conditionLogs) {
    const label = CONDITION_LEVELS.find((c) => c.level === log.level)?.label ?? log.level;
    items.push({ type: "condition", at: log.loggedAt, icon: "💭", title: `体調が「${label}」に変化`, subtitle: formatClock(log.loggedAt) });
  }

  return items.sort((a, b) => a.at - b.at);
}

// あらすじの冒頭に添える一言サマリー文を生成する
export function computeTodaySummarySentence(tasks: DailyTask[], conditionLogs: ConditionLog[], now: number): string {
  const worked = tasks.filter((t) => !t.isProvisional && t.segments.length > 0);
  if (worked.length === 0) return "まだ今日の記録はありません。";

  const totalSeconds = worked.reduce(
    (sum, t) => sum + t.segments.reduce((s, seg) => s + ((seg.end ?? now) - seg.start), 0) / 1000,
    0
  );

  let conditionPart = "";
  if (conditionLogs.length > 0) {
    const counts = new Map<string, number>();
    for (const log of conditionLogs) counts.set(log.level, (counts.get(log.level) ?? 0) + 1);
    let bestLevel = conditionLogs[0].level;
    let bestCount = 0;
    for (const [level, c] of counts) {
      if (c > bestCount) {
        bestCount = c;
        bestLevel = level;
      }
    }
    const label = CONDITION_LEVELS.find((c) => c.level === bestLevel)?.label ?? bestLevel;
    conditionPart = `体調は主に「${label}」でした。`;
  }

  return `今日は${worked.length}件の作業、合計${formatHms(totalSeconds)}でした。${conditionPart}`;
}
