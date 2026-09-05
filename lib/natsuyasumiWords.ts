import type { Phase, Species, Weather } from "./natsuyasumi";
import { SPECIES_NAME, SPECIES_PLAIN } from "./natsuyasumi";

// ぼくのなつやすみ風モードの文言。他モードと同じく、設定の「テーマに合わせた文言を使う」を
// オフにすると、風景画・虫・スタンプカードといった図はそのままに、
// 言葉づかいだけ工程表本来のものへ戻る。
//
// オンのときは、小学生の絵日記らしくひらがなを多めにする(原作の絵日記に倣った)。

export interface NatsuWords {
  // 見出し
  title: string;
  phaseName: (p: Phase) => string;
  phaseNote: (p: Phase) => string;
  dateLine: (month: number, day: number, weekday: string) => string;
  daysLeft: (n: number) => string;

  // お天気
  weatherName: (w: Weather) => string;
  weatherNote: string;

  // ラジオ体操
  stampTitle: string;
  stampNote: (streak: number, card: number) => string;
  stampTodo: string;
  stampDone: string;

  // 朝顔
  vineTitle: string;
  vineNote: (hours: string, blooms: number) => string;

  // きょうやること
  todayTitle: string;
  todayEmpty: string;
  actionCatch: string;
  actionResume: string;
  actionRelease: string;
  actionDone: string;
  actionPick: string;
  runningLabel: string;
  overrunLabel: string;

  // 虫かご
  cageTitle: string;
  cageEmpty: string;
  cageNote: string;
  speciesName: (s: Species) => string;
  rarityName: (r: number) => string;
  sizeLabel: string;
  countLabel: string;
  lastSeenLabel: string;
  caughtTodayLabel: string;

  // 絵日記
  diaryTitle: string;
  diaryPlaceholder: string;
  diaryNoteLabel: string;

  // カレンダー
  calendarTitle: string;
  calendarNote: string;

  // 画面切り替え
  panelToday: string;
  panelCage: string;
  panelCalendar: string;

  // 追加
  pickerTitle: string;
  pickerMenu: string;
  pickerMaster: string;
  pickerFavorite: string;
  pickerFree: string;
  favoriteEmpty: string;
  freeCategoryLabel: string;
  freeNameLabel: string;
  closeLabel: string;
}

const THEMED: NatsuWords = {
  title: "きょうの にっき",
  phaseName: (p) =>
    ({ late: "よふかし", dawn: "あさ", morning: "ごぜん", noon: "おひる", evening: "ゆうがた", night: "よる" })[p],
  phaseNote: (p) =>
    ({
      late: "もう おそい じかんです。そろそろ ねましょう。",
      dawn: "あさです。ラジオたいそうに いってきましょう。",
      morning: "ごぜんちゅう。いちばん はかどる じかんです。",
      noon: "おひるすぎ。せみが ないています。",
      evening: "ゆうがた。かげが ながく なってきました。",
      night: "よるです。きょうの ことを にっきに かきましょう。",
    })[p],
  dateLine: (m, d, wd) => `${m}がつ ${d}にち（${wd}）`,
  daysLeft: (n) => (n <= 0 ? "きょうで こんげつは おしまい" : `こんげつは あと ${n}にち`),

  weatherName: (w) => ({ clear: "かいせい", sunny: "はれ", cloudy: "くもり", shower: "ゆうだち" })[w],
  weatherNote: "よていより はみだすほど、そらが くもります。",

  stampTitle: "ラジオたいそう カード",
  stampNote: (s, c) => `${s}にち つづいています（${c}まいめ）`,
  stampTodo: "きょうは まだ はんこが ありません",
  stampDone: "きょうの はんこ、おしました",

  vineTitle: "えんがわの あさがお",
  vineNote: (hours, blooms) => `きょうは ${hours} がんばりました。はなは ${blooms}こ さいています。`,

  todayTitle: "きょう やること",
  todayEmpty: "きょう やることは まだ ありません。",
  actionCatch: "つかまえる",
  actionResume: "つづきを する",
  actionRelease: "ひとやすみ",
  actionDone: "できた！",
  actionPick: "＋ やることを ふやす",
  runningLabel: "いま やっていること",
  overrunLabel: "よていより ながい",

  cageTitle: "むしかご",
  cageEmpty: "まだ なにも つかまえていません。",
  cageNote:
    "いちど でも やった しごとが、むしに なって ならびます。おおきさは よていの ながさ、めずらしさは やった かいすうの すくなさです。",
  speciesName: (s) => SPECIES_NAME[s],
  rarityName: (r) => ["よく みる", "ときどき みる", "めずらしい", "とても めずらしい"][r] ?? "",
  sizeLabel: "おおきさ",
  countLabel: "つかまえた かず",
  lastSeenLabel: "さいごに みた ひ",
  caughtTodayLabel: "きょう つかまえた",

  diaryTitle: "えにっき",
  diaryPlaceholder: "きょう おもったことを かこう",
  diaryNoteLabel: "ひとこと",

  calendarTitle: "こんげつの カレンダー",
  calendarNote: "きろくの ある ひに いろが つきます。こいほど ながく がんばった ひです。",

  panelToday: "きょう",
  panelCage: "むしかご",
  panelCalendar: "カレンダー",

  pickerTitle: "やることを ふやす",
  pickerMenu: "どこから ふやしますか",
  pickerMaster: "どうぐばこから えらぶ",
  pickerFavorite: "おきにいりから えらぶ",
  pickerFree: "じぶんで かく",
  favoriteEmpty: "おきにいりは まだ ありません。",
  freeCategoryLabel: "しゅるい",
  freeNameLabel: "なまえ",
  closeLabel: "とじる",
};

const PLAIN: NatsuWords = {
  title: "本日の作業",
  phaseName: (p) =>
    ({ late: "深夜", dawn: "早朝", morning: "午前", noon: "日中", evening: "夕方", night: "夜間" })[p],
  phaseNote: (p) =>
    ({
      late: "深夜帯です。この時間の作業は深夜稼働として記録されます。",
      dawn: "早朝です。",
      morning: "午前です。",
      noon: "日中です。",
      evening: "夕方です。定時を回りました。",
      night: "夜間です。本日の記録をまとめましょう。",
    })[p],
  dateLine: (m, d, wd) => `${m}月${d}日（${wd}）`,
  daysLeft: (n) => (n <= 0 ? "本日が今月の最終日です" : `今月の残り ${n}日`),

  weatherName: (w) => ({ clear: "想定内", sunny: "わずかに超過", cloudy: "超過あり", shower: "大幅に超過" })[w],
  weatherNote: "想定時間を超えた分が増えるほど、空が曇ります。",

  stampTitle: "連続記録",
  stampNote: (s, c) => `${s}日連続で記録しています（${c}周目）`,
  stampTodo: "本日はまだ記録がありません",
  stampDone: "本日の記録があります",

  vineTitle: "本日の実働",
  vineNote: (hours, blooms) => `本日の実働は ${hours}、完了は ${blooms}件です。`,

  todayTitle: "本日の作業",
  todayEmpty: "本日の作業はまだありません。",
  actionCatch: "開始する",
  actionResume: "再開する",
  actionRelease: "一時停止",
  actionDone: "完了する",
  actionPick: "＋ 作業を追加する",
  runningLabel: "計測中の作業",
  overrunLabel: "想定超過",

  cageTitle: "作業マスタ一覧",
  cageEmpty: "まだ実績のある作業がありません。",
  cageNote: "一度でも実績のある作業が並びます。大きさは想定時間、めずらしさは実施回数の少なさです。",
  speciesName: (s) => SPECIES_PLAIN[s],
  rarityName: (r) => ["頻繁", "ときどき", "まれ", "ごくまれ"][r] ?? "",
  sizeLabel: "想定時間",
  countLabel: "実施回数",
  lastSeenLabel: "最終実施",
  caughtTodayLabel: "本日実施",

  diaryTitle: "本日の記録",
  diaryPlaceholder: "本日の所感を記入できます",
  diaryNoteLabel: "メモ",

  calendarTitle: "今月のカレンダー",
  calendarNote: "記録のある日に色が付きます。濃いほど実働時間が長い日です。",

  panelToday: "本日",
  panelCage: "マスタ",
  panelCalendar: "カレンダー",

  pickerTitle: "作業を追加",
  pickerMenu: "どこから追加しますか",
  pickerMaster: "作業マスタから選ぶ",
  pickerFavorite: "お気に入りから選ぶ",
  pickerFree: "自由入力する",
  favoriteEmpty: "お気に入りに登録された作業はまだありません。",
  freeCategoryLabel: "業務区分",
  freeNameLabel: "作業名",
  closeLabel: "閉じる",
};

export function natsuWordsFor(wordingEnabled: boolean): NatsuWords {
  return wordingEnabled ? THEMED : PLAIN;
}
