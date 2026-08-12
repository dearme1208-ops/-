"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";

// 「ロボトミーコーポレーション風モード」のON/OFFを<html>のdata属性に反映する。
// globals.cssのhtml[data-lobotomy="true"] ...セレクタで、走査線・ノイズ・
// タイトルのグリッチ演出などをまとめて有効/無効切り替えできるようにするため
export default function LobotomyModeInit() {
  const [enabledStr] = useSetting("theme.lobotomyMode", "false");

  useEffect(() => {
    document.documentElement.setAttribute("data-lobotomy", enabledStr === "true" ? "true" : "false");
  }, [enabledStr]);

  return null;
}
