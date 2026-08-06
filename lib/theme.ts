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
