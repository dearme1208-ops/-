import type { MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// Claudeモードの中核。記録から「気づき」を組み立てる推論エンジン。
//
// このモードが他と決定的に違うのは、絵や言葉づかいではなく“中身”のほうにある。
// 他のモードは実データを別の語彙で言い換えるが、ここでは実データを実際に分析して、
// 分析した本人(=このコード)が結論・根拠・確信度・反証条件をすべて開示する。
//
// 守っている原則:
//   1. 結論は必ず根拠(Evidence)を伴う。根拠に出す数字は実データそのもの
//   2. 確信度は演出ではなく、標本数と効果量から決まる。少ない記録では低く出る
//   3. どの結論にも「これが覆る条件(counterpoint)」を必ず添える
//   4. データが足りなければ黙る。無理に何か言わない(nullを返す)
//   5. 乱数を使わない。同じ記録からは常に同じ結論が出る

const RECENT_DAYS = 90;
const HOUR_BUCKETS = [
  { key: "early", label: "早朝", from: 5, to: 9 },
  { key: "morning", label: "午前", from: 9, to: 12 },
  { key: "afternoon", label: "午後", from: 12, to: 16 },
  { key: "evening", label: "夕方", from: 16, to: 19 },
  { key: "night", label: "夜", from: 19, to: 29 }, // 29 = 翌5時まで
] as const;

const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];

// ---- 小さな統計の道具 ----

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 確信度。標本数と効果量の両方から決まる。
 * 標本が少なければどれだけ差が大きくても高くならず、
 * 標本が多くても差が小さければ高くならない。演出のための下駄は履かせていない。
 */
function confidenceOf(sampleSize: number, effect: number, needed: number): number {
  const n = Math.min(1, sampleSize / needed);
  const e = Math.min(1, effect);
  return Math.round(Math.min(0.95, n * 0.6 + e * 0.35) * 100) / 100;
}

// ---- 型 ----

export interface Evidence {
  label: string;
  value: string;
}

export type FindingKind =
  | "calibration" // 見積もりの偏り
  | "rhythm" // 時間帯の得手不得手
  | "weekday" // 曜日の偏り
  | "fragmentation" // 細切れ
  | "trouble" // 突発の集中
  | "stale" // 滞留
  | "project" // 案件の到達見込み
  | "load"; // 稼働の偏り

export interface Finding {
  id: string;
  kind: FindingKind;
  /** 結論。1文で言い切る */
  headline: string;
  /** どう考えてそう言えるのかの短い説明 */
  detail: string;
  evidence: Evidence[];
  /** 0〜1。標本数と効果量から決まる */
  confidence: number;
  /** 0〜1。時間に換算した影響の大きさ */
  impact: number;
  /** 次の一手。無い場合はnull */
  action: string | null;
  /** この結論が覆る条件。必ず添える */
  counterpoint: string;
  sampleSize: number;
}

/** 分析の過程そのもの。画面に出すために、実際に通った手順を記録する */
export interface ThoughtStep {
  label: string;
  note: string;
}

export interface Thinking {
  findings: Finding[];
  steps: ThoughtStep[];
  /** 分析に使えた実績の件数。0なら何も言えない */
  usableRecords: number;
}

// ============================================================
// 個々の分析
// ============================================================

interface Ctx {
  records: WorkRecord[]; // 除外済みを取り除いた直近RECENT_DAYS分
  withEstimate: { r: WorkRecord; est: number; ratio: number }[];
  today: string;
}

// ---- 1. 見積もりの偏り(区分ごと) ----
// どの区分で想定と実績がずれているか。中央値で見るのは、
// 1件の極端な超過に引きずられて「いつも超過している」と誤診しないため
function analyzeCalibration(ctx: Ctx): Finding | null {
  const byCategory = new Map<string, number[]>();
  for (const w of ctx.withEstimate) {
    const k = w.r.category;
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(w.ratio);
  }
  let worst: { category: string; ratios: number[]; med: number } | null = null;
  for (const [category, ratios] of byCategory) {
    if (ratios.length < 5) continue;
    const med = median(ratios);
    const dev = Math.abs(med - 1);
    if (!worst || dev > Math.abs(worst.med - 1)) worst = { category, ratios, med };
  }
  if (!worst || Math.abs(worst.med - 1) < 0.2) return null;

  const over = worst.med > 1;
  const pct = Math.round(Math.abs(worst.med - 1) * 100);
  const totalSeconds = ctx.withEstimate
    .filter((w) => w.r.category === worst!.category)
    .reduce((s, w) => s + w.r.seconds, 0);
  const estTotal = ctx.withEstimate
    .filter((w) => w.r.category === worst!.category)
    .reduce((s, w) => s + w.est, 0);
  const gapHours = Math.abs(totalSeconds - estTotal) / 3600;

  return {
    id: `calibration:${worst.category}`,
    kind: "calibration",
    headline: over
      ? `「${worst.category}」の想定時間が実態より${pct}%短く設定されています`
      : `「${worst.category}」の想定時間が実態より${pct}%長く設定されています`,
    detail: over
      ? `この区分の実績${worst.ratios.length}件の中央値は想定の${worst.med.toFixed(2)}倍でした。1件の極端な超過ではなく、半数以上が想定を超えています。想定時間そのものを見直す余地があります。`
      : `この区分の実績${worst.ratios.length}件の中央値は想定の${worst.med.toFixed(2)}倍でした。想定より早く終わり続けているため、想定時間に余裕を持たせすぎている可能性があります。`,
    evidence: [
      { label: "対象", value: worst.category },
      { label: "実績件数", value: `${worst.ratios.length}件` },
      { label: "実績÷想定の中央値", value: `${worst.med.toFixed(2)}倍` },
      { label: "累積の差", value: `${gapHours.toFixed(1)}時間` },
    ],
    confidence: confidenceOf(worst.ratios.length, Math.abs(worst.med - 1) / 0.8, 20),
    impact: Math.min(1, gapHours / 20),
    action: `作業マスタの「${worst.category}」の想定時間を、実績の中央値に合わせて更新する`,
    counterpoint:
      "この区分に性質の異なる作業が混ざっている場合、中央値のずれは見積もりの誤りではなく作業の多様さを表しているだけかもしれません。",
    sampleSize: worst.ratios.length,
  };
}

// ---- 2. 時間帯の得手不得手 ----
function analyzeRhythm(ctx: Ctx): Finding | null {
  const buckets = HOUR_BUCKETS.map((b) => ({ ...b, ratios: [] as number[] }));
  for (const w of ctx.withEstimate) {
    if (!w.r.startedAt) continue;
    let h = new Date(w.r.startedAt).getHours();
    if (h < 5) h += 24; // 深夜は前日の夜として扱う
    const b = buckets.find((x) => h >= x.from && h < x.to);
    if (b) b.ratios.push(w.ratio);
  }
  const usable = buckets.filter((b) => b.ratios.length >= 5);
  if (usable.length < 2) return null;
  const scored = usable.map((b) => ({ ...b, med: median(b.ratios) })).sort((a, b) => a.med - b.med);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  const gap = worst.med - best.med;
  if (gap < 0.25) return null;

  return {
    id: `rhythm:${best.key}`,
    kind: "rhythm",
    headline: `${best.label}に始めた作業のほうが、${worst.label}より想定どおりに終わっています`,
    detail: `${best.label}に着手した${best.ratios.length}件は実績÷想定の中央値が${best.med.toFixed(2)}倍、${worst.label}の${worst.ratios.length}件は${worst.med.toFixed(2)}倍でした。同じ想定でも、着手する時間帯によって着地が変わっています。`,
    evidence: [
      { label: `${best.label}の中央値`, value: `${best.med.toFixed(2)}倍（${best.ratios.length}件）` },
      { label: `${worst.label}の中央値`, value: `${worst.med.toFixed(2)}倍（${worst.ratios.length}件）` },
      { label: "差", value: `${Math.round(gap * 100)}ポイント` },
    ],
    confidence: confidenceOf(best.ratios.length + worst.ratios.length, gap / 0.8, 30),
    impact: Math.min(1, gap / 1.2),
    action: `想定を超えやすい作業は、${best.label}に着手する`,
    counterpoint: `${worst.label}に難しい作業を回している場合、差は時間帯ではなく作業の難度を映しているだけかもしれません。`,
    sampleSize: best.ratios.length + worst.ratios.length,
  };
}

// ---- 3. 曜日の偏り ----
function analyzeWeekday(ctx: Ctx): Finding | null {
  const byDay = new Map<number, Map<string, number>>(); // 曜日 → 日付 → 秒
  for (const r of ctx.records) {
    const d = new Date(r.date + "T00:00:00");
    const wd = d.getDay();
    if (!byDay.has(wd)) byDay.set(wd, new Map());
    const m = byDay.get(wd)!;
    m.set(r.date, (m.get(r.date) ?? 0) + r.seconds);
  }
  const perDay = [...byDay.entries()]
    .map(([wd, m]) => ({ wd, days: m.size, avg: mean([...m.values()]) }))
    .filter((x) => x.days >= 3);
  if (perDay.length < 3) return null;
  const overall = mean(perDay.map((x) => x.avg));
  if (overall <= 0) return null;
  const peak = perDay.reduce((a, b) => (b.avg > a.avg ? b : a));
  const excess = peak.avg / overall - 1;
  if (excess < 0.35) return null;

  return {
    id: `weekday:${peak.wd}`,
    kind: "weekday",
    headline: `${WEEKDAY_LABEL[peak.wd]}曜日に負荷が集中しています`,
    detail: `${WEEKDAY_LABEL[peak.wd]}曜日の1日あたり実働は平均${(peak.avg / 3600).toFixed(1)}時間で、全曜日の平均${(overall / 3600).toFixed(1)}時間を${Math.round(excess * 100)}%上回っています。${peak.days}日分の記録から算出しました。`,
    evidence: [
      { label: `${WEEKDAY_LABEL[peak.wd]}曜の平均`, value: `${(peak.avg / 3600).toFixed(1)}時間` },
      { label: "全曜日の平均", value: `${(overall / 3600).toFixed(1)}時間` },
      { label: "対象日数", value: `${peak.days}日` },
    ],
    confidence: confidenceOf(peak.days, excess / 1.0, 12),
    impact: Math.min(1, excess),
    action: `${WEEKDAY_LABEL[peak.wd]}曜日に置いている定例を、他の曜日へ分散できないか見直す`,
    counterpoint: "定例会議など動かせない予定がその曜日に固定されている場合、偏り自体は問題ではありません。",
    sampleSize: peak.days,
  };
}

// ---- 4. 細切れ(中断の多さ) ----
// segmentsが残っている実績だけを対象にする。手動加算やCSV取り込みでは区間が
// 分からないため、そこを混ぜると「中断していない」と誤って数えてしまう
function analyzeFragmentation(ctx: Ctx): Finding | null {
  const withSegments = ctx.records.filter((r) => r.segments && r.segments.length > 0);
  if (withSegments.length < 12) return null;
  const sessionLengths: number[] = [];
  let splitCount = 0;
  for (const r of withSegments) {
    const segs = r.segments!;
    if (segs.length >= 3) splitCount += 1;
    for (const s of segs) {
      const end = s.end ?? s.start;
      sessionLengths.push((end - s.start) / 60000);
    }
  }
  const medSession = median(sessionLengths);
  const splitRate = splitCount / withSegments.length;
  if (medSession >= 20 && splitRate < 0.3) return null;

  return {
    id: "fragmentation",
    kind: "fragmentation",
    headline: `作業が細切れになっています（1回あたりの中央値 ${Math.round(medSession)}分）`,
    detail: `区間が記録されている${withSegments.length}件を調べたところ、1回続けて手を動かしている時間の中央値は${Math.round(medSession)}分でした。${Math.round(splitRate * 100)}%の作業が3回以上に分断されています。切り替えのたびに立ち上げ直す時間が積み上がります。`,
    evidence: [
      { label: "1回あたりの中央値", value: `${Math.round(medSession)}分` },
      { label: "3回以上に分断された割合", value: `${Math.round(splitRate * 100)}%` },
      { label: "対象実績", value: `${withSegments.length}件` },
    ],
    confidence: confidenceOf(withSegments.length, Math.max(splitRate, (25 - medSession) / 25), 40),
    impact: Math.min(1, splitRate + Math.max(0, (25 - medSession) / 50)),
    action: "同じ区分の作業をまとめて連続で処理する時間帯をつくる",
    counterpoint:
      "問い合わせ対応のように、細切れであること自体が仕事の性質という場合もあります。その場合は分断の回数より総量で見るべきです。",
    sampleSize: withSegments.length,
  };
}

// ---- 5. 突発(トラブル)の集中 ----
function analyzeTrouble(ctx: Ctx): Finding | null {
  const troubles = ctx.records.filter((r) => r.isTrouble);
  if (troubles.length < 4) return null;
  const byCategory = new Map<string, { n: number; seconds: number }>();
  for (const r of troubles) {
    const cur = byCategory.get(r.category) ?? { n: 0, seconds: 0 };
    byCategory.set(r.category, { n: cur.n + 1, seconds: cur.seconds + r.seconds });
  }
  const top = [...byCategory.entries()].sort((a, b) => b[1].seconds - a[1].seconds)[0];
  const share = top[1].n / troubles.length;
  if (share < 0.45) return null;
  const totalSeconds = ctx.records.reduce((s, r) => s + r.seconds, 0);
  const troubleShare = troubles.reduce((s, r) => s + r.seconds, 0) / Math.max(1, totalSeconds);

  return {
    id: `trouble:${top[0]}`,
    kind: "trouble",
    headline: `突発対応の${Math.round(share * 100)}%が「${top[0]}」に集中しています`,
    detail: `直近${RECENT_DAYS}日のトラブル対応${troubles.length}件のうち${top[1].n}件がこの区分でした。時間にして${(top[1].seconds / 3600).toFixed(1)}時間、全実働の${Math.round(troubleShare * 100)}%が突発対応に充てられています。特定の場所で繰り返し火が出ているなら、対症ではなく原因側に手を入れられる可能性があります。`,
    evidence: [
      { label: "集中している区分", value: top[0] },
      { label: "件数", value: `${top[1].n}/${troubles.length}件` },
      { label: "費やした時間", value: `${(top[1].seconds / 3600).toFixed(1)}時間` },
      { label: "全実働に占める突発の割合", value: `${Math.round(troubleShare * 100)}%` },
    ],
    confidence: confidenceOf(troubles.length, share, 15),
    impact: Math.min(1, troubleShare * 2.5),
    action: `「${top[0]}」で繰り返し起きている事象を洗い出し、恒久対策を1件立てる`,
    counterpoint:
      "トラブル対応として記録する基準が区分ごとに違う場合、この偏りは実態ではなく記録のつけ方の差かもしれません。",
    sampleSize: troubles.length,
  };
}

// ---- 6. ToDoの滞留 ----
function analyzeStale(todos: TodoTask[], today: string): Finding | null {
  const active = todos.filter((t) => !t.completed && !t.parentTaskId);
  if (active.length === 0) return null;
  const now = Date.now();
  const stale = active.filter((t) => now - t.createdAt > 30 * 86400000);
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
  if (stale.length < 4 && overdue.length < 4) return null;

  const oldest = stale.reduce<TodoTask | null>((a, b) => (a === null || b.createdAt < a.createdAt ? b : a), null);
  const oldestDays = oldest ? Math.floor((now - oldest.createdAt) / 86400000) : 0;

  return {
    id: "stale",
    kind: "stale",
    headline:
      stale.length >= overdue.length
        ? `30日以上動いていないタスクが${stale.length}件あります`
        : `期限を過ぎたタスクが${overdue.length}件たまっています`,
    detail: `未完了のタスク${active.length}件のうち、${stale.length}件は登録から30日以上経っています。${overdue.length > 0 ? `また${overdue.length}件は期限を過ぎています。` : ""}長く動かないタスクは、優先度が低いのではなく「着手できない形のまま置かれている」ことが多く、分解するか手放すかの判断が要ります。`,
    evidence: [
      { label: "未完了", value: `${active.length}件` },
      { label: "30日以上放置", value: `${stale.length}件` },
      { label: "期限超過", value: `${overdue.length}件` },
      ...(oldest ? [{ label: "最も古いもの", value: `${oldest.title}（${oldestDays}日）` }] : []),
    ],
    confidence: confidenceOf(active.length, Math.max(stale.length, overdue.length) / Math.max(1, active.length), 10),
    impact: Math.min(1, (stale.length + overdue.length) / 20),
    action: "30日以上動いていないタスクを1件ずつ見て、分解する・期日を入れる・消すのどれかに決める",
    counterpoint: "いつかやる置き場として意図的に寝かせているリストであれば、滞留は問題ではありません。",
    sampleSize: active.length,
  };
}

// ---- 7. 案件の到達見込み ----
function analyzeProjects(projects: ProjectItem[], records: WorkRecord[], today: string): Finding | null {
  const active = projects.filter((p) => !p.completedAt);
  if (active.length === 0) return null;

  const risky = active
    .map((p) => {
      const stages = p.stages ?? [];
      const done = stages.filter((s) => s.completed).length;
      const progress = stages.length > 0 ? done / stages.length : 0;
      const daysLeft = Math.round(
        (new Date(p.dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
      );
      // 直近14日でこの案件に充てた時間。ペースが無ければ「進んでいない」と見る
      const since = daysAgoStr(14);
      const recentSeconds = records
        .filter((r) => r.date >= since && (r.projectId === p.id || (r.secondaryProjectIds ?? []).includes(p.id)))
        .reduce((s, r) => s + r.seconds, 0);
      return { p, stages: stages.length, done, progress, daysLeft, recentSeconds };
    })
    .filter((x) => x.stages > 0 && x.daysLeft >= 0 && x.progress < 1)
    // 残り日数に対して進捗が足りていない順
    .sort((a, b) => a.progress - a.daysLeft / 60 - (b.progress - b.daysLeft / 60));

  const top = risky[0];
  if (!top) return null;
  // 残り日数のほうが進捗より十分に余裕がある場合は、わざわざ言わない
  const need = 1 - top.progress;
  const pace = top.daysLeft > 0 ? need / top.daysLeft : Infinity;
  if (pace < 0.05 && top.recentSeconds > 0) return null;

  return {
    id: `project:${top.p.id}`,
    kind: "project",
    headline:
      top.recentSeconds === 0
        ? `「${top.p.title}」は直近14日間まったく進んでいません`
        : `「${top.p.title}」は残り${top.daysLeft}日に対して進捗が${Math.round(top.progress * 100)}%です`,
    detail: `全${top.stages}段階のうち${top.done}段階が完了、期日まで残り${top.daysLeft}日です。直近14日にこの案件へ充てた時間は${(top.recentSeconds / 3600).toFixed(1)}時間でした。${top.recentSeconds === 0 ? "着手されないまま期日だけが近づいています。" : `残りの${top.stages - top.done}段階を残り日数で割ると、${(need / Math.max(1, top.daysLeft) * top.stages).toFixed(1)}段階/日の消化が必要になります。`}`,
    evidence: [
      { label: "案件", value: top.p.title },
      { label: "進捗", value: `${top.done}/${top.stages}段階` },
      { label: "期日まで", value: `${top.daysLeft}日` },
      { label: "直近14日の投入", value: `${(top.recentSeconds / 3600).toFixed(1)}時間` },
    ],
    confidence: confidenceOf(top.stages, need, 5),
    impact: Math.min(1, need * (top.daysLeft <= 7 ? 1 : 0.6)),
    action:
      top.recentSeconds === 0
        ? `「${top.p.title}」の次の1段階を、今日のワークスペースに載せる`
        : "残り段階のうち、他人の手を待つものを先に着手する",
    counterpoint: "段階の粒度が揃っていない場合、完了数の割合は進み具合を正しく表しません。",
    sampleSize: top.stages,
  };
}

// ---- 8. 稼働の偏り(日ごとのばらつき) ----
function analyzeLoad(ctx: Ctx): Finding | null {
  const byDate = new Map<string, number>();
  for (const r of ctx.records) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  if (byDate.size < 10) return null;
  const totals = [...byDate.values()];
  const m = mean(totals);
  if (m <= 0) return null;
  const sd = Math.sqrt(mean(totals.map((v) => (v - m) ** 2)));
  const cv = sd / m; // 変動係数
  const heavy = totals.filter((v) => v > m * 1.5).length;
  if (cv < 0.45) return null;

  return {
    id: "load",
    kind: "load",
    headline: `1日あたりの実働のばらつきが大きくなっています`,
    detail: `記録のある${byDate.size}日の実働は平均${(m / 3600).toFixed(1)}時間ですが、ばらつき（標準偏差）は${(sd / 3600).toFixed(1)}時間ありました。平均の1.5倍を超えた日が${heavy}日あります。山と谷が大きいと、見積もりの精度も日によって振れやすくなります。`,
    evidence: [
      { label: "対象日数", value: `${byDate.size}日` },
      { label: "1日の平均実働", value: `${(m / 3600).toFixed(1)}時間` },
      { label: "標準偏差", value: `${(sd / 3600).toFixed(1)}時間` },
      { label: "平均の1.5倍を超えた日", value: `${heavy}日` },
    ],
    confidence: confidenceOf(byDate.size, cv, 30),
    impact: Math.min(1, cv),
    action: "山になっている日の作業を、前後の谷の日へ前倒し・後ろ倒しできないか見る",
    counterpoint: "繁忙期と閑散期がはっきりしている業種では、ばらつきの大きさは自然な姿です。",
    sampleSize: byDate.size,
  };
}

// ============================================================
// 全体の組み立て
// ============================================================

export function buildThinking(
  records: WorkRecord[],
  masters: MasterTask[],
  todos: TodoTask[],
  projects: ProjectItem[],
  today: string
): Thinking {
  const steps: ThoughtStep[] = [];
  const since = daysAgoStr(RECENT_DAYS);
  const valid = records.filter((r) => !r.excludedFromStats && r.date >= since);
  steps.push({
    label: "記録を読む",
    note: `直近${RECENT_DAYS}日の実績 ${valid.length}件（集計から除外した記録は最初に外しています）`,
  });

  const estimateById = new Map(masters.map((m) => [m.id, m.estimatedSeconds]));
  const withEstimate = valid
    .map((r) => {
      const est = r.masterTaskId ? estimateById.get(r.masterTaskId) ?? 0 : 0;
      return { r, est, ratio: est > 0 ? r.seconds / est : 0 };
    })
    .filter((w) => w.est > 0);
  steps.push({
    label: "比べられる記録に絞る",
    note: `想定時間が設定されている ${withEstimate.length}件。想定の無い記録は「ずれ」を測れないため、比較からは外します`,
  });

  const ctx: Ctx = { records: valid, withEstimate, today };
  const raw = [
    analyzeCalibration(ctx),
    analyzeRhythm(ctx),
    analyzeWeekday(ctx),
    analyzeFragmentation(ctx),
    analyzeTrouble(ctx),
    analyzeStale(todos, today),
    analyzeProjects(projects, valid, today),
    analyzeLoad(ctx),
  ];
  const attempted = raw.length;
  const findings = raw.filter((f): f is Finding => f !== null);
  steps.push({
    label: "8つの観点で確かめる",
    note: `見積もりの偏り・時間帯・曜日・細切れ・突発・滞留・案件・稼働の偏りを順に調べ、${attempted}件のうち根拠が足りたのは ${findings.length}件でした`,
  });

  // 影響の大きさ×確信度で並べる。確信が持てないものを上に出さない
  findings.sort((a, b) => b.impact * b.confidence - a.impact * a.confidence);
  steps.push({
    label: "並べ替える",
    note: "影響の大きさと確信度を掛け合わせた順です。確信が持てないものは、たとえ影響が大きくても上には出しません",
  });

  return { findings, steps, usableRecords: valid.length };
}

/** 確信度の言い換え。数値だけだと読み手が解釈しづらいので、言葉も添える */
export function confidenceLabel(c: number): string {
  if (c >= 0.7) return "確度が高い";
  if (c >= 0.45) return "傾向として見える";
  return "参考程度";
}

// ============================================================
// 較正図(想定 vs 実績)のための点
// ============================================================
// 見積もりの話をするときに、いちばん多くを語るのがこの散布図。
// 45度線の上にあれば超過、下にあれば早く終わった、ということが一目で分かる。

export interface CalibrationPoint {
  estimateMinutes: number;
  actualMinutes: number;
  category: string;
  name: string;
  over: boolean;
}

export function buildCalibration(records: WorkRecord[], masters: MasterTask[]): CalibrationPoint[] {
  const since = daysAgoStr(RECENT_DAYS);
  const estimateById = new Map(masters.map((m) => [m.id, m.estimatedSeconds]));
  const points: CalibrationPoint[] = [];
  for (const r of records) {
    if (r.excludedFromStats || r.date < since || !r.masterTaskId) continue;
    const est = estimateById.get(r.masterTaskId) ?? 0;
    if (est <= 0) continue;
    points.push({
      estimateMinutes: est / 60,
      actualMinutes: r.seconds / 60,
      category: r.category,
      name: r.name,
      over: r.seconds > est,
    });
  }
  return points;
}
