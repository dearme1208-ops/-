import type { DailyTask, TodoTask } from "./types";
import type { KaiiEntry } from "./hayarigami";

// 元ネタの2大システム「キーワード収集」と「推理ロジック」を、実データの上に載せたもの。
//
// ・キーワード: 本文中に色付きで現れる語。タップすると手帳に集まる
//   (原作でも本文中の使用可能なキーワードは色を変えて示される)
// ・推理ロジック: 章の最後に、集めたキーワードを空欄へ当てはめて事件の全容を組み立てる。
//   正解に近いほどランクが上がる(原作はS〜Dの5段階)
//
// 重要なのは、ここでの「正解」が演出のための作り話ではなく、その日の実績から
// 一意に決まる事実だという点。つまりこの推理パートは、自分の一日を正しく把握できて
// いるかを問う振り返りそのものになっている。

export interface KeywordDef {
  id: string;
  label: string; // 本文中に現れる語そのもの。この文字列で本文を照合する
}

// キーワードの語そのもの。本文(hayarigamiWords)も必ずこの関数を通して書くので、
// 「本文に出ていない語が手帳に並ぶ」「本文に出ているのに拾えない」といった食い違いが起きない。
// 文言オフのときは工程表の言い回しに合わせて語ごと差し替える
export interface KeywordWords {
  overrun: (n: number) => string;
  trouble: string;
  pending: (n: number) => string;
  paused: (n: number) => string;
  overdue: (n: number) => string;
  erosion: (n: number) => string;
  streak: (n: number) => string;
}

export const KW_THEMED: KeywordWords = {
  overrun: (n) => `想定超過${n}件`,
  trouble: "トラブル対応",
  pending: (n) => `未着手${n}件`,
  paused: (n) => `中断${n}件`,
  overdue: (n) => `期限切れ${n}件`,
  erosion: (n) => `侵蝕度${n}%`,
  streak: (n) => `調査継続${n}日`,
};

export const KW_PLAIN: KeywordWords = {
  overrun: (n) => `想定超過${n}件`,
  trouble: "トラブル対応",
  pending: (n) => `未着手${n}件`,
  paused: (n) => `一時停止${n}件`,
  overdue: (n) => `期限切れ${n}件`,
  erosion: (n) => `超過率${n}%`,
  streak: (n) => `連続${n}日`,
};

export function keywordWordsFor(wordingEnabled: boolean): KeywordWords {
  return wordingEnabled ? KW_THEMED : KW_PLAIN;
}

export interface DayFacts {
  tasks: DailyTask[];
  openTodos: TodoTask[];
  overdueTodos: TodoTask[];
  kaiiIndex: KaiiEntry[];
  erosion: number;
  streakDays: number;
  phaseLabel: string;
  elapsedSecondsOf: (t: DailyTask) => number;
  kw: KeywordWords;
}

// その日の実績から、拾えるキーワードを組み立てる。
// 本文に実際に登場しうる語だけを返す(登場しない語は集めようがないため)
export function buildKeywords(f: DayFacts): KeywordDef[] {
  const out: KeywordDef[] = [];
  const push = (id: string, label: string) => {
    if (label && !out.some((k) => k.label === label)) out.push({ id, label });
  };

  const longest = longestTask(f);
  if (longest) push("longest", longest.name);

  const overrun = f.tasks.filter((t) => t.estimatedSeconds > 0 && f.elapsedSecondsOf(t) > t.estimatedSeconds);
  if (overrun.length > 0) push("overrun", f.kw.overrun(overrun.length));

  const troubles = f.tasks.filter((t) => t.isTrouble);
  if (troubles.length > 0) push("trouble", f.kw.trouble);

  const pending = f.tasks.filter((t) => t.status === "pending" && !t.isProvisional);
  if (pending.length > 0) push("pending", f.kw.pending(pending.length));

  const paused = f.tasks.filter((t) => t.status === "paused");
  if (paused.length > 0) push("paused", f.kw.paused(paused.length));

  if (f.overdueTodos.length > 0) push("overdue", f.kw.overdue(f.overdueTodos.length));
  if (f.erosion > 0) push("erosion", f.kw.erosion(f.erosion));
  push("phase", f.phaseLabel);
  if (f.streakDays > 0) push("streak", f.kw.streak(f.streakDays));

  const worst = f.kaiiIndex[0];
  if (worst) push("worst", worst.displayName);

  return out;
}

function longestTask(f: DayFacts): DailyTask | null {
  let best: DailyTask | null = null;
  let bestSec = -1;
  for (const t of f.tasks) {
    const s = f.elapsedSecondsOf(t);
    if (s > bestSec) {
      bestSec = s;
      best = t;
    }
  }
  return bestSec > 0 ? best : null;
}

// ---- 推理ロジック ----

export interface LogicSlot {
  id: string;
  question: string; // 空欄の前に置く問い
  answerId: string; // 正解のキーワードid
}

export interface LogicPuzzle {
  slots: LogicSlot[];
  candidates: KeywordDef[]; // 選択肢(集めたキーワード)
}

export type Rank = "S" | "A" | "B" | "C" | "D";

// 本日の事実から空欄と正解を組み立てる。空欄は「今日を正しく把握していれば埋められる」ものだけ
export function buildLogicPuzzle(f: DayFacts, collected: KeywordDef[]): LogicPuzzle {
  const slots: LogicSlot[] = [];
  const has = (id: string) => collected.some((k) => k.id === id);

  if (has("longest")) {
    slots.push({ id: "s1", question: "本日、最も時間を要した事案は", answerId: "longest" });
  }
  // 超過の主因は、トラブル対応が記録されていればそれ、無ければ超過件数そのもの
  if (has("trouble")) {
    slots.push({ id: "s2", question: "その時間を押し上げた要因は", answerId: "trouble" });
  } else if (has("overrun")) {
    slots.push({ id: "s2", question: "その時間を押し上げた要因は", answerId: "overrun" });
  }
  if (has("erosion")) {
    slots.push({ id: "s3", question: "本日、想定からはみ出した割合は", answerId: "erosion" });
  }
  if (has("overdue")) {
    slots.push({ id: "s4", question: "いま最も放置されているのは", answerId: "overdue" });
  } else if (has("pending")) {
    slots.push({ id: "s4", question: "本日、手つかずで残ったのは", answerId: "pending" });
  }

  return { slots, candidates: collected };
}

// 原作のS〜Dに倣った評価。全問正解でS、以降は正答率で下げる
export function judgeRank(correct: number, total: number): { rank: Rank; score: number } {
  if (total === 0) return { rank: "D", score: 0 };
  const score = Math.round((correct / total) * 100);
  if (score === 100) return { rank: "S", score };
  if (score >= 96) return { rank: "A", score };
  if (score >= 86) return { rank: "B", score };
  if (score > 0) return { rank: "C", score };
  return { rank: "D", score };
}

export const RANK_COMMENT: Record<Rank, string> = {
  S: "完璧だ。今日の事件は、隅々まで把握できている。",
  A: "ほぼ掴んでいる。細部に一つ、見落としがある。",
  B: "おおむね合っている。だが、まだ像が結びきっていない。",
  C: "食い違いが多い。この事件を、まだ理解できていない。",
  D: "手がかりが足りない。まずはキーワードを集めることだ。",
};

export const RANK_COMMENT_PLAIN: Record<Rank, string> = {
  S: "全問正解です。本日の状況を正確に把握できています。",
  A: "ほぼ正解です。1つだけ取り違えがあります。",
  B: "おおむね正解です。いくつか取り違えがあります。",
  C: "取り違えが多く見られます。記録を見直してみてください。",
  D: "回答できる材料が足りません。まずはキーワードを集めてください。",
};

// ---- 保存(その日限りの手帳) ----

export function keywordStorageKey(date: string): string {
  return `hayarigami.keywords.${date}`;
}

export function parseCollected(raw: string, all: KeywordDef[]): KeywordDef[] {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    ids = [];
  }
  return all.filter((k) => ids.includes(k.id));
}

// 本文をキーワードで分割する。UI側はこの結果をそのまま並べて描くだけでよい
export interface NarrationPart {
  text: string;
  keyword?: KeywordDef;
}

export function splitNarration(text: string, keywords: KeywordDef[]): NarrationPart[] {
  if (keywords.length === 0) return [{ text }];
  // 長い語から順に照合し、短い語が長い語の内側で先に当たるのを防ぐ
  const sorted = [...keywords].sort((a, b) => b.label.length - a.label.length);
  const parts: NarrationPart[] = [];
  let rest = text;
  let guard = 0;
  while (rest.length > 0 && guard++ < 200) {
    let hitAt = -1;
    let hit: KeywordDef | null = null;
    for (const k of sorted) {
      const at = rest.indexOf(k.label);
      if (at >= 0 && (hitAt < 0 || at < hitAt)) {
        hitAt = at;
        hit = k;
      }
    }
    if (!hit || hitAt < 0) {
      parts.push({ text: rest });
      break;
    }
    if (hitAt > 0) parts.push({ text: rest.slice(0, hitAt) });
    parts.push({ text: hit.label, keyword: hit });
    rest = rest.slice(hitAt + hit.label.length);
  }
  return parts;
}
