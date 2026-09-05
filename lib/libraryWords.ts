import type { LoanStatus, RoomPhase, ShelfStatus } from "./library";

// 図書館モードの文言。他モードと同じく、設定の「テーマに合わせた文言を使う」を
// オフにすると、紙の質感や図版はそのままに、言葉づかいだけ工程表本来のものへ戻る。

export interface LibraryWords {
  roomTitle: string;
  roomNote: Record<RoomPhase, string>;
  closedNote: string;

  deskTitle: string;
  deskIdle: string;
  deskIdleHint: string;

  shelfTitle: string;
  shelfEmpty: string;
  catalogTitle: string;
  catalogEmpty: string;
  slipTitle: string;

  panelDesk: string;
  panelShelf: string;
  panelCatalog: string;

  statLoaned: string;
  statReturned: string;
  statOverdue: string;
  statRead: string;
  statDue: string;
  statShelf: string;
  unitBooks: (n: number) => string; // 冊 / 件
  overdueLevelName: (level: 0 | 1 | 2 | 3 | 4) => string;

  callNumberLabel: string;
  authorLabel: string;
  dueLabel: string;
  elapsedLabel: string;
  loanCountLabel: string;
  medianLabel: string;
  overdueRateLabel: string;
  lastLoanLabel: string;
  neverLoaned: string;

  loanStatus: Record<LoanStatus, string>;
  shelfStatus: Record<ShelfStatus, string>;

  overdueBadge: string;
  overdueNote: (seconds: string) => string;

  actionBorrow: string;
  actionReturn: string;
  actionRest: string;
  actionResume: string;
  actionExtend: string;
  extendNote: (seconds: string) => string;
  borrowPrompt: string;
  pickerTitle: string;
  pickerOpen: string;
  closeLabel: string;
  selectPrompt: string;
}

const THEMED: LibraryWords = {
  roomTitle: "閲覧室",
  roomNote: {
    morning: "開館直後。書架はまだ静かです。",
    day: "昼下がりの閲覧室。窓から光が差しています。",
    evening: "陽が傾き、卓上のランプが灯りはじめました。",
    night: "閉館時刻を過ぎています。灯りはあなたの席だけです。",
  },
  closedNote: "閉館後",

  deskTitle: "書見台",
  deskIdle: "いま開いている本はありません",
  deskIdleHint: "書架から一冊選んで、貸出してください。",

  shelfTitle: "本日の貸出棚",
  shelfEmpty: "本日はまだ一冊も借りていません。蔵書目録から選んでください。",
  catalogTitle: "蔵書目録",
  catalogEmpty: "まだ蔵書がありません。作業マスタを登録すると、ここに並びます。",
  slipTitle: "返却期限票",

  panelDesk: "書見台",
  panelShelf: "貸出棚",
  panelCatalog: "目録",

  statLoaned: "本日の貸出",
  statReturned: "返却済",
  statOverdue: "延滞",
  statRead: "閲覧時間",
  statDue: "貸出期間の合計",
  statShelf: "蔵書",
  unitBooks: (n) => `${n}冊`,
  overdueLevelName: (l) => ["", "返却期限間近", "延滞警告", "督促状発送", "回収不能本扱い"][l],

  callNumberLabel: "請求記号",
  authorLabel: "分類",
  dueLabel: "返却期限",
  elapsedLabel: "閲覧時間",
  loanCountLabel: "貸出回数",
  medianLabel: "実際にかかった時間の中央値",
  overdueRateLabel: "延滞率",
  lastLoanLabel: "前回の貸出",
  neverLoaned: "記録なし",

  loanStatus: {
    予約: "予約",
    閲覧中: "閲覧中",
    "書見台に伏せて": "書見台に伏せて",
    返却済: "返却済",
  },
  shelfStatus: { 在架: "在架", 貸出中: "貸出中", 延滞: "延滞", 未登録: "未登録" },

  overdueBadge: "延滞",
  overdueNote: (s) => `返却期限を ${s} 超えています。`,

  actionBorrow: "この本を借りる（計測を開始）",
  actionReturn: "返却する（作業を完了）",
  actionRest: "書見台に伏せる（一時停止）",
  actionResume: "読み進める（再開）",
  actionExtend: "貸出を延長する（想定時間を実測に合わせる）",
  extendNote: (s) => `返却期限を ${s} に延長しました。`,
  borrowPrompt: "借りる本を選んでください。",
  pickerTitle: "蔵書目録から借りる",
  pickerOpen: "蔵書目録から借りる",
  closeLabel: "閉じる",
  selectPrompt: "棚から一冊選んでください。",
};

const PLAIN: LibraryWords = {
  roomTitle: "本日の作業",
  roomNote: {
    morning: "午前です。",
    day: "日中です。",
    evening: "夕方です。定時を回りました。",
    night: "深夜帯です。この時間の作業は深夜稼働として記録されます。",
  },
  closedNote: "時間外",

  deskTitle: "計測中の作業",
  deskIdle: "計測中の作業はありません",
  deskIdleHint: "一覧から作業を選んで開始してください。",

  shelfTitle: "本日の作業",
  shelfEmpty: "本日の作業はまだありません。作業マスタから追加してください。",
  catalogTitle: "作業マスタ一覧",
  catalogEmpty: "まだ作業マスタがありません。登録すると、ここに並びます。",
  slipTitle: "過去の実施日",

  panelDesk: "計測中",
  panelShelf: "本日の一覧",
  panelCatalog: "マスタ",

  statLoaned: "本日の件数",
  statReturned: "完了",
  statOverdue: "想定超過",
  statRead: "実働時間",
  statDue: "想定時間の合計",
  statShelf: "登録数",
  unitBooks: (n) => `${n}件`,
  overdueLevelName: (l) => ["", "わずかに超過", "超過", "大幅に超過", "極端に超過"][l],

  callNumberLabel: "管理番号",
  authorLabel: "カテゴリ",
  dueLabel: "想定時間",
  elapsedLabel: "実働時間",
  loanCountLabel: "実施回数",
  medianLabel: "実績の中央値",
  overdueRateLabel: "超過率",
  lastLoanLabel: "前回の実施",
  neverLoaned: "記録なし",

  loanStatus: {
    予約: "未着手",
    閲覧中: "計測中",
    "書見台に伏せて": "一時停止",
    返却済: "完了",
  },
  shelfStatus: { 在架: "待機", 貸出中: "実施中", 延滞: "超過", 未登録: "未登録" },

  overdueBadge: "想定超過",
  overdueNote: (s) => `想定時間を ${s} 超えています。`,

  actionBorrow: "この作業を開始する",
  actionReturn: "完了する",
  actionRest: "一時停止する",
  actionResume: "再開する",
  actionExtend: "想定時間を実測値に合わせる",
  extendNote: (s) => `想定時間を ${s} に更新しました。`,
  borrowPrompt: "開始する作業を選んでください。",
  pickerTitle: "作業マスタから追加する",
  pickerOpen: "作業マスタから追加する",
  closeLabel: "閉じる",
  selectPrompt: "一覧から作業を選んでください。",
};

export function libraryWordsFor(wordingEnabled: boolean): LibraryWords {
  return wordingEnabled ? THEMED : PLAIN;
}
