import type { DailyTask, WorkRecord } from "./types";

// ===== 原点モード(Excel工程表)の計算ロジック =====
//
// このアプリの原型である「工程表.xlsm」の挙動を、そのままの考え方で再現するための純粋関数群。
// 元ブックは メモ / 工程表 / 作業項目 / 集計 / 時間外集計 の5シートで構成されていて、
// 工程表シートには以下の仕掛けが入っていた。
//
//  ・B列=作業(業務区分) / C列=内容 / E列=開始時間 / F列=終了時間 / J列=想定時間 / K列=完了フラグ
//  ・7行目以降が「奇数行=予定 / 偶数行=実績」の2行ペアで並ぶ
//  ・L列〜CI列が 08:00〜20:30 を10分刻みで並べた時間軸(ガント帯)
//  ・CK列に「やることリスト」
//  ・CL列に "業務区分&内容" の結合キー(集計シートとの突き合わせに使っていた)
//
// VBA側の中心はこの3つ。
//
//  ・作業完了      … 現在時刻を「10分単位に丸めて」打刻し、続けて
//                    MsgBox "予定通りの作業を実行しましたか？" を出す。
//                    はい→予定通り差し込み(中身は空。予定のまま進む)
//                    いいえ→予定外差し込み
//  ・予定外差し込み … 以降の予定を丸ごと下へずらし、空いた行を RGB(255,210,215) の赤に塗り、
//                    InputBox("作業内容を入力してください") を空欄でなくなるまで繰り返す
//  ・集計          … B&C の結合キーごとに実績を貯め、TRIMMEAN(範囲, 0.5) で平均時間を出す
//                    (単純平均ではなく、上下25%ずつを捨てた刈り込み平均)
//
// さらに 時間外集計 マクロは D列(終了時刻)が 17:00 を超えた行だけを別シートへ吸い出していた。
// ここではそれらを、このアプリの DailyTask / WorkRecord の上で成立する形に置き換えている。

/** 予定内(予定通り)の行の色。元ブックの Interior.Color = RGB(255, 242, 204) */
export const ORIGIN_PLANNED_FILL = "#fff2cc";
/** 予定外(突発)の行の色。元ブックの Interior.Color = RGB(255, 210, 215) */
export const ORIGIN_UNPLANNED_FILL = "#ffd2d7";

/** 時間軸(ガント帯)の刻み。元ブックの L列〜CI列と同じ10分 */
export const ORIGIN_AXIS_STEP_MIN = 10;
/** 時間軸の既定の右端。元ブックの CI列 = 20:30 */
export const ORIGIN_AXIS_END_HM = "20:30";

/**
 * 元ブックの工程表シートに目印として置かれていた休憩の時刻(G5/G6・H5/H6・I5/I6)。
 * 設定タブの休憩時間帯が未登録のときの既定値として使う
 */
export const ORIGIN_DEFAULT_BREAKS: { start: string; end: string }[] = [
  { start: "10:00", end: "10:10" },
  { start: "12:00", end: "12:40" },
  { start: "15:00", end: "15:10" },
];

export type MsRange = [number, number];

export function hmToMsOnDate(dateStr: string, hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
}

export function msToHm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 元ブックの打刻の丸め。
 *   roundedTime = Round(currentTime * 24 * 60 / 10) * 10 / (24 * 60)
 * つまり「分 ÷ 10 を四捨五入して ×10」= 10分単位への丸め。
 * VBAのRoundは銀行丸め(5は偶数側へ)だが、5分ちょうどが 8:05→8:00 / 8:15→8:20 と
 * 揺れるのは実用上わかりにくいので、ここは素直な四捨五入にしている
 */
export function roundMsToStep(ms: number, stepMin: number = ORIGIN_AXIS_STEP_MIN): number {
  const step = stepMin * 60_000;
  if (step <= 0) return ms;
  const d = new Date(ms);
  const midnight = new Date(d);
  midnight.setHours(0, 0, 0, 0);
  const offset = ms - midnight.getTime();
  return midnight.getTime() + Math.round(offset / step) * step;
}

/** 時刻が休憩帯の中なら、その休憩帯の終わりまで送る(予定の開始が休憩に食い込まないように) */
export function pushOutOfBreaks(ms: number, breaks: MsRange[]): number {
  let cur = ms;
  // 休憩帯が連続している場合に備えて、動かなくなるまで繰り返す
  for (let i = 0; i < breaks.length + 1; i++) {
    const hit = breaks.find(([s, e]) => cur >= s && cur < e);
    if (!hit) break;
    cur = hit[1];
  }
  return cur;
}

/**
 * fromMs から「正味 durMs だけ作業する」と、休憩帯をまたいだ分だけ後ろへ延びた終了時刻を返す。
 * 元ブックでは休憩は単なる目印の行だったが、予定を積み上げる以上ここは避けて通れない
 */
export function addWorkingMs(fromMs: number, durMs: number, breaks: MsRange[]): number {
  let cur = pushOutOfBreaks(fromMs, breaks);
  let left = Math.max(0, durMs);
  const sorted = [...breaks].sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (e <= cur) continue;
    if (s >= cur + left) break;
    // 休憩に入るまでの分を消化し、残りは休憩明けから
    const before = Math.max(0, s - cur);
    if (before >= left) return cur + left;
    left -= before;
    cur = e;
  }
  return cur + left;
}

export interface OriginRow {
  task: DailyTask;
  /** 元ブックに合わせた行番号。7行目から2行ずつ(予定行=奇数行) */
  rowNo: number;
  planStartMs: number;
  planEndMs: number;
  /** 想定時間(秒)。0なら予定なし */
  plannedSeconds: number;
  actualStartMs?: number;
  /** 計測中は undefined */
  actualEndMs?: number;
  /** 実働(ms)。計測中は now までを含む */
  actualMs: number;
  /** 予定外(突発)。元ブックの赤い行にあたる */
  unplanned: boolean;
  done: boolean;
  running: boolean;
  /** 実績が定時をまたぐ・または定時以降に始まった。元ブックの時間外集計の対象 */
  overtime: boolean;
  /** 実績が想定を超えた。メモシートの「時間超過を赤文字に」への対応 */
  overrun: boolean;
}

export interface BuildOriginRowsOptions {
  dateStr: string;
  /** 始業時刻(HH:MM)。予定の積み上げの起点。元ブックの時間軸の左端 08:00 にあたる */
  startHm: string;
  /** 定時(HH:MM)。ここを越えた実績が時間外集計の対象になる。元ブックは 17:00 固定 */
  closingHm: string;
  breaks: MsRange[];
  now: number;
}

/**
 * 本日の作業を、元ブックの「予定行 / 実績行」の2行ペアに組み直す。
 *
 * 予定の開始時刻は元ブックと同じく積み上げ式(前の予定が終わったら次が始まる)。
 * ただし DailyTask.scheduledTime が入っている行はそこで時刻を打ち直す。
 * これが「予定を下に」(元ブックの Module3)の置き換えで、1行に時刻を書き込むだけで
 * 以降の予定がまとめて後ろへずれる
 */
export function buildOriginRows(tasks: DailyTask[], opts: BuildOriginRowsOptions): OriginRow[] {
  const { dateStr, startHm, closingHm, breaks, now } = opts;
  const closingMs = hmToMsOnDate(dateStr, closingHm);
  const sorted = [...tasks].filter((t) => !t.isProvisional).sort((a, b) => a.order - b.order);

  let cursor = hmToMsOnDate(dateStr, startHm);
  const rows: OriginRow[] = [];

  sorted.forEach((task, i) => {
    const plannedSeconds = task.hasPlan === false ? 0 : task.estimatedSeconds;
    const pinned = task.scheduledTime ? hmToMsOnDate(dateStr, task.scheduledTime) : undefined;
    const planStartMs = pushOutOfBreaks(pinned ?? cursor, breaks);
    const planEndMs = addWorkingMs(planStartMs, plannedSeconds * 1000, breaks);
    cursor = planEndMs;

    const running = task.status === "running";
    const done = task.status === "done";
    const actualStartMs = task.startedAt ?? task.segments[0]?.start;
    const lastSeg = task.segments[task.segments.length - 1];
    const actualEndMs = running ? undefined : (lastSeg?.end ?? task.endedAt);
    let actualMs = task.accumulatedMs + (task.manualAdjustmentMs ?? 0);
    const openSeg = task.segments.find((s) => s.end === undefined);
    if (openSeg) actualMs += now - openSeg.start;

    const endForOvertime = actualEndMs ?? (running ? now : undefined);
    const overtime = endForOvertime !== undefined && endForOvertime > closingMs;
    const overrun = plannedSeconds > 0 && actualMs / 1000 > plannedSeconds;

    rows.push({
      task,
      rowNo: 7 + i * 2,
      planStartMs,
      planEndMs,
      plannedSeconds,
      actualStartMs,
      actualEndMs,
      actualMs,
      unplanned: !!task.isSpontaneous,
      done,
      running,
      overtime,
      overrun,
    });
  });

  return rows;
}

export interface OriginSummary {
  plannedCount: number;
  plannedMs: number;
  unplannedCount: number;
  unplannedMs: number;
  overtimeCount: number;
  doneCount: number;
  totalCount: number;
  /** 実績のうち予定外が占める割合(0〜1)。母数が0なら0 */
  unplannedShare: number;
}

/**
 * 元ブックの Module8「予定内と予定外の集計」。
 * あちらはセルの塗り色(黄=予定内 / 赤=予定外)で判別していたが、
 * このアプリには DailyTask.isSpontaneous という同じ意味を持つ項目が最初からある
 */
export function summarizeOrigin(rows: OriginRow[]): OriginSummary {
  let plannedCount = 0;
  let plannedMs = 0;
  let unplannedCount = 0;
  let unplannedMs = 0;
  let overtimeCount = 0;
  let doneCount = 0;
  for (const r of rows) {
    if (r.unplanned) {
      unplannedCount++;
      unplannedMs += r.actualMs;
    } else {
      plannedCount++;
      plannedMs += r.actualMs;
    }
    if (r.overtime) overtimeCount++;
    if (r.done) doneCount++;
  }
  const total = plannedMs + unplannedMs;
  return {
    plannedCount,
    plannedMs,
    unplannedCount,
    unplannedMs,
    overtimeCount,
    doneCount,
    totalCount: rows.length,
    unplannedShare: total > 0 ? unplannedMs / total : 0,
  };
}

/**
 * Excelの TRIMMEAN(範囲, 0.5) と同じ刈り込み平均。
 * 上下あわせて割合 proportion 分のデータを捨ててから平均する。
 * Excelは「捨てる件数を2の倍数へ切り捨て」てから上下均等に取り除くので、その挙動に合わせてある。
 *
 * 元ブックが単純平均ではなくこれを使っていたのは、タイマーの止め忘れのような
 * 極端に長い記録や、開始直後に止めた極端に短い記録に平均を持っていかれないようにするため
 */
export function trimmedMean(values: number[], proportion = 0.5): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const drop = Math.floor((xs.length * proportion) / 2) * 2;
  const each = drop / 2;
  const kept = each > 0 ? xs.slice(each, xs.length - each) : xs;
  if (kept.length === 0) return null;
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

export interface OriginEstimate {
  /** 刈り込み平均(秒)。元ブックの集計シートの「平均時間」 */
  trimmedSeconds: number | null;
  /** 単純平均(秒)。このアプリが作業マスタの想定時間に使っている値 */
  meanSeconds: number | null;
  sampleCount: number;
  /** 刈り込みで実際に捨てた件数 */
  droppedCount: number;
}

/**
 * 元ブックの集計シートと同じく「業務区分＋内容」の結合キーごとに実績をまとめ、
 * 刈り込み平均と単純平均の両方を出す。キーは元ブックの CL列(=B&C)と同じ作り方
 */
export function computeOriginEstimates(records: WorkRecord[]): Map<string, OriginEstimate> {
  const byKey = new Map<string, number[]>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const key = originKey(r.category, r.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r.seconds);
  }
  const out = new Map<string, OriginEstimate>();
  for (const [key, values] of byKey) {
    const drop = Math.floor((values.length * 0.5) / 2) * 2;
    out.set(key, {
      trimmedSeconds: trimmedMean(values, 0.5),
      meanSeconds: values.reduce((s, v) => s + v, 0) / values.length,
      sampleCount: values.length,
      droppedCount: drop,
    });
  }
  return out;
}

/** 元ブックの CL列。"業務区分" と "内容" をそのまま繋げたものを突き合わせキーにしていた */
export function originKey(category: string, name: string): string {
  return `${category}${name}`;
}

export interface OriginTopWork {
  key: string;
  category: string;
  name: string;
  seconds: number;
  count: number;
}

/**
 * 元ブックの Module7「上位10位の作業」。
 * あちらは集計シートの2行目(=キーごとの平均時間)をバブルソートして上位10件を別シートへ書き出していた。
 * ここでは対象期間の実績を結合キーで合算し、合計時間の多い順に返す
 */
export function computeOriginTopWorks(records: WorkRecord[], limit = 10): OriginTopWork[] {
  const map = new Map<string, OriginTopWork>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    const key = originKey(r.category, r.name);
    const cur = map.get(key);
    if (cur) {
      cur.seconds += r.seconds;
      cur.count++;
    } else {
      map.set(key, { key, category: r.category, name: r.name, seconds: r.seconds, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds).slice(0, limit);
}

export interface OriginOvertimeRow {
  date: string;
  category: string;
  name: string;
  startMs: number;
  endMs: number;
  /** 定時を越えた分だけの時間(ms) */
  afterClosingMs: number;
}

/**
 * 元ブックの Module5「時間外集計」。
 * あちらは 8〜62行目を2行おきに走査して D列 > TimeValue("17:00") の行を別シートへ写していた。
 * ここでは実績の終了時刻ではなく「定時を越えて重なっていた分」を出す
 * (17:00を1分だけまたいだ作業が、まるごと時間外に数えられてしまうのを避けるため)
 */
export function computeOriginOvertimeRows(records: WorkRecord[], closingHm: string): OriginOvertimeRow[] {
  const out: OriginOvertimeRow[] = [];
  for (const r of records) {
    const closingMs = hmToMsOnDate(r.date, closingHm);
    if (r.endedAt <= closingMs) continue;
    // 区間が分かる記録は、実際に定時以降に動いていた区間だけを足す
    let afterClosingMs = 0;
    const segs = r.segments ?? [{ start: r.startedAt, end: r.endedAt }];
    for (const s of segs) {
      const end = s.end ?? r.endedAt;
      afterClosingMs += Math.max(0, end - Math.max(s.start, closingMs));
    }
    if (afterClosingMs <= 0) continue;
    out.push({
      date: r.date,
      category: r.category,
      name: r.name,
      startMs: r.startedAt,
      endMs: r.endedAt,
      afterClosingMs,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMs - b.startMs);
}

/** 時間軸(ガント帯)の目盛り。元ブックの L列〜CI列にあたる */
export function buildOriginAxis(
  dateStr: string,
  startHm: string,
  endHm: string,
  stepMin = ORIGIN_AXIS_STEP_MIN
): { startMs: number; endMs: number; stepMs: number; ticks: number[] } {
  const startMs = hmToMsOnDate(dateStr, startHm);
  let endMs = hmToMsOnDate(dateStr, endHm);
  const stepMs = stepMin * 60_000;
  if (endMs <= startMs) endMs = startMs + stepMs;
  const ticks: number[] = [];
  for (let t = startMs; t <= endMs; t += stepMs) ticks.push(t);
  return { startMs, endMs, stepMs, ticks };
}

/** 時間軸上の位置を0〜1で返す(範囲外は端に丸める) */
export function axisRatio(ms: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  return Math.min(1, Math.max(0, (ms - startMs) / (endMs - startMs)));
}

/** 「1:05」形式。元ブックの想定時間セルは [mm] 書式だったが、長い作業は時分の方が読める */
export function formatOriginDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `0:${String(m).padStart(2, "0")}`;
}
