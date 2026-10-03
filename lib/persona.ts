import { daysBetweenDateStrs, shiftDateStr } from "./time";
import type { Client, MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// ペルソナ風モードの中身。見た目だけのモードだったので、原作の軸
// (期日までの日めくり・予告状・5つの人間パラメータ・仲間との絆)を実データに当てはめる

export interface CallingCard {
  kind: "project" | "todo";
  id: string;
  title: string;
  dueDate: string;
  daysLeft: number;
}

/** 予告状: 7日以内に期日が来る(過ぎたものを含む)案件・ToDoのうち、いちばん差し迫ったもの */
export function pickCallingCard(projects: ProjectItem[], todos: TodoTask[], today: string): CallingCard | null {
  const limit = shiftDateStr(today, 7);
  const cands: CallingCard[] = [];
  for (const p of projects) {
    if (p.completedAt || !p.dueDate || p.dueDate > limit) continue;
    cands.push({ kind: "project", id: p.id, title: p.title, dueDate: p.dueDate, daysLeft: daysBetweenDateStrs(today, p.dueDate) });
  }
  for (const t of todos) {
    if (t.completed || t.parentTaskId || !t.dueDate || t.dueDate > limit) continue;
    cands.push({ kind: "todo", id: t.id, title: t.title, dueDate: t.dueDate, daysLeft: daysBetweenDateStrs(today, t.dueDate) });
  }
  // 案件を優先し、そのうえで期日の近い順
  cands.sort((a, b) => a.daysLeft - b.daysLeft || (a.kind === b.kind ? 0 : a.kind === "project" ? -1 : 1));
  return cands[0] ?? null;
}

export const STATS = [
  { key: "knowledge", label: "知識", words: ["学", "勉強", "調査", "調べ", "資料", "読", "研究", "分析", "資格", "レポート"] },
  { key: "guts", label: "度胸", words: ["トラブル", "交渉", "電話", "営業", "発表", "会議", "打ち合わせ", "面談", "クレーム"] },
  { key: "proficiency", label: "器用さ", words: ["制作", "実装", "作成", "設計", "修理", "料理", "DIY", "工作", "入力", "作業"] },
  { key: "kindness", label: "優しさ", words: ["家事", "家族", "育児", "手伝", "サポート", "介護", "掃除", "洗濯", "子", "相談"] },
  { key: "charm", label: "魅力", words: ["運動", "身支度", "美容", "趣味", "散歩", "筋トレ", "ジム", "ランニング", "ゲーム", "休"] },
] as const;

export type StatKey = (typeof STATS)[number]["key"];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** 作業の分類と名前の言葉から、どのパラメータを伸ばす作業かを決める。当てはまらなければ分類名から決まった1つに振る */
export function statOf(category: string, name: string): StatKey {
  const text = `${category} ${name}`;
  for (const s of STATS) if (s.words.some((w) => text.includes(w))) return s.key;
  return STATS[hash(category) % STATS.length].key;
}

/** ランク1〜5に上がる時間(時間)。直近90日の合計で決める */
const RANK_HOURS = [0, 5, 15, 40, 80];

export interface StatValue {
  key: StatKey;
  label: string;
  hours: number;
  rank: number;
  /** 次のランクまでの割合(0〜1)。最高ランクなら1 */
  toNext: number;
}

export function buildStats(records: WorkRecord[], today: string): StatValue[] {
  const since = shiftDateStr(today, -90);
  const sec = new Map<StatKey, number>();
  for (const r of records) {
    if (r.excludedFromStats || r.date < since || r.date > today) continue;
    const k = statOf(r.category, r.name);
    sec.set(k, (sec.get(k) ?? 0) + r.seconds);
  }
  return STATS.map((s) => {
    const hours = (sec.get(s.key) ?? 0) / 3600;
    let rank = 1;
    for (let i = 1; i < RANK_HOURS.length; i++) if (hours >= RANK_HOURS[i]) rank = i + 1;
    const lo = RANK_HOURS[rank - 1];
    const hi = RANK_HOURS[rank];
    return { key: s.key, label: s.label, hours, rank, toNext: hi === undefined ? 1 : (hours - lo) / (hi - lo) };
  });
}

export interface Bond {
  clientId: string;
  name: string;
  hours: number;
  rank: number; // 1〜10
}

/** 絆: 取引先ごとに、これまで充てた時間で1〜10のランク(作業マスタか案件の取引先から数える) */
export function buildBonds(records: WorkRecord[], masters: MasterTask[], projects: ProjectItem[], clients: Client[]): Bond[] {
  const masterClient = new Map(masters.filter((m) => m.clientId).map((m) => [m.id, m.clientId!]));
  const projectClient = new Map(projects.filter((p) => p.clientId).map((p) => [p.id, p.clientId!]));
  const sec = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const cid = (r.projectId && projectClient.get(r.projectId)) || (r.masterTaskId && masterClient.get(r.masterTaskId));
    if (!cid) continue;
    sec.set(cid, (sec.get(cid) ?? 0) + r.seconds);
  }
  return clients
    .map((c) => {
      const hours = (sec.get(c.id) ?? 0) / 3600;
      // 1時間・3時間・6時間…と、ランクが上がるほど次までが長くなる
      const rank = Math.min(10, 1 + Math.floor(Math.sqrt(hours / 0.5)));
      return { clientId: c.id, name: c.name, hours, rank };
    })
    .filter((b) => b.hours > 0)
    .sort((a, b) => b.hours - a.hours);
}
