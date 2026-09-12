"use client";

import { useEffect } from "react";
import { useSetting } from "@/lib/settings";
import { writeBootSnapshot } from "@/lib/boot";

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
  "hayarigami",
  "mountain",
  "origin",
];

// 演出テーマ(オフ / ロボトミーコーポレーション風 / VA-11 HALL-A風 / ペルソナ5風 / ぼくのなつやすみ風 / Claudeモード / 禅モード / ターミナルモード)を
// <html>のdata属性に反映する。globals.cssのhtml[data-visual-mode="..."]
// セレクタでまとめて有効/無効・配色を切り替えられるようにするため。
//
// あわせて文言設定もdata-wordingとして持たせる。CSSのcontentで直接埋め込んでいる
// 「機密」等のスタンプ・透かしはJS側の文言切り替えを通らないため、
// この属性が無いとテーマ文言をオフにしてもそこだけ残ってしまう
export default function VisualModeInit() {
  const [visualMode] = useSetting("theme.visualMode", "off");
  const [applyWording] = useSetting("theme.applyWording", "true");

  useEffect(() => {
    const mode = THEMED_MODES.includes(visualMode) ? visualMode : "off";
    document.documentElement.setAttribute("data-visual-mode", mode);
    // 次回の起動でこの姿を最初の描画から出せるよう、実際に当てた値を控えておく
    writeBootSnapshot({ visualMode: mode });
  }, [visualMode]);

  useEffect(() => {
    const wording = applyWording === "false" ? "off" : "on";
    document.documentElement.setAttribute("data-wording", wording);
    writeBootSnapshot({ wording });
  }, [applyWording]);

  return null;
}
