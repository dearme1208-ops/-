import type { DailyTask, MasterTask, WorkRecord } from "./types";

// Lobotomy Corporation風モード(管理局モード)の中身。
//
// 元ゲームは「収容した異常存在(アブノーマリティ)に職員を送り込んで作業させ、
// その日のエネルギー目標を満たす」という管理シミュレータで、次の骨格を持つ。
//
//   ・作業は本能 / 洞察 / 愛着 / 抑制 の4種。どれを選ぶかで結果が変わり、
//     同時に職員の4つの能力値(剛毅 / 慎重 / 自制 / 正義)が育つ
//   ・作業の結果としてPEボックス(成功) / NEボックス(失敗)が出て、目標を満たす
//   ・各個体はZAYIN→TETH→HE→WAW→ALEPHの危険度と、キリパス・カウンタを持つ。
//     カウンタがゼロになると収容違反(暴走)
//   ・超過事態はキリパス融解として赤く点滅し、放置するとエネルギーを失う
//   ・危機の度合いは「ラッパ」(第一/第二/第三)という警報段階で示される
//   ・個体は観測レベルが上がるほど図鑑の項目が開示されていく
//
// このモジュールの方針は怪異調査モードと同じで、ゲームの数値は一切でっち上げない。
// 危険度も、カウンタも、能力値も、すべて実際の作業マスタ・実績・本日の作業から
// 決まる。つまり「異常に見える個体」は、本当に見積もりが壊れている作業である。

// ---- 危険度(ZAYIN〜ALEPH) ----
// しきい値は既存のRISK_TIERS_LOBOTOMYと同じ。あちらは「今まさに超過中の作業」に、
// こちらは「その作業マスタの平常時の癖」に対して使う
export type RiskLevel = "ZAYIN" | "TETH" | "HE" | "WAW" | "ALEPH";

const RISK_ORDER: RiskLevel[] = ["ZAYIN", "TETH", "HE", "WAW", "ALEPH"];

export function riskLevelFromRatio(ratio: number): RiskLevel {
  if (ratio >= 4) return "ALEPH";
  if (ratio >= 2.5) return "WAW";
  if (ratio >= 1.8) return "HE";
  if (ratio >= 1.3) return "TETH";
  return "ZAYIN";
}

export function riskRank(level: RiskLevel): number {
  return RISK_ORDER.indexOf(level);
}

// ---- 作業種別 ----
// 元ゲームでは4種の作業が4つの能力値をそれぞれ育てる。ここでも同じ対応にしつつ、
// 「選ぶと想定時間が実際に変わる」という形で業務データに接続する
export type WorkType = "instinct" | "insight" | "attachment" | "repression";

export const WORK_TYPES: WorkType[] = ["instinct", "insight", "attachment", "repression"];

export interface WorkTypeDef {
  key: WorkType;
  virtue: Virtue; // この作業で育つ能力値(元ゲームと同じ対応)
}

export const WORK_TYPE_DEFS: Record<WorkType, WorkTypeDef> = {
  instinct: { key: "instinct", virtue: "fortitude" },
  insight: { key: "insight", virtue: "prudence" },
  attachment: { key: "attachment", virtue: "temperance" },
  repression: { key: "repression", virtue: "justice" },
};

// その作業種別で着手したときに、実際に書き込まれる想定時間。
// 洞察だけは「実績の中央値に合わせる」ため、履歴が要る
export function estimateForWork(type: WorkType, baseSeconds: number, medianActualSeconds: number | null): number {
  const base = baseSeconds > 0 ? baseSeconds : 1800;
  if (type === "instinct") return base;
  if (type === "attachment") return Math.round(base * 1.5);
  if (type === "repression") return Math.max(60, Math.round(base * 0.75));
  // 洞察: 実績があるならそれに合わせる(無ければ据え置き)
  return medianActualSeconds && medianActualSeconds > 0 ? Math.round(medianActualSeconds) : base;
}

// ---- 職員の能力値(4つの徳) ----
export type Virtue = "fortitude" | "prudence" | "temperance" | "justice";

export const VIRTUES: Virtue[] = ["fortitude", "prudence", "temperance", "justice"];

export interface VirtueState {
  virtue: Virtue;
  level: number; // 1〜5(元ゲームの等級表示に合わせる)
  ratio: number; // 0〜1。ゲージの伸び
  detail: string; // 何を測った数字なのかを必ず添える
}

function levelOf(ratio: number): number {
  const r = Math.max(0, Math.min(1, ratio));
  return Math.min(5, Math.max(1, Math.floor(r * 5) + 1));
}

// 4つの能力値は「作業種別を何回押したか」ではなく、実際の働き方から出す。
// ボタンの押下回数を能力値にすると、押すだけで伸びる無意味な数字になってしまうため
export function buildVirtues(input: {
  workedSecondsToday: number;
  estimateAccuracy: number; // 0〜1。想定と実績のズレの小ささ
  withinEstimateRate: number; // 0〜1。想定内に収めた割合
  streakDays: number;
}): VirtueState[] {
  const nominalDay = 8 * 3600;
  const fortitudeRatio = Math.min(1, input.workedSecondsToday / nominalDay);
  const justiceRatio = Math.min(1, input.streakDays / 20);
  return [
    {
      virtue: "fortitude",
      level: levelOf(fortitudeRatio),
      ratio: fortitudeRatio,
      detail: `本日の実働 ${Math.round(input.workedSecondsToday / 60)}分 / 8時間`,
    },
    {
      virtue: "prudence",
      level: levelOf(input.estimateAccuracy),
      ratio: input.estimateAccuracy,
      detail: `見積もりと実績の一致度 ${Math.round(input.estimateAccuracy * 100)}%`,
    },
    {
      virtue: "temperance",
      level: levelOf(input.withinEstimateRate),
      ratio: input.withinEstimateRate,
      detail: `想定内で完了した割合 ${Math.round(input.withinEstimateRate * 100)}%`,
    },
    {
      virtue: "justice",
      level: levelOf(justiceRatio),
      ratio: justiceRatio,
      detail: `連続稼働 ${input.streakDays}日 / 20日`,
    },
  ];
}

// ---- 個体(作業マスタ) ----
export interface Abnormality {
  masterId: string;
  category: string;
  name: string;
  subjectNumber: string; // O-01-23 形式。カテゴリと名前から決まるので毎回同じ番号になる
  riskLevel: RiskLevel;
  estimatedSeconds: number;
  sampleCount: number; // 実績の件数
  medianActualSeconds: number | null;
  meanRatio: number; // 実績 / 想定 の平均。1.0なら見積もり通り
  qliphothCounter: number; // 0〜4。直近の実績のうち想定内に収まった回数
  qliphothMax: number;
  observationLevel: number; // 0〜4。実績が増えるほど図鑑が開く
  breached: boolean; // カウンタ0 = 収容違反(この作業の見積もりは常に外れている)
  recommended: WorkType; // 実績から見た「効く」作業種別
}

// カテゴリと名前から決定的に採番する。同じ作業には必ず同じ番号がつく
export function subjectNumberOf(category: string, name: string): string {
  const seed = `${category}/${name}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const dept = (h % 9) + 1; // O-01 〜 O-09
  const serial = ((h >>> 8) % 99) + 1;
  return `O-${String(dept).padStart(2, "0")}-${String(serial).padStart(2, "0")}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 実績の癖から「効く作業種別」を決める。演出としての助言ではなく、
// そのまま読める実務的な提案になっている:
//   ・いつも想定より早く終わる → 抑制(想定を締める)
//   ・いつも想定を超える       → 愛着(想定に余裕を持たせる)
//   ・ばらつきが大きい         → 洞察(実績の中央値に置き直す)
//   ・実績が足りない           → 本能(まずは一度やってみる)
function recommendWork(ratios: number[]): WorkType {
  if (ratios.length < 2) return "instinct";
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const spread = Math.sqrt(ratios.reduce((a, r) => a + (r - mean) ** 2, 0) / ratios.length);
  if (spread >= 0.5) return "insight";
  if (mean >= 1.2) return "attachment";
  if (mean <= 0.8) return "repression";
  return "instinct";
}

const QLIPHOTH_MAX = 4;
// キリパス・カウンタが減らない上限(想定の5%増まで)。文言もこの値に合わせて書くこと
export const QLIPHOTH_TOLERANCE = 1.05;

export function buildAbnormality(master: MasterTask, records: WorkRecord[]): Abnormality {
  const mine = records
    .filter((r) => !r.excludedFromStats && (r.masterTaskId === master.id || (r.category === master.category && r.name === master.name)))
    .sort((a, b) => b.endedAt - a.endedAt);
  const base = master.estimatedSeconds > 0 ? master.estimatedSeconds : 0;
  const actuals = mine.map((r) => r.seconds).filter((s) => s > 0);
  const ratios = base > 0 ? actuals.map((s) => s / base) : [];
  const meanRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;

  // キリパス・カウンタ: 直近4件のうち、想定の5%増以内で終えた回数。
  // ゼロ = 直近ずっと超過している = 収容違反(見積もりが壊れている)。
  // ここは「想定を守れたか」ではなく「その想定時間がもう現実と合っていないか」を
  // 見るための指標なので、数%の誤差で警告を出さないよう意図的に猶予を持たせている。
  // その代わり表示側では「想定内」と言い切らず、猶予があることが分かる文言にしている
  const recent = ratios.slice(0, QLIPHOTH_MAX);
  const counter = recent.length === 0 ? QLIPHOTH_MAX : recent.filter((r) => r <= QLIPHOTH_TOLERANCE).length;

  return {
    masterId: master.id,
    category: master.category,
    name: master.name,
    subjectNumber: subjectNumberOf(master.category, master.name),
    riskLevel: riskLevelFromRatio(meanRatio),
    estimatedSeconds: base,
    sampleCount: actuals.length,
    medianActualSeconds: median(actuals),
    meanRatio,
    qliphothCounter: counter,
    qliphothMax: QLIPHOTH_MAX,
    observationLevel: Math.min(4, actuals.length),
    breached: recent.length > 0 && counter === 0,
    recommended: recommendWork(ratios),
  };
}

export function buildAbnormalityIndex(masters: MasterTask[], records: WorkRecord[]): Abnormality[] {
  return masters
    .filter((m) => !m.archived)
    .map((m) => buildAbnormality(m, records))
    .sort((a, b) => riskRank(b.riskLevel) - riskRank(a.riskLevel) || b.sampleCount - a.sampleCount);
}

// ---- エネルギー(その日の目標) ----
export interface EnergyState {
  quotaSeconds: number; // 本日の想定時間の合計
  generatedSeconds: number; // 完了した作業の想定時間の合計
  peBoxes: number; // 想定内に収めて完了した件数
  neBoxes: number; // 想定を超えて完了した件数
  totalBoxes: number; // 本日の作業件数(= 目標の箱数)
  percent: number; // 0〜100
}

export function buildEnergyState(tasks: DailyTask[], elapsedSecondsOf: (t: DailyTask) => number): EnergyState {
  const real = tasks.filter((t) => !t.isProvisional);
  let quota = 0;
  let generated = 0;
  let pe = 0;
  let ne = 0;
  for (const t of real) {
    quota += t.estimatedSeconds;
    if (t.status === "done") {
      generated += t.estimatedSeconds;
      const over = t.estimatedSeconds > 0 && elapsedSecondsOf(t) > t.estimatedSeconds;
      if (over) ne += 1;
      else pe += 1;
    }
  }
  return {
    quotaSeconds: quota,
    generatedSeconds: generated,
    peBoxes: pe,
    neBoxes: ne,
    totalBoxes: real.length,
    percent: quota > 0 ? Math.min(100, Math.round((generated / quota) * 100)) : 0,
  };
}

// ---- キリパス融解(超過事態) ----
export interface Meltdown {
  task: DailyTask;
  overSeconds: number; // 想定をどれだけ超えているか
  level: number; // 1〜4。超過の度合い
}

export function findMeltdowns(tasks: DailyTask[], elapsedSecondsOf: (t: DailyTask) => number): Meltdown[] {
  const out: Meltdown[] = [];
  for (const t of tasks) {
    if (t.isProvisional || t.status === "done" || t.status === "pending") continue;
    if (t.estimatedSeconds <= 0) continue;
    const elapsed = elapsedSecondsOf(t);
    if (elapsed <= t.estimatedSeconds) continue;
    const ratio = elapsed / t.estimatedSeconds;
    out.push({
      task: t,
      overSeconds: Math.round(elapsed - t.estimatedSeconds),
      level: ratio >= 4 ? 4 : ratio >= 2.5 ? 3 : ratio >= 1.8 ? 2 : 1,
    });
  }
  return out.sort((a, b) => b.level - a.level || b.overSeconds - a.overSeconds);
}

// ---- 警報段階(ラッパ) ----
// 元ゲームの第一/第二/第三のラッパに倣い、危機の度合いを3段階で示す
export interface AlarmState {
  trumpet: 0 | 1 | 2 | 3;
  reason: string;
}

export function buildAlarm(meltdowns: Meltdown[], isNight: boolean): AlarmState {
  if (meltdowns.length === 0) {
    return { trumpet: 0, reason: isNight ? "深夜帯。稼働中の超過はなし" : "超過している作業はありません" };
  }
  const worst = meltdowns[0].level;
  const count = meltdowns.length;
  if (worst >= 3 || count >= 3) {
    return { trumpet: 3, reason: `${count}件が想定を大きく超過中` };
  }
  if (worst >= 2 || count >= 2) {
    return { trumpet: 2, reason: `${count}件が想定を超過中` };
  }
  return { trumpet: 1, reason: "1件が想定を超過中" };
}

// ---- 時間帯イベント(オーディール) ----
export type OrdealKind = "dawn" | "noon" | "dusk" | "midnight" | "none";

export interface OrdealState {
  kind: OrdealKind;
  hour: number;
}

// 元ゲームは黎明・正午・黄昏・真夜中の順に試練が来る。ここでは実際の時計に対応させ、
// 「いま一日のどこにいるか」を示す指標として使う
export function ordealOf(date: Date = new Date()): OrdealState {
  const h = date.getHours();
  if (h >= 22 || h < 5) return { kind: "midnight", hour: h };
  if (h >= 17) return { kind: "dusk", hour: h };
  if (h >= 11 && h < 14) return { kind: "noon", hour: h };
  if (h >= 5 && h < 11) return { kind: "dawn", hour: h };
  return { kind: "none", hour: h };
}

// ---- 集計の下ごしらえ ----
// 見積もり精度(1に近いほど想定と実績が一致)と、想定内完了率
export function estimateAccuracyOf(records: WorkRecord[], masters: MasterTask[]): number {
  const byKey = new Map<string, number>();
  for (const m of masters) {
    if (m.estimatedSeconds > 0) byKey.set(`${m.category}/${m.name}`, m.estimatedSeconds);
  }
  const diffs: number[] = [];
  for (const r of records) {
    if (r.excludedFromStats || r.seconds <= 0) continue;
    const est = byKey.get(`${r.category}/${r.name}`);
    if (!est) continue;
    diffs.push(Math.min(1, Math.abs(r.seconds - est) / est));
  }
  if (diffs.length === 0) return 0;
  return 1 - diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

export function withinEstimateRateOf(tasks: DailyTask[], elapsedSecondsOf: (t: DailyTask) => number): number {
  const done = tasks.filter((t) => t.status === "done" && t.estimatedSeconds > 0 && !t.isProvisional);
  if (done.length === 0) return 0;
  const within = done.filter((t) => elapsedSecondsOf(t) <= t.estimatedSeconds).length;
  return within / done.length;
}
