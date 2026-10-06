// どの画面からでも開ける「さがす」「操作の履歴」の合図(app/page.tsx に置いた画面が受け取る)
export const SEARCH_EVENT = "koutei:open-search";
export const HISTORY_EVENT = "koutei:open-history";

export function openSearch(): void {
  window.dispatchEvent(new CustomEvent(SEARCH_EVENT));
}

export function openHistory(): void {
  window.dispatchEvent(new CustomEvent(HISTORY_EVENT));
}
