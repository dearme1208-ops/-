import { useSetting } from "./settings";

export interface AccentPreset {
  key: string;
  label: string;
  rgb: string; // "r g b" 形式（Tailwindのrgb(var(--accent-rgb) / <alpha-value>)用）
}

// 単色パレットの方針は維持しつつ、アクセント色（alert）の色相だけ選べるようにするプリセット
export const ACCENT_PRESETS: AccentPreset[] = [
  { key: "red", label: "レッド", rgb: "194 59 59" },
  { key: "blue", label: "ブルー", rgb: "58 108 189" },
  { key: "green", label: "グリーン", rgb: "63 143 87" },
  { key: "amber", label: "アンバー", rgb: "196 135 45" },
  { key: "purple", label: "パープル", rgb: "137 82 189" },
];

export const DEFAULT_ACCENT_RGB = ACCENT_PRESETS[0].rgb;

// カスタムテーマ("off"の基調色をそのまま初期値にする)。ink=背景、cream=文字、panel=パネル背景
export const DEFAULT_CUSTOM_INK_RGB = "11 11 12";
export const DEFAULT_CUSTOM_CREAM_RGB = "233 230 189";
export const DEFAULT_CUSTOM_PANEL_RGB = "21 21 23";

// 設定保存用の"r g b"形式(Tailwindのrgb(var(--x-rgb) / <alpha-value>)用)と、
// <input type="color">用の"#rrggbb"形式を相互変換する
export function rgbSpaceToHex(rgb: string): string {
  const parts = rgb.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "#000000";
  return `#${parts.map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgbSpace(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "0 0 0";
  return [m[1], m[2], m[3]].map((h) => parseInt(h, 16)).join(" ");
}

// ===== 演出テーマ(オフ / ロボトミーコーポレーション風 / VA-11 HALL-A風 / ペルソナ5風 /
//       ぼくのなつやすみ風 / パワプロ風) =====
// 各タブから同じ判定・階級ロジックを使い回すための共通定義。
// CSS側の有効/無効はhtml[data-visual-mode]属性(VisualModeInit.tsxが反映)で切り替わる。
// lobotomy以外は基調色(ink/cream/panel/accent)自体をCSS変数レベルで丸ごと差し替えるため、
// 既存の text-alert / bg-alert / border-alert / text-cream 等のクラスはコンポーネント側の変更なしに
// 自動でテーマ色になる。個別のアニメーション・文言・タブ名/アプリ名だけをこのファイルのヘルパーで出し分ける

export type VisualMode =
  | "off"
  | "lobotomy"
  | "va11halla"
  | "persona5"
  | "natsuyasumi"
  | "powerpro"
  | "claude"
  | "zen"
  | "terminal"
  | "adventurer";
export type ThemedMode =
  | "lobotomy"
  | "va11halla"
  | "persona5"
  | "natsuyasumi"
  | "powerpro"
  | "claude"
  | "zen"
  | "terminal"
  | "adventurer";

const THEMED_MODES: ThemedMode[] = [
  "lobotomy",
  "va11halla",
  "persona5",
  "natsuyasumi",
  "powerpro",
  "claude",
  "zen",
  "terminal",
  "adventurer",
];

export function useVisualMode(): {
  mode: VisualMode;
  lobotomyMode: boolean;
  va11hallaMode: boolean;
  persona5Mode: boolean;
  natsuyasumiMode: boolean;
  powerproMode: boolean;
  claudeMode: boolean;
  zenMode: boolean;
  terminalMode: boolean;
  adventurerMode: boolean;
  themedMode: ThemedMode | null;
  // 色・形・アニメーションは常にthemedMode通りに適用される一方、
  // アプリ名・タブ名・バッジ文言・メッセージ等の「文言」だけは
  // この設定でオフにでき、その場合は通常の言い回しに戻る
  wordingEnabled: boolean;
  wordingMode: VisualMode; // appTitle/tabLabel用。wordingEnabled=falseなら常に"off"
  wordingThemedMode: ThemedMode | null; // riskBadgeLabel/runningLabel/overrunLabel用
} {
  const [raw] = useSetting("theme.visualMode", "off");
  const [wordingRaw] = useSetting("theme.applyWording", "true");
  const mode: VisualMode = (THEMED_MODES as string[]).includes(raw) ? (raw as VisualMode) : "off";
  const themedMode = mode === "off" ? null : (mode as ThemedMode);
  const wordingEnabled = wordingRaw !== "false";
  return {
    mode,
    lobotomyMode: mode === "lobotomy",
    va11hallaMode: mode === "va11halla",
    persona5Mode: mode === "persona5",
    natsuyasumiMode: mode === "natsuyasumi",
    powerproMode: mode === "powerpro",
    claudeMode: mode === "claude",
    zenMode: mode === "zen",
    terminalMode: mode === "terminal",
    adventurerMode: mode === "adventurer",
    themedMode,
    wordingEnabled,
    wordingMode: wordingEnabled ? mode : "off",
    wordingThemedMode: wordingEnabled ? themedMode : null,
  };
}

// Claudeモードだけは色・文言に加えてタブ構成自体を絞り込む(他モードは全タブ表示のまま)。
// ToDoと案件を別のタブに分ける理由が薄いと判断し、「ワークスペース」1つに統合した。
// どちらも「いつかやること、任意でサブステップと期日を持つ」という同じ概念であり、
// タブを跨がずその場で計測を開始できる方がClaudeらしいという結論に至ったため
// 禅モードはさらに踏み込み、「今やるべき1件だけを見せる。他は見せない」という
// 引き算の思想そのものをタブ構成に反映する。ToDo・案件の一覧やレポート等は
// 意図的に隠す(データの追加・編集は他モードに切り替えて行う前提)
// ターミナルモードはClaude/禅とは正反対の方針(引き算ではなく足し算)のため、
// あえてここには追加しない。全タブをそのまま表示し、その上で「本日」タブの
// 中身だけを情報密度マシマシの管制室ダッシュボードに差し替える
// 冒険者モードは全タブを削ぎ落とすほどではないが、集計・ランキング/グラフ/ヒートマップ/
// 年表/残業分析の5タブは同じ実績データを別角度から見ているだけで役割が重なっており、
// RPGのキャラクターステータス画面のように1画面へ集約する方が自然と判断。
// グラフ/ヒートマップ/年表/残業分析の4タブを非表示にし、集計・ランキングタブの中身を
// AdventurerStatusSectionに丸ごと差し替えることで、実質的にその1画面へ統合する
export const VISIBLE_TABS_BY_MODE: Partial<Record<ThemedMode, TabKey[]>> = {
  claude: ["today", "report", "settings"],
  zen: ["today", "settings"],
  adventurer: [
    "today",
    "todo",
    "projects",
    "master",
    "template",
    "gantt",
    "aggregation",
    "attention",
    "mandala",
    "memo",
    "report",
    "records",
    "settings",
  ],
};

export function visibleTabKeys(mode: VisualMode, allKeys: TabKey[]): TabKey[] {
  if (mode === "off") return allKeys;
  const allowed = VISIBLE_TABS_BY_MODE[mode as ThemedMode];
  return allowed ?? allKeys;
}

// 想定/予測に対する超過の度合い(実績が想定の何倍か)に応じて表示する階級バッジ。
// 数字が大きいほど危険度が高い。ratioは「実績 ÷ 想定」で渡す(1.0 = ちょうど想定通り)
export const RISK_TIERS_LOBOTOMY = [
  { threshold: 4, name: "ALEPH", level: 4 },
  { threshold: 2.5, name: "WAW", level: 3 },
  { threshold: 1.8, name: "HE", level: 2 },
  { threshold: 1.3, name: "TETH", level: 1 },
  { threshold: 1, name: "ZAYIN", level: 0 },
] as const;
// VA-11 HALL-A風: 注文(=作業)が捌ききれず溜まっていく様子をカクテル名になぞらえた階級
export const RISK_TIERS_VA11HALLA = [
  { threshold: 4, name: "BAD TOUCH", level: 4 },
  { threshold: 2.5, name: "MOONBLAST", level: 3 },
  { threshold: 1.8, name: "LAST CALL", level: 2 },
  { threshold: 1.3, name: "ON THE ROCKS", level: 1 },
  { threshold: 1, name: "REGULAR", level: 0 },
] as const;
// ペルソナ5風: 「予告状」を送りつけるまでの盛り上がりになぞらえた階級
export const RISK_TIERS_PERSONA5 = [
  { threshold: 4, name: "予告状", level: 4 },
  { threshold: 2.5, name: "覚醒", level: 3 },
  { threshold: 1.8, name: "総攻撃", level: 2 },
  { threshold: 1.3, name: "警告", level: 1 },
  { threshold: 1, name: "順調", level: 0 },
] as const;
// ぼくのなつやすみ風: 夏の天気の移り変わりになぞらえた、危機感の薄いのんびりした階級
export const RISK_TIERS_NATSUYASUMI = [
  { threshold: 4, name: "夕立警報", level: 4 },
  { threshold: 2.5, name: "入道雲", level: 3 },
  { threshold: 1.8, name: "セミしぐれ", level: 2 },
  { threshold: 1.3, name: "汗ばむ陽気", level: 1 },
  { threshold: 1, name: "そよ風", level: 0 },
] as const;
// パワプロ風: 選手査定ランクになぞらえた階級。Sが最悪(査定ダウン警報)
export const RISK_TIERS_POWERPRO = [
  { threshold: 4, name: "S", level: 4 },
  { threshold: 2.5, name: "A", level: 3 },
  { threshold: 1.8, name: "B", level: 2 },
  { threshold: 1.3, name: "D", level: 1 },
  { threshold: 1, name: "G", level: 0 },
] as const;
// Claudeモード: Claude自身の思考プロセスになぞらえた階級。予測を超えるほど
// 「考える時間」が伸びていく、というポジティブな言い回しにしている(危機感を煽らない)
export const RISK_TIERS_CLAUDE = [
  { threshold: 4, name: "要相談", level: 4 },
  { threshold: 2.5, name: "拡張思考中", level: 3 },
  { threshold: 1.8, name: "深く思考中", level: 2 },
  { threshold: 1.3, name: "やや長考", level: 1 },
  { threshold: 1, name: "順調", level: 0 },
] as const;
// 禅モード: 超過そのものを「危険」ではなく「まだそこに在る」という静かな事実として
// 言い換える。危機感を煽る言葉を一切使わない、最も穏やかな階級
export const RISK_TIERS_ZEN = [
  { threshold: 4, name: "まだそこに在る", level: 4 },
  { threshold: 2.5, name: "長く在る", level: 3 },
  { threshold: 1.8, name: "少し長い", level: 2 },
  { threshold: 1.3, name: "続いている", level: 1 },
  { threshold: 1, name: "凪", level: 0 },
] as const;

// ターミナルモード: 相場の急変を思わせる警戒段階。英字連呼+記号でアラート感を強める
export const RISK_TIERS_TERMINAL = [
  { threshold: 4, name: "SYSTEM OVERLOAD", level: 4 },
  { threshold: 2.5, name: "CRITICAL", level: 3 },
  { threshold: 1.8, name: "VOLATILE", level: 2 },
  { threshold: 1.3, name: "ELEVATED", level: 1 },
  { threshold: 1, name: "NOMINAL", level: 0 },
] as const;

// 冒険者風: RPGのダンジョン攻略になぞらえた、危機感よりワクワク感を煽る階級
export const RISK_TIERS_ADVENTURER = [
  { threshold: 4, name: "ぜんめつの危機", level: 4 },
  { threshold: 2.5, name: "ピンチ！", level: 3 },
  { threshold: 1.8, name: "強敵出現", level: 2 },
  { threshold: 1.3, name: "警戒", level: 1 },
  { threshold: 1, name: "平和", level: 0 },
] as const;

export type RiskTier =
  | (typeof RISK_TIERS_LOBOTOMY)[number]
  | (typeof RISK_TIERS_VA11HALLA)[number]
  | (typeof RISK_TIERS_PERSONA5)[number]
  | (typeof RISK_TIERS_NATSUYASUMI)[number]
  | (typeof RISK_TIERS_POWERPRO)[number]
  | (typeof RISK_TIERS_CLAUDE)[number]
  | (typeof RISK_TIERS_ZEN)[number]
  | (typeof RISK_TIERS_TERMINAL)[number]
  | (typeof RISK_TIERS_ADVENTURER)[number];

const RISK_TIERS_BY_MODE: Record<ThemedMode, readonly { threshold: number; name: string; level: number }[]> = {
  lobotomy: RISK_TIERS_LOBOTOMY,
  va11halla: RISK_TIERS_VA11HALLA,
  persona5: RISK_TIERS_PERSONA5,
  natsuyasumi: RISK_TIERS_NATSUYASUMI,
  powerpro: RISK_TIERS_POWERPRO,
  claude: RISK_TIERS_CLAUDE,
  zen: RISK_TIERS_ZEN,
  terminal: RISK_TIERS_TERMINAL,
  adventurer: RISK_TIERS_ADVENTURER,
};

export function getRiskTier(ratio: number, mode: ThemedMode): RiskTier {
  const tiers = RISK_TIERS_BY_MODE[mode];
  return (tiers.find((t) => ratio >= t.threshold) ?? tiers[tiers.length - 1]) as RiskTier;
}

// 階級バッジの共通クラス名・色クラスをまとめて返す(呼び出し側は<span>に展開するだけでよい)。
// 色自体はテーマごとにhtml[data-visual-mode]側で--accent-rgb / v11 / ppトークンが切り替わるため、
// ここではモードごとの「形」(角ばった箱 / ネオン枠 / ラベルシール / 査定ランクメダル等)だけを出し分ける
export function riskBadgeClasses(level: number, mode: ThemedMode): string {
  const shape =
    mode === "va11halla"
      ? "border-v11-pink/70 bg-v11-pink/20 text-v11-pink"
      : mode === "persona5"
        ? "border-2 border-alert bg-black/70 text-alert font-black uppercase"
        : mode === "natsuyasumi"
          ? "border-2 border-dashed border-alert/70 bg-alert/10 text-alert"
          : mode === "powerpro"
            ? "risk-badge-pp-medal border-2 border-pp-gold bg-pp-gold/15 text-pp-gold font-black"
            : mode === "claude"
              ? "border-alert/40 bg-alert/10 text-alert font-bold"
              : mode === "zen"
                ? "border-transparent bg-transparent text-cream/50 font-normal"
                : mode === "terminal"
                  ? "risk-badge-terminal border-alert bg-black/80 text-alert font-bold uppercase tracking-wider"
                  : mode === "adventurer"
                    ? "border-2 border-alert bg-alert/15 text-alert font-bold"
                    : "border-alert/70 bg-alert/20 text-alert";
  const roundness =
    mode === "powerpro"
      ? "px-2.5"
      : mode === "claude" || mode === "zen" || mode === "adventurer"
        ? "rounded-full px-2.5"
        : "rounded px-1.5";
  return `risk-badge risk-badge-${level} border ${roundness} py-0.5 text-[10px] font-bold ${shape}`;
}

// 文言表示がオフの時に使う、テーマに依存しないニュートラルな階級ラベル(レベル0〜4)
const NEUTRAL_TIER_LABELS = ["低", "やや高", "高", "警戒", "危険"];

export function riskBadgeLabel(tier: RiskTier, mode: ThemedMode | null): string {
  if (mode === null) return `危険度 ${NEUTRAL_TIER_LABELS[tier.level] ?? tier.level}`;
  if (mode === "va11halla") return tier.name;
  if (mode === "persona5") return tier.name;
  if (mode === "natsuyasumi") return tier.name;
  if (mode === "powerpro") return `査定 ${tier.name}`;
  if (mode === "claude") return tier.name;
  if (mode === "zen") return tier.name;
  if (mode === "terminal") return `[${tier.name}]`;
  if (mode === "adventurer") return tier.name;
  return `危険度 ${tier.name}`;
}

// 計測中/超過中カードのテーマ別アニメーションクラス。TodaySection/TodoSection/モーダル等で
// 「今アクティブなテーマに応じたカード演出クラス」を1回の関数呼び出しで得るためのヘルパー
const CARD_RUNNING_CLASS: Record<ThemedMode, string> = {
  lobotomy: "card-running",
  va11halla: "card-running-v11",
  persona5: "card-running-p5",
  natsuyasumi: "card-running-nat",
  powerpro: "card-running-pp",
  claude: "card-running-claude",
  zen: "card-running-zen",
  terminal: "card-running-terminal",
  adventurer: "card-running-adv",
};
export function cardRunningClass(mode: ThemedMode): string {
  return CARD_RUNNING_CLASS[mode];
}

const CARD_OVERRUN_CLASS: Record<ThemedMode, string> = {
  lobotomy: "card-overrun",
  va11halla: "card-overrun-v11",
  persona5: "card-overrun-p5",
  natsuyasumi: "card-overrun-nat",
  powerpro: "card-overrun-pp",
  claude: "card-overrun-claude",
  zen: "card-overrun-zen",
  terminal: "card-overrun-terminal",
  adventurer: "card-overrun-adv",
};
export function cardOverrunClass(mode: ThemedMode): string {
  return CARD_OVERRUN_CLASS[mode];
}

const HAZARD_BAR_CLASS: Record<ThemedMode, string> = {
  lobotomy: "hazard-bar",
  va11halla: "hazard-bar-v11",
  persona5: "hazard-bar-p5",
  natsuyasumi: "hazard-bar-nat",
  powerpro: "hazard-bar-pp",
  claude: "hazard-bar-claude",
  zen: "hazard-bar-zen",
  terminal: "hazard-bar-terminal",
  adventurer: "hazard-bar-adv",
};
export function hazardBarClass(mode: ThemedMode): string {
  return HAZARD_BAR_CLASS[mode];
}

const GANTT_OVERRUN_CLASS: Record<ThemedMode, string> = {
  lobotomy: "gantt-bar-overrun",
  va11halla: "gantt-bar-overrun-v11",
  persona5: "gantt-bar-overrun-p5",
  natsuyasumi: "gantt-bar-overrun-nat",
  powerpro: "gantt-bar-overrun-pp",
  claude: "gantt-bar-overrun-claude",
  zen: "gantt-bar-overrun-zen",
  terminal: "gantt-bar-overrun-terminal",
  adventurer: "gantt-bar-overrun-adv",
};
export function ganttOverrunClass(mode: ThemedMode): string {
  return GANTT_OVERRUN_CLASS[mode];
}

// va11hallaだけ固定のネオン色(v11-pink)を使う一方、他の5テーマは--accent-rgbが
// テーマごとに差し替わっているtext-alertでそのまま正しい色になる、という非対称性を
// 吸収するための強調テキスト色ヘルパー
export function emphasisTextClass(mode: ThemedMode): string {
  return mode === "va11halla" ? "text-v11-pink" : "text-alert";
}

// テーマの世界観に合わせた「計測中」表示ラベル。modeがnull(文言オフ)の時は通常表記
export function runningLabel(mode: ThemedMode | null): string {
  if (mode === "va11halla") return "営業中";
  if (mode === "persona5") return "潜入中";
  if (mode === "natsuyasumi") return "観察中";
  if (mode === "powerpro") return "出場中";
  if (mode === "lobotomy") return "計測中";
  if (mode === "claude") return "実行中";
  if (mode === "zen") return "今、ここ";
  if (mode === "terminal") return "● LIVE";
  if (mode === "adventurer") return "ぼうけん中";
  return "計測中";
}

// テーマの世界観に合わせた「予測超過」表示ラベル。modeがnull(文言オフ)の時は通常表記
export function overrunLabel(mode: ThemedMode | null): string {
  if (mode === "va11halla") return "⚡ 稼働中・時間超過";
  if (mode === "persona5") return "🔴 潜入時間・超過警告";
  if (mode === "natsuyasumi") return "🌻 予定より長引き中";
  if (mode === "powerpro") return "⚾ 延長戦・大幅超過";
  if (mode === "claude") return "🧠 拡張思考中・想定超過";
  if (mode === "zen") return "まだ、そこに在ります";
  if (mode === "terminal") return "▲ THRESHOLD BREACH";
  if (mode === "adventurer") return "⚔️ 激闘中・想定を超過";
  return "⚠ 計測中・予測超過";
}

// 作業完了ポップアップの見出しに使う、テーマの世界観に合わせた「完了」表示ラベル。
// modeがnull(文言オフ)の時は通常表記
export function completionLabel(mode: ThemedMode | null): string {
  if (mode === "va11halla") return "会計完了";
  if (mode === "persona5") return "予告どおり、成功";
  if (mode === "natsuyasumi") return "できた！";
  if (mode === "powerpro") return "試合終了";
  if (mode === "lobotomy") return "収容完了";
  if (mode === "claude") return "完了しました";
  if (mode === "zen") return "終えた";
  if (mode === "terminal") return "TASK COMPLETE";
  if (mode === "adventurer") return "討伐した！";
  return "完了しました";
}

// ===== アプリ名・タブ名の丸ごと差し替え =====
// 見た目や色だけでなく、アプリそのものの「名乗り」までテーマの世界観に合わせて変える。
// 「工程表」というアプリ名自体、タブの並びや呼び方も、選んだテーマの中の人物になりきったような
// 名称に総入れ替えする(データ構造やタブのkeyは不変、表示ラベルだけが変わる)

export const APP_TITLE_BY_MODE: Record<ThemedMode, string> = {
  lobotomy: "収容記録簿",
  va11halla: "営業日誌",
  persona5: "予告状ノート",
  natsuyasumi: "なつやすみの しゅくだい",
  powerpro: "球団ノート",
  claude: "Claude",
  zen: "今",
  terminal: "CTRL_ROOM",
  adventurer: "ぼうけんの書",
};

export function appTitle(mode: VisualMode): string {
  return mode === "off" ? "工程表" : APP_TITLE_BY_MODE[mode];
}

export type TabKey =
  | "today"
  | "todo"
  | "projects"
  | "master"
  | "template"
  | "gantt"
  | "aggregation"
  | "charts"
  | "heatmap"
  | "attention"
  | "overtime"
  | "yearlyChart"
  | "mandala"
  | "memo"
  | "report"
  | "records"
  | "settings";

export const TAB_LABELS_BY_MODE: Record<ThemedMode, Record<TabKey, string>> = {
  lobotomy: {
    today: "本日の収容作業",
    todo: "未処理命令",
    projects: "契約対象",
    master: "個体図鑑",
    template: "曜日別作業指令",
    gantt: "観測記録",
    aggregation: "業績評定",
    charts: "統計解析",
    heatmap: "異常分布図",
    attention: "異常個体リスト",
    overtime: "深夜稼働記録",
    yearlyChart: "年次記録",
    mandala: "目標統制盤",
    memo: "職員日誌",
    report: "日次・週次・月次報告書",
    records: "記録の改竄",
    settings: "管理局設定",
  },
  va11halla: {
    today: "本日のオーダー",
    todo: "伝票",
    projects: "常連客リスト",
    master: "メニュー表",
    template: "曜日別シフト",
    gantt: "営業記録",
    aggregation: "売上ランキング",
    charts: "経営グラフ",
    heatmap: "混雑ヒートマップ",
    attention: "クレーム一覧",
    overtime: "深夜営業分析",
    yearlyChart: "年間営業記録",
    mandala: "夢のメニュー構想",
    memo: "バーのメモ帳",
    report: "日次・週次・月次売上報告",
    records: "伝票の修正",
    settings: "バーの設定",
  },
  persona5: {
    today: "本日の潜入計画",
    todo: "計画メモ",
    projects: "協力者リスト",
    master: "ペルソナ図鑑",
    template: "曜日別ルーティン",
    gantt: "行動記録",
    aggregation: "成果ランキング",
    charts: "分析グラフ",
    heatmap: "警戒レベル分布",
    attention: "警戒対象リスト",
    overtime: "深夜潜入記録",
    yearlyChart: "年間活動記録",
    mandala: "野望達成マンダラ",
    memo: "作戦ノート",
    report: "怪盗団 日報・週報・月報",
    records: "記録の書き換え",
    settings: "アジト設定",
  },
  natsuyasumi: {
    today: "今日の日記",
    todo: "しゅくだい",
    projects: "自由研究",
    master: "道具箱",
    template: "時間割",
    gantt: "生活記録表",
    aggregation: "がんばり表",
    charts: "観察グラフ",
    heatmap: "お天気マップ",
    attention: "先生からのお便り",
    overtime: "がんばりすぎ度チェック",
    yearlyChart: "夏の思い出年表",
    mandala: "めあてシート",
    memo: "らくがき帳",
    report: "今日・週・月のふりかえり",
    records: "日記の書き直し",
    settings: "ふでばこ",
  },
  powerpro: {
    today: "本日の試合",
    todo: "伝令メモ",
    projects: "契約更改",
    master: "選手名鑑",
    template: "曜日別ローテーション",
    gantt: "スタメン表",
    aggregation: "成績スタッツ",
    charts: "査定グラフ",
    heatmap: "守備位置ヒートマップ",
    attention: "戦力外通告候補",
    overtime: "登板過多チェック",
    yearlyChart: "球歴年表",
    mandala: "目標達成シート",
    memo: "監督メモ",
    report: "日間・週間・月間MVP",
    records: "スコアブック修正",
    settings: "球団運営設定",
  },
  claude: {
    today: "ワークスペース",
    todo: "タスク",
    projects: "プロジェクト",
    master: "スキル",
    template: "ルーティン",
    gantt: "タイムライン",
    aggregation: "インサイト",
    charts: "アナリティクス",
    heatmap: "集中度マップ",
    attention: "要フォロー",
    overtime: "負荷チェック",
    yearlyChart: "年間ふりかえり",
    mandala: "ゴールマップ",
    memo: "メモ",
    report: "レポート",
    records: "ログ編集",
    settings: "設定",
  },
  // 禅モードは「今」タブと「設定」タブしか表示しないため、他のラベルは
  // 実質使われないが、Record<TabKey, string>を満たすため静かな言い回しで埋めておく
  zen: {
    today: "今",
    todo: "こと",
    projects: "つづくこと",
    master: "積み重ね",
    template: "週の型",
    gantt: "歩み",
    aggregation: "積算",
    charts: "流れ",
    heatmap: "濃淡",
    attention: "気にかかること",
    overtime: "根を詰めた日",
    yearlyChart: "一年",
    mandala: "願い",
    memo: "書きつけ",
    report: "ふりかえり",
    records: "記録",
    settings: "設定",
  },
  // ターミナルモード: 引き算の禅モードとは正反対に、あらゆるタブを証券端末/管制室の
  // モニター名になぞらえた英字表記に置き換える(タブ数自体は絞らず全部出す)
  terminal: {
    today: "DASHBOARD",
    todo: "QUEUE",
    projects: "POSITIONS",
    master: "INSTRUMENTS",
    template: "SCHEDULE",
    gantt: "TIMELINE",
    aggregation: "RANKINGS",
    charts: "ANALYTICS",
    heatmap: "HEATMAP",
    attention: "ALERTS",
    overtime: "OVERLOAD",
    yearlyChart: "ARCHIVE",
    mandala: "OBJECTIVES",
    memo: "NOTES",
    report: "DIGEST",
    records: "LEDGER",
    settings: "CONFIG",
  },
  // 冒険者風: RPGの世界に丸ごとなりきったタブ名。危機感より冒険のワクワク感を強調する。
  // aggregationは、非表示にしたcharts/heatmap/yearlyChart/overtimeの内容も
  // まとめて引き受けるステータス画面になるため、ランキングだけでなく通算戦績・
  // 危険度マップ・年代記まで含む名称にしている
  adventurer: {
    today: "本日のクエスト",
    todo: "クエスト帳",
    projects: "大冒険",
    master: "モンスター図鑑",
    template: "曜日別しゅぎょう",
    gantt: "冒険の記録",
    aggregation: "冒険者ステータス",
    charts: "強さのグラフ",
    heatmap: "危険度マップ",
    attention: "要注意モンスター",
    overtime: "夜更かし警報",
    yearlyChart: "冒険の年代記",
    mandala: "目標の魔法陣",
    memo: "冒険メモ",
    report: "日々・週間・月間の冒険記",
    records: "記録の書き換え",
    settings: "冒険の設定",
  },
};

export function tabLabel(key: string, mode: VisualMode, fallback: string): string {
  if (mode === "off") return fallback;
  const table = TAB_LABELS_BY_MODE[mode];
  return (table as Record<string, string>)[key] ?? fallback;
}
