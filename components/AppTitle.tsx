"use client";

import { useEffect } from "react";
import { appTitle, useVisualMode } from "@/lib/theme";

// アプリ名(見出し・ブラウザタブのタイトル)を演出テーマに応じて丸ごと差し替える。
// 「工程表」という名乗り自体をテーマの世界観に合わせることで、色や装飾だけでなく
// アプリのアイデンティティそのものが変わったように感じられるようにするため
export default function AppTitle() {
  const { mode } = useVisualMode();
  const title = appTitle(mode);

  useEffect(() => {
    document.title = title;
  }, [title]);

  return (
    <h1
      className="app-title font-display text-2xl font-bold tracking-wide text-cream sm:text-3xl"
      data-text={title}
    >
      {title}
    </h1>
  );
}
