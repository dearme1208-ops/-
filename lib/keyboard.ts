// キーボード操作の共通の判定

type KeyLike = {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

/** 日本語入力の変換中・変換確定のキーか(Enterで送信・Escで閉じる前に必ず確かめる)。
 *  isComposing が立たないブラウザ(Safari等)向けに keyCode 229 も見る */
export function isImeComposing(e: KeyLike): boolean {
  const n = e.nativeEvent ?? e;
  return !!(n.isComposing || e.isComposing || n.keyCode === 229 || e.keyCode === 229);
}

/** 「確定のEnter」ではなく、送信してよいEnterか */
export function isSubmitEnter(e: KeyLike & { shiftKey?: boolean }): boolean {
  return e.key === "Enter" && !e.shiftKey && !isImeComposing(e);
}

/** 画面全体のショートカットを無視すべきか: 入力中・選択中・ダイアログが開いている・
 *  ほかの処理が既に扱った(defaultPrevented) */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || isImeComposing(e)) return true;
  const t = e.target as HTMLElement | null;
  if (t) {
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return true;
  }
  if (typeof document !== "undefined" && document.querySelector(".modal-scrim, [data-command-palette], [role='dialog'][aria-modal='true']")) return true;
  return false;
}
