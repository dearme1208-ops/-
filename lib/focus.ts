import type { WorkRecord } from "./types";

// 「集中の連続性」の分析。
//
// 合計時間だけを見ていると、3時間まとめて取り組んだ日と、30分×6回に割れた日が
// 同じ数字になってしまう。実際には後者のほうが成果は落ちる ——
// 前の作業を終えないまま次へ移ると注意の一部が前の作業に残り続ける
// (Leroy 2009「attention residue」)ことが知られており、
// 中断された作業に戻るまでの実測平均は25分半という調査(Mark et al. 2005)もある。
//
// このアプリは一時停止のたびに区間(TimeSegment)を刻んでいるので、
// 新しい入力を増やさずに「どれだけ途切れずにいられたか」を後から測れる。
// 区間を持たない記録(手動加算・CSV取り込み・実績編集で作られたもの)は
// 連続性を判定できないため、集計から除外する。

/** これ以上続いた区間を「まとまった時間」とみなすしきい値。上記の25分半に合わせてある */
export const DEEP_BLOCK_MS = 25 * 60 * 1000;

/** この長さ以下の途切れは「中断」とみなさず、前後の区間をつなげる(押し間違い・一瞬の保留) */
const GLUE_TOLERANCE_MS = 60 * 1000;

/** 作業の同一性は「大項目/作業名」で見る。同名の別レコードに分かれていても1つの作業として扱う */
function taskKeyOf(r: WorkRecord): string {
  return `${r.category}\u0000${r.name}`;
}

export interface FocusBlock {
  start: number;
  end: number;
  key: string;
  label: string;
}

export interface ReturnGap {
  /** 中断された作業 */
  label: string;
  /** 中断されてから同じ作業に戻るまでの実測時間 */
  gapMs: number;
  /** その間に割り込んだ作業(時間の長い順)。空なら誰も割り込まずに空白だった */
  interrupters: string[];
}

export interface DayFocus {
  date: string;
  /** 区間の合計。手動加算等を含まないので、実績の合計時間とは一致しないことがある */
  totalMs: number;
  /** つなぎ合わせたあとの無中断区間の数 */
  blockCount: number;
  longestMs: number;
  longestLabel: string;
  /** DEEP_BLOCK_MS以上の区間だけを足した「まとまった時間」 */
  deepMs: number;
  /** 作業が別の作業へ切り替わった回数 */
  switchCount: number;
  gaps: ReturnGap[];
}

/** 区間を持つ記録から、その日の無中断区間を時系列で組み立てる */
function buildBlocks(records: WorkRecord[]): FocusBlock[] {
  const raw: FocusBlock[] = [];
  for (const r of records) {
    if (r.excludedFromStats) continue;
    for (const s of r.segments ?? []) {
      if (!s.end || s.end <= s.start) continue;
      raw.push({ start: s.start, end: s.end, key: taskKeyOf(r), label: `${r.category} / ${r.name}` });
    }
  }
  raw.sort((a, b) => a.start - b.start);

  // 同じ作業が僅かな間を置いて続いているだけのものは1本につなぐ
  const blocks: FocusBlock[] = [];
  for (const b of raw) {
    const prev = blocks[blocks.length - 1];
    if (prev && prev.key === b.key && b.start - prev.end <= GLUE_TOLERANCE_MS) {
      prev.end = Math.max(prev.end, b.end);
      continue;
    }
    blocks.push({ ...b });
  }
  return blocks;
}

export function computeDayFocus(date: string, records: WorkRecord[]): DayFocus | null {
  const blocks = buildBlocks(records);
  if (blocks.length === 0) return null;

  let totalMs = 0;
  let longestMs = 0;
  let longestLabel = "";
  let deepMs = 0;
  let switchCount = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const len = b.end - b.start;
    totalMs += len;
    if (len >= DEEP_BLOCK_MS) deepMs += len;
    if (len > longestMs) {
      longestMs = len;
      longestLabel = b.label;
    }
    if (i > 0 && blocks[i - 1].key !== b.key) switchCount++;
  }

  // 中断されてから同じ作業に戻るまでの間隔と、その隙間に割り込んだ作業
  const gaps: ReturnGap[] = [];
  const lastEndByKey = new Map<string, { end: number; index: number; label: string }>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const prev = lastEndByKey.get(b.key);
    if (prev) {
      const between = new Map<string, number>();
      for (let j = prev.index + 1; j < i; j++) {
        const o = blocks[j];
        between.set(o.label, (between.get(o.label) ?? 0) + (o.end - o.start));
      }
      gaps.push({
        label: b.label,
        gapMs: b.start - prev.end,
        interrupters: [...between.entries()].sort((x, y) => y[1] - x[1]).map(([label]) => label),
      });
    }
    lastEndByKey.set(b.key, { end: b.end, index: i, label: b.label });
  }

  return { date, totalMs, blockCount: blocks.length, longestMs, longestLabel, deepMs, switchCount, gaps };
}

export interface InterrupterRow {
  label: string;
  /** この作業が他の作業を中断させた回数 */
  count: number;
  /** その中断で失われた(他の作業が止まっていた)時間の合計 */
  blockedMs: number;
}

export interface FocusSummary {
  days: DayFocus[];
  /** 区間を持たないため分析できなかった日数。母数の少なさを正直に出すために持つ */
  skippedDayCount: number;
  avgLongestMs: number;
  /** まとまった時間が計測時間全体に占める割合(0〜1) */
  deepRatio: number;
  /** 中断されてから戻るまでの時間の中央値。比較対象は調査値の25分半 */
  medianReturnGapMs: number | null;
  totalSwitches: number;
  /** 1日あたりの切り替え回数 */
  avgSwitchesPerDay: number;
  topInterrupters: InterrupterRow[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * 指定した日付群(通常は直近N日)の記録から、集中の連続性をまとめる。
 * recordsは全期間を渡してよい。dates に含まれる日だけを見る
 */
export function computeFocusSummary(records: WorkRecord[], dates: string[]): FocusSummary {
  const byDate = new Map<string, WorkRecord[]>();
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  const days: DayFocus[] = [];
  let skippedDayCount = 0;
  for (const date of dates) {
    const recs = byDate.get(date);
    if (!recs || recs.length === 0) continue;
    const day = computeDayFocus(date, recs);
    // 記録はあるのに区間が無い日 = 手動入力だけの日。分析できないので数だけ控える
    if (!day) skippedDayCount++;
    else days.push(day);
  }

  if (days.length === 0) {
    return {
      days: [],
      skippedDayCount,
      avgLongestMs: 0,
      deepRatio: 0,
      medianReturnGapMs: null,
      totalSwitches: 0,
      avgSwitchesPerDay: 0,
      topInterrupters: [],
    };
  }

  const totalMs = days.reduce((s, d) => s + d.totalMs, 0);
  const deepMs = days.reduce((s, d) => s + d.deepMs, 0);
  const totalSwitches = days.reduce((s, d) => s + d.switchCount, 0);
  const avgLongestMs = Math.round(days.reduce((s, d) => s + d.longestMs, 0) / days.length);

  const allGaps = days.flatMap((d) => d.gaps);
  const interrupters = new Map<string, InterrupterRow>();
  for (const g of allGaps) {
    // 隙間に割り込んだ作業すべてに、その中断の責任を数える。
    // 「誰のせいで戻れなかったか」を見るための指標なので、割り込み側の長さではなく
    // 止まっていた側の時間(gapMs)を計上する
    for (const label of g.interrupters) {
      const row = interrupters.get(label) ?? { label, count: 0, blockedMs: 0 };
      row.count++;
      row.blockedMs += g.gapMs;
      interrupters.set(label, row);
    }
  }

  return {
    days,
    skippedDayCount,
    avgLongestMs,
    deepRatio: totalMs > 0 ? deepMs / totalMs : 0,
    medianReturnGapMs: median(allGaps.map((g) => g.gapMs)),
    totalSwitches,
    avgSwitchesPerDay: Math.round((totalSwitches / days.length) * 10) / 10,
    topInterrupters: [...interrupters.values()].sort((a, b) => b.blockedMs - a.blockedMs).slice(0, 5),
  };
}

/** 中断の実測平均として広く引かれている調査値(Mark et al. 2005 の25分26秒) */
export const REFERENCE_RETURN_GAP_MS = (25 * 60 + 26) * 1000;
