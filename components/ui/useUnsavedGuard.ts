"use client";

import { useCallback, useRef } from "react";
import { choiceDialog, confirmDialog } from "./ConfirmDialog";

// 編集の窓を閉じる前に、保存していない変更があれば聞く。
// 返す関数を Modal の onClose(✕・Esc・暗幕)に渡す。保存ボタンからは使わない。
//   const requestClose = useUnsavedGuard(dirty, { onClose, onSave });
//   <Modal onClose={requestClose} ...>
// - 変更が無い: そのまま onClose
// - onSave あり:「変更を保存しますか？」[保存][破棄][戻る]。保存は onSave が false を返したら閉じない
// - onSave なし:「変更を破棄しますか？」[破棄][戻る]
export function useUnsavedGuard(
  dirty: boolean,
  opts: {
    onClose: () => void;
    onSave?: () => Promise<boolean | void> | boolean | void;
    title?: string;
    body?: string;
  }
): () => Promise<void> {
  const latest = useRef({ dirty, ...opts });
  latest.current = { dirty, ...opts };
  // 確認の窓が出ている間に、もう一度閉じようとしても二重に聞かない
  const asking = useRef(false);
  return useCallback(async () => {
    const { dirty: isDirty, onClose, onSave, title, body } = latest.current;
    if (!isDirty) {
      onClose();
      return;
    }
    if (asking.current) return;
    asking.current = true;
    try {
      if (onSave) {
        const choice = await choiceDialog({
          title: title ?? "変更を保存しますか？",
          body: body ?? "保存していない変更があります。",
          okLabel: "保存",
          altLabel: "破棄",
          altDanger: true,
          cancelLabel: "戻る",
        });
        if (choice === "ok") {
          if ((await onSave()) !== false) latest.current.onClose();
        } else if (choice === "alt") {
          latest.current.onClose();
        }
      } else {
        const ok = await confirmDialog({
          title: title ?? "変更を破棄しますか？",
          body: body ?? "保存していない変更は失われます。",
          okLabel: "破棄",
          cancelLabel: "戻る",
          danger: true,
        });
        if (ok) latest.current.onClose();
      }
    } finally {
      asking.current = false;
    }
  }, []);
}
