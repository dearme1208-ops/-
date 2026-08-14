// 達成演出(紙吹雪)の起動をトースト同様のモジュールレベルpub/subで配信する。
// ConfettiHostが唯一の購読者として描画する
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeConfetti(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function fireConfetti() {
  for (const l of listeners) l();
}
