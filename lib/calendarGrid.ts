// 案件・ToDoのカレンダー表示(月表示・週表示)で共通して使うグリッド生成ロジック
export const DOW_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

// anchorを含む週(日曜始まり)の7日間を返す
export function buildWeekGrid(anchor: Date): Date[] {
  const gridStart = new Date(anchor);
  gridStart.setDate(anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}
