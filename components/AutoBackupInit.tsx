"use client";

import { useEffect } from "react";
import { runAutoBackup } from "@/lib/autoBackup";

// 起動時に1日1回だけ、指定フォルダへバックアップを書き出す。
// 保存先が未設定・非対応ブラウザ・許可切れのときは何もせず黙って終わる
// (画面を出して邪魔をしない。状態の確認と再設定は設定画面で行う)。
// 起動直後は他の初期化と競合させたくないので、少し遅らせてから走らせる
export default function AutoBackupInit() {
  useEffect(() => {
    const id = window.setTimeout(() => {
      void runAutoBackup();
    }, 4000);
    return () => window.clearTimeout(id);
  }, []);

  return null;
}
