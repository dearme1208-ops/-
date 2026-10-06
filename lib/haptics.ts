// 開始・完了などの手応えを、端末の振動で手に伝える(押せたかどうかが画面を見なくても分かる)。
// 設定「操作時の振動」(ui.haptics)で切れる。振動に対応しない端末(iPhoneのSafariなど)では何もしない
let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/** 短い振動。開始は1回、完了は2回のように、出来事ごとに長さを変える */
export function buzz(pattern: number | number[]): void {
  if (!enabled || typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // 振動できない環境では黙って何もしない
  }
}
