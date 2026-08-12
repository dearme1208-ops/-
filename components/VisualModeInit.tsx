"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";

// 演出テーマ(オフ / ロボトミーコーポレーション風 / VA-11 HALL-A風)を
// <html>のdata属性に反映する。globals.cssのhtml[data-visual-mode="..."]
// セレクタでまとめて有効/無効・配色を切り替えられるようにするため
export default function VisualModeInit() {
  const [visualMode] = useSetting("theme.visualMode", "off");

  useEffect(() => {
    const mode = visualMode === "lobotomy" || visualMode === "va11halla" ? visualMode : "off";
    document.documentElement.setAttribute("data-visual-mode", mode);
  }, [visualMode]);

  return null;
}
