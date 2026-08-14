"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";

const FONT_SCALES: Record<string, string> = {
  sm: "15px",
  md: "16px",
  lg: "19px",
};

// 文字サイズ・ハイコントラストの設定を<html>に反映する。globals.cssの
// html[data-high-contrast="true"]セレクタ・--base-font-size変数で全タブに一括適用する
export default function AccessibilityInit() {
  const [fontScale] = useSetting("accessibility.fontScale", "md");
  const [highContrastStr] = useSetting("accessibility.highContrast", "false");

  useEffect(() => {
    document.documentElement.style.setProperty("--base-font-size", FONT_SCALES[fontScale] ?? FONT_SCALES.md);
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.setAttribute("data-high-contrast", highContrastStr === "true" ? "true" : "false");
  }, [highContrastStr]);

  return null;
}
