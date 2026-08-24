import { shiftDateStr } from "./time";
import type { DailyTask, WorkRecord } from "./types";

// デイリーチャレンジの入力データ。呼び出し側(useDailyChallenges)が
// その日のdailyTasks/todo完了数/案件完了数/日記の有無だけを集めて渡す。
// 判定ロジック自体はUIから独立させてあるので、他の演出テーマ画面からも使い回せる
export interface DailyChallengeContext {
  tasks: DailyTask[]; // 本日のdailyTasks(仮計測含む全件)
  todoCompletedToday: number;
  projectCompletedToday: number;
  journalNonEmpty: boolean;
}

export interface ChallengeResult {
  id: string;
  icon: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unit: "count" | "seconds";
  done: boolean;
}

// 過去の傾向(直近TREND_WINDOW_DAYS日の実績)から算出した、その人にとっての「普段」の量。
// dayCountがMIN_TREND_DAYS未満の場合は傾向を信頼せず、テンプレートの固定目標値にフォールバックする
export interface PersonalTrend {
  dayCount: number;
  avgCategoriesPerDay: number;
  avgBreaksPerDay: number;
  avgTotalSecondsPerDay: number;
  avgFirstStartHour: number;
}

export const TREND_WINDOW_DAYS = 30;
export const MIN_TREND_DAYS = 10; // これ未満の日数しか記録が無い間は、まだ傾向を信頼せず固定の目標値を使う

// dateStr(その日)を基準に、傾向算出に使う範囲 [start, end) を返す。前日までの
// TREND_WINDOW_DAYS日分を見る(当日はまだ進行中で不完全なため含めない)
export function trendWindowRange(dateStr: string): { start: string; end: string } {
  return { start: shiftDateStr(dateStr, -TREND_WINDOW_DAYS), end: dateStr };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function formatHoursMinutesJp(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

export function computePersonalTrend(records: WorkRecord[], dateStr: string): PersonalTrend {
  const { start, end } = trendWindowRange(dateStr);
  const inWindow = records.filter((r) => !r.excludedFromStats && r.date >= start && r.date < end);

  const byDate = new Map<string, WorkRecord[]>();
  for (const r of inWindow) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const dayCount = byDate.size;
  if (dayCount === 0) {
    return { dayCount: 0, avgCategoriesPerDay: 0, avgBreaksPerDay: 0, avgTotalSecondsPerDay: 0, avgFirstStartHour: 9 };
  }

  let categoriesSum = 0;
  let breaksSum = 0;
  let secondsSum = 0;
  let firstStartHourSum = 0;
  for (const recs of byDate.values()) {
    categoriesSum += new Set(recs.map((r) => r.category)).size;
    breaksSum += recs.reduce((s, r) => s + Math.max(0, (r.segments?.length ?? 1) - 1), 0);
    secondsSum += recs.reduce((s, r) => s + r.seconds, 0);
    const minStart = Math.min(...recs.map((r) => r.startedAt));
    const d = new Date(minStart);
    firstStartHourSum += d.getHours() + d.getMinutes() / 60;
  }

  return {
    dayCount,
    avgCategoriesPerDay: categoriesSum / dayCount,
    avgBreaksPerDay: breaksSum / dayCount,
    avgTotalSecondsPerDay: secondsSum / dayCount,
    avgFirstStartHour: firstStartHourSum / dayCount,
  };
}

interface ChallengeTemplate {
  id: string;
  icon: string;
  title: string;
  description: string; // 固定目標値(傾向データが無い/不十分な場合に使う)での説明文
  target: number;
  unit?: "count" | "seconds"; // 省略時は"count"
  compute: (ctx: DailyChallengeContext, param: number) => number;
  param: number; // compute内で使う基準値(早起きの基準時刻など)。傾向データが無ければこの既定値を使う
  // 過去の傾向から、その人にとって「普段より一歩だけ頑張る」目標値・説明文・paramを組み立てる。
  // 対象外のテンプレート(記録魔・有終の美・速攻クリアなど傾向で伸縮させにくいもの)は省略している
  adaptive?: (trend: PersonalTrend) => { target: number; param: number; description: string };
}

function doneTasks(ctx: DailyChallengeContext): DailyTask[] {
  return ctx.tasks.filter((t) => t.status === "done" && !t.isProvisional);
}

// 8種類のテンプレートから毎日3件を選ぶ。幅(カテゴリ横断)・質(予定内)・
// 行動(休憩)・時間帯(早起き)・量(合計時間)・振り返り(日記)・横断機能(ToDo/案件)・
// スピードと、種類が偏らないよう意識して選定している
const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  {
    id: "cross-category",
    icon: "🎯",
    title: "カテゴリ横断",
    description: "3つ以上のカテゴリの作業を完了する",
    target: 3,
    param: 0,
    compute: (ctx) => new Set(doneTasks(ctx).map((t) => t.category)).size,
    adaptive: (trend) => {
      const target = clamp(Math.round(trend.avgCategoriesPerDay) + 1, 2, 6);
      return { target, param: 0, description: `${target}つ以上のカテゴリの作業を完了する` };
    },
  },
  {
    id: "on-time",
    icon: "⏳",
    title: "予定内クリア",
    description: "予定時間内に3件完了する",
    target: 3,
    param: 0,
    compute: (ctx) =>
      doneTasks(ctx).filter((t) => t.estimatedSeconds > 0 && t.accumulatedMs / 1000 <= t.estimatedSeconds).length,
  },
  {
    id: "take-breaks",
    icon: "☕",
    title: "休憩上手",
    description: "作業の合間に2回休憩をはさむ",
    target: 2,
    param: 0,
    compute: (ctx) => ctx.tasks.reduce((sum, t) => sum + Math.max(0, t.segments.length - 1), 0),
    adaptive: (trend) => {
      const target = clamp(Math.round(trend.avgBreaksPerDay) + 1, 1, 5);
      return { target, param: 0, description: `作業の合間に${target}回休憩をはさむ` };
    },
  },
  {
    id: "early-bird",
    icon: "🌅",
    title: "早起き",
    description: "9時より前に最初の作業を始める",
    target: 1,
    param: 9,
    compute: (ctx, param) => {
      const starts = ctx.tasks.filter((t) => t.startedAt !== undefined).map((t) => t.startedAt!);
      if (starts.length === 0) return 0;
      const d = new Date(Math.min(...starts));
      return d.getHours() + d.getMinutes() / 60 < param ? 1 : 0;
    },
    adaptive: (trend) => {
      // 普段の最初の開始時刻より30分早いところをストレッチ目標にする
      const thresholdHour = clamp(trend.avgFirstStartHour - 0.5, 6, 10);
      const hh = Math.floor(thresholdHour);
      const mm = Math.round((thresholdHour - hh) * 60);
      const label = `${hh}:${String(mm).padStart(2, "0")}`;
      return { target: 1, param: thresholdHour, description: `${label}より前に最初の作業を始める` };
    },
  },
  {
    id: "solid-hours",
    icon: "💪",
    title: "がっつり",
    description: "合計2時間以上の作業を記録する",
    target: 7200,
    unit: "seconds",
    param: 0,
    compute: (ctx) => ctx.tasks.reduce((sum, t) => sum + t.accumulatedMs / 1000, 0),
    adaptive: (trend) => {
      // 平均の1.1倍程度を、15分刻みのきりのいい値に丸めてストレッチ目標にする
      const raw = trend.avgTotalSecondsPerDay * 1.1;
      const target = clamp(Math.round(raw / 900) * 900, 1800, 6 * 3600);
      return { target, param: 0, description: `合計${formatHoursMinutesJp(target)}以上の作業を記録する` };
    },
  },
  {
    id: "journal",
    icon: "📝",
    title: "記録魔",
    description: "今日の記録に一言書く",
    target: 1,
    param: 0,
    compute: (ctx) => (ctx.journalNonEmpty ? 1 : 0),
  },
  {
    id: "todo-or-project",
    icon: "✅",
    title: "有終の美",
    description: "ToDoまたは案件を1件完了する",
    target: 1,
    param: 0,
    compute: (ctx) => ctx.todoCompletedToday + ctx.projectCompletedToday,
  },
  {
    id: "speed-run",
    icon: "⚡",
    title: "速攻クリア",
    description: "30分以内に完了する作業が1件ある",
    target: 1,
    param: 30 * 60000,
    compute: (ctx, param) => doneTasks(ctx).filter((t) => t.accumulatedMs > 0 && t.accumulatedMs <= param).length,
  },
];

// 日付文字列だけを種にした決定的な乱数(mulberry32)。同じ日は何度リロードしても
// 同じ3件が選ばれ、日付が変われば別の組み合わせになる
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDailyChallengeTemplates(dateStr: string, count = 3): ChallengeTemplate[] {
  const rng = mulberry32(hashString(dateStr));
  const pool = [...CHALLENGE_TEMPLATES];
  const picked: ChallengeTemplate[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

// recordsを渡すと、直近の実績から算出した傾向をもとに目標値を調整する(データが
// MIN_TREND_DAYS日分に満たない間は、これまで通り固定の目標値のまま)。recordsを
// 省略した場合は常に固定の目標値になる(呼び出し側を段階的に移行できるようにするため)
export function computeDailyChallenges(dateStr: string, ctx: DailyChallengeContext, records?: WorkRecord[]): ChallengeResult[] {
  const trend = records ? computePersonalTrend(records, dateStr) : null;
  const trendReliable = !!trend && trend.dayCount >= MIN_TREND_DAYS;

  return pickDailyChallengeTemplates(dateStr).map((t) => {
    const resolved =
      trendReliable && t.adaptive
        ? t.adaptive(trend!)
        : { target: t.target, param: t.param, description: t.description };
    const progress = Math.min(resolved.target, Math.max(0, t.compute(ctx, resolved.param)));
    return {
      id: t.id,
      icon: t.icon,
      title: t.title,
      description: resolved.description,
      progress,
      target: resolved.target,
      unit: t.unit ?? "count",
      done: progress >= resolved.target,
    };
  });
}
