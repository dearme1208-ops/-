// 設定タブの項目(35項目・縦に1万px以上)を分類ごとに絞り込んで見せるための分類表。
// 設定画面の各パネルは見出し(h3)の文字列で識別しているので、ここも見出しで対応させる
// (JSXの並びを組み替えずに分類できる)。新しい設定を足したら、ここにも見出しを足す
// (足し忘れても「すべて」には出るので消えることはない。単体テストで漏れを検出する)

export interface SettingsCategory {
  key: string;
  label: string;
  headings: string[];
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    key: "today",
    label: "⏱ 本日の作業",
    headings: [
      "未計測時間の自動計測",
      "本日の作業の表示",
      "作業の追加画面",
      "本日タブのパネル表示",
      "基本労働時間",
      "日・週・月の目標時間",
      "体調の記録",
      "本日の育成度表示",
      "トラブル対応の部署・項目候補",
      "ホーム画面のクイック起動",
      "音声での開始/終了",
    ],
  },
  {
    key: "todo",
    label: "✅ ToDo・案件",
    headings: ["ToDoの対応状況の選択肢", "ToDoの分類の選択肢", "完了済みのサブタスク・段階の表示", "カレンダーの週表示"],
  },
  {
    key: "notify",
    label: "🔔 通知",
    headings: ["ToDoの期日リマインダー", "朝の自動ダイジェスト通知", "1日の終わりの自動サマリー通知", "天気変化の通知（降水確率）"],
  },
  {
    key: "geo",
    label: "📍 位置情報",
    headings: ["位置情報による移動検知", "位置情報による地点到着検知（自動開始）"],
  },
  {
    key: "look",
    label: "🎨 見た目・操作",
    headings: ["演出テーマ", "タブの並べ方", "アクセントカラー", "文字サイズ・見やすさ", "各タブのボタン表示", "下部固定タブバー", "モード選択メニュー"],
  },
  {
    key: "report",
    label: "📊 集計・報告",
    headings: [
      "コスト換算（時給/単価）",
      "週報・月報の「定時以降の業務」判定基準",
      "使用頻度の低い作業マスタの検出基準",
      "実績編集で名称・区分を変更した時の挙動",
    ],
  },
  {
    key: "data",
    label: "💾 データ",
    headings: ["全データのバックアップ・復元", "自動バックアップ", "実績データの月次アーカイブ", "タブごとのCSVインポート/エクスポート/テンプレート表示"],
  },
];

// 見出し先頭の絵文字(📆 🎭 など)と前後の空白を除いて比べる
function normalizeHeading(heading: string): string {
  return heading.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

/** 設定の見出しが属する分類のキー。分類表に無ければnull(「すべて」にだけ出る) */
export function settingCategoryOf(heading: string): string | null {
  const h = normalizeHeading(heading);
  return SETTINGS_CATEGORIES.find((c) => c.headings.some((x) => normalizeHeading(x) === h))?.key ?? null;
}
