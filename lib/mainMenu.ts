import type { ThemedMode, VisualMode } from "./theme";
import type { Rgb, TileShape } from "./powerproMenuArt";

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
  /**
   * タイルの色調。そのモードを代表する4〜5色を並べたもので、18枚のタイルには
   * この中を等間隔でつないだ色が順に配られる(paletteColorFor参照)。
   * 未指定(パワプロ)の場合はMENU_ENTRIESの色をそのまま使う。
   * パワプロの明るい原色は野球ゲームの育成メニューには合うが、他のモードに
   * そのまま使うと世界観と色合いが噛み合わない(ロボトミー風が虹色になる、等)ため、
   * モードごとに実際に使われている配色(CSSのアクセント色・専用パレット)から取っている
   */
  tilePalette?: Rgb[];
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * タイルの色を、そのモードのtilePaletteから等間隔に取り出す。
 * 代表色を順につないだ連続した帯として扱うことで、18枚それぞれに違う色を配りながら、
 * どの2枚を並べてもそのモードの色調から外れないようにしている。
 * tilePaletteを持たないモード(パワプロ)では、渡されたfallback(MENU_ENTRIESの色)をそのまま返す
 */
export function paletteColorFor(skin: MenuSkin, index: number, total: number, fallback: Rgb): Rgb {
  const anchors = skin.tilePalette;
  if (!anchors || anchors.length === 0 || total <= 1) return fallback;
  const t = (index / (total - 1)) * (anchors.length - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(i0 + 1, anchors.length - 1);
  return mixRgb(anchors[i0], anchors[i1], t - i0);
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
    // 血の赤(基調のアクセント色そのもの)・くすんだオリーブ黄(タイトル画面の色)・
    // 異常体を思わせる紫・鋼鉄グレー・警告アンバー
    tilePalette: [
      [194, 59, 59],
      [140, 142, 88],
      [107, 72, 124],
      [86, 92, 104],
      [186, 110, 46],
    ],
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
    // ネオンサインの配色。ピンクとシアンは専用のCSS変数と同じ値
    tilePalette: [
      [255, 45, 149],
      [0, 229, 255],
      [138, 66, 214],
      [255, 176, 54],
      [70, 110, 230],
    ],
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
    // 黒地に赤・白を基調にした切り絵風の配色に合わせ、赤と黒の濃淡を主体にする。
    // 金とスレートを少しだけ混ぜ、18枚が赤一色に埋もれないようにしている
    tilePalette: [
      [217, 35, 35],
      [46, 46, 52],
      [104, 26, 32],
      [176, 140, 54],
      [70, 74, 86],
    ],
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
    // 証券端末風の値上がり/値下がり色(専用CSS変数)そのままに、黒鉛グレーを添える
    tilePalette: [
      [255, 176, 0],
      [47, 227, 130],
      [64, 220, 255],
      [255, 77, 90],
      [78, 86, 94],
    ],
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
    // RPGのステータス画面でおなじみの配色(HP=緑、MP=青、危険=赤、ゴールド、レア=紫)を
    // そのまま流用。専用CSS変数(--adv-*)と同じ値
    tilePalette: [
      [214, 158, 40],
      [74, 168, 90],
      [66, 120, 200],
      [196, 60, 48],
      [138, 92, 196],
    ],
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
    // 書棚に並ぶ革表紙の色。基調の革茶に、臙脂・深緑・紺の布装丁と金の箔押しを添える
    tilePalette: [
      [122, 74, 42],
      [110, 40, 40],
      [64, 92, 68],
      [58, 78, 116],
      [176, 140, 70],
    ],
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
    // 血の赤(基調のアクセント色)を軸に、打撲のような紫・灰・錆・ほぼ黒を添えた
    // 彩度の低い配色。ホラーサウンドノベルの禍々しさを崩さないようにしている
    tilePalette: [
      [176, 26, 38],
      [96, 64, 98],
      [96, 92, 90],
      [150, 80, 40],
      [62, 48, 46],
    ],
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
    // 朝焼けのオレンジ(基調のアクセント色)・氷河の青・松の緑・岩のグレー・赤土
    tilePalette: [
      [232, 138, 74],
      [92, 142, 190],
      [72, 112, 82],
      [112, 118, 126],
      [150, 112, 92],
    ],
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
    // 太陽・海・葉の専用CSS変数の色に、スイカの赤と麦わら帽子の色を添える
    tilePalette: [
      [235, 170, 60],
      [92, 177, 206],
      [98, 152, 72],
      [222, 92, 82],
      [178, 142, 92],
    ],
  },
};

/** そのモードでメニューを出せるか。出せるならその意匠を返す */
export function menuSkinFor(mode: VisualMode): MenuSkin | null {
  return MENU_SKINS[mode as ThemedMode] ?? null;
}

/** 設定画面などで「どのモードで使えるか」を並べるための一覧 */
export const MENU_SUPPORTED_MODES = Object.keys(MENU_SKINS) as ThemedMode[];
