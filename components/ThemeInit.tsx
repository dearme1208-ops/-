"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";
import { DEFAULT_ACCENT_RGB } from "@/lib/theme";

// 設定されたアクセントカラーをCSS変数として<html>に反映する
export default function ThemeInit() {
  const [accentRgb] = useSetting("theme.accentRgb", DEFAULT_ACCENT_RGB);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-rgb", accentRgb);
  }, [accentRgb]);

  return null;
}
