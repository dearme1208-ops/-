import type { DailyTask, MasterTask, WorkRecord } from "./types";

// 図書館モードの中身。
//
// これまでこのモードは配色とカードめくり演出だけで、画面の作りは通常と同じだった。
// ここでは「本日の作業」タブそのものを図書館の閲覧室に置き換える。
//
//   ・作業マスタ  = 蔵書。1冊ごとに請求記号と貸出履歴を持つ
//   ・本日の作業  = その本の貸出。想定時間が返却期限にあたる
//   ・実績        = 過去の貸出履歴。返却期限票に日付印として並ぶ
//   ・想定超過    = 延滞
//
// 他モードと同じく、ここに出る数値はすべて実データから決まる。
// 背表紙の厚みも、日付印の並びも、擦り切れ具合も、作った値ではない。

// ---- 請求記号 ----
// 実際の図書館の請求記号(分類記号 + 図書記号)にならい、
// カテゴリと作業名から決定的に組み立てる。同じ作業には必ず同じ記号がつく
const KANA_ROWS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ";

export function callNumberOf(category: string, name: string): string {
  let h = 2166136261 >>> 0;
  const seed = `${category}/${name}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // 分類記号は3桁。図書記号は作業名の頭文字にあたる仮名と通番
  const cls = String(h % 1000).padStart(3, "0");
  const kana = KANA_ROWS[(h >>> 9) % KANA_ROWS.length];
  const serial = ((h >>> 17) % 99) + 1;
  return `${cls} / ${kana}-${serial}`;
}

// ---- 蔵書(作業マスタ) ----
export type ShelfStatus = "在架" | "貸出中" | "延滞" | "未登録";

export interface BookEntry {
  masterId: string;
  category: string; // 著者欄に出す
  title: string;
  callNumber: string;
  estimatedSeconds: number; // 貸出期間(想定時間)
  loanCount: number; // 貸出回数(実績件数)
  medianSeconds: number | null; // 実際にかかった時間の中央値
  overdueRate: number; // 期限を超えた割合 0〜1
  lastLoanDate: string | null;
  status: ShelfStatus;
  thickness: number; // 背表紙の厚み 0〜1。想定時間が長いほど厚い
  wear: number; // 擦り切れ具合 0〜1。読まれた回数が多いほど古びる
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 想定時間から背表紙の厚みを出す。10分で薄く、4時間で最大
export function thicknessOf(estimatedSeconds: number): number {
  if (estimatedSeconds <= 0) return 0.25;
  const t = (estimatedSeconds - 600) / (4 * 3600 - 600);
  return Math.max(0.12, Math.min(1, t));
}

export function buildBook(
  master: MasterTask,
  records: WorkRecord[],
  todayTasks: DailyTask[]
): BookEntry {
  const mine = records
    .filter(
      (r) =>
        !r.excludedFromStats &&
        r.seconds > 0 &&
        (r.masterTaskId === master.id || (r.category === master.category && r.name === master.name))
    )
    .sort((a, b) => b.endedAt - a.endedAt);
  const est = master.estimatedSeconds > 0 ? master.estimatedSeconds : 0;
  const secs = mine.map((r) => r.seconds);
  const overdue = est > 0 ? mine.filter((r) => r.seconds > est).length : 0;

  const loanToday = todayTasks.find((t) => t.masterTaskId === master.id);
  const status: ShelfStatus = !loanToday
    ? "在架"
    : loanToday.status === "done"
      ? "在架"
      : "貸出中";

  return {
    masterId: master.id,
    category: master.category,
    title: master.name,
    callNumber: callNumberOf(master.category, master.name),
    estimatedSeconds: est,
    loanCount: mine.length,
    medianSeconds: median(secs),
    overdueRate: mine.length > 0 ? overdue / mine.length : 0,
    lastLoanDate: mine[0]?.date ?? null,
    status,
    thickness: thicknessOf(est),
    wear: Math.min(1, mine.length / 12),
  };
}

export function buildCollection(
  masters: MasterTask[],
  records: WorkRecord[],
  todayTasks: DailyTask[]
): BookEntry[] {
  return masters
    .filter((m) => !m.archived)
    .map((m) => buildBook(m, records, todayTasks))
    .sort((a, b) => b.loanCount - a.loanCount || a.title.localeCompare(b.title, "ja"));
}

// ---- 貸出(本日の作業) ----
export type LoanStatus = "予約" | "閲覧中" | "書見台に伏せて" | "返却済";

export interface Loan {
  task: DailyTask;
  callNumber: string;
  status: LoanStatus;
  elapsedSeconds: number;
  dueSeconds: number; // 返却期限(想定時間)
  progress: number; // 0〜1超。1超で延滞
  overdueSeconds: number; // 期限を超えた分
}

export function buildLoan(task: DailyTask, elapsedSeconds: number): Loan {
  const due = task.estimatedSeconds;
  const progress = due > 0 ? elapsedSeconds / due : 0;
  return {
    task,
    callNumber: callNumberOf(task.category, task.name),
    status:
      task.status === "done"
        ? "返却済"
        : task.status === "running"
          ? "閲覧中"
          : task.status === "paused"
            ? "書見台に伏せて"
            : "予約",
    elapsedSeconds,
    dueSeconds: due,
    progress,
    overdueSeconds: due > 0 && elapsedSeconds > due ? Math.round(elapsedSeconds - due) : 0,
  };
}

// ---- 返却期限票(日付印) ----
export interface DateStamp {
  date: string; // YYYY-MM-DD
  overdue: boolean; // その回、期限を超えていたか
}

// 実際の図書館の本の巻末にある「返却期限票」。
// その本を借りた日付が判子で押されていく、あの票を実績から起こす
export function buildDateSlip(
  master: MasterTask | null,
  category: string,
  name: string,
  records: WorkRecord[],
  limit = 24
): DateStamp[] {
  const est = master?.estimatedSeconds ?? 0;
  return records
    .filter(
      (r) =>
        !r.excludedFromStats &&
        r.seconds > 0 &&
        (master ? r.masterTaskId === master.id : false || (r.category === category && r.name === name))
    )
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, limit)
    .map((r) => ({ date: r.date, overdue: est > 0 && r.seconds > est }))
    .reverse();
}

// ---- 閲覧室の様子 ----
export type RoomPhase = "morning" | "day" | "evening" | "night";

export interface RoomState {
  phase: RoomPhase;
  hour: number;
  open: boolean; // 開館時間内か。夜間は閉館後の居残りとして扱う
}

export function roomStateOf(date: Date = new Date()): RoomState {
  const h = date.getHours();
  if (h >= 21 || h < 6) return { phase: "night", hour: h, open: false };
  if (h >= 17) return { phase: "evening", hour: h, open: true };
  if (h >= 11) return { phase: "day", hour: h, open: true };
  return { phase: "morning", hour: h, open: true };
}

// ---- 本日の集計 ----
export interface DeskSummary {
  loanedCount: number; // 本日借りた冊数(= 本日の作業件数)
  returnedCount: number; // 返却済(完了)
  overdueCount: number; // 延滞中
  readSeconds: number; // 本日の閲覧時間(実働)
  dueSeconds: number; // 本日の返却期限合計(想定合計)
  shelfTotal: number; // 蔵書数
}

export function buildDeskSummary(
  tasks: DailyTask[],
  elapsedSecondsOf: (t: DailyTask) => number,
  shelfTotal: number
): DeskSummary {
  const real = tasks.filter((t) => !t.isProvisional);
  let read = 0;
  let due = 0;
  let overdue = 0;
  let returned = 0;
  for (const t of real) {
    const e = elapsedSecondsOf(t);
    read += e;
    due += t.estimatedSeconds;
    if (t.status === "done") returned += 1;
    else if (t.estimatedSeconds > 0 && e > t.estimatedSeconds) overdue += 1;
  }
  return {
    loanedCount: real.length,
    returnedCount: returned,
    overdueCount: overdue,
    readSeconds: Math.round(read),
    dueSeconds: due,
    shelfTotal,
  };
}

// 延滞の度合い。既存のRISK_TIERS_LIBRARYと同じ考え方で段階を出す
export function overdueLevel(progress: number): 0 | 1 | 2 | 3 | 4 {
  if (progress >= 4) return 4;
  if (progress >= 2.5) return 3;
  if (progress >= 1.8) return 2;
  if (progress >= 1.3) return 1;
  return 0;
}
