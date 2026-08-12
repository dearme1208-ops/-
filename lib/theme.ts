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

// ===== 演出テーマ(オフ / ロボトミーコーポレーション風 / VA-11 HALL-A風) =====
// 各タブから同じ判定・階級ロジックを使い回すための共通定義。
// CSS側の有効/無効はhtml[data-visual-mode]属性(VisualModeInit.tsxが反映)で切り替わる

export type VisualMode = "off" | "lobotomy" | "va11halla";
export type ThemedMode = "lobotomy" | "va11halla";

export function useVisualMode(): {
  mode: VisualMode;
  lobotomyMode: boolean;
  va11hallaMode: boolean;
  themedMode: ThemedMode | null;
} {
  const [raw] = useSetting("theme.visualMode", "off");
  const mode: VisualMode = raw === "lobotomy" || raw === "va11halla" ? raw : "off";
  return {
    mode,
    lobotomyMode: mode === "lobotomy",
    va11hallaMode: mode === "va11halla",
    themedMode: mode === "off" ? null : mode,
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

export type RiskTier = (typeof RISK_TIERS_LOBOTOMY)[number] | (typeof RISK_TIERS_VA11HALLA)[number];

export function getRiskTier(ratio: number, mode: ThemedMode): RiskTier {
  const tiers = mode === "va11halla" ? RISK_TIERS_VA11HALLA : RISK_TIERS_LOBOTOMY;
  return tiers.find((t) => ratio >= t.threshold) ?? tiers[tiers.length - 1];
}

// 階級バッジの共通クラス名・色クラスをまとめて返す(呼び出し側は<span>に展開するだけでよい)
export function riskBadgeClasses(level: number, mode: ThemedMode): string {
  const color =
    mode === "va11halla"
      ? "border-v11-pink/70 bg-v11-pink/20 text-v11-pink"
      : "border-alert/70 bg-alert/20 text-alert";
  return `risk-badge risk-badge-${level} rounded border px-1.5 py-0.5 text-[10px] font-bold ${color}`;
}

export function riskBadgeLabel(tier: RiskTier, mode: ThemedMode): string {
  return mode === "va11halla" ? tier.name : `危険度 ${tier.name}`;
}
