import type { MandalaChart } from "./types";

// 大谷翔平選手の目標達成シートで知られる、9x9マス(3x3の「ブロック」×さらに3x3の「マス」)の
// マンダラチャート配置を計算する。中心ブロックの中心=目標、中心ブロックの残り8マス=8つの
// テーマ、各テーマに対応する周囲8ブロックはそれぞれ中心にそのテーマを再掲し、残り8マスに
// 具体策を並べる、という本家の構造をそのまま再現する

// ブロック内の8マス(中心を除く)の並び順。行優先で中心(1,1)だけ飛ばす
const SLOT_OFFSETS: [number, number][] = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 2],
  [2, 0],
  [2, 1],
  [2, 2],
];

export const THEME_COUNT = 8;
export const ACTIONS_PER_THEME = 8;

function slotIndexOf(row: number, col: number): number {
  return SLOT_OFFSETS.findIndex(([r, c]) => r === row && c === col);
}

export type MandalaCellKind = "goal" | "theme" | "action";

export interface MandalaCell {
  kind: MandalaCellKind;
  themeIndex: number; // kind==="goal"の場合は-1
  actionIndex: number; // kind!=="action"の場合は-1
}

// 9x9(行→列の配列)を返す。gridRows[r][c]でアクセスする
export function buildMandalaGrid(): MandalaCell[][] {
  const grid: MandalaCell[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: MandalaCell[] = [];
    for (let c = 0; c < 9; c++) {
      const blockRow = Math.floor(r / 3);
      const blockCol = Math.floor(c / 3);
      const withinRow = r % 3;
      const withinCol = c % 3;

      if (blockRow === 1 && blockCol === 1) {
        // 中心ブロック: 中心=目標、残り8マス=テーマ
        if (withinRow === 1 && withinCol === 1) {
          row.push({ kind: "goal", themeIndex: -1, actionIndex: -1 });
        } else {
          const themeIndex = slotIndexOf(withinRow, withinCol);
          row.push({ kind: "theme", themeIndex, actionIndex: -1 });
        }
      } else {
        // 周囲8ブロック: どのテーマのブロックかをブロック自体の位置から求める
        const themeIndex = slotIndexOf(blockRow, blockCol);
        if (withinRow === 1 && withinCol === 1) {
          // ブロック中心にテーマ名を再掲(本家と同じ演出)
          row.push({ kind: "theme", themeIndex, actionIndex: -1 });
        } else {
          const actionIndex = slotIndexOf(withinRow, withinCol);
          row.push({ kind: "action", themeIndex, actionIndex });
        }
      }
    }
    grid.push(row);
  }
  return grid;
}

export function emptyMandalaChart(title: string): Omit<MandalaChart, "id" | "createdAt" | "updatedAt"> {
  return {
    title,
    goal: "",
    themes: Array.from({ length: THEME_COUNT }, () => ""),
    actions: Array.from({ length: THEME_COUNT }, () => Array.from({ length: ACTIONS_PER_THEME }, () => "")),
    actionTodoIds: Array.from({ length: THEME_COUNT }, () => Array.from({ length: ACTIONS_PER_THEME }, () => undefined)),
  };
}

export interface MandalaSample {
  key: string;
  label: string;
  goal: string;
  themes: string[];
  actions: string[][];
}

// 「家庭円満をテーマに」の相談を受けて作成したマンダラチャートの下書きサンプル。
// あくまで一例として、そのままチャート化してから自由に書き換えられるようにする
export const MANDALA_SAMPLES: MandalaSample[] = [
  {
    key: "katei-enman",
    label: "家庭円満マンダラ(サンプル)",
    goal: "家庭円満",
    themes: [
      "夫婦の対話",
      "子どもとの時間",
      "暮らしの基盤",
      "家計・将来設計",
      "家族の健康",
      "心を通わせる",
      "自分を整える",
      "思い出づくり",
    ],
    actions: [
      [
        "週1で二人の時間",
        "「ありがとう」を毎日",
        "最後まで話を聞く",
        "月1のデート",
        "家事分担を話し合う",
        "疲れに気づき手伝う",
        "記念日を祝う",
        "不満はその日に伝える",
      ],
      [
        "毎日10分向き合う",
        "話を否定せず聞く",
        "週末は一緒に遊ぶ",
        "成長を言葉で伝える",
        "勉強を一緒に見る",
        "理由を話して叱る",
        "友達関係に関心を持つ",
        "家族写真を残す",
      ],
      [
        "家事分担表を作る",
        "掃除洗濯のルーティン",
        "1週間の献立を決める",
        "使ったら元に戻す",
        "定期的に断捨離",
        "家計簿で見える化",
        "防災グッズを見直す",
        "家・車の点検計画",
      ],
      [
        "毎月家計を確認",
        "貯蓄目標を共有",
        "教育費を計画",
        "固定費を年1見直し",
        "お小遣いのルール",
        "大きな買い物は相談",
        "予備資金を確保",
        "ライフイベントを話す",
      ],
      [
        "定期健診を受ける",
        "一緒に体を動かす",
        "睡眠時間を確保",
        "バランスの良い食事",
        "疲れたら早めに休む",
        "体調変化に気を配る",
        "かかりつけ医を決める",
        "笑う機会を増やす",
      ],
      [
        "食事は一緒にとる",
        "「今日どうだった?」",
        "日中もこまめに連絡",
        "月1の家族会議",
        "良いも悪いも共有",
        "まず受け止める",
        "スマホを置いて話す",
        "感謝を言葉にする",
      ],
      [
        "週1の自分の時間",
        "趣味の時間を作る",
        "息抜きの場所を持つ",
        "完璧を求めすぎない",
        "素直に頼る",
        "休養優先の日を作る",
        "一呼吸置く習慣",
        "自分を労う時間",
      ],
      [
        "年数回の家族旅行",
        "誕生日を必ず祝う",
        "季節の行事を楽しむ",
        "アルバムを整理する",
        "祖父母と交流の機会",
        "恒例行事を1つ作る",
        "小さなサプライズ",
        "語れる経験を増やす",
      ],
    ],
  },
  // 工程表という業務アプリなのにサンプルが家庭向けの1件だけだったため、
  // このアプリで実際に記録している内容(想定時間・案件の段階・トラブル対応・
  // 作業マスタ・残業)にそのまま繋がる仕事向けのサンプルを足しておく
  {
    key: "shigoto-kaizen",
    label: "仕事の進め方マンダラ(サンプル)",
    goal: "見積り通りに終わる仕事",
    themes: [
      "見積りの精度",
      "着手のはやさ",
      "段取り・準備",
      "中断を減らす",
      "案件の進行管理",
      "トラブルを減らす",
      "記録を残す",
      "体力・集中力",
    ],
    actions: [
      [
        "実績平均で想定を見直す",
        "初めての作業は多めに見る",
        "超過したら原因を1行残す",
        "分解して1件を小さく",
        "似た作業の実績を先に見る",
        "想定を月1で棚卸しする",
        "無理な想定を約束しない",
        "余裕分を明示して伝える",
      ],
      [
        "朝一番に重いものから",
        "5分だけ手をつける",
        "期日の近い順に並べる",
        "迷ったら小さい方を先に",
        "前日に翌日の下書き",
        "着手日を決めて置く",
        "寝かせる案件を作らない",
        "その場で1歩進める",
      ],
      [
        "必要な資料を先に揃える",
        "手順をテンプレート化",
        "よく使う作業を★に登録",
        "曜日テンプレートを整える",
        "道具・環境を先に整える",
        "確認事項を先に潰す",
        "関係者に前もって連絡",
        "終わりの形を先に決める",
      ],
      [
        "通知をまとめて処理する",
        "割り込みは記録してから",
        "連続作業は50分で区切る",
        "会議を午後にまとめる",
        "同種の作業をまとめる",
        "「あとで」を書き留める",
        "作業中は一つだけ開く",
        "中断したら再開時刻を決める",
      ],
      [
        "段階(マイルストーン)に割る",
        "期日から逆算して置く",
        "週1で進捗を見直す",
        "止まっている案件を拾う",
        "前の段階を追い越さない",
        "遅れは早めに共有する",
        "完了の条件を決めておく",
        "終わった段階は必ず閉じる",
      ],
      [
        "起きたら必ず記録する",
        "原因を分類して残す",
        "再発したものを優先で潰す",
        "手順書に注意点を追記",
        "確認の工程を1つ足す",
        "似た作業に横展開する",
        "一人で抱え込まない",
        "起きやすい時間帯を知る",
      ],
      [
        "終わったらすぐ記録する",
        "一言メモを必ず添える",
        "計測の消し忘れを直す",
        "外れ値は除外して残す",
        "週報を毎週書く",
        "月末に振り返る",
        "気づきをメモタブへ",
        "数字と実感を突き合わせる",
      ],
      [
        "所定時間で切り上げる",
        "休憩を必ず取る",
        "体調を毎日記録する",
        "疲れている日は軽い作業",
        "残業した翌日は調整する",
        "睡眠を優先する",
        "集中できる時間帯に重い作業",
        "水分・目薬をこまめに",
      ],
    ],
  },
];

export function mandalaChartFromSample(sample: MandalaSample): Omit<MandalaChart, "id" | "createdAt" | "updatedAt"> {
  return {
    title: sample.label,
    goal: sample.goal,
    themes: [...sample.themes],
    actions: sample.actions.map((row) => [...row]),
    actionTodoIds: Array.from({ length: THEME_COUNT }, () => Array.from({ length: ACTIONS_PER_THEME }, () => undefined)),
  };
}
