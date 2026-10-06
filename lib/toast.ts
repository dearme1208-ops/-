// グローバルなトースト通知(主に「元に戻す」付き)の簡易pub/sub。
// ReactツリーのどこからでもshowUndoToastを呼べるよう、Context/Providerを介さず
// モジュールレベルの購読リストで配信する(ToastHostが唯一の購読者として描画する想定)
export interface ToastItem {
  id: string;
  message: string;
  onUndo?: () => void;
  durationMs: number;
}

type Listener = (toasts: ToastItem[]) => void;
let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function showUndoToast(message: string, onUndo?: () => void, durationMs = 6000) {
  // 同じ知らせが既に出ていれば重ねて出さない(複数の画面が同じ出来事に反応した時に2つ並ばないように)
  if (!onUndo && toasts.some((t) => t.message === message && !t.onUndo)) return;
  const id = crypto.randomUUID();
  if (onUndo) {
    // 履歴にも控え、トーストと履歴のどちらから戻しても1回だけ効くようにする
    let done = false;
    const original = onUndo;
    const once = () => {
      if (done) return;
      done = true;
      original();
    };
    recordHistory(message, once);
    onUndo = once;
  }
  toasts = [...toasts, { id, message, onUndo, durationMs }];
  emit();
  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// ---- 操作の履歴 ----
// 「元に戻す」は数秒で消えるので、あとで気づいた時に戻せるよう、この画面を開いている間の
// 取り消せる操作(完了・削除・取り込みなど)を新しい順に30件まで控えておく。
// 戻す処理は画面の中の関数なので、アプリを開き直すと履歴は消える
export interface HistoryItem {
  id: string;
  message: string;
  at: number;
  undo: () => void | Promise<void>;
  undone: boolean;
}

let history: HistoryItem[] = [];
const historyListeners = new Set<(items: HistoryItem[]) => void>();

function emitHistory() {
  for (const l of historyListeners) l(history);
}

export function recordHistory(message: string, undo: () => void | Promise<void>): void {
  history = [{ id: crypto.randomUUID(), message, at: Date.now(), undo, undone: false }, ...history].slice(0, 30);
  emitHistory();
}

export function subscribeHistory(listener: (items: HistoryItem[]) => void): () => void {
  historyListeners.add(listener);
  listener(history);
  return () => {
    historyListeners.delete(listener);
  };
}

/** 履歴から1件戻す(戻せるのは1回だけ) */
export async function undoHistory(id: string): Promise<void> {
  const item = history.find((h) => h.id === id);
  if (!item || item.undone) return;
  item.undone = true;
  history = [...history];
  emitHistory();
  await item.undo();
}
