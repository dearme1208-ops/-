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
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, message, onUndo, durationMs }];
  emit();
  setTimeout(() => dismissToast(id), durationMs);
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
