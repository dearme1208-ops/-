import { computeProjectProgress } from "./projectStage";
import { shiftDateStr, todayStr } from "./time";
import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// Claudeモードの「記憶」。本家のClaudeが会話をまたいで覚えている事柄を見せ、
// 何を覚えておくかを利用者が決められるのと同じ考え方で、記録から読み取れる働き方の傾向を
// 短い文にして並べる。気づき(lib/claudeThinking.ts)が「今、手を打つべきこと」なのに対し、
// 記憶は「あなたについて分かっていること」。間違っていれば「忘れる」で消せ、
// 記録からは分からないこと(「午後は電話が多い」など)は自分で書き足せる。
// 覚えている内容は、本物のClaudeに相談する時の引き継ぎ文にもそのまま入る

export interface Memory {
  id: string;
  text: string;
  /** 何から読み取ったか(件数など) */
  basis: string;
}

export interface MemoryNote {
  id: string;
  text: string;
  createdAt: number;
}

const WINDOW_DAYS = 60;
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
const BANDS = [
  { key: "early", label: "早朝（5〜9時）", from: 5, to: 9 },
  { key: "morning", label: "午前（9〜12時）", from: 9, to: 12 },
  { key: "afternoon", label: "午後（12〜16時）", from: 12, to: 16 },
  { key: "evening", label: "夕方（16〜19時）", from: 16, to: 19 },
  { key: "night", label: "夜（19時以降）", from: 19, to: 29 },
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function durationText(sec: number): string {
  const min = Math.max(5, Math.round(sec / 60 / 5) * 5);
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

export function deriveMemories(records: WorkRecord[], todos: TodoTask[], today: string): Memory[] {
  const since = shiftDateStr(today, -WINDOW_DAYS);
  const recent = records.filter((r) => !r.excludedFromStats && r.date > since && r.date <= today && r.seconds > 0);
  const out: Memory[] = [];

  // 取りかかる時間帯
  const sizable = recent.filter((r) => r.seconds >= 15 * 60);
  if (sizable.length >= 10) {
    const counts = BANDS.map((b) => {
      const n = sizable.filter((r) => {
        const h = new Date(r.startedAt).getHours();
        const hh = h < 5 ? h + 24 : h;
        return hh >= b.from && hh < b.to;
      }).length;
      return { band: b, n };
    }).sort((a, b) => b.n - a.n);
    const share = counts[0].n / sizable.length;
    if (share >= 0.35) {
      out.push({
        id: `rhythm:${counts[0].band.key}`,
        text: `${counts[0].band.label}に取りかかる作業がいちばん多い`,
        basis: `15分以上の作業${sizable.length}件のうち${Math.round(share * 100)}%`,
      });
    }
  }

  // よくやる作業の、いつもの所要時間(上位3件)
  const byWork = new Map<string, { label: string; secs: number[] }>();
  for (const r of recent) {
    const key = r.masterTaskId ?? `${r.category}/${r.name}`;
    const g = byWork.get(key) ?? { label: `${r.category} / ${r.name}`, secs: [] };
    g.secs.push(r.seconds);
    byWork.set(key, g);
  }
  [...byWork.entries()]
    .filter(([, g]) => g.secs.length >= 4)
    .sort((a, b) => b[1].secs.length - a[1].secs.length)
    .slice(0, 3)
    .forEach(([key, g]) => {
      out.push({
        id: `dur:${key}`,
        text: `「${g.label}」は、たいてい${durationText(median(g.secs))}ほどかかる`,
        basis: `直近${g.secs.length}回の中央値`,
      });
    });

  // 期限を過ぎてから終わりやすい分類
  const byCat = new Map<string, { total: number; late: number }>();
  for (const t of todos) {
    if (!t.completed || !t.completedAt || !t.dueDate || t.parentTaskId) continue;
    const cat = (t.category ?? "").trim();
    if (!cat) continue;
    const g = byCat.get(cat) ?? { total: 0, late: 0 };
    g.total++;
    if (todayStr(new Date(t.completedAt)) > t.dueDate) g.late++;
    byCat.set(cat, g);
  }
  for (const [cat, g] of byCat) {
    if (g.total >= 4 && g.late / g.total >= 0.5) {
      out.push({ id: `late:${cat}`, text: `@${cat} の仕事は、期限を過ぎてから終わることが多い`, basis: `期限付き${g.total}件のうち${g.late}件` });
    }
  }

  // 1日の作業量と、よく働く曜日
  const byDay = new Map<string, number>();
  for (const r of recent) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.seconds);
  if (byDay.size >= 5) {
    out.push({
      id: "daily",
      text: `記録のある日は、1日におよそ${durationText(median([...byDay.values()]))}取り組んでいる`,
      basis: `${byDay.size}日分の中央値`,
    });
    const perWeekday = WEEKDAY.map(() => [] as number[]);
    for (const [date, sec] of byDay) {
      const [y, m, d] = date.split("-").map(Number);
      perWeekday[new Date(y, m - 1, d).getDay()].push(sec);
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const overall = avg([...byDay.values()]);
    const top = perWeekday
      .map((xs, wd) => ({ wd, n: xs.length, a: xs.length ? avg(xs) : 0 }))
      .filter((x) => x.n >= 3)
      .sort((a, b) => b.a - a.a)[0];
    if (top && top.a >= overall * 1.25) {
      out.push({
        id: `weekday:${top.wd}`,
        text: `${WEEKDAY[top.wd]}曜日に、ほかの日より多く作業している`,
        basis: `${WEEKDAY[top.wd]}曜の平均${durationText(top.a)}・全体の平均${durationText(overall)}`,
      });
    }
  }
  return out;
}

export function parseNotes(json: string): MemoryNote[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((n) => n && typeof n.text === "string" && typeof n.id === "string") : [];
  } catch {
    return [];
  }
}

export function parseForgotten(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * 本物のClaudeに相談する時に、最初に貼る引き継ぎ文。覚えていること・自分で書いたこと・
 * 今の状況(計測中・期限の近いタスク・進行中の案件)を短くまとめる
 */
export function buildHandoff({
  today,
  memories,
  notes,
  running,
  todos,
  projects,
}: {
  today: string;
  memories: Memory[];
  notes: MemoryNote[];
  running: DailyTask | null;
  todos: TodoTask[];
  projects: ProjectItem[];
}): string {
  const lines: string[] = [];
  lines.push(`# 工程表アプリからの引き継ぎ（${today}）`);
  lines.push("");
  lines.push("時間の記録とタスク管理に使っているアプリの内容です。これを前提に相談に乗ってください。");
  lines.push("");
  if (memories.length) {
    lines.push("## 記録から分かっている私の働き方");
    for (const m of memories) lines.push(`- ${m.text}（${m.basis}）`);
    lines.push("");
  }
  if (notes.length) {
    lines.push("## 私が書き残したこと");
    for (const n of notes) lines.push(`- ${n.text}`);
    lines.push("");
  }
  lines.push("## 今の状況");
  if (running) lines.push(`- 計測中: ${running.category} / ${running.name}`);
  const soon = todos
    .filter((t) => !t.completed && !t.parentTaskId && t.dueDate && t.dueDate <= shiftDateStr(today, 3))
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  for (const t of soon) {
    const late = t.dueDate! < today;
    lines.push(`- タスク: ${t.title}（期限 ${t.dueDate}${late ? "・期限切れ" : ""}${t.category ? `・@${t.category}` : ""}）`);
  }
  const open = todos.filter((t) => !t.completed && !t.parentTaskId).length;
  lines.push(`- 未完了のタスク: 全${open}件`);
  for (const p of projects.filter((p) => !p.completedAt)) {
    const prog = computeProjectProgress(p.stages);
    lines.push(`- 案件: ${p.title}（期日 ${p.dueDate}${prog !== null ? `・進捗 ${Math.round(prog * 100)}%` : ""}）`);
  }
  return lines.join("\n");
}
