import type { BoardViewItem } from "@/lib/boardViewItems";

// 各ビュー共通の入力。既存のドラッグ配置(x/y)は使わず、カテゴリ・期日・進捗といった
// 「意味のある値」だけを見て、ビューごとに独自のレイアウトで並べ直す
export interface AltViewProps {
  items: BoardViewItem[];
  onOpen: (item: BoardViewItem) => void;
  today: string;
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// カテゴリ名・タイトルなどの文字列から、毎回同じ色相を安定して出す(乱数だと再描画のたびに
// 変わってしまい、どれがどれだか分からなくなるため)
export function hueForString(s: string): number {
  return hashString(s) % 360;
}

export function kindIcon(kind: BoardViewItem["kind"]): string {
  if (kind === "project") return "📁";
  if (kind === "task") return "⏱";
  return "🗒";
}

export function kindLabel(kind: BoardViewItem["kind"]): string {
  if (kind === "project") return "案件";
  if (kind === "task") return "本日の作業";
  return "ToDo";
}

export function EmptyBoardState() {
  return (
    <div className="panel flex min-h-[40vh] items-center justify-center p-8 text-center text-sm text-cream/50">
      ボードに置いたToDo・案件・本日の作業がまだありません。
      <br />
      「ボード」表示で何か置くと、ここに反映されます。
    </div>
  );
}
