// タイムボックスの「時間です」で鳴らす短い音。音源ファイルを持たずにWeb Audioで3回鳴らす。
// 自動再生の制限などで鳴らせない環境では何もしない(通知・画面の表示は別に出る)
export function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    [0, 0.35, 0.7].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 1046.5 : 880;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.32);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch {
    // 鳴らせなくても機能は止めない
  }
}
