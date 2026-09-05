import type { OrdealKind, RiskLevel, Virtue, WorkType } from "./lobotomy";

// 管理局モードの文言。他モードと同じく、設定の「テーマに合わせた文言を使う」を
// オフにすると、色や図はそのままに言葉づかいだけ工程表本来のものへ戻る。
//
// ゲーム側の用語(アブノーマリティ / キリパス / PEボックス / ラッパ)は、
// オフのときは全部ふつうの業務語に置き換わる。

export interface LobotomyWords {
  facilityTitle: string;
  dayLabel: (n: number) => string;
  energyTitle: string;
  energyUnit: string;
  quotaLabel: string;
  boxLabel: string;
  peBox: string;
  neBox: string;
  boxSummary: (pe: number, ne: number, total: number) => string;

  // 画面内の切り替え。元ゲームの部門(セフィラ)名を借りている。
  // アプリ側のタブ名(個体図鑑=作業マスタ等)と衝突しない語を選んでいる
  panelFacility: string;
  panelIndex: string;
  panelAgent: string;
  deptCaption: { facility: string; index: string; agent: string };
  cellsTitle: string;
  cellsEmpty: string;
  indexTitle: string;
  indexEmpty: string;
  agentTitle: string;
  logTitle: string;
  logLead: string; // この欄が何を数えているのかの説明
  logMeaning: Record<WorkType, string>; // 各項目が何回を指すのか

  riskTitle: string;
  // 危険度の呼び名。文言オフでは ZAYIN 等のゲーム用語を出さず、超過の度合いそのものを言う
  riskLabel: Record<RiskLevel, string>;
  riskNote: (level: RiskLevel, ratio: number) => string;
  qliphothLabel: string;
  qliphothNote: (counter: number, max: number) => string;
  breachedLabel: string;
  breachedNote: string;
  observationLabel: string;
  observationNote: (level: number) => string;
  subjectLabel: string;
  managerialTitle: string;
  lockedNote: (needed: number) => string;

  workTitle: string;
  workName: Record<WorkType, string>;
  workDesc: Record<WorkType, string>;
  workEffect: (type: WorkType, seconds: string) => string;
  recommendedLabel: string;
  recommendedNote: (type: WorkType) => string;

  virtueName: Record<Virtue, string>;

  meltdownTitle: string;
  meltdownNote: (count: number) => string;
  meltdownResolve: string;
  meltdownReestimate: string;

  trumpetName: (t: 0 | 1 | 2 | 3) => string;
  ordealName: Record<OrdealKind, string>;
  ordealNote: Record<OrdealKind, string>;

  statusRunning: string;
  statusPaused: string;
  statusPending: string;
  statusDone: string;

  actionComplete: string;
  actionPause: string;
  actionResume: string;
  actionSuppress: string; // 融解の解消(想定を実測に書き換える)
  pickerTitle: string;
  pickerOpen: string;
  noSelection: string;
  closeLabel: string;
}

const THEMED: LobotomyWords = {
  facilityTitle: "収容施設",
  dayLabel: (n) => `DAY ${n}`,
  energyTitle: "エネルギー",
  energyUnit: "E",
  quotaLabel: "本日の目標",
  boxLabel: "エンケファリン箱",
  peBox: "PE-BOX",
  neBox: "NE-BOX",
  boxSummary: (pe, ne, total) => `PE ${pe} / NE ${ne}（本日の抽出予定 ${total}）`,

  panelFacility: "管理部",
  panelIndex: "情報部",
  panelAgent: "訓練部",
  deptCaption: {
    facility: "Malkuth ── 収容区画の監視と作業指示",
    index: "Yesod ── 個体情報の記録と開示",
    agent: "Netzach ── 職員の状態管理",
  },
  cellsTitle: "収容区画",
  cellsEmpty: "本日収容している個体はいません。個体図鑑から収容してください。",
  indexTitle: "個体記録",
  indexEmpty: "まだ観測記録がありません。作業を完了すると、ここに登録されます。",
  agentTitle: "職員能力値",
  logTitle: "本日の作業記録",
  logLead:
    "着手時に選んだ作業種別の回数です。元ゲームでは作業種別が対応する能力値を鍛えますが、ここでの能力値は実績から算出しているため、この回数では変動しません。",
  logMeaning: {
    instinct: "想定時間を変えずに着手した回数",
    insight: "想定時間を過去の実績の中央値に置き直して着手した回数",
    attachment: "想定時間を1.5倍にして着手した回数",
    repression: "想定時間を0.75倍に締めて着手した回数",
  },

  riskTitle: "危険度",
  riskLabel: { ZAYIN: "ZAYIN", TETH: "TETH", HE: "HE", WAW: "WAW", ALEPH: "ALEPH" },
  riskNote: (level, ratio) =>
    `実績は想定の${ratio.toFixed(2)}倍。この比率から危険度は${level}と判定されています。`,
  qliphothLabel: "キリパス・カウンタ",
  qliphothNote: (counter, max) =>
    `直近${max}件のうち${counter}件が想定内。ゼロになると収容違反です。`,
  breachedLabel: "収容違反",
  breachedNote: "直近の作業がすべて想定を超えています。この個体の想定時間は、もう現実と合っていません。",
  observationLabel: "観測レベル",
  observationNote: (level) => `観測レベル ${level} / 4。実績が増えるほど記載が開示されます。`,
  subjectLabel: "個体番号",
  managerialTitle: "管理業務記録",
  lockedNote: (needed) => `── 観測レベル ${needed} で開示 ──`,

  workTitle: "作業種別を選択",
  workName: {
    instinct: "本能",
    insight: "洞察",
    attachment: "愛着",
    repression: "抑制",
  },
  workDesc: {
    instinct: "そのまま手を動かす。想定時間は据え置き。",
    insight: "実績を見て組み直す。想定を過去の中央値に合わせる。",
    attachment: "丁寧に向き合う。想定に1.5倍の余裕を取る。",
    repression: "短時間で押さえ込む。想定を0.75倍に締める。",
  },
  workEffect: (_type, seconds) => `この作業の想定時間は ${seconds} で記録されます`,
  recommendedLabel: "推奨作業",
  recommendedNote: (type) =>
    type === "insight"
      ? "実績のばらつきが大きい個体です。中央値に置き直すのが有効です。"
      : type === "attachment"
        ? "この個体は想定を超えがちです。余裕を取ることを推奨します。"
        : type === "repression"
          ? "この個体は想定より早く片付いています。締めても問題ありません。"
          : "実績が足りません。まず一度そのまま作業してください。",

  virtueName: {
    fortitude: "剛毅",
    prudence: "慎重",
    temperance: "自制",
    justice: "正義",
  },

  meltdownTitle: "キリパス融解",
  meltdownNote: (count) => `${count}件の区画で融解が進行中です。対処してください。`,
  meltdownResolve: "作業を完了して鎮圧する",
  meltdownReestimate: "想定を実測値に書き換えて融解を止める",

  trumpetName: (t) => (t === 0 ? "平常" : t === 1 ? "第一のラッパ" : t === 2 ? "第二のラッパ" : "第三のラッパ"),
  ordealName: {
    dawn: "黎明",
    noon: "正午",
    dusk: "黄昏",
    midnight: "真夜中",
    none: "待機",
  },
  ordealNote: {
    dawn: "一日の始まり。ここで収容した個体が今日の全部になります。",
    noon: "正午。この時点の進捗が、その日の着地をほぼ決めます。",
    dusk: "黄昏。定時を回りました。残りをどう畳むかの局面です。",
    midnight: "真夜中。この時間の作業は深夜稼働として記録されます。",
    none: "待機中。",
  },

  statusRunning: "作業中",
  statusPaused: "中断",
  statusPending: "待機",
  statusDone: "抽出完了",

  actionComplete: "作業を完了する",
  actionPause: "作業を中断する",
  actionResume: "作業を再開する",
  actionSuppress: "想定を実測値に書き換える",
  pickerTitle: "個体図鑑から収容する",
  pickerOpen: "個体図鑑から収容する",
  noSelection: "区画を選択してください。",
  closeLabel: "閉じる",
};

const PLAIN_RISK_LABEL: Record<RiskLevel, string> = {
  ZAYIN: "想定内",
  TETH: "やや超過",
  HE: "超過",
  WAW: "大幅超過",
  ALEPH: "極端",
};

const PLAIN: LobotomyWords = {
  facilityTitle: "本日の作業",
  dayLabel: (n) => `連続${n}日目`,
  energyTitle: "進捗",
  energyUnit: "",
  quotaLabel: "本日の予定合計",
  boxLabel: "完了件数",
  peBox: "想定内",
  neBox: "想定超過",
  boxSummary: (pe, ne, total) => `想定内 ${pe} / 超過 ${ne}（本日の予定 ${total}件）`,

  panelFacility: "作業一覧",
  panelIndex: "傾向分析",
  panelAgent: "本日の指標",
  deptCaption: {
    facility: "本日の作業の状況と、着手・完了の操作",
    index: "作業マスタごとの実績の傾向",
    agent: "本日の働き方を4つの指標で見る",
  },
  cellsTitle: "本日の作業",
  cellsEmpty: "本日の作業はまだありません。作業マスタから追加してください。",
  indexTitle: "作業別の傾向",
  indexEmpty: "まだ実績がありません。作業を完了すると、ここに集計されます。",
  agentTitle: "本日の指標",
  logTitle: "着手のしかたの記録",
  logLead:
    "着手のしかたを選んだ回数です。指標そのものは実績から算出しているため、この回数では変動しません。",
  logMeaning: {
    instinct: "想定時間を変えずに着手した回数",
    insight: "想定時間を過去の実績の中央値に合わせて着手した回数",
    attachment: "想定時間を1.5倍にして着手した回数",
    repression: "想定時間を0.75倍にして着手した回数",
  },

  riskTitle: "超過傾向",
  riskLabel: PLAIN_RISK_LABEL,
  riskNote: (level, ratio) => {
    const label = PLAIN_RISK_LABEL[level];
    return `実績は想定の${ratio.toFixed(2)}倍です。（${label}）`;
  },
  qliphothLabel: "想定内で収まった回数",
  qliphothNote: (counter, max) => `直近${max}件のうち${counter}件が想定内でした。`,
  breachedLabel: "要見直し",
  breachedNote: "直近の作業がすべて想定を超えています。この作業の想定時間は実態と合っていません。",
  observationLabel: "実績の蓄積",
  observationNote: (level) => `実績 ${level} / 4件。件数が増えるほど表示できる情報が増えます。`,
  subjectLabel: "管理番号",
  managerialTitle: "この作業についてわかっていること",
  lockedNote: (needed) => `── 実績${needed}件で表示 ──`,

  workTitle: "着手のしかたを選ぶ",
  workName: {
    instinct: "そのまま",
    insight: "実績に合わせる",
    attachment: "余裕を取る",
    repression: "締める",
  },
  workDesc: {
    instinct: "想定時間は変更せずに着手します。",
    insight: "想定時間を過去の実績の中央値に合わせて着手します。",
    attachment: "想定時間を1.5倍にして着手します。",
    repression: "想定時間を0.75倍にして着手します。",
  },
  workEffect: (_type, seconds) => `この作業の想定時間は ${seconds} で記録されます`,
  recommendedLabel: "おすすめ",
  recommendedNote: (type) =>
    type === "insight"
      ? "実績のばらつきが大きい作業です。中央値に置き直すのが有効です。"
      : type === "attachment"
        ? "この作業は想定を超えがちです。余裕を取ることをおすすめします。"
        : type === "repression"
          ? "この作業は想定より早く終わっています。締めても問題ありません。"
          : "実績が足りません。まず一度そのまま計測してください。",

  virtueName: {
    fortitude: "実働量",
    prudence: "見積もり精度",
    temperance: "想定内完了率",
    justice: "継続",
  },

  meltdownTitle: "想定超過",
  meltdownNote: (count) => `${count}件が想定時間を超えています。`,
  meltdownResolve: "作業を完了する",
  meltdownReestimate: "想定を実測値に書き換える",

  trumpetName: (t) => (t === 0 ? "正常" : t === 1 ? "注意" : t === 2 ? "警告" : "重大"),
  ordealName: {
    dawn: "午前",
    noon: "正午",
    dusk: "夕方",
    midnight: "深夜",
    none: "待機",
  },
  ordealNote: {
    dawn: "一日の始まりです。ここで登録した作業が本日の予定になります。",
    noon: "正午です。この時点の進捗が、その日の着地をほぼ決めます。",
    dusk: "定時を回りました。残りをどう畳むかの局面です。",
    midnight: "深夜帯です。この時間の作業は深夜稼働として記録されます。",
    none: "待機中です。",
  },

  statusRunning: "計測中",
  statusPaused: "一時停止",
  statusPending: "未着手",
  statusDone: "完了",

  actionComplete: "作業を完了する",
  actionPause: "一時停止する",
  actionResume: "再開する",
  actionSuppress: "想定を実測値に書き換える",
  pickerTitle: "作業マスタから追加する",
  pickerOpen: "作業マスタから追加する",
  noSelection: "作業を選択してください。",
  closeLabel: "閉じる",
};

export function lobotomyWordsFor(wordingEnabled: boolean): LobotomyWords {
  return wordingEnabled ? THEMED : PLAIN;
}
