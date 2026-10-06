"use client";

import { useCallback, useEffect, useMemo } from "react";
import { db } from "./db";
import { useSetting } from "./settings";

// 使っていない表示を、そっと畳む。本日の作業の「そのほかの表示」に並ぶパネルごとに、
// 初めて出した日と最後に触った日を覚えておき、30日以上一度も触っていないものは
// 一番下の「しばらく使っていない表示」にまとめる(消すわけではなく、押せばすぐ戻る)。
// 設定「使っていない表示を畳む」(ui.autoFoldPanels)で止められる

const FOLD_AFTER_MS = 30 * 86_400_000;
// 触ったことの記録は1日1回で十分(押すたびに設定を書き換えない)
const TOUCH_INTERVAL_MS = 86_400_000;

type Usage = Record<string, { first: number; last?: number }>;

function parse(json: string): Usage {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const KEY = "ui.panelUsage";

// 書き込みは、画面に読み込み済みの値ではなく、その時点のDBの値に足し込む。
// 画面側の値は読み込みが終わるまで既定の"{}"なので、それを元に書くと記録が毎回消えていた
async function updateUsage(mutate: (u: Usage) => Usage | null): Promise<void> {
  await db.transaction("rw", db.settings, async () => {
    const cur = parse((await db.settings.get(KEY))?.value ?? "{}");
    const next = mutate(cur);
    if (next) await db.settings.put({ key: KEY, value: JSON.stringify(next) });
  });
}

export function usePanelUsage(ids: string[], now: number = Date.now()) {
  const [json] = useSetting(KEY, "{}");
  const [autoFoldStr] = useSetting("ui.autoFoldPanels", "true");
  const usage = useMemo(() => parse(json), [json]);

  // 初めて出したパネルは、その日を「使い始めた日」として覚える
  const idsKey = ids.join(",");
  useEffect(() => {
    void updateUsage((cur) => {
      const missing = ids.filter((id) => !cur[id]);
      if (missing.length === 0) return null;
      const next = { ...cur };
      for (const id of missing) next[id] = { first: Date.now() };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const isFolded = useCallback(
    (id: string) => {
      if (autoFoldStr !== "true") return false;
      const u = usage[id];
      if (!u) return false;
      return now - u.first > FOLD_AFTER_MS && now - (u.last ?? u.first) > FOLD_AFTER_MS;
    },
    [usage, now, autoFoldStr]
  );

  const touch = useCallback(
    (id: string) => {
      const u = usage[id];
      if (u?.last && Date.now() - u.last < TOUCH_INTERVAL_MS) return;
      void updateUsage((cur) => ({ ...cur, [id]: { first: cur[id]?.first ?? Date.now(), last: Date.now() } }));
    },
    [usage]
  );

  return { isFolded, touch };
}
