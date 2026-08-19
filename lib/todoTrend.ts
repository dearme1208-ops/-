import { endOfDay, endOfMonth, endOfWeek } from "date-fns";
import type { TodoTask } from "./types";
import { isoWeekKey, type TrendGranularity } from "./trend";
import { todayStr } from "./time";

const WINDOW_COUNT: Record<TrendGranularity, number> = { day: 14, week: 12, month: 12 };
export const TODO_TREND_MAX_TAGS = 5;
const UNSET_TAG_LABEL = "未設定";
const OTHER_TAG_LABEL = "その他";

// StackedComboChartのsegment.classNameに渡す固定の塗り分け。
// アクセント色(fill-alert)だけの濃淡だと隣り合う区分の区別がつきにくいため、
// テーマ基調色のfill-creamと交互に組み合わせて隣接区分の見分けやすさを確保する。
// どちらもテーマのCSS変数に追従する色なので、単一色相方針は崩さない。
// 動的な文字列結合ではなくリテラルの配列として書き、Tailwindのビルド時スキャンに拾わせる
export const TODO_TAG_SEGMENT_CLASSES = [
  "fill-alert/85",
  "fill-cream/65",
  "fill-alert/55",
  "fill-cream/40",
  "fill-alert/30",
  "fill-cream/18",
];

export interface TodoTrendTagCount {
  tag: string;
  count: number;
}

export interface TodoTrendPoint {
  key: string;
  label: string;
  totalOpen: number;
  // 表示対象タグ(件数上位MAX_TAGS件+その他)の順で、全ポイントで必ず同じ並びになる
  byTag: TodoTrendTagCount[];
}

// 指定時点で「まだ完了していなかった」トップレベルのToDoを返す(サブタスクは対象外、
// 一覧の件数バッジと同じ数え方に揃えている)。createdAt/completedAtは実際のタイムスタンプの
// ため、この開閉判定自体は過去に遡っても正確。一方、対応状況(tag)は現在の値をそのまま使うため、
// 過去時点で本当にそのタグだったとは限らない(タグの変更履歴は保持していない)。あくまで
// 「現在のタグ基準で見た、残タスク数の推移」という近似であることに注意
function openTasksAsOf(tasks: TodoTask[], asOfMs: number): TodoTask[] {
  return tasks.filter(
    (t) => !t.parentTaskId && t.createdAt <= asOfMs && (!t.completed || (t.completedAt ?? Infinity) > asOfMs)
  );
}

export function buildTodoTrend(tasks: TodoTask[], granularity: TrendGranularity, now: Date = new Date()): TodoTrendPoint[] {
  const windowCount = WINDOW_COUNT[granularity];

  // 直近時点(今)でのタグ別件数から表示する上位タグを固定する(全ポイントで同じタグ・同じ色順にするため)
  const latestOpen = openTasksAsOf(tasks, now.getTime());
  const latestCounts = new Map<string, number>();
  for (const t of latestOpen) {
    const tag = t.tag?.trim() || UNSET_TAG_LABEL;
    latestCounts.set(tag, (latestCounts.get(tag) ?? 0) + 1);
  }
  const sortedTags = [...latestCounts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  const shownTags = sortedTags.slice(0, TODO_TREND_MAX_TAGS);
  const hasOther = sortedTags.length > TODO_TREND_MAX_TAGS;
  const tagLabels = hasOther ? [...shownTags, OTHER_TAG_LABEL] : shownTags;

  function bucketFor(tag: string): string {
    return shownTags.includes(tag) ? tag : OTHER_TAG_LABEL;
  }

  const points: TodoTrendPoint[] = [];
  for (let i = windowCount - 1; i >= 0; i--) {
    let d: Date;
    let key: string;
    let label: string;
    let bucketEnd: Date;
    if (granularity === "day") {
      d = new Date(now);
      d.setDate(d.getDate() - i);
      key = todayStr(d);
      label = `${d.getMonth() + 1}/${d.getDate()}`;
      bucketEnd = endOfDay(d);
    } else if (granularity === "week") {
      d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      key = isoWeekKey(d);
      label = key.slice(6);
      bucketEnd = endOfWeek(d, { weekStartsOn: 1 });
    } else {
      d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = `${d.getMonth() + 1}月`;
      bucketEnd = endOfMonth(d);
    }
    // 直近バケット(今週・今月など)は期間の終わりが未来になるため、「今」を超えないようにする
    const asOfMs = Math.min(bucketEnd.getTime(), now.getTime());

    const open = openTasksAsOf(tasks, asOfMs);
    const counts = new Map<string, number>();
    for (const t of open) {
      const tag = t.tag?.trim() || UNSET_TAG_LABEL;
      const bucket = bucketFor(tag);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    points.push({
      key,
      label,
      totalOpen: open.length,
      byTag: tagLabels.map((tag) => ({ tag, count: counts.get(tag) ?? 0 })),
    });
  }
  return points;
}
