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
/** 前の区切り(行頭・空白・読点) */
const START = "(?:^|[\\s、,。])";
/** 後ろの区切り(行末・空白・読点) */
const END = "(?=$|[\\s、,。])";

// 日付の言葉は「独立した語」として書かれた時だけ期限として受け取る。区切りを見ないと、
// 「来週日程調整」の「来週日」、「月曜日報」の「月曜日」、「明日中止」の「明日中」、「3日以内」の「3日」、
// 「1/2ページ」の「1/2」のように、件名の一部を期限として食べてしまう。
// 例外として「明日までに送る」「今日中に出す」のように期限だと明示する助詞が付いている場合は、
// 後ろに区切りが無くても、また「見積書を明日までに送る」のように文の途中(を・は・が・に の直後)でも受け取る
interface DateRule {
  /** 日付の言葉そのもの(前後の区切り・助詞を含まない) */
  core: string;
  /** 区切りが無くても期限と認める助詞。既定は「までに」「中に」 */
  explicit?: string;
  /** 「明日見積書を送る」のように、区切りも助詞も無く件名が続く書き方でも受け取る時の形(無ければ受け取らない) */
  loose?: string;
  resolve: (m: RegExpMatchArray, today: string) => string | null;
}

const DATE_RULES: DateRule[] = [
  { core: "(今日|本日)", loose: "(今日|本日)", resolve: (_m, t) => t },
  { core: "(明後日|あさって)", loose: "(明後日|あさって)", resolve: (_m, t) => shiftDateStr(t, 2) },
  { core: "(明日|あした|あす)", loose: "(明日|あした|あす)", resolve: (_m, t) => shiftDateStr(t, 1) },
  {
    // 今週中・今週末: その週の金曜(週末なら日曜)。金曜を過ぎていれば今日
    core: "今週(中|末)",
    explicit: "(?:までに|に)",
    loose: "今週(中|末)",
    resolve: (m, t) => {
      const wd = weekdayOf(t);
      if (wd === 0) return t; // 日曜は週の最終日
      const target = m[1] === "末" ? 7 : 5; // 7 = 日曜を週の終わりとみなす
      const diff = target - wd;
      return diff >= 0 ? shiftDateStr(t, diff) : t;
    },
  },
  {
    // 来週の○曜 / 来週○曜日。「曜」まで書かれた時だけ曜日とみなす(「来週月次報告」の「月」を曜日にしない)
    core: "来週の?([日月火水木金土])曜日?",
    loose: "来週の?([日月火水木金土])曜(?:日(?![報程誌記]))?",
    resolve: (m, t) => {
      const wd = weekdayOf(t);
      const toNextMonday = ((8 - wd) % 7) || 7;
      const target = WEEKDAYS.indexOf(m[1]);
      return shiftDateStr(t, toNextMonday + ((target + 6) % 7));
    },
  },
  {
    // 来週: 来週の月曜
    core: "来週",
    loose: "来週",
    resolve: (_m, t) => shiftDateStr(t, ((8 - weekdayOf(t)) % 7) || 7),
  },
  {
    // ○曜(日): 今日から数えて次のその曜日(今日がその曜日なら今日)
    core: "([日月火水木金土])曜日?",
    // 「月曜日報」の「日」は件名側に残す。「日曜大工」は曜日ではない
    loose: "([日月火水木金土])曜(?:日(?![報程誌記]))?(?!大工)",
    resolve: (m, t) => shiftDateStr(t, (WEEKDAYS.indexOf(m[1]) - weekdayOf(t) + 7) % 7),
  },
  {
    // 10/12 ・ 10月12日。過ぎていれば来年
    core: "(\\d{1,2})(?:/|月)(\\d{1,2})日?",
    explicit: "(?:までに)",
    // 「10月12日納品」は受け取る。「1/2ページ」と紛れる N/M の形は、区切りか「までに」が要る
    loose: "(\\d{1,2})月(\\d{1,2})日",
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
    // 「3日で」「2日間」「3日以内」のような所要日数は、後ろに区切りが無いので期限として扱われない
    // (「3日中に」は「3日のうちに」とも読めるため、明示の助詞は「までに」だけにする)
    core: "(\\d{1,2})日",
    explicit: "(?:までに)",
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

const DATE_MATCHERS = DATE_RULES.map((rule) => ({
  rule,
  // 独立した語として書かれた形: 「明日 A社に電話」「金曜までに 資料」
  separate: new RegExp(`${START}${rule.core}${DUE_SUFFIX}${END}`),
  // 期限だと明示する助詞つきの形: 「明日までに見積書を送る」「見積書を明日までに送る」
  explicit: new RegExp(`(?:${START}|(?<=[をはがに]))${rule.core}${rule.explicit ?? "(?:までに|中に)"}`),
  // 区切りも助詞も無い形: 「明日見積書を送る」「見積書を明日送る」「金曜に提出」「10月12日納品」。
  // すぐ後ろに件名(漢字・カタカナ・英数字)が続く時だけ受け取る。ひらがなが続く「明日は休み」「明日の会議」や、
  // 「明日中止」「3日以内」「2日間」のように別の語になる形は受け取らない
  loose: rule.loose
    ? new RegExp(`(?:${START}|(?<=[をはがに]))${rule.loose}(?:までに|まで|に)?(?=[一-龠々ァ-ヶーA-Za-z0-9０-９])(?![中以間])`)
    : null,
}));

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

  for (const { rule, separate, explicit, loose } of DATE_MATCHERS) {
    const m = separate.exec(text) ?? explicit.exec(text) ?? loose?.exec(text);
    if (!m) continue;
    const resolved = rule.resolve(m, today);
    if (!resolved) continue;
    dueDate = resolved;
    // 区切りから始まる一致は空白に置き換える。文の途中(「見積書を|明日までに|送る」)から抜いた時は
    // 前後をそのままつなげ、件名に不自然な空白が入らないようにする
    text = text.replace(m[0], /^[\s、,。]/.test(m[0]) ? " " : "");
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
