import { shiftDateStr } from "./time";

// Claudeモードの入力欄。「明日までに見積書を送る 30分 @営業」のように話し言葉で書いたものを、
// 件名・期限・見込み時間・分類・重要の印に分けて受け取る。どう受け取ったかは入力中に
// その場で見せ(=誤解したらその場で気づける)、決まった書式を覚えなくても使えるようにする

export interface ComposeResult {
  title: string;
  category?: string;
  dueDate?: string; // YYYY-MM-DD
  estimateMin?: number;
  important: boolean;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 期限の後ろに付く助詞(「までに」「中に」など)。件名から一緒に取り除く */
const DUE_SUFFIX = "(?:までに|まで|中に|中|に|の)?";
/** 前後の区切り(行頭・行末・空白・読点) */
const START = "(?:^|[\\s、,])";

interface DateRule {
  re: RegExp;
  resolve: (m: RegExpMatchArray, today: string) => string | null;
}

const DATE_RULES: DateRule[] = [
  { re: new RegExp(`${START}(今日|本日)${DUE_SUFFIX}`), resolve: (_m, t) => t },
  { re: new RegExp(`${START}(明後日|あさって)${DUE_SUFFIX}`), resolve: (_m, t) => shiftDateStr(t, 2) },
  { re: new RegExp(`${START}(明日|あした|あす)${DUE_SUFFIX}`), resolve: (_m, t) => shiftDateStr(t, 1) },
  {
    // 今週中・今週末: その週の金曜(週末なら日曜)。金曜を過ぎていれば今日
    re: new RegExp(`${START}今週(中|末)${DUE_SUFFIX}`),
    resolve: (m, t) => {
      const wd = weekdayOf(t);
      if (wd === 0) return t; // 日曜は週の最終日
      const target = m[1] === "末" ? 7 : 5; // 7 = 日曜を週の終わりとみなす
      const diff = target - wd;
      return diff >= 0 ? shiftDateStr(t, diff) : t;
    },
  },
  {
    // 来週の○曜 / 来週○曜日
    re: new RegExp(`${START}来週の?([日月火水木金土])曜?日?${DUE_SUFFIX}`),
    resolve: (m, t) => {
      const wd = weekdayOf(t);
      const toNextMonday = ((8 - wd) % 7) || 7;
      const target = WEEKDAYS.indexOf(m[1]);
      return shiftDateStr(t, toNextMonday + ((target + 6) % 7));
    },
  },
  {
    // 来週: 来週の月曜
    re: new RegExp(`${START}来週${DUE_SUFFIX}`),
    resolve: (_m, t) => shiftDateStr(t, ((8 - weekdayOf(t)) % 7) || 7),
  },
  {
    // ○曜(日): 今日から数えて次のその曜日(今日がその曜日なら今日)
    re: new RegExp(`${START}([日月火水木金土])曜日?${DUE_SUFFIX}`),
    resolve: (m, t) => shiftDateStr(t, (WEEKDAYS.indexOf(m[1]) - weekdayOf(t) + 7) % 7),
  },
  {
    // 10/12 ・ 10月12日。過ぎていれば来年
    re: new RegExp(`${START}(\\d{1,2})(?:/|月)(\\d{1,2})日?${DUE_SUFFIX}`),
    resolve: (m, t) => {
      const mo = Number(m[1]);
      const d = Number(m[2]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      const y = Number(t.slice(0, 4));
      const cand = `${y}-${pad(mo)}-${pad(d)}`;
      return cand < t ? `${y + 1}-${pad(mo)}-${pad(d)}` : cand;
    },
  },
  {
    // 12日: 今月のその日。過ぎていれば来月
    // 「3日で」「2日間」のような所要日数は期限として扱わない
    re: new RegExp(`${START}(\\d{1,2})日(?!で|間|かけ|ほど|くらい)${DUE_SUFFIX}`),
    resolve: (m, t) => {
      const d = Number(m[1]);
      if (d < 1 || d > 31) return null;
      const [y, mo] = t.split("-").map(Number);
      const cand = `${y}-${pad(mo)}-${pad(d)}`;
      if (cand >= t) return cand;
      const ny = mo === 12 ? y + 1 : y;
      const nm = mo === 12 ? 1 : mo + 1;
      return `${ny}-${pad(nm)}-${pad(d)}`;
    },
  },
];

const ESTIMATE_RE = /(?:^|[\s、,])約?(\d+(?:\.\d+)?)\s*(分|時間|h|min)(?:くらい|ほど|程度|で)?(?=[\s、,]|$)/i;

export function parseCompose(raw: string, today: string): ComposeResult {
  let text = ` ${raw.trim()} `;
  let category: string | undefined;
  let dueDate: string | undefined;
  let estimateMin: number | undefined;
  let important = false;

  // 「見積書@営業」のように空白なしで書いても受け取る。英数字の直後の@(メールアドレス)は分類にしない
  const tag = /(?<![A-Za-z0-9._%+-])[@＠]([^\s@＠]+)/.exec(text);
  if (tag) {
    category = tag[1];
    text = text.replace(tag[0], " ");
  }

  const mark = /【(至急|重要|急ぎ)】|[!！]+(?=\s*$)/.exec(text);
  if (mark) {
    important = true;
    text = text.replace(mark[0], " ");
  }

  const est = ESTIMATE_RE.exec(text);
  if (est) {
    const n = Number(est[1]);
    estimateMin = Math.round(/時間|h/i.test(est[2]) ? n * 60 : n);
    text = text.replace(est[0], " ");
  }

  for (const rule of DATE_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const resolved = rule.resolve(m, today);
    if (!resolved) continue;
    dueDate = resolved;
    text = text.replace(m[0], " ");
    break;
  }

  const title = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[、,]\s*/, "")
    .replace(/\s*[、,]$/, "");
  return { title, category, dueDate, estimateMin, important };
}

/** 期限の読み上げ(「明日 10/4(土)」など)。どう受け取ったかを見せる時に使う */
export function dueLabel(dueDate: string, today: string): string {
  const [, m, d] = dueDate.split("-").map(Number);
  const md = `${m}/${d}(${WEEKDAYS[weekdayOf(dueDate)]})`;
  if (dueDate === today) return `今日 ${md}`;
  if (dueDate === shiftDateStr(today, 1)) return `明日 ${md}`;
  return md;
}
