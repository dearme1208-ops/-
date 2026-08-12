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

// ===== 演出テーマ(オフ / ロボトミーコーポレーション風 / VA-11 HALL-A風 / ペルソナ5風 / ぼくのなつやすみ風) =====
// 各タブから同じ判定・階級ロジックを使い回すための共通定義。
// CSS側の有効/無効はhtml[data-visual-mode]属性(VisualModeInit.tsxが反映)で切り替わる。
// persona5/natsuyasumiは基調色(ink/cream/panel/accent)自体をCSS変数レベルで丸ごと差し替えるため、
// 既存の text-alert / bg-alert / border-alert / text-cream 等のクラスはコンポーネント側の変更なしに
// 自動でテーマ色になる。個別のアニメーション・文言だけをこのファイルのヘルパーで出し分ける

export type VisualMode = "off" | "lobotomy" | "va11halla" | "persona5" | "natsuyasumi";
export type ThemedMode = "lobotomy" | "va11halla" | "persona5" | "natsuyasumi";

const THEMED_MODES: ThemedMode[] = ["lobotomy", "va11halla", "persona5", "natsuyasumi"];

export function useVisualMode(): {
  mode: VisualMode;
  lobotomyMode: boolean;
  va11hallaMode: boolean;
  persona5Mode: boolean;
  natsuyasumiMode: boolean;
  themedMode: ThemedMode | null;
} {
  const [raw] = useSetting("theme.visualMode", "off");
  const mode: VisualMode = (THEMED_MODES as string[]).includes(raw) ? (raw as VisualMode) : "off";
  return {
    mode,
    lobotomyMode: mode === "lobotomy",
    va11hallaMode: mode === "va11halla",
    persona5Mode: mode === "persona5",
    natsuyasumiMode: mode === "natsuyasumi",
    themedMode: mode === "off" ? null : (mode as ThemedMode),
  };
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

export type RiskTier =
  | (typeof RISK_TIERS_LOBOTOMY)[number]
  | (typeof RISK_TIERS_VA11HALLA)[number]
  | (typeof RISK_TIERS_PERSONA5)[number]
  | (typeof RISK_TIERS_NATSUYASUMI)[number];

const RISK_TIERS_BY_MODE: Record<ThemedMode, readonly { threshold: number; name: string; level: number }[]> = {
  lobotomy: RISK_TIERS_LOBOTOMY,
  va11halla: RISK_TIERS_VA11HALLA,
  persona5: RISK_TIERS_PERSONA5,
  natsuyasumi: RISK_TIERS_NATSUYASUMI,
};

export function getRiskTier(ratio: number, mode: ThemedMode): RiskTier {
  const tiers = RISK_TIERS_BY_MODE[mode];
  return (tiers.find((t) => ratio >= t.threshold) ?? tiers[tiers.length - 1]) as RiskTier;
}

// 階級バッジの共通クラス名・色クラスをまとめて返す(呼び出し側は<span>に展開するだけでよい)。
// 色自体はテーマごとにhtml[data-visual-mode]側で--accent-rgb / v11トークンが切り替わるため、
// ここではモードごとの「形」(角ばった箱 / ネオン枠 / ラベルシール等)だけを出し分ける
export function riskBadgeClasses(level: number, mode: ThemedMode): string {
  const shape =
    mode === "va11halla"
      ? "border-v11-pink/70 bg-v11-pink/20 text-v11-pink"
      : mode === "persona5"
        ? "border-2 border-alert bg-black/70 text-alert font-black uppercase"
        : mode === "natsuyasumi"
          ? "border-2 border-dashed border-alert/70 bg-alert/10 text-alert"
          : "border-alert/70 bg-alert/20 text-alert";
  return `risk-badge risk-badge-${level} rounded border px-1.5 py-0.5 text-[10px] font-bold ${shape}`;
}

export function riskBadgeLabel(tier: RiskTier, mode: ThemedMode): string {
  if (mode === "va11halla") return tier.name;
  if (mode === "persona5") return tier.name;
  if (mode === "natsuyasumi") return tier.name;
  return `危険度 ${tier.name}`;
}

// 計測中/超過中カードのテーマ別アニメーションクラス。TodaySection/TodoSection/モーダル等で
// 「今アクティブなテーマに応じたカード演出クラス」を1回の関数呼び出しで得るためのヘルパー
const CARD_RUNNING_CLASS: Record<ThemedMode, string> = {
  lobotomy: "card-running",
  va11halla: "card-running-v11",
  persona5: "card-running-p5",
  natsuyasumi: "card-running-nat",
};
export function cardRunningClass(mode: ThemedMode): string {
  return CARD_RUNNING_CLASS[mode];
}

const CARD_OVERRUN_CLASS: Record<ThemedMode, string> = {
  lobotomy: "card-overrun",
  va11halla: "card-overrun-v11",
  persona5: "card-overrun-p5",
  natsuyasumi: "card-overrun-nat",
};
export function cardOverrunClass(mode: ThemedMode): string {
  return CARD_OVERRUN_CLASS[mode];
}

const HAZARD_BAR_CLASS: Record<ThemedMode, string> = {
  lobotomy: "hazard-bar",
  va11halla: "hazard-bar-v11",
  persona5: "hazard-bar-p5",
  natsuyasumi: "hazard-bar-nat",
};
export function hazardBarClass(mode: ThemedMode): string {
  return HAZARD_BAR_CLASS[mode];
}

const GANTT_OVERRUN_CLASS: Record<ThemedMode, string> = {
  lobotomy: "gantt-bar-overrun",
  va11halla: "gantt-bar-overrun-v11",
  persona5: "gantt-bar-overrun-p5",
  natsuyasumi: "gantt-bar-overrun-nat",
};
export function ganttOverrunClass(mode: ThemedMode): string {
  return GANTT_OVERRUN_CLASS[mode];
}

// va11hallaだけ固定のネオン色(v11-pink)を使う一方、他の3テーマは--accent-rgbが
// テーマごとに差し替わっているtext-alertでそのまま正しい色になる、という非対称性を
// 吸収するための強調テキスト色ヘルパー
export function emphasisTextClass(mode: ThemedMode): string {
  return mode === "va11halla" ? "text-v11-pink" : "text-alert";
}

// テーマの世界観に合わせた「計測中」表示ラベル
export function runningLabel(mode: ThemedMode): string {
  if (mode === "va11halla") return "営業中";
  if (mode === "persona5") return "潜入中";
  if (mode === "natsuyasumi") return "観察中";
  return "計測中";
}

// テーマの世界観に合わせた「予測超過」表示ラベル
export function overrunLabel(mode: ThemedMode): string {
  if (mode === "va11halla") return "⚡ 稼働中・時間超過";
  if (mode === "persona5") return "🔴 潜入時間・超過警告";
  if (mode === "natsuyasumi") return "🌻 予定より長引き中";
  return "⚠ 計測中・予測超過";
}
