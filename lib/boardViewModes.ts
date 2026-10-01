// 統合ボードの表示切替タブ。「ボード」(既存の自由配置)以外は、同じToDo/案件/本日の作業を
// 全く違う見た目で眺めるための読み取り専用寄りのビュー(クリックで詳細は開けるが、
// ドラッグ配置や図形・付箋の編集はボード表示でのみ行う)
export type BoardViewMode =
  | "board"
  | "progress"
  | "islands"
  | "stars"
  | "shelf"
  | "iceberg"
  | "treemap"
  | "tickets"
  | "metro"
  | "mosaic"
  | "garden"
  | "city";

export const BOARD_VIEW_MODES: { key: BoardViewMode; label: string }[] = [
  { key: "board", label: "📋 ボード" },
  // ToDo・案件の進み具合・期日に対するペース・最近の動きを1件1行で並べる(実務向け)
  { key: "progress", label: "📈 進捗" },
  { key: "islands", label: "🗺 諸島マップ" },
  { key: "stars", label: "🌌 星図" },
  { key: "shelf", label: "📚 書架" },
  { key: "iceberg", label: "🧊 氷山" },
  { key: "treemap", label: "🪆 ツリーマップ" },
  { key: "tickets", label: "☕ 伝票レール" },
  { key: "metro", label: "🚉 路線図" },
  { key: "mosaic", label: "🧩 モザイク" },
  { key: "garden", label: "🌳 庭園" },
  { key: "city", label: "🏙 都市計画図" },
];
