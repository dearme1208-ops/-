import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ink/cream/panelはCSS変数駆動にし、html[data-visual-mode]側で書き換えるだけで
        // 全タブ・全コンポーネントの基調色を一括反転できるようにしている(persona5/natsuyasumi用)
        ink: "rgb(var(--ink-rgb) / <alpha-value>)",
        cream: "rgb(var(--cream-rgb) / <alpha-value>)",
        alert: "rgb(var(--accent-rgb) / <alpha-value>)",
        panel: "rgb(var(--panel-rgb) / <alpha-value>)",
        // VA-11 HALL-A風演出テーマ専用のネオンパレット(固定色、アクセントカラー設定とは独立)
        "v11-pink": "rgb(255 45 149 / <alpha-value>)",
        "v11-cyan": "rgb(0 229 255 / <alpha-value>)",
        // ペルソナ5風演出テーマ専用の赤・白(固定色)
        "p5-red": "rgb(var(--p5-red-rgb) / <alpha-value>)",
        "p5-white": "rgb(var(--p5-white-rgb) / <alpha-value>)",
        // ぼくのなつやすみ風演出テーマ専用の夏空・陽射し・葉の色(固定色)
        "nat-sea": "rgb(var(--nat-sea-rgb) / <alpha-value>)",
        "nat-sun": "rgb(var(--nat-sun-rgb) / <alpha-value>)",
        "nat-leaf": "rgb(var(--nat-leaf-rgb) / <alpha-value>)",
        // パワプロ風演出テーマ専用の球場グリーン・査定ランクゴールド(固定色)
        "pp-green": "rgb(var(--pp-green-rgb) / <alpha-value>)",
        "pp-gold": "rgb(var(--pp-gold-rgb) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-oswald)", "sans-serif"],
        sans: ["var(--font-noto-sans-jp)", "sans-serif"],
      },
      boxShadow: {
        panel: "0 8px 24px rgba(0,0,0,0.5)",
        pill: "0 2px 8px rgba(0,0,0,0.4)",
      },
    },
  },
  plugins: [],
};
export default config;
