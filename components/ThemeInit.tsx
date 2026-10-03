"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";
import { writeBootSnapshot } from "@/lib/boot";
import { DEFAULT_ACCENT_RGB, DEFAULT_CUSTOM_CREAM_RGB, DEFAULT_CUSTOM_INK_RGB, DEFAULT_CUSTOM_PANEL_RGB } from "@/lib/theme";

// 設定されたアクセントカラーをCSS変数として<html>に反映する。
// 演出テーマが「オフ」または「カスタム」の場合のみ適用する(演出テーマ側が既に
// 自分の世界観に合わせたアクセント色をhtml[data-visual-mode]セレクタで定義しているため)。
// 「カスタム」の場合のみ、背景/文字/パネル色も合わせてインラインで上書きする
// (インラインstyleは他の演出テーマのhtml[data-visual-mode]セレクタより優先されるため、
// 演出テーマ選択中は必ずこれらのプロパティを削除して通常のCSSカスケードに戻す)
/** アクセント色が赤〜橙(色相がおよそ330°〜50°)でなければ、警告用の赤系の色を返す */
export function alertRgbFor(accentRgb: string): string | null {
  const [r, g, b] = accentRgb.split(/\s+/).map(Number);
  if ([r, g, b].some((v) => !Number.isFinite(v))) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 30) return "214 76 64"; // ほぼ無彩色(灰色系)のアクセント
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min)) * 60;
  else if (max === g) hue = ((b - r) / (max - min)) * 60 + 120;
  else hue = ((r - g) / (max - min)) * 60 + 240;
  if (hue < 0) hue += 360;
  return hue <= 50 || hue >= 330 ? null : "214 76 64";
}

export default function ThemeInit() {
  const [accentRgb] = useSetting("theme.accentRgb", DEFAULT_ACCENT_RGB);
  const [visualMode] = useSetting("theme.visualMode", "off");
  const [customInkRgb] = useSetting("theme.custom.inkRgb", DEFAULT_CUSTOM_INK_RGB);
  const [customCreamRgb] = useSetting("theme.custom.creamRgb", DEFAULT_CUSTOM_CREAM_RGB);
  const [customPanelRgb] = useSetting("theme.custom.panelRgb", DEFAULT_CUSTOM_PANEL_RGB);

  useEffect(() => {
    const root = document.documentElement.style;
    if (visualMode === "off" || visualMode === "custom") {
      root.setProperty("--accent-rgb", accentRgb);
      // 緑・青など赤橙系でないアクセントを選んだ場合、警告(期限切れ・超過)まで同じ色になって
      // 「良い知らせ」と見分けがつかなくなるので、警告だけ赤系にする
      const alert = alertRgbFor(accentRgb);
      if (alert) root.setProperty("--alert-rgb", alert);
      else root.removeProperty("--alert-rgb");
      writeBootSnapshot({ accentRgb });
    } else {
      root.removeProperty("--accent-rgb");
      root.removeProperty("--alert-rgb");
      writeBootSnapshot({ accentRgb: "" });
    }
  }, [accentRgb, visualMode]);

  useEffect(() => {
    const root = document.documentElement.style;
    if (visualMode === "custom") {
      root.setProperty("--ink-rgb", customInkRgb);
      root.setProperty("--cream-rgb", customCreamRgb);
      root.setProperty("--panel-rgb", customPanelRgb);
      writeBootSnapshot({ inkRgb: customInkRgb, creamRgb: customCreamRgb, panelRgb: customPanelRgb });
    } else {
      root.removeProperty("--ink-rgb");
      root.removeProperty("--cream-rgb");
      root.removeProperty("--panel-rgb");
      // カスタム以外では上書きを消すので、控えからも消しておく
      writeBootSnapshot({ inkRgb: "", creamRgb: "", panelRgb: "" });
    }
  }, [visualMode, customInkRgb, customCreamRgb, customPanelRgb]);

  return null;
}
