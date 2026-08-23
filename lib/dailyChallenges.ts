import type { DailyTask } from "./types";

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

interface ChallengeTemplate {
  id: string;
  icon: string;
  title: string;
  description: string;
  target: number;
  unit?: "count" | "seconds"; // 省略時は"count"
  compute: (ctx: DailyChallengeContext) => number;
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
    compute: (ctx) => new Set(doneTasks(ctx).map((t) => t.category)).size,
  },
  {
    id: "on-time",
    icon: "⏳",
    title: "予定内クリア",
    description: "予定時間内に3件完了する",
    target: 3,
    compute: (ctx) =>
      doneTasks(ctx).filter((t) => t.estimatedSeconds > 0 && t.accumulatedMs / 1000 <= t.estimatedSeconds).length,
  },
  {
    id: "take-breaks",
    icon: "☕",
    title: "休憩上手",
    description: "作業の合間に2回休憩をはさむ",
    target: 2,
    compute: (ctx) => ctx.tasks.reduce((sum, t) => sum + Math.max(0, t.segments.length - 1), 0),
  },
  {
    id: "early-bird",
    icon: "🌅",
    title: "早起き",
    description: "9時より前に最初の作業を始める",
    target: 1,
    compute: (ctx) => {
      const starts = ctx.tasks.filter((t) => t.startedAt !== undefined).map((t) => t.startedAt!);
      if (starts.length === 0) return 0;
      return new Date(Math.min(...starts)).getHours() < 9 ? 1 : 0;
    },
  },
  {
    id: "solid-hours",
    icon: "💪",
    title: "がっつり",
    description: "合計2時間以上の作業を記録する",
    target: 7200,
    unit: "seconds",
    compute: (ctx) => ctx.tasks.reduce((sum, t) => sum + t.accumulatedMs / 1000, 0),
  },
  {
    id: "journal",
    icon: "📝",
    title: "記録魔",
    description: "今日の記録に一言書く",
    target: 1,
    compute: (ctx) => (ctx.journalNonEmpty ? 1 : 0),
  },
  {
    id: "todo-or-project",
    icon: "✅",
    title: "有終の美",
    description: "ToDoまたは案件を1件完了する",
    target: 1,
    compute: (ctx) => ctx.todoCompletedToday + ctx.projectCompletedToday,
  },
  {
    id: "speed-run",
    icon: "⚡",
    title: "速攻クリア",
    description: "30分以内に完了する作業が1件ある",
    target: 1,
    compute: (ctx) => doneTasks(ctx).filter((t) => t.accumulatedMs > 0 && t.accumulatedMs <= 30 * 60000).length,
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

export function computeDailyChallenges(dateStr: string, ctx: DailyChallengeContext): ChallengeResult[] {
  return pickDailyChallengeTemplates(dateStr).map((t) => {
    const progress = Math.min(t.target, Math.max(0, t.compute(ctx)));
    return {
      id: t.id,
      icon: t.icon,
      title: t.title,
      description: t.description,
      progress,
      target: t.target,
      unit: t.unit ?? "count",
      done: progress >= t.target,
    };
  });
}
