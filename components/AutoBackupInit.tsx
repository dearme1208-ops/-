"use client";

import { useEffect } from "react";
import { runAutoBackup } from "@/lib/autoBackup";
import { showUndoToast } from "@/lib/toast";

// 起動時に1日1回だけ、指定フォルダへバックアップを書き出す。
// 保存先が未設定・非対応ブラウザのときは何もせず黙って終わる(そもそも使っていない)。
// 保存先を設定してあるのに書けなかったとき(許可切れ・書き込みの失敗)だけは知らせる。
// 以前はこれも黙っていたため、「自動で控えが取れている」と思ったまま何週間も
// 1つも書かれていない、ということが起こり得た。知らせるのは起動につき1回だけ
// (ここは起動時に1度しか走らない)。
// 起動直後は他の初期化と競合させたくないので、少し遅らせてから走らせる
export default function AutoBackupInit() {
  useEffect(() => {
    const id = window.setTimeout(() => {
      void runAutoBackup()
        .then((result) => {
          if (result.status === "denied") {
            showUndoToast(
              "自動の控えが止まっています（保存先フォルダの許可が切れています）。設定で保存先を選び直してください",
              undefined,
              12000
            );
          } else if (result.status === "error") {
            showUndoToast(`自動の控えを書き出せませんでした。設定で保存先を確かめてください（${result.message}）`, undefined, 12000);
          }
        })
        .catch((e) => {
          showUndoToast(
            `自動の控えを書き出せませんでした。設定で保存先を確かめてください（${e instanceof Error ? e.message : String(e)}）`,
            undefined,
            12000
          );
        });
    }, 4000);
    return () => window.clearTimeout(id);
  }, []);

  return null;
}
