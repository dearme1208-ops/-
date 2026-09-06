import type { DailyTask, ProjectItem, TodoTask, WorkRecord } from "./types";
import type { TabKey } from "./theme";
import type { GlyphKey, Rgb } from "./powerproMenuArt";
import { isStageDone } from "./projectStage";
import { segmentsAccumulatedMs } from "./tasks";

// 育成選手モードのメインメニュー。
//
// 家庭用野球ゲームのモード選択画面をそのまま持ち込む。並び順・色・記号は
// 「よく入る順」と「系統ごとの色分け」で決めていて、
//   赤橙 = 今日その場で動かすもの
//   青緑 = 溜まっているもの・計画するもの
//   紫  = 記録を振り返るもの
//   灰  = 道具・設定
// タイルの下に出る件数バッジはすべて実データの数え上げで、演出のための数字は無い。

export interface MenuEntry {
  key: TabKey;
  glyph: GlyphKey;
  color: Rgb;
  /** 演出テーマ文言をオフにしたときのタブ名(通常時の呼び名) */
  plainLabel: string;
  /** 演出テーマ文言のときの説明。タブ名自体は theme.ts の TAB_LABELS_BY_MODE から取る */
  themedDesc: string;
  /** 文言オフのときの説明 */
  plainDesc: string;
}

// 4列×5段。実際のモード選択画面と同じ「上段ほど頻度が高い」並びにしている
export const MENU_ENTRIES: MenuEntry[] = [
  { key: "today", glyph: "today", color: [232, 88, 40], plainLabel: "本日の作業",
    themedDesc: "本日の練習メニューを組み、その場で練習を始められる。育成の中心となる画面。",
    plainDesc: "本日の作業を並べて、開始・一時停止・完了を記録します。" },
  { key: "todo", glyph: "todo", color: [64, 150, 226], plainLabel: "ToDo",
    themedDesc: "獲得候補の一覧。期日が近い選手ほど上に来る。ドラフトボードで最優先の1件が分かる。",
    plainDesc: "ToDoの一覧。期日・重要度で並べ替えたり、マイデイに入れたりできます。" },
  { key: "projects", glyph: "projects", color: [226, 168, 36], plainLabel: "案件",
    themedDesc: "契約している案件。段階を1試合ずつに見立てた勝敗表と、順位表が出る。",
    plainDesc: "案件の一覧。段階(マイルストーン)の進捗と期日を管理します。" },
  { key: "master", glyph: "master", color: [136, 96, 220], plainLabel: "作業マスタ",
    themedDesc: "これまで登録した作業の名鑑。想定時間と実績件数がまとまっている。",
    plainDesc: "作業マスタの一覧。想定時間の再計算やアーカイブができます。" },

  { key: "template", glyph: "template", color: [56, 176, 132], plainLabel: "曜日別テンプレート",
    themedDesc: "曜日ごとの決まった練習メニュー。ここから本日の練習をまとめて生成できる。",
    plainDesc: "曜日別のテンプレート。本日の作業リストを一括生成する元になります。" },
  { key: "gantt", glyph: "gantt", color: [92, 128, 208], plainLabel: "ガントチャート",
    themedDesc: "その日の練習を時間軸に並べた行動記録。空き時間と重なりが一目で分かる。",
    plainDesc: "1日の作業を時間軸に並べたガントチャートです。" },
  { key: "aggregation", glyph: "aggregation", color: [226, 120, 60], plainLabel: "集計・ランキング",
    themedDesc: "期間ごとの成績ランキング。どの練習に時間を使ったかの順位が出る。",
    plainDesc: "期間ごとの集計と、作業別・区分別のランキングです。" },
  { key: "charts", glyph: "charts", color: [72, 168, 200], plainLabel: "グラフ",
    themedDesc: "成績の推移をグラフで見る。伸びている練習と落ちている練習が分かる。",
    plainDesc: "実績の推移をグラフで表示します。" },

  { key: "heatmap", glyph: "heatmap", color: [204, 76, 96], plainLabel: "ヒートマップ",
    themedDesc: "曜日と時間帯ごとの負荷分布。どこに疲労が溜まっているかを色で示す。",
    plainDesc: "区分×曜日、時間帯×曜日の作業時間をヒートマップで表示します。" },
  { key: "attention", glyph: "attention", color: [232, 148, 40], plainLabel: "要注意リスト",
    themedDesc: "想定から大きく外れている練習の一覧。故障の前に気づくための画面。",
    plainDesc: "想定時間から大きく外れている作業や、気づきの一覧です。" },
  { key: "overtime", glyph: "overtime", color: [88, 92, 176], plainLabel: "残業分析",
    themedDesc: "所定の練習時間を超えた分の分析。夜間の自主練がどれだけあったか。",
    plainDesc: "所定労働時間を超えた分の概算残業を月ごとに集計します。" },
  { key: "yearlyChart", glyph: "yearlyChart", color: [176, 112, 200], plainLabel: "年表",
    themedDesc: "1年度ぶんの成績をまとめた年鑑。月ごとの推移と節目の記録が並ぶ。",
    plainDesc: "年度ごとの月次推移と、累計のマイルストーンです。" },

  { key: "mandala", glyph: "mandala", color: [212, 96, 148], plainLabel: "マンダラチャート",
    themedDesc: "目標を中心に据えて、そこへ至る具体策を8×8で書き出すシート。",
    plainDesc: "目標を中心に、テーマと具体策を9×9で書き出すマンダラチャートです。" },
  { key: "memo", glyph: "memo", color: [216, 176, 56], plainLabel: "メモ",
    themedDesc: "気づいたことを書き留める帳面。付箋を自由に置ける。",
    plainDesc: "付箋・手書き・チェックリストを自由に置けるメモ帳です。" },
  { key: "board", glyph: "board", color: [60, 160, 160], plainLabel: "統合ボード",
    themedDesc: "メモと本日の練習と候補を1枚に並べた作戦テーブル。",
    plainDesc: "メモ・本日の作業・マイデイのToDoを1枚のボードにまとめた画面です。" },
  { key: "report", glyph: "report", color: [120, 140, 168], plainLabel: "日報・週報・月報",
    themedDesc: "日ごと・週ごと・月ごとの成績をまとめた報告書。そのまま提出できる形で出る。",
    plainDesc: "日報・週報・月報を作成します。" },

  { key: "records", glyph: "records", color: [148, 116, 92], plainLabel: "実績編集",
    themedDesc: "記録した成績を後から直す画面。計測の消し忘れもここで整えられる。",
    plainDesc: "記録済みの実績を後から編集・削除できます。" },
  { key: "settings", glyph: "settings", color: [110, 118, 134], plainLabel: "設定",
    themedDesc: "監督としての方針を決める画面。所定時間・通知・演出などを設定する。",
    plainDesc: "アプリ全体の設定です。" },
];

// ------------------------------------------------------------
// タイルに出す件数バッジ
// ------------------------------------------------------------
// 実データの数え上げだけを出す。数える対象が無い項目にはバッジを付けない
export interface MenuBadge {
  label: string;
  value: string;
  ratio: number; // 帯の中の塗り割合(0〜1)
  spark: boolean; // 右上の光。「今見るべきものがある」ときだけ点ける
}

export interface MenuSignalInput {
  today: string;
  /** 演出テーマ文言を使うか。バッジの見出し語もこれで切り替える */
  wordingEnabled: boolean;
  tasks: DailyTask[]; // 本日の作業(仮計測を除いたもの)
  todos: TodoTask[];
  projects: ProjectItem[];
  records: WorkRecord[];
  now: number;
  /** 想定から大きく外れている作業の件数(要注意リストと同じ基準で外から渡す) */
  attentionCount: number;
}

export function buildMenuBadges(input: MenuSignalInput): Map<TabKey, MenuBadge> {
  const map = new Map<TabKey, MenuBadge>();
  const { today, tasks, todos, projects, records, wordingEnabled } = input;
  // 見出し語も文言設定に従わせる。図(タイルと帯)は常に出て、言葉だけ元に戻る
  const w = (themed: string, plain: string) => (wordingEnabled ? themed : plain);

  // 本日の練習: 完了/全体
  if (tasks.length > 0) {
    const done = tasks.filter((t) => t.status === "done").length;
    const running = tasks.some((t) => t.status === "running");
    map.set("today", {
      label: running ? w("練習中", "計測中") : "本日",
      value: `${done}/${tasks.length}`,
      ratio: done / tasks.length,
      spark: running || done < tasks.length,
    });
  }

  // 候補(ToDo): 未完了件数と、そのうち期限切れ
  const openTodos = todos.filter((t) => !t.completed && !t.parentTaskId);
  if (openTodos.length > 0) {
    const overdue = openTodos.filter((t) => t.dueDate && t.dueDate < today).length;
    map.set("todo", {
      label: overdue > 0 ? "期限切れ" : w("交渉中", "未完了"),
      value: overdue > 0 ? `${overdue}` : `${openTodos.length}`,
      ratio: overdue > 0 ? overdue / openTodos.length : 0.25,
      spark: overdue > 0,
    });
  }

  // 契約案件: 進行中の件数と、そのうち期日超過
  const openProjects = projects.filter((p) => !p.completedAt);
  if (openProjects.length > 0) {
    const overdue = openProjects.filter((p) => p.dueDate < today).length;
    map.set("projects", {
      label: overdue > 0 ? "期日超過" : "進行中",
      value: overdue > 0 ? `${overdue}` : `${openProjects.length}`,
      ratio: overdue > 0 ? overdue / openProjects.length : 0.25,
      spark: overdue > 0,
    });
  }

  // 要注意: 該当件数
  if (input.attentionCount > 0) {
    map.set("attention", {
      label: "要確認",
      value: `${input.attentionCount}`,
      ratio: Math.min(1, input.attentionCount / 10),
      spark: true,
    });
  }

  // 行動記録(ガント)と成績の訂正: 本日の実績件数
  const todayRecords = records.filter((r) => r.date === today).length;
  if (todayRecords > 0) {
    map.set("gantt", { label: "本日", value: `${todayRecords}件`, ratio: Math.min(1, todayRecords / 8), spark: false });
  }

  // 段階の残り(案件の中の未通過)
  const openStages = openProjects.reduce((n, p) => n + (p.stages ?? []).filter((s) => !isStageDone(s)).length, 0);
  if (openStages > 0 && !map.has("projects")) {
    map.set("projects", { label: w("残り試合", "残り段階"), value: `${openStages}`, ratio: 0.3, spark: false });
  }

  return map;
}

/** 本日の実働秒数。ヘッダーの表示に使う */
export function todayWorkedSeconds(tasks: DailyTask[], now: number): number {
  return Math.round(tasks.reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0) / 1000);
}
