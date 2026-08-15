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

// 週表示の範囲の決め方。fixedStart=指定した曜日を起点に7日間、
// centered=anchorを中心に前後3日、todayForward=anchorを起点にそこから7日間
export type WeekViewMode = "fixedStart" | "centered" | "todayForward";

function daysFrom(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// anchorを含む週の7日間を、設定された週表示モードに従って返す
export function buildWeekGrid(anchor: Date, mode: WeekViewMode = "fixedStart", weekStartDay = 0): Date[] {
  if (mode === "centered") {
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - 3);
    return daysFrom(start, 7);
  }
  if (mode === "todayForward") {
    return daysFrom(anchor, 7);
  }
  // fixedStart: anchor以前で直近の指定曜日を起点にする
  const diff = (anchor.getDay() - weekStartDay + 7) % 7;
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - diff);
  return daysFrom(start, 7);
}
