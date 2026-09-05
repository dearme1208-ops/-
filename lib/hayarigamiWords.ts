import type { KaiiStatus } from "./hayarigami";
import { KW_PLAIN, KW_THEMED, RANK_COMMENT, RANK_COMMENT_PLAIN, type Rank } from "./hayarigamiLogic";

// 怪異調査モードの画面内文言。設定の「テーマに合わせた文言を使う」をオフにすると、
// 色・絵・アニメーションはこのモードのまま、言葉づかいだけ工程表本来のものに戻る。
// (他モードはlib/theme.tsのriskBadgeLabel等で同じ切り替えを行っている。このモードは
//  専用画面を持ち独自の文言が多いため、ここに一覧としてまとめる)

export interface HayarigamiWords {
  fileHeader: string;
  fileNoPrefix: string;
  troubleBadge: string;
  noRunning: string;
  stagePrefix: string;
  indexEmpty: string;
  filesEmpty: string;
  rumorsEmpty: string;
  statusDone: string;
  statusRunning: string;
  statusPaused: string;
  statusPending: string;
  erosionLabel: string;
  routeTitle: string;
  occultCountLabel: string;
  scienceCountLabel: string;
  statStreak: string;
  statToday: string;
  statSolved: string;
  statIndexed: string;
  statSealed: string;
  statLoad: string;
  reportTitle: string;
  reportBody: (total: number, erosion: number, worked: string, route: string) => string;
  judgeTitle: string;
  occultTag: string;
  occultChoice: string;
  scienceTag: string;
  scienceChoice: string;
  judgeNote: string;
  completeChoice: string;
  pauseChoice: string;
  resumeChoice: (name: string) => string;
  openChoice: (name: string) => string;
  newChoice: (name: string) => string;
  pickerChoice: string;
  pickerMenuTitle: string;
  pickerOptMaster: string;
  pickerOptFavorite: string;
  pickerOptFree: string;
  favoriteEmpty: string;
  freeCategoryLabel: string;
  freeNameLabel: string;
  pickerTitle: string;
  pickerDesc: string;
  pickerStart: string;
  pickerQueue: string;
  noStartHint: string;
  screens: { main: string; index: string; files: string; rumors: string; record: string; logic: string };
  // 推理ロジック
  logicTitle: string;
  logicLead: string;
  logicBlank: string;
  logicConfirm: string;
  logicRetry: string;
  logicNoKeywords: string;
  logicResult: (rank: string, correct: number, total: number) => string;
  rankComment: (rank: string) => string;
  keywordHint: string;
  keywordCount: (n: number, total: number) => string;
  // セルフ・クエスチョン
  selfQuestionChoice: string;
  sqTitle: string;
  sqStep1: string;
  sqStep2: (name: string) => string;
  sqAsIs: string;
  sqHalf: string;
  sqDouble: string;
  sqNone: string;
  sqClose: string;
  sqDone: (name: string, estimate: string) => string;
  detailHeader: string;
  detailStatus: string;
  detailCount: string;
  detailAvg: string;
  detailMax: string;
  detailRatio: string;
  detailTrouble: string;
  detailLastSeen: string;
  detailNote: string;
  noEstimate: string;
  commentary: (ratio: number) => string;
  narration: {
    index: (count: number, sealed: number, topName: string) => string;
    files: (total: number, done: number, pending: number, paused: number, overrun: number, hasTrouble: boolean) => string;
    rumors: (overdue: number, myDay: number) => string;
    record: (
      streak: number,
      worked: string,
      erosion: number,
      stage: string,
      routeDesc: string,
      phaseLabel: string
    ) => string;
    runningNoEstimate: (clock: string, category: string, name: string) => string;
    running: (clock: string, category: string, name: string, estimate: string, commentary: string, tail: string) => string;
    paused: (category: string, name: string) => string;
    pending: (clock: string, flavor: string, count: number) => string;
    allDone: (count: number, streak: number, erosion: number) => string;
    idle: (clock: string, flavor: string) => string;
    judgedOccult: (count: number) => string;
    judgedScience: (actual: string, hasMaster: boolean) => string;
    completed: (name: string) => string;
    queued: (name: string) => string;
  };
}

const THEMED: HayarigamiWords = {
  fileHeader: "怪異調査ファイル",
  fileNoPrefix: "FILE No.",
  troubleBadge: "怪異認定済",
  noRunning: "調査中のファイルはない",
  stagePrefix: "現在の到達段階",
  indexEmpty: "まだ1件も記録されていない。作業を完了させると、ここに綴じられていく。",
  filesEmpty: "本日のファイルはまだ無い。",
  rumorsEmpty: "追うべき噂は、今のところ無い。",
  statusDone: "解決",
  statusRunning: "調査中",
  statusPaused: "中断",
  statusPending: "未着手",
  erosionLabel: "侵蝕度（想定からはみ出した割合）",
  routeTitle: "現在のルート",
  occultCountLabel: "オカルト判定",
  scienceCountLabel: "科学判定",
  statStreak: "調査継続",
  statToday: "本日の実働",
  statSolved: "解決した怪異",
  statIndexed: "名鑑に記録",
  statSealed: "鎮めた怪異",
  statLoad: "負荷",
  reportTitle: "── 本日の捜査報告 ──",
  reportBody: (total, erosion, worked, route) =>
    `本日の事案${total}件はすべて解決。侵蝕度${erosion}%、実働${worked}。${route}にて記録を締める。`,
  judgeTitle: "── この現象を、どう説明する? ──",
  occultTag: "オカルト",
  occultChoice: "これは怪異の仕業だ（トラブル対応として記録する）",
  scienceTag: "科学",
  scienceChoice: "見積もりが甘かっただけだ（想定時間を実測値に書き換える）",
  judgeNote: "どちらを選んでも作業は続行できます。選択は集計・レポートと「ルート」に実際に反映されます。",
  completeChoice: "▶ この怪異を解決した（作業を完了する）",
  pauseChoice: "▶ 調査を中断する（一時停止）",
  resumeChoice: (name) => `▶ 「${name}」の調査を再開する`,
  openChoice: (name) => `▶ 「${name}」のファイルを開く`,
  newChoice: (name) => `▶ 新たに「${name}」を調べ始める`,
  pickerChoice: "▶ 対象を選んで調べる",
  pickerMenuTitle: "何から調べますか",
  pickerOptMaster: "▶ 名鑑（作業マスタ）全体から選ぶ",
  pickerOptFavorite: "▶ よく調べる相手（★）から選ぶ",
  pickerOptFree: "▶ 未知の相手を書き記す（自由入力）",
  favoriteEmpty: "★を付けた名鑑がまだない。名鑑（作業マスタ）で★を付けておくと、ここから直接選べる。",
  freeCategoryLabel: "分類",
  freeNameLabel: "対象の名前",
  pickerTitle: "名鑑から選ぶ",
  pickerDesc: "調べる対象を選んでください（作業マスタの全件から検索できます）。",
  pickerStart: "▶ この怪異の調査を今すぐ始める（計測開始）",
  pickerQueue: "▶ ファイルだけ用意する（未着手のまま追加）",
  noStartHint: "開けるファイルがありません。作業マスタで★をつけておくと、ここから直接調査を始められます。",
  screens: { main: "調査", index: "名鑑", files: "事件", rumors: "噂", record: "記録", logic: "推理" },
  logicTitle: "推理ロジック",
  logicLead: "集めたキーワードを空欄に当てはめ、本日の事件の全容を組み立てろ。",
  logicBlank: "［　？　］",
  logicConfirm: "この推理で確定する",
  logicRetry: "もう一度、推理し直す",
  logicNoKeywords: "キーワードが足りない。本文の色付きの語に触れて拾い集めろ。",
  logicResult: (rank, correct, total) => `評価 ${rank}　（${correct} / ${total}）`,
  rankComment: (rank) => RANK_COMMENT[rank as Rank] ?? "",
  keywordHint: "色の付いた語に触れると、キーワードとして手帳に控えられる。",
  keywordCount: (n, total) => `キーワード ${n}/${total}`,
  selfQuestionChoice: "▶ 自問自答して、状況を整理する",
  sqTitle: "── セルフ・クエスチョン ──",
  sqStep1: "……今、何を優先すべきだ?",
  sqStep2: (name) => `「${name}」に、どれだけ掛かると見ている?`,
  sqAsIs: "想定どおりで構わない",
  sqHalf: "想定の1.5倍は掛かるだろう",
  sqDouble: "想定の倍は掛かる。そういう予感がする",
  sqNone: "……今日は、まだ始めるものが無い。",
  sqClose: "考えるのをやめる",
  sqDone: (name, estimate) => `「${name}」に取り掛かる。見込みは${estimate}。……そう腹を括った。`,
  detailHeader: "怪異名鑑",
  detailStatus: "状態",
  detailCount: "遭遇回数",
  detailAvg: "平均遭遇時間",
  detailMax: "最長遭遇",
  detailRatio: "想定との比",
  detailTrouble: "怪異認定",
  detailLastSeen: "最終目撃",
  detailNote:
    "呼び名は実績の傾向から自動で決まります（いつも長引く／突発が多い／一瞬で終わる 等）。想定と実績が噛み合うと「鎮められた」になります。",
  noEstimate: "不明",
  commentary: (ratio) => {
    if (ratio >= 4) return "もはや見積もりの話ではない。これは完全に「出て」いる。";
    if (ratio >= 2.5) return "想定の枠を大きく踏み越えた。何かに引きずり込まれている。";
    if (ratio >= 1.8) return "明らかに長い。背後に何かが立っている気配がする。";
    if (ratio >= 1.3) return "少しだけ、長い。気のせいだと思いたいが。";
    return "今のところ、想定の内側だ。";
  },
  narration: {
    index: (count, sealed, topName) =>
      count === 0
        ? "名鑑はまだ白紙だ。作業を完了させるたび、その記録がここに綴じられていく。"
        : `記録された怪異は${count}体。うち${sealed}体は想定と実績が噛み合い、すでに鎮められている。……最も厄介なのは「${topName}」だ。`,
    files: (total, done, pending, paused, overrun, hasTrouble) =>
      `本日開いたファイルは${total}件。うち解決済み${done}件、${KW_THEMED.pending(pending)}、${KW_THEMED.paused(
        paused
      )}だ。` +
      (overrun > 0 ? `想定の内に収まらなかったものが${KW_THEMED.overrun(overrun)}。` : "") +
      (hasTrouble ? `そのうちいくつかは${KW_THEMED.trouble}として、通常の見積もりから切り離してある。` : ""),
    rumors: (overdue, myDay) =>
      overdue > 0
        ? `${KW_THEMED.overdue(overdue)}の噂が、まだ野放しになっている。……放置された噂ほど、質が悪い。`
        : `期限を過ぎた噂はない。今日拾うべき噂は${myDay}件だ。`,
    record: (streak, worked, erosion, stage, routeDesc, phaseLabel) =>
      `${KW_THEMED.streak(streak)}。本日の実働は${worked}、${KW_THEMED.erosion(
        erosion
      )}。現在の到達段階は「${stage}」。いまは${phaseLabel}。${routeDesc}`,
    runningNoEstimate: (clock, category, name) =>
      `……${clock}。「${category} / ${name}」の調査を継続している。この件には想定時間が設定されていない。どこまで続くのか、誰も知らない。`,
    running: (clock, category, name, estimate, commentary, tail) =>
      `……${clock}。「${category} / ${name}」の調査を継続している。想定は${estimate}。${commentary}${tail}`,
    paused: (category, name) =>
      `「${category} / ${name}」の調査は中断したままだ。……中断した怪異は、こちらが忘れた頃に戻ってくる。`,
    pending: (clock, flavor, count) =>
      `……${clock}。${flavor}${KW_THEMED.pending(count)}のファイルが、机の上に積まれている。どれから開く?`,
    allDone: (count, streak, erosion) =>
      `本日の怪異は${count}件すべて解決した。${KW_THEMED.streak(streak)}目、${KW_THEMED.erosion(
        erosion
      )}。……今日は、静かだ。`,
    idle: (clock, flavor) => `……${clock}。${flavor}まだ何も起きていない。それは幸運なのか、単に「まだ」なのか。`,
    judgedOccult: (count) =>
      `これは怪異の仕業だ——そう記録した。この一件は「${KW_THEMED.trouble}」として、通常の見積もりとは切り離して集計される。……${
        count >= 3 ? "オカルト側の判定が積み上がってきた。" : "判定はあなたの記録に残る。"
      }`,
    judgedScience: (actual, hasMaster) =>
      `怪異などいない。見積もりが甘かっただけだ——想定を実測の${actual}に書き換えた。${
        hasMaster ? "次に同じ作業に出遭っても、もう驚かない。" : "この作業には名鑑(マスタ)が無いため、本日分のみ修正した。"
      }`,
    completed: (name) => `「${name}」は解決した。ファイルを閉じる。……この件は名鑑に綴じられた。`,
    queued: (name) => `「${name}」のファイルを用意した。……開くかどうかは、まだ決めなくていい。`,
  },
};

const PLAIN: HayarigamiWords = {
  fileHeader: "本日の作業",
  fileNoPrefix: "No.",
  troubleBadge: "トラブル対応",
  noRunning: "計測中の作業はありません",
  stagePrefix: "現在の到達段階",
  indexEmpty: "まだ実績がありません。作業を完了すると、ここに集計されます。",
  filesEmpty: "本日の作業はまだありません。",
  rumorsEmpty: "対象のToDoはありません。",
  statusDone: "完了",
  statusRunning: "計測中",
  statusPaused: "一時停止",
  statusPending: "未着手",
  erosionLabel: "超過率（想定からはみ出した割合）",
  routeTitle: "超過の処理傾向",
  occultCountLabel: "トラブル計上",
  scienceCountLabel: "見積もり更新",
  statStreak: "連続日数",
  statToday: "本日の実働",
  statSolved: "完了した作業",
  statIndexed: "記録された作業",
  statSealed: "想定と一致",
  statLoad: "負荷",
  reportTitle: "── 本日のまとめ ──",
  reportBody: (total, erosion, worked, route) =>
    `本日の作業${total}件はすべて完了しました。超過率${erosion}%、実働${worked}。超過の処理傾向は「${route}」です。`,
  judgeTitle: "── 想定を超えました。どちらとして記録しますか? ──",
  occultTag: "トラブル",
  occultChoice: "突発的な一件として記録する（トラブル対応にする）",
  scienceTag: "見積もり",
  scienceChoice: "見積もりの誤差として処理する（想定時間を実測値に更新する）",
  judgeNote: "どちらを選んでも作業は続行できます。選択は集計・レポートに実際に反映されます。",
  completeChoice: "▶ この作業を完了する",
  pauseChoice: "▶ 一時停止する",
  resumeChoice: (name) => `▶ 「${name}」を再開する`,
  openChoice: (name) => `▶ 「${name}」を開始する`,
  newChoice: (name) => `▶ 「${name}」を開始する`,
  pickerChoice: "▶ 作業を選んで開始する",
  pickerMenuTitle: "追加する方法を選んでください",
  pickerOptMaster: "▶ 作業マスタ全体から選ぶ",
  pickerOptFavorite: "▶ よく使う作業（★）から選ぶ",
  pickerOptFree: "▶ 自由入力で追加する",
  favoriteEmpty: "★を付けた作業マスタがまだありません。作業マスタで★を付けておくと、ここから選べます。",
  freeCategoryLabel: "業務区分（大項目）",
  freeNameLabel: "詳細作業名",
  pickerTitle: "作業マスタから選ぶ",
  pickerDesc: "開始する作業を選んでください（作業マスタの全件から検索できます）。",
  pickerStart: "▶ この作業を今すぐ開始する（計測開始）",
  pickerQueue: "▶ 未着手のまま追加する（開始しない）",
  noStartHint: "開始できる作業がありません。作業マスタで★をつけておくと、ここから直接開始できます。",
  screens: { main: "本日", index: "集計", files: "作業", rumors: "ToDo", record: "記録", logic: "整理" },
  logicTitle: "本日の振り返り",
  logicLead: "拾ったキーワードを空欄に当てはめて、本日の状況をまとめてください。",
  logicBlank: "［　？　］",
  logicConfirm: "この内容で確定する",
  logicRetry: "もう一度やり直す",
  logicNoKeywords: "キーワードが足りません。本文中の色付きの語をタップして集めてください。",
  logicResult: (rank, correct, total) => `評価 ${rank}（正解 ${correct} / ${total}）`,
  rankComment: (rank) => RANK_COMMENT_PLAIN[rank as Rank] ?? "",
  keywordHint: "色の付いた語をタップすると、キーワードとして控えられます。",
  keywordCount: (n, total) => `キーワード ${n}/${total}`,
  selfQuestionChoice: "▶ 今の状況を整理する",
  sqTitle: "── 状況の整理 ──",
  sqStep1: "今、優先する作業はどれですか?",
  sqStep2: (name) => `「${name}」にどれくらい掛かりそうですか?`,
  sqAsIs: "想定どおり",
  sqHalf: "想定の1.5倍",
  sqDouble: "想定の2倍",
  sqNone: "今は開始できる作業がありません。",
  sqClose: "閉じる",
  sqDone: (name, estimate) => `「${name}」を開始しました。想定は${estimate}に設定しました。`,
  detailHeader: "作業別の実績",
  detailStatus: "状態",
  detailCount: "実績件数",
  detailAvg: "平均所要時間",
  detailMax: "最長所要時間",
  detailRatio: "想定との比",
  detailTrouble: "トラブル対応",
  detailLastSeen: "最終実施",
  detailNote: "想定と実績の比が±20%以内に収まり、十分な件数が貯まると「想定と一致」になります。",
  noEstimate: "未設定",
  commentary: (ratio) => {
    if (ratio >= 4) return "想定の4倍以上に達しています。";
    if (ratio >= 2.5) return "想定の2.5倍を超えています。";
    if (ratio >= 1.8) return "想定を大きく超えています。";
    if (ratio >= 1.3) return "想定を超えています。";
    return "想定の範囲内です。";
  },
  narration: {
    index: (count, sealed, topName) =>
      count === 0
        ? "まだ実績がありません。作業を完了すると、ここに集計されていきます。"
        : `記録された作業は${count}件。うち${sealed}件は想定と実績が一致しています。最も超過が大きいのは「${topName}」です。`,
    files: (total, done, pending, paused, overrun, hasTrouble) =>
      `本日の作業は${total}件。完了${done}件、${KW_PLAIN.pending(pending)}、${KW_PLAIN.paused(paused)}です。` +
      (overrun > 0 ? `想定に収まらなかったものが${KW_PLAIN.overrun(overrun)}あります。` : "") +
      (hasTrouble ? `うち一部は${KW_PLAIN.trouble}として、通常の見積もりとは分けて集計しています。` : ""),
    rumors: (overdue, myDay) =>
      overdue > 0
        ? `${KW_PLAIN.overdue(overdue)}のToDoがあります。`
        : `期限を過ぎたToDoはありません。本日のマイデイは${myDay}件です。`,
    record: (streak, worked, erosion, stage, routeDesc, phaseLabel) =>
      `${KW_PLAIN.streak(streak)}。本日の実働は${worked}、${KW_PLAIN.erosion(
        erosion
      )}。現在の到達段階は「${stage}」。時間帯は${phaseLabel}です。${routeDesc}`,
    runningNoEstimate: (clock, category, name) =>
      `${clock}時点。「${category} / ${name}」を計測中です。この作業には想定時間が設定されていません。`,
    running: (clock, category, name, estimate, commentary) =>
      `${clock}時点。「${category} / ${name}」を計測中です。想定は${estimate}。${commentary}`,
    paused: (category, name) => `「${category} / ${name}」は一時停止のままです。`,
    pending: (clock, _flavor, count) => `${clock}時点。${KW_PLAIN.pending(count)}の作業があります。`,
    allDone: (count, streak, erosion) =>
      `本日の作業${count}件はすべて完了しました。${KW_PLAIN.streak(streak)}目、${KW_PLAIN.erosion(erosion)}です。`,
    idle: (clock) => `${clock}時点。本日の作業はまだ登録されていません。`,
    judgedOccult: () =>
      `この作業を${KW_PLAIN.trouble}として記録しました。突発的な一件として、通常の見積もりとは切り離して集計されます。`,
    judgedScience: (actual, hasMaster) =>
      `想定時間を実測の${actual}に更新しました。${
        hasMaster ? "作業マスタにも反映したため、次回からこの想定が使われます。" : "この作業には作業マスタが無いため、本日分のみ更新しました。"
      }`,
    completed: (name) => `「${name}」を完了しました。`,
    queued: (name) => `「${name}」を未着手のまま追加しました。`,
  },
};

export function wordsFor(wordingEnabled: boolean): HayarigamiWords {
  return wordingEnabled ? THEMED : PLAIN;
}

// 名鑑の状態表示。文言オフの時は集計上の意味そのままの言い方に置き換える
const KAII_STATUS_PLAIN: Record<KaiiStatus, string> = {
  目撃情報のみ: "サンプル僅少",
  調査中: "計測中",
  解明済み: "傾向把握済み",
  鎮められた: "想定と一致",
};

export function kaiiStatusLabel(status: KaiiStatus, wordingEnabled: boolean): string {
  return wordingEnabled ? status : KAII_STATUS_PLAIN[status];
}
