import type { ThemedMode, VisualMode } from "./theme";
import type { TileShape } from "./powerproMenuArt";

// モード選択メニュー(タブに入る前に出る、家庭用ゲームのモード選択画面のような入口)。
//
// 元は育成選手モード専用だったが、画面の中身そのもの——18個のタブと、その下に出る
// 件数——はモードに依らず同じものなので、外側の意匠だけをモードごとに差し替える形にした。
//
// ここで差し替えるのは次の3つだけ:
//   ・タイルの輪郭と質感(角丸/名刺/傾き/画面、照りの有無)
//   ・上段と側帯に出る数字の呼び名
//   ・進行状況の1行の言い回し
// タイルの色・記号、件数、上段の数値はすべて共通で、実データの数え上げのままにしてある。
// 枠の配色も、パワプロ以外はアプリのpanel/cream/accentをそのまま使う。明るいテーマ
// (図書館・なつやすみなど)でも文字が読めることを配色ごとに確かめる手間を増やさないため。

export interface MenuSkin {
  /** 上段左の小見出し */
  eyebrow: string;
  /** 進行状況の1行。turnは実績から数えた「何年目・何月・第何週」 */
  progress: (turn: { year: number; month: number; weekOfMonth: number }) => string;
  /** 上段のチップ3つの見出し(残り時間・見積り精度・連続記録) */
  chips: [string, string, string];
  /** 側帯の4つの見出し(実働・完了・未完了ToDo・案件)。74pxの縦帯に1〜2行で収まる短さにする */
  rail: [string, string, string, string];
  /** 説明帯の右にある決定ボタン */
  enterLabel: string;
  /** 総合評価の記章の下に出る呼び名 */
  rankLabel: string;
  shape: TileShape;
  chrome: "gloss" | "matte";
  /** 左の柱に立ち絵を出すか(いまのところ育成選手モードだけ) */
  portrait: boolean;
  /** 濃紺の専用配色を使うか。育成選手モードだけ、元の見た目をそのまま残す */
  navyFrame: boolean;
}

/** 演出テーマ文言をオフにしたときの呼び名。図(タイル・枠・形)は変えず、言葉だけ元に戻す */
export const PLAIN_MENU_WORDS = {
  eyebrow: "MENU",
  chips: ["残り時間", "見積り精度", "連続記録"] as [string, string, string],
  rail: ["実働", "完了", "未完了", "案件"] as [string, string, string, string],
  enterLabel: "開く ▶",
  rankLabel: "総合評価",
};

// メニューを出すモード。
// Claudeモード・禅モード・ハブモードは意図的にタブを絞り込んでいて(4/2/5タブ)、
// 「どのタブへ行くか選ぶ」入口そのものがモードの狙いと噛み合わないので入れていない。
export const MENU_SKINS: Partial<Record<ThemedMode, MenuSkin>> = {
  powerpro: {
    eyebrow: "SUCCESS",
    progress: (t) => `育成${t.year}年目 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["体力", "調子", "連続出場"],
    rail: ["練習時間", "消化", "交渉中", "契約"],
    enterLabel: "決定 ▶",
    rankLabel: "総合ランク",
    shape: "squircle",
    chrome: "gloss",
    portrait: true,
    navyFrame: true,
  },
  lobotomy: {
    eyebrow: "MAIN CONSOLE",
    progress: (t) => `第${t.year}期 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["エネルギー", "予測精度", "無事故日数"],
    rail: ["稼働", "処理済", "未処理命令", "契約対象"],
    enterLabel: "実行 ▶",
    rankLabel: "職員評価",
    shape: "screen",
    chrome: "matte",
    portrait: false,
    navyFrame: false,
  },
  va11halla: {
    eyebrow: "BOOT MENU",
    progress: (t) => `${t.year}年目 ${t.month}月 第${t.weekOfMonth}週の営業`,
    chips: ["スタミナ", "レシピ精度", "連勤"],
    rail: ["営業時間", "提供済", "伝票", "常連"],
    enterLabel: "SELECT ▶",
    rankLabel: "バーテン評価",
    shape: "screen",
    chrome: "gloss",
    portrait: false,
    navyFrame: false,
  },
  persona5: {
    eyebrow: "MENU",
    progress: (t) => `${t.year}年目 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["体力", "読みの精度", "連日出動"],
    rail: ["活動時間", "完遂", "計画メモ", "協力者"],
    enterLabel: "決行 ▶",
    rankLabel: "総合評価",
    shape: "slant",
    chrome: "gloss",
    portrait: false,
    navyFrame: false,
  },
  terminal: {
    eyebrow: "SYSTEM",
    progress: (t) => `Y${t.year} M${t.month} W${t.weekOfMonth}`,
    chips: ["CAPACITY", "ACCURACY", "STREAK"],
    rail: ["UPTIME", "CLOSED", "QUEUE", "POS"],
    enterLabel: "EXEC ▶",
    rankLabel: "RATING",
    shape: "screen",
    chrome: "matte",
    portrait: false,
    navyFrame: false,
  },
  adventurer: {
    eyebrow: "ギルド掲示板",
    progress: (t) => `冒険${t.year}年目 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["体力", "見立ての精度", "連続遠征"],
    rail: ["冒険時間", "討伐", "クエスト", "大冒険"],
    enterLabel: "受注 ▶",
    rankLabel: "冒険者ランク",
    shape: "card",
    chrome: "gloss",
    portrait: false,
    navyFrame: false,
  },
  library: {
    eyebrow: "目録",
    progress: (t) => `${t.year}年目 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["開館時間の残り", "請求の精度", "連続開館"],
    rail: ["閲覧時間", "返却", "予約票", "特別蔵書"],
    enterLabel: "この棚へ ▶",
    rankLabel: "司書評価",
    shape: "card",
    chrome: "matte",
    portrait: false,
    navyFrame: false,
  },
  hayarigami: {
    eyebrow: "捜査ファイル",
    progress: (t) => `捜査${t.year}年目 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["気力", "見立ての精度", "連続出動"],
    rail: ["調査時間", "解決", "未解決の噂", "継続捜査"],
    enterLabel: "調べる ▶",
    rankLabel: "捜査官評価",
    shape: "screen",
    chrome: "matte",
    portrait: false,
    navyFrame: false,
  },
  mountain: {
    eyebrow: "登山口",
    progress: (t) => `入山${t.year}年目 ${t.month}月 第${t.weekOfMonth}週`,
    chips: ["日没まで", "コースタイムの精度", "連続入山"],
    rail: ["行動時間", "通過", "ザック", "登攀中"],
    enterLabel: "この道へ ▶",
    rankLabel: "登山者評価",
    shape: "card",
    chrome: "matte",
    portrait: false,
    navyFrame: false,
  },
  natsuyasumi: {
    eyebrow: "きょうは なにする?",
    progress: (t) => `${t.year}年目の なつやすみ ${t.month}月 ${t.weekOfMonth}しゅうめ`,
    chips: ["げんき", "みつもりの あたり", "つづけた ひ"],
    rail: ["あそんだ", "おわった", "しゅくだい", "けんきゅう"],
    enterLabel: "これに する ▶",
    rankLabel: "そうごう",
    shape: "card",
    chrome: "gloss",
    portrait: false,
    navyFrame: false,
  },
};

/** そのモードでメニューを出せるか。出せるならその意匠を返す */
export function menuSkinFor(mode: VisualMode): MenuSkin | null {
  return MENU_SKINS[mode as ThemedMode] ?? null;
}

/** 設定画面などで「どのモードで使えるか」を並べるための一覧 */
export const MENU_SUPPORTED_MODES = Object.keys(MENU_SKINS) as ThemedMode[];
