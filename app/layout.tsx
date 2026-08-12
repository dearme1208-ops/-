import type { Metadata, Viewport } from "next";
import { Oswald, Noto_Sans_JP } from "next/font/google";
import "./globals.css";
import HeaderArt from "@/components/HeaderArt";
import BadgeUpdater from "@/components/BadgeUpdater";

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
    <html lang="ja" className={`${oswald.variable} ${notoSansJp.variable}`}>
      <body className="min-h-screen bg-ink font-sans text-cream antialiased">
        <BadgeUpdater />
        {/* 演出テーマ(設定でON時のみCSSで可視化)の走査線・ノイズ・グリッドの
            オーバーレイ。常時DOMには存在させ、表示はCSS側(html[data-visual-mode])で切り替える */}
        <div className="crt-scanlines" aria-hidden="true" />
        <div className="crt-noise" aria-hidden="true" />
        <div className="synthwave-grid" aria-hidden="true" />
        <div className="frame-corners">
          <span className="corner-tr" />
          <span className="corner-br" />
        </div>
        <header className="relative overflow-hidden border-b border-cream/10">
          <HeaderArt />
          <div className="absolute inset-0 flex items-end px-6 pb-3 sm:px-10">
            <h1 className="app-title font-display text-2xl font-bold tracking-wide text-cream sm:text-3xl" data-text="工程表">
              工程表
            </h1>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-8">{children}</main>
      </body>
    </html>
  );
}
