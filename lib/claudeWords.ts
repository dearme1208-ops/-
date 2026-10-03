import type { FindingKind } from "./claudeThinking";

// Claudeモードの文言。他モードと同じく、設定の「テーマに合わせた文言を使う」を
// オフにすると、図・分析・数値はそのままに、語り口だけ工程表本来のものへ戻る。
//
// 注意: 気づき(Finding)の本文そのものは lib/claudeThinking.ts が組み立てており、
// もとから分析の言葉で書かれているため切り替えの対象にしていない。
// ここで切り替わるのは、その周りの見出し・語りかけ・一人称の有無だけ。

export interface ClaudeWords {
  // インサイト画面
  insightTitle: string;
  insightLead: string;
  thinkingTitle: string;
  thinkingLead: string;
  findingsTitle: string;
  findingsEmpty: string;
  findingsEmptyHint: (n: number) => string;
  noData: string;

  evidenceLabel: string;
  actionLabel: string;
  counterLabel: string;
  confidenceLabel: string;
  sampleLabel: (n: number) => string;
  kindLabel: (k: FindingKind) => string;

  calibrationTitle: string;
  calibrationLead: string;
  calibrationEmpty: string;
  calibrationOver: (n: number, total: number) => string;

  rhythmTitle: string;
  rhythmLead: string;

  // ワークスペース側
  focusTitle: string;
  focusIdle: string;
  todayLine: (done: number, clock: string) => string;
  topFindingLead: string;
  seeAll: string;
  captureLabel: string;
  capturePlaceholder: string;

  /** 見出しの挨拶(時刻で変わる)。文言オフでは「ワークスペース」 */
  greeting: (hour: number) => string;
  /** 計測中の作業に添える、取り組み中を表す言葉(数秒ごとに入れ替わる) */
  workingVerbs: string[];
  understood: string;
  memoryTitle: string;
  memoryLead: string;
  memoryEmpty: string;
  memoryNotesTitle: string;
  memoryNotePlaceholder: string;
  memoryForget: string;
  connectTitle: string;
  connectLead: string;
}

const THEMED: ClaudeWords = {
  insightTitle: "インサイト",
  insightLead:
    "あなたの記録だけを材料に、私が実際に手を動かして調べた結果です。結論には必ず根拠の数字と、その結論が覆る条件を添えています。",
  thinkingTitle: "どう考えたか",
  thinkingLead: "結論だけでなく、そこへ至った手順も開示します。",
  findingsTitle: "気づいたこと",
  findingsEmpty: "今回は、確信を持って言えることが見つかりませんでした。",
  findingsEmptyHint: (n) =>
    `直近の実績は${n}件です。想定時間を設定した作業をもう少し積み重ねると、比べられるようになります。`,
  noData: "まだ分析できる記録がありません。作業を計測すると、ここに気づきが出ます。",

  evidenceLabel: "根拠",
  actionLabel: "次の一手",
  counterLabel: "この結論が覆るとき",
  confidenceLabel: "確信度",
  sampleLabel: (n) => `${n}件から`,
  kindLabel: (k) =>
    ({
      calibration: "見積もり",
      rhythm: "時間帯",
      weekday: "曜日",
      fragmentation: "集中",
      trouble: "突発",
      stale: "滞留",
      project: "案件",
      load: "稼働",
    })[k],

  calibrationTitle: "想定と実績",
  calibrationLead:
    "点ひとつが実績1件です。破線より上にあれば想定を超え、下にあれば想定より早く終わっています。軸は対数なので、5分の作業と5時間の作業を同じ図で見比べられます。",
  calibrationEmpty: "想定時間つきの実績がまだありません。",
  calibrationOver: (n, total) => `${total}件のうち${n}件が想定を超えました。`,

  rhythmTitle: "一日の律動",
  rhythmLead: "その時刻に着手した実績の数です。あなたが実際にいつ手を動かしているかを示しています。",

  focusTitle: "いま集中していること",
  focusIdle: "まだ計測を始めていません。",
  todayLine: (done, clock) => `今日はここまで ${done}件を完了、合計 ${clock} 手を動かしました。`,
  topFindingLead: "いま、いちばん気になっているのは",
  seeAll: "すべての気づきを見る",
  captureLabel: "今、何を考えていますか？",
  capturePlaceholder: "何を進めましょう？ 例: 明日までに見積書を送る 30分 @営業",

  greeting: (h) =>
    h < 5 ? "遅くまでおつかれさまです" : h < 10 ? "おはようございます" : h < 17 ? "こんにちは" : "おつかれさまです",
  workingVerbs: ["取り組み中", "考えをまとめ中", "手を動かし中", "組み立て中", "じっくり進行中", "磨き込み中", "整え中", "練り上げ中"],
  understood: "こう受け取りました",
  memoryTitle: "覚えていること",
  memoryLead: "あなたの記録から読み取った働き方です。違っていれば忘れられますし、記録からは分からないことは書き足せます。",
  memoryEmpty: "まだ覚えていることはありません。記録が増えると、ここに働き方の傾向が出ます。",
  memoryNotesTitle: "あなたが書き残したこと",
  memoryNotePlaceholder: "覚えておいてほしいこと（例: 午後は電話が多い）",
  memoryForget: "忘れる",
  connectTitle: "Claudeと続ける",
  connectLead: "ここで覚えていることと今の状況をまとめて、Claudeとの会話にそのまま渡せます。",
};

const PLAIN: ClaudeWords = {
  insightTitle: "分析",
  insightLead:
    "記録した実績だけを材料にした分析結果です。結論には根拠の数字と、その結論が当てはまらない場合の条件を添えています。",
  thinkingTitle: "分析の手順",
  thinkingLead: "結論に至るまでに行った処理です。",
  findingsTitle: "分析結果",
  findingsEmpty: "今回は、根拠を伴って言える結論が見つかりませんでした。",
  findingsEmptyHint: (n) => `直近の実績は${n}件です。想定時間を設定した作業が増えると、比較ができるようになります。`,
  noData: "まだ分析できる記録がありません。作業を計測すると、ここに結果が出ます。",

  evidenceLabel: "根拠",
  actionLabel: "推奨する対応",
  counterLabel: "留意点",
  confidenceLabel: "確度",
  sampleLabel: (n) => `標本 ${n}件`,
  kindLabel: (k) =>
    ({
      calibration: "見積もり",
      rhythm: "時間帯",
      weekday: "曜日",
      fragmentation: "中断",
      trouble: "トラブル",
      stale: "滞留",
      project: "案件",
      load: "稼働",
    })[k],

  calibrationTitle: "想定と実績の散布図",
  calibrationLead:
    "点ひとつが実績1件です。破線より上が想定超過、下が想定内です。軸は対数のため、短い作業と長い作業を同じ図で比較できます。",
  calibrationEmpty: "想定時間つきの実績がまだありません。",
  calibrationOver: (n, total) => `${total}件のうち${n}件が想定を超えています。`,

  rhythmTitle: "時間帯ごとの着手件数",
  rhythmLead: "その時刻に着手した実績の件数です。",

  focusTitle: "計測中の作業",
  focusIdle: "計測中の作業はありません。",
  todayLine: (done, clock) => `本日の完了 ${done}件、実働 合計 ${clock}。`,
  topFindingLead: "最も優先度の高い指摘",
  seeAll: "分析結果をすべて見る",
  captureLabel: "タスクを追加",
  capturePlaceholder: "例: 明日までに見積書を送る 30分 @営業",

  greeting: () => "ワークスペース",
  workingVerbs: ["計測中"],
  understood: "入力内容",
  memoryTitle: "記録から分かる傾向",
  memoryLead: "記録から読み取った働き方の傾向です。当てはまらないものは非表示にでき、記録にないことは追記できます。",
  memoryEmpty: "まだ傾向を読み取れるだけの記録がありません。",
  memoryNotesTitle: "追記したこと",
  memoryNotePlaceholder: "追記する内容（例: 午後は電話が多い）",
  memoryForget: "非表示",
  connectTitle: "AIと連携",
  connectLead: "傾向と現在の状況をまとめた文章をコピーして、AIとの会話に渡せます。",
};

export function claudeWordsFor(wordingEnabled: boolean): ClaudeWords {
  return wordingEnabled ? THEMED : PLAIN;
}
