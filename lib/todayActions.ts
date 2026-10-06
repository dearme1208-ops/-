// 本日の作業(TodaySection)の操作を、画面の外から呼び出すための合図。
// 本日の作業は常に裏で動いている(app/page.tsx)ので、独自の画面に差し替えるモードの
// 「道具袋」から合図を送れば、同じダイアログ・同じ処理がそのまま使える
export const TODAY_ACTION_EVENT = "koutei:today-action";

export type TodayAction = "trouble" | "add" | "dayPlan" | "timebox" | "tomorrow" | "reflection" | "dayGaps" | "capture" | "search" | "history";

export function requestTodayAction(kind: TodayAction): void {
  window.dispatchEvent(new CustomEvent(TODAY_ACTION_EVENT, { detail: kind }));
}
