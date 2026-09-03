"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";

const THEMED_MODES = [
  "lobotomy",
  "va11halla",
  "persona5",
  "natsuyasumi",
  "claude",
  "zen",
  "terminal",
  "adventurer",
  "hub",
  "library",
  "powerpro",
];

// 演出テーマ(オフ / ロボトミーコーポレーション風 / VA-11 HALL-A風 / ペルソナ5風 / ぼくのなつやすみ風 / Claudeモード / 禅モード / ターミナルモード)を
// <html>のdata属性に反映する。globals.cssのhtml[data-visual-mode="..."]
// セレクタでまとめて有効/無効・配色を切り替えられるようにするため
export default function VisualModeInit() {
  const [visualMode] = useSetting("theme.visualMode", "off");

  useEffect(() => {
    const mode = THEMED_MODES.includes(visualMode) ? visualMode : "off";
    document.documentElement.setAttribute("data-visual-mode", mode);
  }, [visualMode]);

  return null;
}
