"use client";

import { useEffect, useState } from "react";
import { todayStr } from "./time";

/** 次のローカル0時(+余裕ms)までのミリ秒。DST等で0以下にならないよう最低1秒 */
export function msUntilNextLocalMidnight(now: Date = new Date(), marginMs = 1000): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, next.getTime() - now.getTime() + marginMs);
}

/**
 * 今日の日付文字列(todayStr()と同じ形式)。
 * 日付が変わったら(0時・画面復帰・フォーカス時)更新して再描画する
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayStr());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 同じ値なら setState は再描画しない
    const check = () => setToday(todayStr());
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        check();
        arm();
      }, msUntilNextLocalMidnight());
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      check();
      // スリープ復帰でタイマーがずれるので張り直す
      arm();
    };
    const onFocus = () => {
      check();
      arm();
    };
    check();
    arm();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return today;
}
