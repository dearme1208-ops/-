import type { DailyTask, MasterTask, ProjectItem, TodoTask, WorkRecord } from "./types";

// パワプロ風モード(育成選手モード)の判定ロジック。
//
// 元ネタのサクセスは「限られたターンの中で、練習で経験点を貯め、体力とやる気を管理しながら
// 能力値を上げていく」ゲームで、画面の主役は ①ターン表示 ②体力/やる気 ③練習コマンド
// ④経験点 ⑤能力値カード の5つ。このファイルはその5つを、すべて実績(WorkRecord)・
// 本日の作業(DailyTask)・ToDo・案件から決定的に導出する。
//
// 他モードと同じ大原則: 演出のための乱数も、水増しした数値も一切置かない。
// 表示される数字はすべて実データの言い換えであり、根拠(reason)を必ず持たせる。

const NOMINAL_DAY_SECONDS = 8 * 3600;
const RECENT_DAYS = 30;

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ============================================================
// ターン(年・月・週)
// ============================================================
// サクセスは「高校3年 9月 1週」のようにターンが進む。ここでは架空の学年を作らず、
// 実際のカレンダーと「最初の実績を付けた年」からの経過年数をそのまま当てはめる。

export interface TurnState {
  year: number; // 育成N年目(最初の実績の年を1年目とする)
  month: number;
  weekOfMonth: number; // 1〜5
  remainingTurns: number; // 本日まだ着手していない作業の件数
  usedTurns: number; // 本日すでに完了した件数
  dateLabel: string; // YYYY-MM-DD
}

export function buildTurnState(today: string, records: WorkRecord[], tasks: DailyTask[]): TurnState {
  const firstDate = records.reduce<string | null>((min, r) => (min === null || r.date < min ? r.date : min), null);
  const thisYear = Number(today.slice(0, 4));
  const firstYear = firstDate ? Number(firstDate.slice(0, 4)) : thisYear;
  const day = Number(today.slice(8, 10));
  return {
    year: Math.max(1, thisYear - firstYear + 1),
    month: Number(today.slice(5, 7)),
    weekOfMonth: Math.min(5, Math.floor((day - 1) / 7) + 1),
    remainingTurns: tasks.filter((t) => t.status === "pending" || t.status === "paused").length,
    usedTurns: tasks.filter((t) => t.status === "done").length,
    dateLabel: today,
  };
}

// ============================================================
// 経験点(5色)
// ============================================================
// サクセスの経験点は筋力・敏捷・技術・変化球・精神の5種類。
// それぞれに「実データのどの側面か」を割り当てる。同じデータからは常に同じ点数が出る。

export type ExpKind = "muscle" | "agility" | "technique" | "breaking" | "mental";

export interface ExpSource {
  kind: ExpKind;
  value: number;
  /** その点数がどの実データから出たのかを、画面にそのまま出せる短い文で持つ */
  reason: string;
}

export function buildExperience(records: WorkRecord[], streakDays: number): ExpSource[] {
  const since = daysAgoStr(RECENT_DAYS);
  const valid = records.filter((r) => !r.excludedFromStats);
  const recent = valid.filter((r) => r.date >= since);

  const totalHours = valid.reduce((s, r) => s + r.seconds, 0) / 3600;
  const categories = new Set(recent.map((r) => r.category)).size;
  const kinds = new Set(recent.map((r) => r.masterTaskId ?? `${r.category}::${r.name}`)).size;
  const troubles = recent.filter((r) => r.isTrouble).length;

  return [
    {
      kind: "muscle",
      value: Math.round(totalHours * 3),
      reason: `これまでの実働 ${totalHours.toFixed(1)}時間`,
    },
    {
      kind: "agility",
      value: categories * 45,
      reason: `直近${RECENT_DAYS}日で扱った業務区分 ${categories}種`,
    },
    {
      kind: "technique",
      value: kinds * 20,
      reason: `直近${RECENT_DAYS}日で扱った作業 ${kinds}種`,
    },
    {
      kind: "breaking",
      value: troubles * 35,
      reason: `直近${RECENT_DAYS}日のトラブル対応 ${troubles}件`,
    },
    {
      kind: "mental",
      value: streakDays * 25,
      reason: `連続記録 ${streakDays}日`,
    },
  ];
}

// ============================================================
// 能力値(6種)
// ============================================================
// パワプロの野手能力はミート/パワー/走力/肩力/守備力/捕球の6つで、
// 数値とG〜Sのランクの両方が表示される。ここでも同じ形にする。

export type AbilityKey = "meet" | "power" | "speed" | "arm" | "field" | "catch";

export const ABILITY_KEYS: AbilityKey[] = ["meet", "power", "speed", "arm", "field", "catch"];

export interface Ability {
  key: AbilityKey;
  /** 1〜150。パワプロの野手能力と同じ上限に合わせている */
  value: number;
  rank: string; // G〜S
  reason: string;
}

const RANK_TABLE: { min: number; rank: string }[] = [
  { min: 130, rank: "S" },
  { min: 110, rank: "A" },
  { min: 90, rank: "B" },
  { min: 70, rank: "C" },
  { min: 55, rank: "D" },
  { min: 40, rank: "E" },
  { min: 25, rank: "F" },
  { min: 0, rank: "G" },
];

export function rankOf(value: number): string {
  return RANK_TABLE.find((r) => value >= r.min)?.rank ?? "G";
}

/** 0〜1の割合を1〜150の能力値に均す。0.5が丁度Cのあたりに来るように定めた */
function toAbilityValue(ratio: number): number {
  return Math.max(1, Math.min(150, Math.round(1 + clamp01(ratio) * 149)));
}

export function buildAbilities(
  records: WorkRecord[],
  todos: TodoTask[],
  masters: MasterTask[]
): Ability[] {
  const since = daysAgoStr(RECENT_DAYS);
  const valid = records.filter((r) => !r.excludedFromStats);
  const recent = valid.filter((r) => r.date >= since);
  const estimateById = new Map(masters.map((m) => [m.id, m.estimatedSeconds]));

  // ミート: 想定時間の内に収まった実績の割合。狙ったところに当てられているか。
  // 判定はアプリ共通の「想定超過」と同じく厳密(1秒でも超えたら超過)にする。
  // ここだけ1割の猶予を持たせると、練習コマンドに⚠想定超過が出ている作業を
  // 同じ画面で「想定時間に収まった」と数えることになり、表示が食い違う
  const withEstimate = recent.filter((r) => r.masterTaskId && (estimateById.get(r.masterTaskId) ?? 0) > 0);
  const onTarget = withEstimate.filter((r) => r.seconds <= (estimateById.get(r.masterTaskId!) ?? 0)).length;
  const meetRatio = withEstimate.length > 0 ? onTarget / withEstimate.length : 0;

  // パワー: 1日あたりの平均実働時間。8時間で満点に近づく
  const dayTotals = new Map<string, number>();
  for (const r of recent) dayTotals.set(r.date, (dayTotals.get(r.date) ?? 0) + r.seconds);
  const activeDays = dayTotals.size;
  const avgDaySeconds = activeDays > 0 ? [...dayTotals.values()].reduce((s, v) => s + v, 0) / activeDays : 0;
  const powerRatio = avgDaySeconds / NOMINAL_DAY_SECONDS;

  // 走力: 1日あたりの平均完了件数。8件で満点に近づく
  const dayCounts = new Map<string, number>();
  for (const r of recent) dayCounts.set(r.date, (dayCounts.get(r.date) ?? 0) + 1);
  const avgDayCount = activeDays > 0 ? [...dayCounts.values()].reduce((s, v) => s + v, 0) / activeDays : 0;
  const speedRatio = avgDayCount / 8;

  // 肩力: 1日の最大実働時間。瞬間的にどれだけ出せるか
  const maxDaySeconds = dayTotals.size > 0 ? Math.max(...dayTotals.values()) : 0;
  const armRatio = maxDaySeconds / (10 * 3600);

  // 守備力: トラブル対応でない実績の割合。突発の割り込みをどれだけ防げているか
  // (想定時間を守れたかどうかとは別の軸。そちらはミートが受け持つ)
  const troubleRate = recent.length > 0 ? recent.filter((r) => r.isTrouble).length / recent.length : 0;
  const fieldRatio = recent.length > 0 ? 1 - troubleRate : 0;

  // 捕球: 期日のあるToDoを期日までに完了できた割合。取りこぼしの少なさ
  const dueTodos = todos.filter((t) => t.dueDate);
  const caught = dueTodos.filter((t) => {
    if (!t.completed || !t.completedAt) return false;
    const done = new Date(t.completedAt);
    const doneStr = `${done.getFullYear()}-${String(done.getMonth() + 1).padStart(2, "0")}-${String(done.getDate()).padStart(2, "0")}`;
    return doneStr <= (t.dueDate ?? "");
  }).length;
  const catchRatio = dueTodos.length > 0 ? caught / dueTodos.length : 0;

  const build = (key: AbilityKey, ratio: number, reason: string): Ability => {
    const value = toAbilityValue(ratio);
    return { key, value, rank: rankOf(value), reason };
  };

  return [
    build(
      "meet",
      meetRatio,
      withEstimate.length > 0
        ? `想定時間に収まった実績 ${onTarget}/${withEstimate.length}件`
        : "想定時間つきの実績がまだありません"
    ),
    build(
      "power",
      powerRatio,
      activeDays > 0 ? `1日あたりの実働 平均${(avgDaySeconds / 3600).toFixed(1)}時間` : "直近の実績がありません"
    ),
    build("speed", speedRatio, activeDays > 0 ? `1日あたり 平均${avgDayCount.toFixed(1)}件を完了` : "直近の実績がありません"),
    build("arm", armRatio, maxDaySeconds > 0 ? `1日の最大実働 ${(maxDaySeconds / 3600).toFixed(1)}時間` : "直近の実績がありません"),
    build(
      "field",
      fieldRatio,
      recent.length > 0
        ? `トラブル対応は ${recent.filter((r) => r.isTrouble).length}/${recent.length}件`
        : "直近の実績がありません"
    ),
    build("catch", catchRatio, dueTodos.length > 0 ? `期日内に完了したToDo ${caught}/${dueTodos.length}件` : "期日つきのToDoがありません"),
  ];
}

/** 6能力の合計から選手ランクを出す。オールA(6つとも110以上)なら文句なしのSランク */
export function playerRankOf(abilities: Ability[]): { rank: string; total: number; allA: boolean } {
  const total = abilities.reduce((s, a) => s + a.value, 0);
  const allA = abilities.length > 0 && abilities.every((a) => a.value >= 110);
  return { rank: allA ? "S" : rankOf(Math.round(total / Math.max(1, abilities.length))), total, allA };
}

// ============================================================
// 体力・やる気
// ============================================================
// サクセスでは体力が減るとケガ率が上がり、やる気が低いと練習効率が落ちる。
// ここでは体力を「1日8時間に対する残り」、やる気を「本日の見積もり精度」に対応させる。

export type MotivationLevel = 0 | 1 | 2 | 3 | 4; // 0=絶不調 〜 4=絶好調

export interface Condition {
  staminaPercent: number; // 0〜100
  staminaSeconds: number; // 残り想定可働秒数
  workedSeconds: number;
  motivation: MotivationLevel;
  motivationReason: string;
  injuryRisk: number; // 0〜1。体力の減りと超過の大きさから
  injuryReason: string;
}

export function buildCondition(
  tasks: DailyTask[],
  elapsedSecondsOf: (t: DailyTask) => number
): Condition {
  const workedSeconds = tasks.reduce((s, t) => s + elapsedSecondsOf(t), 0);
  const staminaSeconds = Math.max(0, NOMINAL_DAY_SECONDS - workedSeconds);
  const staminaPercent = Math.round((staminaSeconds / NOMINAL_DAY_SECONDS) * 100);

  // やる気: 本日完了した作業のうち、想定時間に収まった割合。
  // 判定は練習コマンドの⚠想定超過と同じ厳密なものにする(同一画面で矛盾させない)
  const done = tasks.filter((t) => t.status === "done" && t.estimatedSeconds > 0);
  const inside = done.filter((t) => elapsedSecondsOf(t) <= t.estimatedSeconds).length;
  let motivation: MotivationLevel;
  let motivationReason: string;
  if (done.length === 0) {
    motivation = 2;
    motivationReason = "本日はまだ完了した作業がありません";
  } else {
    const rate = inside / done.length;
    motivation = rate >= 0.85 ? 4 : rate >= 0.6 ? 3 : rate >= 0.4 ? 2 : rate >= 0.2 ? 1 : 0;
    motivationReason = `本日完了した${done.length}件のうち ${inside}件が想定時間に収まりました`;
  }

  // ケガの危険: 想定を超えた分の合計が、想定の合計に対してどれだけあるか
  let over = 0;
  let base = 0;
  for (const t of tasks) {
    if (t.estimatedSeconds <= 0) continue;
    base += t.estimatedSeconds;
    over += Math.max(0, elapsedSecondsOf(t) - t.estimatedSeconds);
  }
  const overRatio = base > 0 ? over / base : 0;
  const injuryRisk = clamp01(overRatio * 0.6 + (1 - staminaPercent / 100) * 0.4);

  return {
    staminaPercent,
    staminaSeconds,
    workedSeconds,
    motivation,
    motivationReason,
    injuryRisk,
    injuryReason:
      base > 0
        ? `想定合計 ${Math.round(base / 60)}分に対し ${Math.round(over / 60)}分の超過`
        : "想定時間つきの作業がまだありません",
  };
}

// ============================================================
// 熱血ゲージ(進捗)
// ============================================================
// 赤特訓のゲージに相当する。本日の予定をどこまで消化したかをそのまま入れる。

export interface HotGauge {
  filled: number; // 0〜1
  done: number;
  total: number;
  fever: boolean; // すべて消化しきったらフィーバー
}

export function buildHotGauge(tasks: DailyTask[]): HotGauge {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const filled = total > 0 ? done / total : 0;
  return { filled, done, total, fever: total > 0 && done === total };
}

// ============================================================
// 練習コマンド
// ============================================================
// サクセスの練習コマンドは「どの練習を選ぶと、どの経験点がいくつ入るか」が見える。
// ここでは本日の各作業をそのままコマンドにし、区分から得意な経験点の色を決める。

export type PracticeKind = "batting" | "running" | "pitching" | "fielding" | "catching" | "mental";

export const PRACTICE_EXP: Record<PracticeKind, ExpKind> = {
  batting: "muscle",
  running: "agility",
  pitching: "breaking",
  fielding: "technique",
  catching: "technique",
  mental: "mental",
};

/** 業務区分と作業名から、決定的に練習の種目を割り当てる。同じ作業は常に同じ種目になる */
export function practiceKindOf(category: string, name: string): PracticeKind {
  const t = `${category} ${name}`;
  // 判定は具体的なものから順に。「障害対応」のように複数に当てはまる名前は、
  // より限定的な語(トラブル系)を先に見ないと汎用の「対応」に吸われてしまう
  if (/(トラブル|障害|不具合|クレーム|緊急|復旧)/i.test(t)) return "pitching";
  if (/(会議|打合|打ち合わせ|ミーティング|MTG|商談|訪問|来客)/i.test(t)) return "catching";
  if (/(資料|作成|作図|設計|図面|見積|見積り|見積もり|提案)/i.test(t)) return "batting";
  if (/(確認|チェック|レビュー|検査|検証|test|テスト)/i.test(t)) return "fielding";
  if (/(メール|連絡|電話|問合|問い合わせ|対応|サポート)/i.test(t)) return "running";
  if (/(整理|片付|事務|入力|集計|報告|日報)/i.test(t)) return "mental";
  // どれにも当てはまらない場合も、名前から決定的に散らす(同じ名前は常に同じ種目)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const kinds: PracticeKind[] = ["batting", "running", "pitching", "fielding", "catching", "mental"];
  return kinds[h % kinds.length];
}

export interface PracticeCommand {
  taskId: string;
  name: string;
  category: string;
  kind: PracticeKind;
  expKind: ExpKind;
  /** この作業をやり切ると入る経験点。想定時間(分)をそのまま点にしている */
  expGain: number;
  estimatedSeconds: number;
  elapsedSeconds: number;
  status: DailyTask["status"];
  progress: number; // 0〜1超。1を超えたら想定超過
  overrunSeconds: number;
  /** 得意練習(直近でいちばん多く取り組んでいる区分)なら true。パワプロの得意練習と同じ扱い */
  favorite: boolean;
}

export function buildCommands(
  tasks: DailyTask[],
  elapsedSecondsOf: (t: DailyTask) => number,
  favoriteCategory: string | null
): PracticeCommand[] {
  return tasks.map((t) => {
    const elapsed = elapsedSecondsOf(t);
    const kind = practiceKindOf(t.category, t.name);
    return {
      taskId: t.id,
      name: t.name,
      category: t.category,
      kind,
      expKind: PRACTICE_EXP[kind],
      expGain: Math.max(1, Math.round(t.estimatedSeconds / 60)),
      estimatedSeconds: t.estimatedSeconds,
      elapsedSeconds: elapsed,
      status: t.status,
      progress: t.estimatedSeconds > 0 ? elapsed / t.estimatedSeconds : 0,
      overrunSeconds: Math.max(0, elapsed - t.estimatedSeconds),
      favorite: favoriteCategory !== null && t.category === favoriteCategory,
    };
  });
}

/** 直近でいちばん多く取り組んでいる業務区分 = 得意練習 */
export function favoriteCategoryOf(records: WorkRecord[]): string | null {
  const since = daysAgoStr(RECENT_DAYS);
  const counts = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats || r.date < since) continue;
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

// ============================================================
// 特殊能力
// ============================================================
// パワプロの特殊能力は金(強)・青(並)・赤(マイナス)の3色で表示される。
// ここでも実データの閾値だけで付け外しし、必ず根拠を添える。

export type AbilityColor = "gold" | "blue" | "red";

export interface SpecialAbility {
  name: string;
  /** 文言オフのときの呼び名。バッジの色・条件・根拠はそのままで、言葉だけ工程表のものに戻す */
  plainName: string;
  color: AbilityColor;
  reason: string;
}

export function buildSpecialAbilities(
  records: WorkRecord[],
  todos: TodoTask[],
  abilities: Ability[],
  streakDays: number,
  condition: Condition
): SpecialAbility[] {
  const since = daysAgoStr(RECENT_DAYS);
  const recent = records.filter((r) => !r.excludedFromStats && r.date >= since);
  const out: SpecialAbility[] = [];
  const byKey = new Map(abilities.map((a) => [a.key, a]));

  const meet = byKey.get("meet");
  if (meet && meet.value >= 110) out.push({ name: "チャンス◎", plainName: "見積もり精度が高い", color: "gold", reason: meet.reason });
  else if (meet && meet.value >= 70) out.push({ name: "チャンス○", plainName: "見積もりがおおむね正確", color: "blue", reason: meet.reason });

  const troubles = recent.filter((r) => r.isTrouble).length;
  if (troubles >= 10) out.push({ name: "対ピンチ◎", plainName: "トラブル対応の経験が豊富", color: "gold", reason: `直近${RECENT_DAYS}日で${troubles}件のトラブルを処理` });
  else if (troubles >= 3) out.push({ name: "対ピンチ○", plainName: "トラブル対応の経験あり", color: "blue", reason: `直近${RECENT_DAYS}日で${troubles}件のトラブルを処理` });

  if (streakDays >= 20) out.push({ name: "不屈の魂", plainName: "記録の継続が長い", color: "gold", reason: `${streakDays}日連続で記録を継続中` });
  else if (streakDays >= 5) out.push({ name: "粘り強さ", plainName: "記録を継続中", color: "blue", reason: `${streakDays}日連続で記録を継続中` });

  const catchA = byKey.get("catch");
  if (catchA && catchA.value >= 110) out.push({ name: "守備職人", plainName: "期日を守れている", color: "gold", reason: catchA.reason });

  const variety = new Set(recent.map((r) => r.category)).size;
  if (variety >= 6) out.push({ name: "ムードメーカー", plainName: "幅広い区分を担当", color: "blue", reason: `直近${RECENT_DAYS}日で${variety}種の業務区分を担当` });

  const overdue = todos.filter((t) => !t.completed && t.dueDate && t.dueDate < daysAgoStr(0)).length;
  if (overdue >= 5) out.push({ name: "エラー", plainName: "期限切れが多い", color: "red", reason: `期限を過ぎたToDoが${overdue}件たまっています` });

  if (condition.staminaPercent <= 15) out.push({ name: "疲れやすさ", plainName: "長時間の稼働", color: "red", reason: `本日すでに ${Math.round(condition.workedSeconds / 3600 * 10) / 10}時間 稼働しています` });

  if (condition.injuryRisk >= 0.6) out.push({ name: "故障しやすい", plainName: "超過が大きい", color: "red", reason: condition.injuryReason });

  return out;
}

// ============================================================
// スカウト評価(ToDo)
// ============================================================
// ToDoタブは「スカウトリスト」。1件を1人の候補選手に見立て、期日までの余裕と重要度から
// 評価(S〜C)を付ける。順位付けの意味はもとの並びと同じで、見え方だけが変わる。

export interface ScoutGrade {
  grade: string; // S / A / B / C
  urgency: number; // 0〜1。期日が近いほど1に寄る
  label: string;
  /** 文言オフのときの表示。評価そのもの(grade/urgency)は変わらず、呼び名だけ戻す */
  labelPlain: string;
}

export function scoutGradeOf(todo: TodoTask, today: string): ScoutGrade {
  if (todo.completed) return { grade: "—", urgency: 0, label: "契約済", labelPlain: "完了" };
  if (!todo.dueDate) {
    return todo.important
      ? { grade: "A", urgency: 0.6, label: "有力", labelPlain: "重要" }
      : { grade: "C", urgency: 0.15, label: "調査中", labelPlain: "期日なし" };
  }
  const days = Math.round(
    (new Date(todo.dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
  );
  if (days < 0) return { grade: "S", urgency: 1, label: "交渉期限切れ", labelPlain: "期限切れ" };
  if (days === 0) return { grade: "S", urgency: 0.95, label: "本日が期限", labelPlain: "本日が期限" };
  const rest = `あと${days}日`;
  if (days <= 2) return { grade: "A", urgency: 0.75, label: rest, labelPlain: rest };
  if (days <= 7) return { grade: "B", urgency: 0.45, label: rest, labelPlain: rest };
  return { grade: "C", urgency: 0.2, label: rest, labelPlain: rest };
}

// ============================================================
// ペナントレース(案件)
// ============================================================
// 案件タブは「契約案件」。段階(ProjectStage)を試合数に見立てて勝敗表にする。

export interface PennantRecord {
  wins: number; // 完了した段階
  losses: number; // 期日を過ぎたまま未完了の段階
  remaining: number; // 残りの段階
  games: number;
  winRate: number; // 0〜1
  standing: string; // 首位 / Aクラス / Bクラス / 最下位争い
  /** 文言オフのときの表示。勝率そのものは同じで、呼び名だけ工程表のものに戻す */
  standingPlain: string;
  daysLeft: number | null;
}

export function buildPennant(project: ProjectItem, today: string): PennantRecord {
  const stages = project.stages ?? [];
  const wins = stages.filter((s) => s.completed).length;
  const losses = stages.filter((s) => !s.completed && s.dueDate && s.dueDate < today).length;
  const remaining = stages.length - wins - losses;
  const games = stages.length;
  const winRate = games > 0 ? wins / games : project.completedAt ? 1 : 0;
  // 順位は勝率(=段階の消化率)そのもの。呼び名だけ2通り持たせる
  const [standing, standingPlain] =
    games === 0
      ? project.completedAt
        ? (["優勝", "完了"] as const)
        : (["開幕前", "段階なし"] as const)
      : winRate >= 1
        ? (["優勝", "全段階が完了"] as const)
        : winRate >= 0.7
          ? (["首位", "順調"] as const)
          : winRate >= 0.4
            ? (["Aクラス", "進行中"] as const)
            : losses > 0
              ? (["最下位争い", "遅延あり"] as const)
              : (["Bクラス", "着手したところ"] as const);
  const daysLeft = project.dueDate
    ? Math.round((new Date(project.dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000)
    : null;
  return { wins, losses, remaining, games, winRate, standing, standingPlain, daysLeft };
}

// ============================================================
// 1日ごとの育成
// ============================================================
// ここが「シーズン成績」と決定的に違うところ。
//
// buildAbilities(直近30日の比率)は“今の調子”のスナップショットで、良い日が続けば
// 上がり、悪い日が続けば下がる。それはそれで意味があるが、育成ゲームとしては
// 「昨日がんばったぶんが今日の自分に残っている」感覚が無い。
//
// そこでこちらは、1日の働きを「その日の練習で得た成長ポイント」に換算し、
// 初日からの合計を能力値とする。過去の記録は変わらないので値は下がらず、
// 働いた日だけ確実に伸びる。
//
// 重要なのは、これが実データの純粋な関数であること。どこにも“育成値”という
// 可変の数字を保存していない。全実績から毎回同じ合計が出るので、
// 端末を変えてもデータを戻しても、同じ記録からは必ず同じ能力値になる。

/** 1日の練習で1ポイント得るのに必要な量。ここを変えると育ちの速さが変わる */
const GAIN_UNIT = {
  /** ミート: 想定内に収めて完了した作業 1件につき1 */
  meet: 1,
  /** パワー: 実働30分につき1 */
  powerMinutes: 30,
  /** 走力: 片付けたToDo・案件の段階 1件につき1 */
  speed: 1,
  /** 肩力: 完了した作業 1件につき1 */
  arm: 1,
  /** 守備力: 突発対応をやり切った 1件につき1 */
  field: 1,
  /** 捕球: 期日までに片付けたToDo 1件につき1 */
  catch: 1,
} as const;

export interface DailyGain {
  date: string;
  meet: number;
  power: number;
  speed: number;
  arm: number;
  field: number;
  catch: number;
  /** その日の合計ポイント */
  total: number;
  /** 画面にそのまま出せる、何をしたから何ポイント入ったかの内訳 */
  detail: Record<AbilityKey, string>;
}

interface DayInput {
  date: string;
  /** その日に完了した作業(実績) */
  records: WorkRecord[];
  /** その日に完了したToDoの件数 */
  todoDone: number;
  /** そのうち期日までに片付けた件数 */
  todoInTime: number;
  /** その日に完了した案件の段階の件数 */
  stageDone: number;
}

function gainOfDay(input: DayInput, estimateById: Map<string, number>): DailyGain {
  const rs = input.records;
  const worked = rs.reduce((s, r) => s + r.seconds, 0);
  // ミートは「想定内に収めて完了した件数」。判定はアプリ共通の厳密なもの
  const withEstimate = rs.filter((r) => r.masterTaskId && (estimateById.get(r.masterTaskId) ?? 0) > 0);
  const inside = withEstimate.filter((r) => r.seconds <= (estimateById.get(r.masterTaskId!) ?? 0)).length;
  const troubles = rs.filter((r) => r.isTrouble).length;

  const meet = inside * GAIN_UNIT.meet;
  const power = Math.floor(worked / 60 / GAIN_UNIT.powerMinutes);
  const speed = (input.todoDone + input.stageDone) * GAIN_UNIT.speed;
  const arm = rs.length * GAIN_UNIT.arm;
  const field = troubles * GAIN_UNIT.field;
  const catchG = input.todoInTime * GAIN_UNIT.catch;

  return {
    date: input.date,
    meet,
    power,
    speed,
    arm,
    field,
    catch: catchG,
    total: meet + power + speed + arm + field + catchG,
    detail: {
      meet: `想定内に収めて完了 ${inside}件`,
      power: `実働 ${Math.round(worked / 60)}分（${GAIN_UNIT.powerMinutes}分で+1）`,
      speed: `片付けたToDo ${input.todoDone}件・案件の段階 ${input.stageDone}件`,
      arm: `完了した作業 ${rs.length}件`,
      field: `やり切った突発対応 ${troubles}件`,
      catch: `期日までに片付けたToDo ${input.todoInTime}件`,
    },
  };
}

export interface Growth {
  /** 初日からの合計。1〜150に丸めた能力値 */
  abilities: Ability[];
  /** 本日ぶんの伸び */
  today: DailyGain;
  /** 記録のある日数 */
  trainedDays: number;
  /** 丸める前の素点。次の1ポイントまでの距離を出すのに使う */
  rawTotals: Record<AbilityKey, number>;
}

function dateOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 初日からの積み上げで能力値を出す。
 * 素点をそのまま能力値にすると青天井になるので、150を上限に緩やかに詰める
 * (伸び始めは素直に上がり、高くなるほど1ポイントの重みが増す)。
 */
function toAbilityFromPoints(points: number): number {
  // 150 * (1 - e^(-p/90)) 。p=90でおよそ95、p=300でほぼ上限に達する
  return Math.max(1, Math.min(150, Math.round(150 * (1 - Math.exp(-points / 90)))));
}

export function buildGrowth(
  records: WorkRecord[],
  todos: TodoTask[],
  projects: ProjectItem[],
  masters: MasterTask[],
  today: string
): Growth {
  const estimateById = new Map(masters.map((m) => [m.id, m.estimatedSeconds]));

  // 日ごとにまとめる
  const byDate = new Map<string, DayInput>();
  const ensure = (date: string) => {
    let d = byDate.get(date);
    if (!d) {
      d = { date, records: [], todoDone: 0, todoInTime: 0, stageDone: 0 };
      byDate.set(date, d);
    }
    return d;
  };
  for (const r of records) {
    if (r.excludedFromStats) continue;
    ensure(r.date).records.push(r);
  }
  for (const t of todos) {
    if (!t.completed || !t.completedAt) continue;
    const date = dateOf(t.completedAt);
    const d = ensure(date);
    d.todoDone += 1;
    if (t.dueDate && date <= t.dueDate) d.todoInTime += 1;
  }
  for (const p of projects) {
    for (const st of p.stages ?? []) {
      if (!st.completed || !st.completedAt) continue;
      ensure(dateOf(st.completedAt)).stageDone += 1;
    }
  }

  const raw: Record<AbilityKey, number> = { meet: 0, power: 0, speed: 0, arm: 0, field: 0, catch: 0 };
  let todayGain: DailyGain | null = null;
  for (const input of byDate.values()) {
    const g = gainOfDay(input, estimateById);
    raw.meet += g.meet;
    raw.power += g.power;
    raw.speed += g.speed;
    raw.arm += g.arm;
    raw.field += g.field;
    raw.catch += g.catch;
    if (input.date === today) todayGain = g;
  }
  if (!todayGain) {
    todayGain = gainOfDay({ date: today, records: [], todoDone: 0, todoInTime: 0, stageDone: 0 }, estimateById);
  }

  const abilities: Ability[] = ABILITY_KEYS.map((key) => {
    const value = toAbilityFromPoints(raw[key]);
    return { key, value, rank: rankOf(value), reason: `これまでの積み上げ ${raw[key]}ポイント` };
  });

  return { abilities, today: todayGain, trainedDays: byDate.size, rawTotals: raw };
}

// ============================================================
// 体力(その日の残り)
// ============================================================
// 就業時間ぶんを走り切れる体力を1日の満タンとし、実働で減っていく。
// 休憩のチェックリストを1つ消化するごとに少し戻る。
// 「働けば減る/休めば戻る」という当たり前の関係を、そのまま数字にしている。

/** チェックリスト1件あたりの回復量(%) */
export const REST_RECOVERY_PERCENT = 6;

export interface Stamina {
  percent: number;
  /** 就業時間(秒)。設定の所定労働時間から取る */
  standardSeconds: number;
  workedSeconds: number;
  /** 消化した休憩チェックの件数 */
  restedItems: number;
  /** 回復したぶん(%) */
  recoveredPercent: number;
  reason: string;
}

export function buildStamina(workedSeconds: number, standardHours: number, restedItems: number): Stamina {
  const standardSeconds = Math.max(3600, standardHours * 3600);
  const consumed = (workedSeconds / standardSeconds) * 100;
  const recovered = restedItems * REST_RECOVERY_PERCENT;
  const percent = Math.max(0, Math.min(100, Math.round(100 - consumed + recovered)));
  return {
    percent,
    standardSeconds,
    workedSeconds,
    restedItems,
    recoveredPercent: recovered,
    reason:
      `就業時間 ${standardHours}時間を満タンとして、実働 ${Math.round(workedSeconds / 60)}分で ${Math.round(consumed)}% 消費` +
      (restedItems > 0 ? `、休憩の消化 ${restedItems}件で ${recovered}% 回復` : ""),
  };
}

// ============================================================
// ドラフトボード(スカウトリストの見出し)
// ============================================================
// ToDo一覧を「スカウト部が今どういう状況か」の一枚にまとめる。
// 階級ごとの人数と、いま最優先の1件が分かれば、リストを読む前に状況が掴める。

export interface ScoutBoardTier {
  grade: string;
  count: number;
}

export interface ScoutBoard {
  tiers: ScoutBoardTier[];
  /** いま最優先の1件。無ければnull */
  top: {
    title: string;
    category: string | null;
    grade: string;
    urgency: number;
    label: string;
    labelPlain: string;
    /** 期日までの日数。期日なしはnull */
    days: number | null;
  } | null;
  /** 交渉中(未完了)の件数 */
  active: number;
  /** 契約済(完了)の件数 */
  signed: number;
}

export function buildScoutBoard(todos: TodoTask[], today: string): ScoutBoard {
  // サブタスクは1人の候補ではなく視察項目なので、親だけを数える
  const parents = todos.filter((t) => !t.parentTaskId);
  const active = parents.filter((t) => !t.completed);
  const counts = new Map<string, number>([
    ["S", 0],
    ["A", 0],
    ["B", 0],
    ["C", 0],
  ]);
  let top: ScoutBoard["top"] = null;
  let topUrgency = -1;
  for (const t of active) {
    const g = scoutGradeOf(t, today);
    counts.set(g.grade, (counts.get(g.grade) ?? 0) + 1);
    if (g.urgency > topUrgency) {
      topUrgency = g.urgency;
      const days = t.dueDate
        ? Math.round(
            (new Date(t.dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000
          )
        : null;
      top = {
        title: t.title,
        category: t.category ?? null,
        grade: g.grade,
        urgency: g.urgency,
        label: g.label,
        labelPlain: g.labelPlain,
        days,
      };
    }
  }
  return {
    tiers: [...counts.entries()].map(([grade, count]) => ({ grade, count })),
    top,
    active: active.length,
    signed: parents.length - active.length,
  };
}

// ============================================================
// 順位表(契約案件の見出し)
// ============================================================
// 案件を勝率順に並べた勝敗表。段階の消化がそのまま勝敗になるので、
// どの案件が走っていてどれが止まっているかが、順位という一列で分かる。

export interface StandingRow {
  id: string;
  title: string;
  wins: number;
  losses: number;
  remaining: number;
  games: number;
  winRate: number;
  standing: string;
  standingPlain: string;
  daysLeft: number | null;
}

export function buildStandings(projects: ProjectItem[], today: string): StandingRow[] {
  return projects
    .filter((p) => !p.completedAt)
    .map((p) => {
      const pe = buildPennant(p, today);
      return {
        id: p.id,
        title: p.title,
        wins: pe.wins,
        losses: pe.losses,
        remaining: pe.remaining,
        games: pe.games,
        winRate: pe.winRate,
        standing: pe.standing,
        standingPlain: pe.standingPlain,
        daysLeft: pe.daysLeft,
      };
    })
    // 勝率の高い順。同率なら期日が近いほうを上に置く(順位表としての読み方に合わせる)
    .sort((a, b) => b.winRate - a.winRate || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}
