import type { KaiiStatus } from "./hayarigami";

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
  pickerTitle: string;
  pickerDesc: string;
  pickerStart: string;
  pickerQueue: string;
  noStartHint: string;
  screens: { main: string; index: string; files: string; rumors: string; record: string };
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
    files: (total: number, done: number, pending: number, paused: number) => string;
    rumors: (overdue: number, myDay: number) => string;
    record: (streak: number, worked: string, erosion: number, stage: string, routeDesc: string) => string;
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
  pickerChoice: "▶ 名鑑（作業マスタ）から選んで調べる",
  pickerTitle: "名鑑から選ぶ",
  pickerDesc: "調べる対象を選んでください（作業マスタの全件から検索できます）。",
  pickerStart: "▶ この怪異の調査を今すぐ始める（計測開始）",
  pickerQueue: "▶ ファイルだけ用意する（未着手のまま追加）",
  noStartHint: "開けるファイルがありません。作業マスタで★をつけておくと、ここから直接調査を始められます。",
  screens: { main: "調査", index: "名鑑", files: "事件", rumors: "噂", record: "記録" },
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
    files: (total, done, pending, paused) =>
      `本日開いたファイルは${total}件。うち解決済みが${done}件、未着手が${pending}件、中断中が${paused}件だ。`,
    rumors: (overdue, myDay) =>
      overdue > 0
        ? `期限を過ぎた噂が${overdue}件、まだ野放しになっている。……放置された噂ほど、質が悪い。`
        : `期限切れの噂はない。今日拾うべき噂は${myDay}件だ。`,
    record: (streak, worked, erosion, stage, routeDesc) =>
      `調査継続${streak}日。本日の実働は${worked}、侵蝕度${erosion}%。現在の到達段階は「${stage}」。${routeDesc}`,
    runningNoEstimate: (clock, category, name) =>
      `……${clock}。「${category} / ${name}」の調査を継続している。この件には想定時間が設定されていない。どこまで続くのか、誰も知らない。`,
    running: (clock, category, name, estimate, commentary, tail) =>
      `……${clock}。「${category} / ${name}」の調査を継続している。想定は${estimate}。${commentary}${tail}`,
    paused: (category, name) =>
      `「${category} / ${name}」の調査は中断したままだ。……中断した怪異は、こちらが忘れた頃に戻ってくる。`,
    pending: (clock, flavor, count) =>
      `……${clock}。${flavor}手をつけていないファイルが${count}件、机の上に積まれている。どれから開く?`,
    allDone: (count, streak, erosion) =>
      `本日の怪異は${count}件すべて解決した。調査継続${streak}日目、侵蝕度${erosion}%。……今日は、静かだ。`,
    idle: (clock, flavor) => `……${clock}。${flavor}まだ何も起きていない。それは幸運なのか、単に「まだ」なのか。`,
    judgedOccult: (count) =>
      `これは怪異の仕業だ——そう記録した。この一件は「トラブル対応」として、通常の見積もりとは切り離して集計される。……${
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
  pickerChoice: "▶ 作業マスタから選んで開始する",
  pickerTitle: "作業マスタから選ぶ",
  pickerDesc: "開始する作業を選んでください（作業マスタの全件から検索できます）。",
  pickerStart: "▶ この作業を今すぐ開始する（計測開始）",
  pickerQueue: "▶ 未着手のまま追加する（開始しない）",
  noStartHint: "開始できる作業がありません。作業マスタで★をつけておくと、ここから直接開始できます。",
  screens: { main: "本日", index: "集計", files: "作業", rumors: "ToDo", record: "記録" },
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
    files: (total, done, pending, paused) =>
      `本日の作業は${total}件。完了${done}件、未着手${pending}件、一時停止${paused}件です。`,
    rumors: (overdue, myDay) =>
      overdue > 0
        ? `期限切れのToDoが${overdue}件あります。`
        : `期限切れのToDoはありません。本日のマイデイは${myDay}件です。`,
    record: (streak, worked, erosion, stage, routeDesc) =>
      `連続日数${streak}日。本日の実働は${worked}、超過率${erosion}%。現在の到達段階は「${stage}」。${routeDesc}`,
    runningNoEstimate: (clock, category, name) =>
      `${clock}時点。「${category} / ${name}」を計測中です。この作業には想定時間が設定されていません。`,
    running: (clock, category, name, estimate, commentary) =>
      `${clock}時点。「${category} / ${name}」を計測中です。想定は${estimate}。${commentary}`,
    paused: (category, name) => `「${category} / ${name}」は一時停止のままです。`,
    pending: (clock, _flavor, count) => `${clock}時点。未着手の作業が${count}件あります。`,
    allDone: (count, streak, erosion) =>
      `本日の作業${count}件はすべて完了しました。連続日数${streak}日目、超過率${erosion}%です。`,
    idle: (clock) => `${clock}時点。本日の作業はまだ登録されていません。`,
    judgedOccult: () =>
      "この作業をトラブル対応として記録しました。突発的な一件として、通常の見積もりとは切り離して集計されます。",
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
