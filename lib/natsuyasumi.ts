import type { DailyTask, MasterTask, WorkRecord } from "./types";

// ぼくのなつやすみ風モードの判定ロジック。
//
// 元ネタは「8月1日から31日までを自由に過ごす」アドベンチャーで、
// 一日は朝6時に起きて夜10時に寝るまで。朝・昼・夕方・夜で背景の絵が描き替わり、
// ラジオ体操に通い、虫を採り、そして夜に「その日の出来事をひとつ選んで」絵日記を書く。
//
// このファイルはその構造を、実データの上に素直に載せている。
//   ・時間帯       → 実際の時刻
//   ・ラジオ体操カード → 連続記録日数(スタンプ)
//   ・朝顔の育ち   → 本日の実働時間
//   ・虫かご       → 作業マスタ。大きさは想定時間、めずらしさは実施回数の少なさ
//   ・お天気       → 本日の想定超過の度合い
//   ・絵日記       → その日いちばん時間を使った作業
//
// 他モードと同じく、演出のための乱数も水増しした数値も置かない。
// 種(seed)は作業名や日付なので、同じ対象には毎回まったく同じ絵が出る。

// ============================================================
// 一日の時間帯
// ============================================================
// 原作は朝6時起床・夜10時就寝で、その間に朝/昼/夕方/夜の絵が入れ替わる。
// ここでも同じ区切りにし、就寝時刻を過ぎたら「夜ふかし」として扱う。

export type Phase = "dawn" | "morning" | "noon" | "evening" | "night" | "late";

export interface PhaseInfo {
  phase: Phase;
  /** 原作の一日(6時〜22時)のどこにいるか。0〜1。夜ふかしは1で止める */
  dayProgress: number;
  hour: number;
}

export function phaseOf(date: Date): PhaseInfo {
  const hour = date.getHours();
  const phase: Phase =
    hour < 5 ? "late" : hour < 8 ? "dawn" : hour < 11 ? "morning" : hour < 15 ? "noon" : hour < 18 ? "evening" : hour < 22 ? "night" : "late";
  const minutes = hour * 60 + date.getMinutes();
  const dayProgress = Math.max(0, Math.min(1, (minutes - 6 * 60) / (22 * 60 - 6 * 60)));
  return { phase, dayProgress, hour };
}

// ============================================================
// お天気
// ============================================================
// 原作の天気は日替わりだが、ここでは「本日の想定超過の度合い」に対応させる。
// 予定どおりなら快晴、はみ出すほど雲が増え、大きくはみ出すと夕立になる。

export type Weather = "clear" | "sunny" | "cloudy" | "shower";

export interface WeatherState {
  weather: Weather;
  /** 0〜1。想定合計に対する超過分の割合 */
  overRatio: number;
  reason: string;
}

export function weatherOf(tasks: { estimatedSeconds: number; elapsedSeconds: number }[]): WeatherState {
  let base = 0;
  let over = 0;
  for (const t of tasks) {
    if (t.estimatedSeconds <= 0) continue;
    base += t.estimatedSeconds;
    over += Math.max(0, t.elapsedSeconds - t.estimatedSeconds);
  }
  const overRatio = base > 0 ? over / base : 0;
  const weather: Weather = overRatio >= 0.5 ? "shower" : overRatio >= 0.2 ? "cloudy" : overRatio > 0 ? "sunny" : "clear";
  return {
    weather,
    overRatio,
    reason:
      base > 0
        ? `予定の合計 ${Math.round(base / 60)}分に対して、はみ出した分は ${Math.round(over / 60)}分`
        : "まだ予定時間のついた作業がありません",
  };
}

// ============================================================
// ラジオ体操カード
// ============================================================
// 原作では毎朝ラジオ体操に行くとカードに判子が押される。
// ここでは連続記録日数をそのままスタンプの数にする。

export interface StampCard {
  /** カードのマス目。true = 判子が押してある */
  stamps: boolean[];
  streak: number;
  /** カードは何枚目か。10マスで1枚 */
  cardNumber: number;
  filledToday: boolean;
}

const STAMPS_PER_CARD = 10;

export function buildStampCard(streakDays: number, workedToday: boolean): StampCard {
  const cardNumber = Math.floor(Math.max(0, streakDays - 1) / STAMPS_PER_CARD) + 1;
  const onThisCard = streakDays === 0 ? 0 : ((streakDays - 1) % STAMPS_PER_CARD) + 1;
  const stamps = Array.from({ length: STAMPS_PER_CARD }, (_, i) => i < onThisCard);
  return { stamps, streak: streakDays, cardNumber, filledToday: workedToday };
}

// ============================================================
// 朝顔
// ============================================================
// 原作では毎朝の水やりで朝顔が育つ。ここでは本日の実働時間で伸ばす。
// 段階は lib/growth.ts の NATSUYASUMI_STAGES と同じ6段階に揃えている。

export interface MorningGlory {
  /** 0〜1。つるの伸び具合 */
  growth: number;
  stageIndex: number;
  /** 咲いている花の数 */
  blooms: number;
  workedSeconds: number;
}

export function buildMorningGlory(workedSeconds: number, doneCount: number): MorningGlory {
  const hours = workedSeconds / 3600;
  const stageIndex = hours >= 8 ? 5 : hours >= 6 ? 4 : hours >= 4 ? 3 : hours >= 2 ? 2 : hours >= 1 ? 1 : 0;
  return {
    growth: Math.max(0, Math.min(1, hours / 8)),
    stageIndex,
    // 花は「完了した作業の数」。時間ではなく、やり切った数だけ咲く
    blooms: Math.min(6, doneCount),
    workedSeconds,
  };
}

// ============================================================
// 虫かご
// ============================================================
// 作業マスタを1匹の虫として扱う。原作の昆虫採集と同じで、
// 「捕まえた種類が増えていく」ことそのものが記録になる。
//
// 種類は作業名から決定的に決まるので、同じ作業は毎回同じ虫として出る。
// 大きさは想定時間、めずらしさは実施回数の少なさ。どちらも実データそのもの。

export type Species =
  | "kabuto" // カブトムシ
  | "kuwagata" // クワガタ
  | "semi" // セミ
  | "tonbo" // トンボ
  | "chou" // チョウ
  | "batta" // バッタ
  | "tentou" // テントウムシ
  | "koganemushi"; // コガネムシ

export const SPECIES_NAME: Record<Species, string> = {
  kabuto: "カブトムシ",
  kuwagata: "クワガタ",
  semi: "セミ",
  tonbo: "トンボ",
  chou: "チョウ",
  batta: "バッタ",
  tentou: "テントウムシ",
  koganemushi: "コガネムシ",
};

export const SPECIES_PLAIN: Record<Species, string> = {
  kabuto: "大物",
  kuwagata: "重め",
  semi: "短時間の繰り返し",
  tonbo: "移動・連絡",
  chou: "打ち合わせ",
  batta: "細かい作業",
  tentou: "小さい定型",
  koganemushi: "その他",
};

function hash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * 作業から虫の種類を決める。
 * 想定時間が長いものほど大型の甲虫、短くて回数が多いものはセミやバッタ、
 * というふうに「その作業の性質」がそのまま種類に出るようにしている。
 */
export function speciesOf(category: string, name: string, estimatedSeconds: number): Species {
  const t = `${category} ${name}`;
  if (/(会議|打合|打ち合わせ|ミーティング|MTG|商談|来客)/i.test(t)) return "chou";
  if (/(移動|訪問|外出|配送|運搬|連絡|電話|メール)/i.test(t)) return "tonbo";
  if (estimatedSeconds >= 4 * 3600) return "kabuto";
  if (estimatedSeconds >= 2 * 3600) return "kuwagata";
  if (estimatedSeconds > 0 && estimatedSeconds <= 15 * 60) return "tentou";
  if (estimatedSeconds > 0 && estimatedSeconds <= 45 * 60) return "batta";
  const kinds: Species[] = ["semi", "koganemushi"];
  return kinds[hash(t) % kinds.length];
}

export interface Bug {
  masterId: string;
  species: Species;
  category: string;
  name: string;
  /** 0〜1。想定時間から決まる体の大きさ */
  size: number;
  /** 実施回数。多いほど「よく見かける虫」 */
  count: number;
  /** 0〜3。実施回数の少なさから決まるめずらしさ */
  rarity: number;
  lastSeenDate: string | null;
  /** 本日つかまえたか */
  caughtToday: boolean;
  totalSeconds: number;
}

export function buildBugCage(
  masters: MasterTask[],
  records: WorkRecord[],
  todayTasks: DailyTask[],
  today: string
): Bug[] {
  const stats = new Map<string, { count: number; seconds: number; last: string }>();
  for (const r of records) {
    if (r.excludedFromStats || !r.masterTaskId) continue;
    const cur = stats.get(r.masterTaskId) ?? { count: 0, seconds: 0, last: r.date };
    cur.count += 1;
    cur.seconds += r.seconds;
    if (r.date > cur.last) cur.last = r.date;
    stats.set(r.masterTaskId, cur);
  }
  const caughtToday = new Set(
    todayTasks.filter((t) => t.status === "done" && t.masterTaskId).map((t) => t.masterTaskId!)
  );

  const bugs: Bug[] = [];
  for (const m of masters) {
    if (m.archived) continue;
    const s = stats.get(m.id);
    if (!s) continue; // 一度も実績が無いものは、まだ捕まえていない
    bugs.push({
      masterId: m.id,
      species: speciesOf(m.category, m.name, m.estimatedSeconds),
      category: m.category,
      name: m.name,
      size: Math.max(0.15, Math.min(1, m.estimatedSeconds / (4 * 3600))),
      count: s.count,
      rarity: s.count >= 20 ? 0 : s.count >= 8 ? 1 : s.count >= 3 ? 2 : 3,
      lastSeenDate: s.last,
      caughtToday: caughtToday.has(m.id),
      totalSeconds: s.seconds,
    });
  }
  // めずらしい順 → 大きい順。虫かごを覗いたとき、珍しい虫が先に目に入るように
  return bugs.sort((a, b) => b.rarity - a.rarity || b.size - a.size);
}

// ============================================================
// 絵日記
// ============================================================
// 原作では、その日に起きた出来事の中からひとつを選んで絵日記に書く。
// ここでは「その日いちばん時間を使った作業」を今日の出来事として拾い、
// 文章は実際の数字から組み立てる。書き足したい一言はユーザーが自分で書く。

export interface DiaryEntry {
  date: string;
  /** 今日の出来事(いちばん時間を使った作業)。無ければnull */
  topic: { category: string; name: string; seconds: number; masterId?: string } | null;
  doneCount: number;
  totalSeconds: number;
  weather: Weather;
  /** 実データから組み立てた本文 */
  body: string;
}

export function buildDiary(
  today: string,
  tasks: DailyTask[],
  elapsedSecondsOf: (t: DailyTask) => number,
  weather: Weather,
  wordingEnabled: boolean
): DiaryEntry {
  const real = tasks.filter((t) => !t.isProvisional);
  let top: DiaryEntry["topic"] = null;
  let totalSeconds = 0;
  for (const t of real) {
    const sec = elapsedSecondsOf(t);
    totalSeconds += sec;
    if (!top || sec > top.seconds) {
      top = { category: t.category, name: t.name, seconds: sec, masterId: t.masterTaskId };
    }
  }
  const doneCount = real.filter((t) => t.status === "done").length;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  const timeText = hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`;

  let body: string;
  if (!top || totalSeconds < 60) {
    body = wordingEnabled
      ? "きょうは まだ なにも していません。これから はじめます。"
      : "本日の記録はまだありません。";
  } else if (wordingEnabled) {
    const weatherWord = { clear: "とても よく はれた", sunny: "はれた", cloudy: "くもりの", shower: "ゆうだちの きた" }[weather];
    body =
      `きょうは ${weatherWord} 一日でした。` +
      `いちばん ながく やったのは「${top.name}」で、${Math.round(top.seconds / 60)}分 かかりました。` +
      (doneCount > 0 ? `ぜんぶで ${doneCount}こ おわらせて、` : "") +
      `${timeText} がんばりました。`;
  } else {
    body =
      `本日の実働は ${timeText}、完了 ${doneCount}件。` +
      `最も時間を使ったのは「${top.name}」で ${Math.round(top.seconds / 60)}分でした。`;
  }

  return { date: today, topic: top, doneCount, totalSeconds, weather, body };
}

// ============================================================
// 8月のカレンダー(その月の記録)
// ============================================================
// 原作の「8月1日から31日まで」に倣い、表示中の月を1枚のカレンダーにする。
// 記録のある日には印が付き、日ごとの実働時間で濃さが変わる。

export interface CalendarDay {
  date: string;
  day: number;
  weekday: number;
  seconds: number;
  isToday: boolean;
  isFuture: boolean;
}

export function buildMonthCalendar(month: string, records: WorkRecord[], today: string): CalendarDay[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const byDate = new Map<string, number>();
  for (const r of records) {
    if (r.excludedFromStats) continue;
    if (r.date.startsWith(month)) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.seconds);
  }
  const days: CalendarDay[] = [];
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    days.push({
      date,
      day: d,
      weekday: new Date(y, m - 1, d).getDay(),
      seconds: byDate.get(date) ?? 0,
      isToday: date === today,
      isFuture: date > today,
    });
  }
  return days;
}

/** 残り日数。原作の「8月31日で終わる」感覚を、その月の終わりに置き換える */
export function daysLeftInMonth(today: string): number {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(y, m, 0).getDate() - d;
}
