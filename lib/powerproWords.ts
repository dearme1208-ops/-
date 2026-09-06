import type { AbilityKey, ExpKind, MotivationLevel, PracticeKind } from "./powerpro";

// パワプロ風モードの文言。他モードと同じく、設定の「テーマに合わせた文言を使う」を
// オフにすると、球場の絵・ゲージ・能力値の図はそのままに、言葉づかいだけ工程表本来のものへ戻る。
//
// 図(球場・キャラクター・六角形・電光掲示板)は文言設定に関係なく常に出る。
// 切り替わるのはラベルだけで、示している実データはどちらでもまったく同じ。

export interface PowerproWords {
  // 見出し
  screenTitle: string;
  turnLabel: (year: number, month: number, week: number) => string;
  remainingTurns: (n: number) => string;
  usedTurns: (n: number) => string;

  // 画面切り替え
  panelTraining: string;
  panelGrowth: string;
  panelPlayer: string;
  panelScout: string;

  // 1日ごとの育成
  /** 積み上げのほうの名前。比率(選手データ)とは測っているものが違うので、平文では別の語を使う */
  growthAbilityName: (key: AbilityKey) => string;
  growthTitle: string;
  growthLead: string;
  growthNote: string;
  seasonNote: string;
  todayGainTitle: string;
  todayGainEmpty: string;
  trainedDaysLabel: (n: number) => string;
  nextPointLabel: (n: number) => string;

  // 体力と休憩
  staminaTitle: string;
  staminaLead: string;
  restTitle: string;
  restEmpty: string;
  restRecover: (n: number) => string;
  restDoneLabel: (done: number, total: number) => string;

  // ゲージ
  staminaLabel: string;
  staminaNote: (rest: string) => string;
  motivationLabel: string;
  motivationName: (level: MotivationLevel) => string;
  hotLabel: string;
  hotNote: (done: number, total: number) => string;
  feverLabel: string;
  injuryLabel: string;
  injuryNote: string;

  // 練習
  trainingTitle: string;
  trainingEmpty: string;
  trainingHint: string;
  practiceName: (kind: PracticeKind) => string;
  favoriteBadge: string;
  expGainLabel: (n: number, kind: string) => string;
  nowTraining: string;
  overrunBadge: string;
  overrunNote: (over: string) => string;

  // 操作
  actionStart: string;
  actionResume: string;
  actionPause: string;
  actionFinish: string;
  actionPick: string;
  pickerTitle: string;
  pickerMenuTitle: string;
  pickerOptMaster: string;
  pickerOptFavorite: string;
  pickerOptFree: string;
  favoriteEmpty: string;
  freeCategoryLabel: string;
  freeNameLabel: string;
  closeLabel: string;

  // 能力値
  playerTitle: string;
  playerRankLabel: string;
  allALabel: string;
  abilityName: (key: AbilityKey) => string;
  expTitle: string;
  expName: (kind: ExpKind) => string;
  specialTitle: string;
  specialEmpty: string;
  basisLabel: string;

  // スカウト(ToDo) / ペナント(案件)
  scoutBadge: (grade: string) => string;
  draftTitle: string;
  draftTarget: string;
  draftActive: string;
  draftSigned: string;
  draftNoTarget: string;
  standingsTitle: string;
  standingsTeam: string;
  standingsWin: string;
  standingsLose: string;
  standingsRest: string;
  standingsRate: string;
  standingsDays: string;
  standingsEmpty: string;
  winLossLabel: (w: number, l: number) => string;
  pennantLabel: string;

  // スコアボード(ガントチャートタブ)
  lineScoreTitle: string;
  lineScoreNote: string;
  lineScoreInning: string;
  lineScoreRuns: string;
  lineScoreTotal: string;
  lineScoreErrors: string;

  // 記録
  recordTitle: string;
  workedLabel: string;
  doneLabel: string;
  plannedLabel: string;
  overdueLabel: string;
  streakLabel: string;
  favoriteTrainingLabel: string;
  none: string;
}

const THEMED: PowerproWords = {
  screenTitle: "サクセス",
  turnLabel: (y, m, w) => `育成${y}年目　${m}月　第${w}週`,
  remainingTurns: (n) => `残り${n}ターン`,
  usedTurns: (n) => `消化${n}ターン`,

  panelTraining: "練習",
  panelGrowth: "育成",
  panelPlayer: "データ",
  panelScout: "評価",

  // 野球の能力名は比喩なので、比率でも積み上げでもそのまま通じる
  growthAbilityName: (k) =>
    ({ meet: "ミート", power: "パワー", speed: "走力", arm: "肩力", field: "守備力", catch: "捕球" })[k],
  growthTitle: "積み上げた能力",
  growthLead:
    "初日からの練習の合計です。過去の記録は変わらないので、この値は下がりません。働いた日だけ確実に伸びます。",
  growthNote: "初日からの積み上げ",
  seasonNote: "いまの調子（直近30日）",
  todayGainTitle: "今日の練習で伸びたぶん",
  todayGainEmpty: "今日はまだ練習していません。作業を完了すると、ここに伸びが出ます。",
  trainedDaysLabel: (n) => `練習した日数 ${n}日`,
  nextPointLabel: (n) => `次の1ポイントまで あと${n}`,

  staminaTitle: "体力",
  staminaLead: "就業時間ぶんを走り切れる体力が満タンです。練習で減り、休憩で戻ります。",
  restTitle: "休憩メニュー",
  restEmpty:
    "休憩の設定がまだありません。設定の「休憩時間帯」でチェック項目を登録すると、ここで消化して体力を戻せます。",
  restRecover: (n) => `1つ消化するごとに体力が ${n}% 戻ります`,
  restDoneLabel: (done, total) => `${done}/${total} 消化`,

  staminaLabel: "体力",
  staminaNote: (rest) => `本日はあと ${rest} 分の練習に耐えられます`,
  motivationLabel: "やる気",
  motivationName: (l) => ["絶不調", "不調", "普通", "好調", "絶好調"][l],
  hotLabel: "熱血ゲージ",
  hotNote: (d, t) => `本日の練習メニュー ${d}/${t} を消化`,
  feverLabel: "フィーバー！",
  injuryLabel: "ケガの危険",
  injuryNote: "想定を超えた分が積み上がると、ケガの危険が上がります。",

  trainingTitle: "練習メニュー",
  trainingEmpty: "本日の練習メニューがまだ組まれていません。",
  trainingHint: "コマンドを選ぶと、その練習を始めます。",
  practiceName: (k) =>
    ({ batting: "打撃練習", running: "走り込み", pitching: "投げ込み", fielding: "守備練習", catching: "捕手練習", mental: "メンタル" })[k],
  favoriteBadge: "得意練習",
  expGainLabel: (n, kind) => `${kind}経験点 +${n}`,
  nowTraining: "練習中",
  overrunBadge: "オーバーワーク",
  overrunNote: (o) => `予定を ${o} 超えています。`,

  actionStart: "この練習を始める",
  actionResume: "練習を再開する",
  actionPause: "小休止する",
  actionFinish: "練習を終える",
  actionPick: "＋ 練習メニューを追加する",
  pickerTitle: "練習メニューを追加",
  pickerMenuTitle: "どこから追加しますか",
  pickerOptMaster: "選手名鑑から選ぶ",
  pickerOptFavorite: "得意メニューから選ぶ",
  pickerOptFree: "自主練を入力する",
  favoriteEmpty: "お気に入りに登録された練習はまだありません。",
  freeCategoryLabel: "練習の種別",
  freeNameLabel: "練習の内容",
  closeLabel: "閉じる",

  playerTitle: "選手能力",
  playerRankLabel: "選手ランク",
  allALabel: "オールA",
  abilityName: (k) =>
    ({ meet: "ミート", power: "パワー", speed: "走力", arm: "肩力", field: "守備力", catch: "捕球" })[k],
  expTitle: "経験点",
  expName: (k) => ({ muscle: "筋力", agility: "敏捷", technique: "技術", breaking: "変化球", mental: "精神" })[k],
  specialTitle: "特殊能力",
  specialEmpty: "まだ特殊能力は身についていません。記録を積み上げると現れます。",
  basisLabel: "根拠",

  scoutBadge: (g) => `評価${g}`,
  draftTitle: "スカウト部　ドラフトボード",
  draftTarget: "最優先ターゲット",
  draftActive: "交渉中",
  draftSigned: "契約済",
  draftNoTarget: "追いかけている候補はいません",
  standingsTitle: "ペナントレース　順位表",
  standingsTeam: "案件",
  standingsWin: "勝",
  standingsLose: "敗",
  standingsRest: "残",
  standingsRate: "勝率",
  standingsDays: "期日まで",
  standingsEmpty: "進行中の案件はありません",
  winLossLabel: (w, l) => `${w}勝${l}敗`,
  pennantLabel: "ペナント",

  lineScoreTitle: "本日のスコア",
  lineScoreNote: "練習1本を1回に見立てたスコアボードです。数字はその回に入った点（実働の分数）、○＝予定内、●＝オーバーワーク。",
  lineScoreInning: "回",
  lineScoreRuns: "点",
  lineScoreTotal: "計",
  lineScoreErrors: "失",

  recordTitle: "本日の成績",
  workedLabel: "練習時間",
  doneLabel: "消化",
  plannedLabel: "予定",
  overdueLabel: "交渉期限切れ",
  streakLabel: "連続出場",
  favoriteTrainingLabel: "得意練習",
  none: "なし",
};

const PLAIN: PowerproWords = {
  screenTitle: "本日の作業",
  turnLabel: (y, m, w) => `記録${y}年目　${m}月　第${w}週`,
  remainingTurns: (n) => `未完了${n}件`,
  usedTurns: (n) => `完了${n}件`,

  panelTraining: "作業",
  panelGrowth: "積み上げ",
  panelPlayer: "データ",
  panelScout: "評価",

  // 平文では、比率の名前(「1日の実働」等)をそのまま使うと実態と 食い違ってしまう。
  // ここで測っているのは割合ではなく、初日からの件数・時間の積み上げそのもの
  growthAbilityName: (k) =>
    ({ meet: "想定内", power: "実働", speed: "片付け", arm: "作業数", field: "突発対応", catch: "期日内" })[k],
  growthTitle: "積み上げた指標",
  growthLead:
    "記録初日からの合計です。過去の記録は変わらないため、この値は下がりません。作業した日だけ増えます。",
  growthNote: "初日からの積み上げ",
  seasonNote: "直近30日の傾向",
  todayGainTitle: "本日ぶんの積み上げ",
  todayGainEmpty: "本日の記録はまだありません。作業を完了すると、ここに加算されます。",
  trainedDaysLabel: (n) => `記録のある日数 ${n}日`,
  nextPointLabel: (n) => `次の1ポイントまで あと${n}`,

  staminaTitle: "体力",
  staminaLead: "所定労働時間を満タンとして、実働で減り、休憩の消化で戻ります。",
  restTitle: "休憩チェックリスト",
  restEmpty:
    "休憩時間帯の設定がありません。設定の「休憩時間帯」でチェック項目を登録すると、ここで消化できます。",
  restRecover: (n) => `1件消化するごとに ${n}% 回復します`,
  restDoneLabel: (done, total) => `${done}/${total} 消化`,

  staminaLabel: "残り想定時間",
  staminaNote: (rest) => `1日8時間を基準に、あと ${rest} 分です`,
  motivationLabel: "見積もり精度",
  // この5段階が見ているのは超過の大きさではなく「本日完了した作業のうち、
  // 想定内に収まった件数の割合」。大きさの話に読める語だと、
  // 5%の超過1件でも「大きく超過」と出てしまい実態と食い違う
  motivationName: (l) => ["大半が超過", "超過が多い", "半々", "多くが想定内", "ほぼ想定内"][l],
  hotLabel: "本日の進捗",
  hotNote: (d, t) => `本日の作業 ${d}/${t} 件が完了`,
  feverLabel: "本日分すべて完了",
  injuryLabel: "超過の度合い",
  injuryNote: "想定時間を超えた分が積み上がると、この値が上がります。",

  trainingTitle: "本日の作業",
  trainingEmpty: "本日の作業がまだ登録されていません。",
  trainingHint: "作業を選ぶと、計測を開始します。",
  practiceName: (k) =>
    ({ batting: "作成・設計", running: "連絡・対応", pitching: "トラブル対応", fielding: "確認・検証", catching: "打ち合わせ", mental: "事務・整理" })[k],
  favoriteBadge: "よく行う区分",
  expGainLabel: (n, kind) => `${kind} +${n}`,
  nowTraining: "計測中",
  overrunBadge: "想定超過",
  overrunNote: (o) => `想定時間を ${o} 超えています。`,

  actionStart: "この作業を開始する",
  actionResume: "再開する",
  actionPause: "一時停止する",
  actionFinish: "完了する",
  actionPick: "＋ 作業を追加する",
  pickerTitle: "作業を追加",
  pickerMenuTitle: "どこから追加しますか",
  pickerOptMaster: "作業マスタから選ぶ",
  pickerOptFavorite: "お気に入りから選ぶ",
  pickerOptFree: "自由入力する",
  favoriteEmpty: "お気に入りに登録された作業はまだありません。",
  freeCategoryLabel: "業務区分",
  freeNameLabel: "作業名",
  closeLabel: "閉じる",

  playerTitle: "実績サマリ",
  playerRankLabel: "総合評価",
  allALabel: "全項目が高水準",
  abilityName: (k) =>
    ({ meet: "見積もり精度", power: "1日の実働", speed: "1日の件数", arm: "最大実働", field: "通常作業率", catch: "期日内完了率" })[k],
  expTitle: "積み上げ",
  expName: (k) =>
    ({ muscle: "総実働", agility: "区分の幅", technique: "作業の種類", breaking: "トラブル", mental: "継続" })[k],
  specialTitle: "傾向",
  specialEmpty: "まだ目立った傾向はありません。記録が増えると現れます。",
  basisLabel: "根拠",

  scoutBadge: (g) => `優先${g}`,
  draftTitle: "ToDo の状況",
  draftTarget: "最優先の1件",
  draftActive: "未完了",
  draftSigned: "完了",
  draftNoTarget: "未完了のToDoはありません",
  standingsTitle: "案件の進捗一覧",
  standingsTeam: "案件",
  standingsWin: "完了",
  standingsLose: "超過",
  standingsRest: "残",
  standingsRate: "消化率",
  standingsDays: "期日まで",
  standingsEmpty: "進行中の案件はありません",
  winLossLabel: (w, l) => `完了${w} / 超過${l}`,
  pennantLabel: "段階",

  lineScoreTitle: "この日の内訳",
  lineScoreNote: "作業1件を1列に並べています。数字はその作業の実働（分）、○＝想定内、●＝想定超過です。",
  lineScoreInning: "件",
  lineScoreRuns: "分",
  lineScoreTotal: "計",
  lineScoreErrors: "超過",

  recordTitle: "本日の記録",
  workedLabel: "実働時間",
  doneLabel: "完了",
  plannedLabel: "予定",
  overdueLabel: "期限切れ",
  streakLabel: "連続日数",
  favoriteTrainingLabel: "よく行う区分",
  none: "なし",
};

export function powerproWordsFor(wordingEnabled: boolean): PowerproWords {
  return wordingEnabled ? THEMED : PLAIN;
}
