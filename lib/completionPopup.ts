// 作業完了時に「何を完了したか」を可視化するポップアップのpub/sub。
// 元に戻すトースト(toast.ts)・紙吹雪(confetti.ts)と同じ考え方で、finishDailyTask
// (lib/tasks.ts)という単一の合流点から発火する。TodaySectionの通常完了・手動記録・
// 放置作業の復旧・各演出テーマの完了ボタンなど、どの経路で完了してもここを必ず通るため、
// 呼び出し側ごとに発火を仕込む必要がない
export interface CompletionInfo {
  id: string;
  category: string;
  name: string;
  seconds: number;
  estimatedSeconds: number;
}

type Listener = (info: CompletionInfo) => void;
const listeners = new Set<Listener>();

export function subscribeCompletionPopup(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function fireCompletionPopup(info: Omit<CompletionInfo, "id">) {
  const item: CompletionInfo = { id: crypto.randomUUID(), ...info };
  for (const l of listeners) l(item);
}
