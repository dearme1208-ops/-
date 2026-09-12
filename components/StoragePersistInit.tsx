"use client";

import { useEffect } from "react";

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
  }, []);

  return null;
}
