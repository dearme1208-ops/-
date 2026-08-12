import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0B0C",
        cream: "#E9E6BD",
        alert: "rgb(var(--accent-rgb) / <alpha-value>)",
        panel: "#151517",
        // VA-11 HALL-A風演出テーマ専用のネオンパレット(固定色、アクセントカラー設定とは独立)
        "v11-pink": "rgb(255 45 149 / <alpha-value>)",
        "v11-cyan": "rgb(0 229 255 / <alpha-value>)",
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
