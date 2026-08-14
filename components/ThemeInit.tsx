"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";
import { DEFAULT_ACCENT_RGB, DEFAULT_CUSTOM_CREAM_RGB, DEFAULT_CUSTOM_INK_RGB, DEFAULT_CUSTOM_PANEL_RGB } from "@/lib/theme";

// 設定されたアクセントカラーをCSS変数として<html>に反映する。
// 演出テーマが「カスタム」の場合のみ、背景/文字/パネル色も合わせてインラインで上書きする
// (インラインstyleは他の演出テーマのhtml[data-visual-mode]セレクタより優先されるため、
// カスタム以外のモードでは必ずこれらのプロパティを削除して通常のCSSカスケードに戻す)
export default function ThemeInit() {
  const [accentRgb] = useSetting("theme.accentRgb", DEFAULT_ACCENT_RGB);
  const [visualMode] = useSetting("theme.visualMode", "off");
  const [customInkRgb] = useSetting("theme.custom.inkRgb", DEFAULT_CUSTOM_INK_RGB);
  const [customCreamRgb] = useSetting("theme.custom.creamRgb", DEFAULT_CUSTOM_CREAM_RGB);
  const [customPanelRgb] = useSetting("theme.custom.panelRgb", DEFAULT_CUSTOM_PANEL_RGB);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-rgb", accentRgb);
  }, [accentRgb]);

  useEffect(() => {
    const root = document.documentElement.style;
    if (visualMode === "custom") {
      root.setProperty("--ink-rgb", customInkRgb);
      root.setProperty("--cream-rgb", customCreamRgb);
      root.setProperty("--panel-rgb", customPanelRgb);
    } else {
      root.removeProperty("--ink-rgb");
      root.removeProperty("--cream-rgb");
      root.removeProperty("--panel-rgb");
    }
  }, [visualMode, customInkRgb, customCreamRgb, customPanelRgb]);

  return null;
}
