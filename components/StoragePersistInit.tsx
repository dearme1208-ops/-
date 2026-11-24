"use client";

import { useEffect } from "react";
import { cleanupDailySettingsOncePerDay } from "@/lib/dailySettingsCleanup";
import { purgeOldTrash } from "@/lib/trash";
import { todayStr } from "@/lib/time";

const TRASH_PURGE_KEY = "koutei.trashPurge";

// ゴミ箱の7日を過ぎたものを消す(1日1回。印はlocalStorage)
async function purgeOldTrashOncePerDay(today: string = todayStr()): Promise<void> {
  try {
    if (localStorage.getItem(TRASH_PURGE_KEY) === today) return;
  } catch {
    // localStorageが使えなくても掃除はできる
  }
  await purgeOldTrash();
  try {
    localStorage.setItem(TRASH_PURGE_KEY, today);
  } catch {
    // 印が残せなくても次の起動でまた掃除するだけ
  }
}

// このアプリのデータは端末のブラウザ内(IndexedDB)にしか無い。既定では「一時的な」
// 保存領域として扱われ、端末の空き容量が減った際にブラウザの判断で丸ごと破棄され得る。
// 永続化を申請しておくとその対象から外れる(対応ブラウザのみ・拒否されることもある)。
// ホーム画面に追加済み等の条件を満たしていれば、多くのブラウザで確認なしに許可される
export default function StoragePersistInit() {
  useEffect(() => {
    void (async () => {
      try {
        if (!navigator.storage?.persist || !navigator.storage.persisted) return;
        if (await navigator.storage.persisted()) return;
        await navigator.storage.persist();
      } catch {
        // 未対応・拒否のいずれでもアプリの動作自体には影響しないため、何もしない
      }
    })();
    // 日付ごとの古い印・古いゴミ箱の掃除(1日1回)。起動の描画を邪魔しないよう少し後で行う
    const timer = window.setTimeout(() => {
      void cleanupDailySettingsOncePerDay().catch(() => {});
      void purgeOldTrashOncePerDay().catch(() => {});
    }, 5000);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
