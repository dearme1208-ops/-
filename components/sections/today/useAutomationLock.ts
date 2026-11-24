"use client";

import { useEffect, useState } from "react";

// 同じアプリを複数のタブで開いた時、時刻で動く自動処理(予定の自動開始・休憩の強制停止・時間割の終わり)を
// 1つのタブだけで動かすための目印。navigator.locks で「koutei-automation」を持てたタブだけが true になる。
// 持てなかったタブは少しおいて取り直す(持っていたタブが閉じたら引き継ぐ)。
// navigator.locks が無い環境では、これまでどおり常に true(各タブで動かす)
const LOCK_NAME = "koutei-automation";
const RETRY_MS = 5000;

export function useAutomationLock(): boolean {
  const supported = typeof navigator !== "undefined" && !!navigator.locks?.request;
  const [held, setHeld] = useState(!supported);

  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let release: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryAcquire = () => {
      if (disposed) return;
      navigator.locks
        .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (!lock || disposed) return null;
          setHeld(true);
          // 画面が閉じる(またはこのフックが外れる)まで持ち続ける
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        .then(() => {
          if (disposed) return;
          // 持てなかった(または手放した)ので、少しおいて取り直す
          setHeld(false);
          timer = setTimeout(tryAcquire, RETRY_MS);
        })
        .catch(() => {
          // ロックが使えない(権限など)時は、これまでどおりこのタブでも動かす
          if (!disposed) setHeld(true);
        });
    };
    tryAcquire();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      release?.();
    };
  }, [supported]);

  return held;
}
