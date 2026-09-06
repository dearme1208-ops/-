"use client";

import { useEffect } from "react";
import { appTitle, resolveVisualMode } from "@/lib/theme";
import { useBootSetting } from "@/lib/settings";
import { writeBootSnapshot } from "@/lib/boot";

// アプリ名(見出し・ブラウザタブのタイトル)を演出テーマに応じて丸ごと差し替える。
// 「工程表」という名乗り自体をテーマの世界観に合わせることで、色や装飾だけでなく
// アプリのアイデンティティそのものが変わったように感じられるようにするため
export default function AppTitle() {
  // ここだけはlocalStorageの控えを使って、最初の描画からモードの名前を出す。
  // ヘッダーは起動中も伏せずに見せている唯一のモード依存の文字なので、
  // 設定の読み出しを待つと必ず「工程表」が一瞬映ってしまう。
  // 本文(main)の中の文言は起動中は伏せてあるので、共通のuseVisualModeは触らない
  // (タブ名まで控えで先取りすると静的HTMLと食い違い、再水和に失敗してしまう)
  const [rawMode] = useBootSetting("theme.visualMode", "off", "visualMode");
  const [rawWording] = useBootSetting("theme.applyWording", "true", "wording");
  // 控えは "on"/"off"、設定は "true"/"false" で入っているのでどちらも受ける
  const wordingOn = rawWording !== "false" && rawWording !== "off";
  const title = appTitle(wordingOn ? resolveVisualMode(rawMode) : "off");

  useEffect(() => {
    document.title = title;
    writeBootSnapshot({ title });
  }, [title]);

  // 見出しの文字は、最初の描画の直前に同期スクリプト(lib/boot.ts)が
  // 前回のアプリ名へ差し替えている。React側もuseVisualMode経由で同じ控えを
  // 見ているので中身は一致するが、静的HTMLとは異なるため水和の警告だけ抑える
  return (
    <h1
      className="app-title font-display text-2xl font-bold tracking-wide text-cream sm:text-3xl"
      data-text={title}
      suppressHydrationWarning
    >
      {title}
    </h1>
  );
}
