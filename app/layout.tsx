import type { Metadata, Viewport } from "next";
import { Oswald, Noto_Sans_JP, Yomogi, VT323, Anton, Special_Elite, Noto_Serif_JP } from "next/font/google";
import "./globals.css";
import HeaderArt from "@/components/HeaderArt";
import BadgeUpdater from "@/components/BadgeUpdater";
import AppTitle from "@/components/AppTitle";

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-oswald",
  display: "swap",
});

const notoSansJp = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-noto-sans-jp",
  display: "swap",
});

// 演出テーマごとの元ネタらしさを出すための追加書体。
// 日本語グリフを持たないラテン専用書体(vt323/anton/specialElite)は見出し等の日本語には
// 効かないため、時刻・数字・パーセンテージ等の tabular-nums 要素にのみ当てて効果を出す。
// ぼくのなつやすみ風のyomogiは手書き風の日本語フォントなので見出し・ボタンにも直接使う
const yomogi = Yomogi({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-yomogi",
  display: "swap",
});

const vt323 = VT323({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-vt323",
  display: "swap",
});

const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});

const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-special-elite",
  display: "swap",
});

// Claudeモード用。見出し・アプリ名に、Claude自身の製品デザインを思わせる
// 温かみのあるセリフ体を使う(日本語グリフを持つため見出しの日本語にも直接効く)
const notoSerifJp = Noto_Serif_JP({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-noto-serif-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "工程表",
  description: "作業時間記録・集計アプリ",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "工程表",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ja"
      className={`${oswald.variable} ${notoSansJp.variable} ${yomogi.variable} ${vt323.variable} ${anton.variable} ${specialElite.variable} ${notoSerifJp.variable}`}
    >
      <body className="min-h-screen bg-ink font-sans text-cream antialiased">
        <BadgeUpdater />
        {/* 演出テーマ(設定でON時のみCSSで可視化)の走査線・ノイズ・グリッドの
            オーバーレイ。常時DOMには存在させ、表示はCSS側(html[data-visual-mode])で切り替える */}
        <div className="crt-scanlines" aria-hidden="true" />
        <div className="crt-noise" aria-hidden="true" />
        <div className="synthwave-grid" aria-hidden="true" />
        <div className="p5-watermark" aria-hidden="true" />
        <div className="frame-corners">
          <span className="corner-tr" />
          <span className="corner-br" />
        </div>
        <header className="relative overflow-hidden border-b border-cream/10">
          <HeaderArt />
          <div className="absolute inset-0 flex items-end px-6 pb-3 sm:px-10">
            <AppTitle />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-8">{children}</main>
      </body>
    </html>
  );
}
