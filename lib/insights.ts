import type { MasterTask, WorkRecord } from "./types";
import { bucketOfHour } from "./timeOfDay";
import { DOW_LABELS } from "./weekday";

export interface Insight {
  id: string;
  icon: string;
  title: string;
  body: string;
  tone: "positive" | "caution";
  sampleCount: number;
  effectMagnitude: number; // 並び替え専用(絶対値の大きいものを優先表示)。表示はしない
}

const MIN_SAMPLES = 3;
const MIN_COMBO_SAMPLES = 4;
const EFFECT_THRESHOLD_PT = 15; // 想定比のptで、これ未満の差は「たまたま」の可能性が高いとみなし出さない
const COMBO_EFFECT_THRESHOLD_PT = 25; // 曜日×時間帯は組み合わせ数が多く偶然の極端値が出やすいため、閾値を上げる

interface MatchedRecord {
  record: WorkRecord;
  pct: number; // 想定時間 ÷ 実績時間 × 100
}

function buildEstimatedByKey(masterTasks: MasterTask[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of masterTasks) {
    if (m.estimatedSeconds > 0) map.set(`${m.category}::${m.name}`, m.estimatedSeconds);
  }
  return map;
}

function matchRecords(records: WorkRecord[], estimatedByKey: Map<string, number>): MatchedRecord[] {
  const out: MatchedRecord[] = [];
  for (const r of records) {
    if (r.excludedFromStats || !r.startedAt || r.seconds <= 0) continue;
    const estimatedSeconds = estimatedByKey.get(`${r.category}::${r.name}`);
    if (!estimatedSeconds) continue;
    out.push({ record: r, pct: (estimatedSeconds / r.seconds) * 100 });
  }
  return out;
}

function avg(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

// ルール1: 同じ作業の中で、一時停止を挟んだ(中断された)ケースと、中断なしで一気に終えた
// ケースとで、想定比に差が出ているかを比較する。区間(segments)が不明な記録(手動加算・CSV取込等)
// は判定できないため対象から除く
function ruleInterruptionCost(matched: MatchedRecord[]): Insight[] {
  const withInterrupted: number[] = [];
  const withoutInterrupted: number[] = [];
  for (const { record, pct } of matched) {
    if (!record.segments) continue;
    if (record.segments.length >= 2) withInterrupted.push(pct);
    else if (record.segments.length === 1) withoutInterrupted.push(pct);
  }
  if (withInterrupted.length < MIN_SAMPLES || withoutInterrupted.length < MIN_SAMPLES) return [];
  const a = Math.round(avg(withInterrupted));
  const b = Math.round(avg(withoutInterrupted));
  const diff = a - b;
  if (Math.abs(diff) < EFFECT_THRESHOLD_PT) return [];
  const worse = diff < 0;
  return [
    {
      id: "interruption-cost",
      icon: worse ? "⏸️" : "🔁",
      title: worse ? "中断すると時間がかかりやすい傾向" : "中断しても意外と影響が小さい傾向",
      body: worse
        ? `一時停止を挟んだ作業は、一気に終えた作業に比べて想定比が平均${Math.abs(diff)}pt低い傾向があります（中断あり${a}% / 中断なし${b}%）。`
        : `一時停止を挟んだ作業でも、一気に終えた作業と想定比の差はあまり無いようです（中断あり${a}% / 中断なし${b}%）。`,
      tone: worse ? "caution" : "positive",
      sampleCount: withInterrupted.length + withoutInterrupted.length,
      effectMagnitude: Math.abs(diff),
    },
  ];
}

// ルール2: その日その作業の「直前に行っていた作業」の大項目(カテゴリ)ごとに、後続の作業の
// 想定比を比較する。特定のカテゴリの後は所要時間が伸びやすい(切り替えコスト)/逆に捗りやすい、
// という持ち越し効果を検出する
function ruleCategoryCarryover(records: WorkRecord[], estimatedByKey: Map<string, number>): Insight[] {
  const byDate = new Map<string, WorkRecord[]>();
  for (const r of records) {
    if (r.excludedFromStats || !r.startedAt || r.seconds <= 0) continue;
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }

  const followingPctByPrevCategory = new Map<string, number[]>();
  const baseline: number[] = [];
  for (const dayRecords of byDate.values()) {
    const sorted = [...dayRecords].sort((a, b) => a.startedAt! - b.startedAt!);
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const estimatedSeconds = estimatedByKey.get(`${current.category}::${current.name}`);
      if (!estimatedSeconds) continue;
      const pct = (estimatedSeconds / current.seconds) * 100;
      const prevCategory = sorted[i - 1].category;
      if (!followingPctByPrevCategory.has(prevCategory)) followingPctByPrevCategory.set(prevCategory, []);
      followingPctByPrevCategory.get(prevCategory)!.push(pct);
      baseline.push(pct);
    }
  }
  if (baseline.length < MIN_SAMPLES) return [];
  const baselineAvg = avg(baseline);

  let worst: { category: string; pct: number; count: number } | null = null;
  let best: { category: string; pct: number; count: number } | null = null;
  for (const [category, pcts] of followingPctByPrevCategory) {
    if (pcts.length < MIN_SAMPLES) continue;
    const a = avg(pcts);
    if (!worst || a < worst.pct) worst = { category, pct: a, count: pcts.length };
    if (!best || a > best.pct) best = { category, pct: a, count: pcts.length };
  }

  const insights: Insight[] = [];
  if (worst && baselineAvg - worst.pct >= EFFECT_THRESHOLD_PT) {
    const diff = Math.round(baselineAvg - worst.pct);
    insights.push({
      id: "carryover-worst",
      icon: "🌀",
      title: `「${worst.category}」の後は要注意`,
      body: `「${worst.category}」の作業の後に始めた作業は、他の場合に比べて想定比が平均${diff}pt低い傾向があります（サンプル${worst.count}件）。`,
      tone: "caution",
      sampleCount: worst.count,
      effectMagnitude: diff,
    });
  }
  if (best && best.pct - baselineAvg >= EFFECT_THRESHOLD_PT && (!worst || best.category !== worst.category)) {
    const diff = Math.round(best.pct - baselineAvg);
    insights.push({
      id: "carryover-best",
      icon: "🌊",
      title: `「${best.category}」の後は捗りやすい`,
      body: `「${best.category}」の作業の後に始めた作業は、他の場合に比べて想定比が平均${diff}pt高い傾向があります（サンプル${best.count}件）。`,
      tone: "positive",
      sampleCount: best.count,
      effectMagnitude: diff,
    });
  }
  return insights;
}

// ルール3: 曜日×時間帯の組み合わせで、特に生産的/苦手なセルが無いかを見る。曜日別・時間帯別を
// それぞれ単独で見ただけでは分からない複合パターン(例:「水曜の午後」だけ特に悪い)を検出する。
// 組み合わせ数が多く偶然の極端値が出やすいため、閾値を単独ルールより高めにする
function ruleWeekdayTimeOfDayCombo(matched: MatchedRecord[]): Insight[] {
  const byCell = new Map<string, { dow: number; bucketLabel: string; pcts: number[] }>();
  const baseline: number[] = [];
  for (const { record, pct } of matched) {
    const d = new Date(record.startedAt);
    const dow = d.getDay();
    const bucket = bucketOfHour(d.getHours());
    if (!bucket) continue;
    const key = `${dow}::${bucket.id}`;
    if (!byCell.has(key)) byCell.set(key, { dow, bucketLabel: bucket.label, pcts: [] });
    byCell.get(key)!.pcts.push(pct);
    baseline.push(pct);
  }
  if (baseline.length < MIN_COMBO_SAMPLES) return [];
  const baselineAvg = avg(baseline);

  let worst: { dow: number; bucketLabel: string; pct: number; count: number } | null = null;
  let best: { dow: number; bucketLabel: string; pct: number; count: number } | null = null;
  for (const { dow, bucketLabel, pcts } of byCell.values()) {
    if (pcts.length < MIN_COMBO_SAMPLES) continue;
    const a = avg(pcts);
    if (!worst || a < worst.pct) worst = { dow, bucketLabel, pct: a, count: pcts.length };
    if (!best || a > best.pct) best = { dow, bucketLabel, pct: a, count: pcts.length };
  }

  const insights: Insight[] = [];
  if (worst && baselineAvg - worst.pct >= COMBO_EFFECT_THRESHOLD_PT) {
    const diff = Math.round(baselineAvg - worst.pct);
    insights.push({
      id: "combo-worst",
      icon: "🌫️",
      title: `${DOW_LABELS[worst.dow]}曜${worst.bucketLabel}は特に苦手な傾向`,
      body: `${DOW_LABELS[worst.dow]}曜日の${worst.bucketLabel}に行った作業は、想定比が平均より${diff}pt低い傾向があります（サンプル${worst.count}件）。`,
      tone: "caution",
      sampleCount: worst.count,
      effectMagnitude: diff,
    });
  }
  if (best && best.pct - baselineAvg >= COMBO_EFFECT_THRESHOLD_PT && (!worst || best.dow !== worst.dow || best.bucketLabel !== worst.bucketLabel)) {
    const diff = Math.round(best.pct - baselineAvg);
    insights.push({
      id: "combo-best",
      icon: "🌤️",
      title: `${DOW_LABELS[best.dow]}曜${best.bucketLabel}は特に得意な傾向`,
      body: `${DOW_LABELS[best.dow]}曜日の${best.bucketLabel}に行った作業は、想定比が平均より${diff}pt高い傾向があります（サンプル${best.count}件）。`,
      tone: "positive",
      sampleCount: best.count,
      effectMagnitude: diff,
    });
  }
  return insights;
}

const MAX_INSIGHTS = 4;

// 体調別/天気別/時間帯別の生産性分析をそれぞれ単独で見るのではなく、既存の実績データを
// 複数の軸で横断的に見て、単独の集計では気づきにくいパターンを自動で見つけ出す。
// サンプル数・効果量の両方が一定の閾値を超えたものだけを提示し、誤検出を抑える
export function computeInsights(records: WorkRecord[], masterTasks: MasterTask[]): Insight[] {
  const estimatedByKey = buildEstimatedByKey(masterTasks);
  const matched = matchRecords(records, estimatedByKey);

  const all = [
    ...ruleInterruptionCost(matched),
    ...ruleCategoryCarryover(records, estimatedByKey),
    ...ruleWeekdayTimeOfDayCombo(matched),
  ];
  return all.sort((a, b) => b.effectMagnitude - a.effectMagnitude).slice(0, MAX_INSIGHTS);
}
