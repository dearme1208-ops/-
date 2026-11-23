// 森モードのCanvas(ヘッダーの林 ForestCanvas と、画面全体の胞子 ForestAmbience)が共有する負荷の調整。
//
// ・描く頻度: rAFは毎フレーム回すが、絵を描き直すのは間隔(fps)が空いたフレームだけにする
// ・描くフレームを交互にする: ヘッダーは偶数フレーム、胞子は奇数フレームにだけ描く(レーン)。
//   同じフレームで2枚とも描くと、計測中のカードが出ている時(4倍CPU制限のモバイル)にそのフレームだけ
//   16.7msを超えて落ちていた。交互にすれば1フレームに描くのは常に1枚だけになる
// ・解像度: devicePixelRatio を頭打ちにする(どちらもぼんやりした光と影なので、3倍で描いても見分けがつかない)
// ・軽量モード: コア数・メモリが少ない端末やデータ節約の設定では、さらに頻度・解像度・粒の数を落とす

export interface ForestPerfProfile {
  /** 軽量モード(低スペック端末)か */
  lite: boolean;
  /** ヘッダーの林を描き直す頻度の上限 */
  sceneFps: number;
  /** ヘッダーの林の解像度の上限 */
  sceneDprCap: number;
  /** 胞子を描き直す頻度の上限 */
  ambienceFps: number;
  /** 胞子の解像度の上限 */
  ambienceDprCap: number;
}

interface NavigatorPerfHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

/** 低スペック端末の判定。どれも取れない(古いSafari等)ときは通常扱いにする */
export function isLowEndDevice(
  nav: NavigatorPerfHints | undefined = typeof navigator !== "undefined" ? (navigator as NavigatorPerfHints) : undefined
): boolean {
  if (!nav) return false;
  // 4コア・4GBは普通のスマホやiPhone(報告値が丸められる)にも多く、軽量版に落とすと絵が粗くなる。
  // 通常版でも4倍遅いCPUで60fps近く出たので、はっきり非力な2コア以下・2GB以下だけを軽量版にする
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) return true;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return true;
  if (nav.connection?.saveData) return true;
  return false;
}

let cached: ForestPerfProfile | null = null;

export function getForestPerfProfile(): ForestPerfProfile {
  if (cached) return cached;
  const lite = isLowEndDevice();
  cached = lite
    ? // 20fpsの上限は、60Hzの画面ではレーン(1フレームおき)と組み合わさって15fpsになる
      { lite, sceneFps: 20, sceneDprCap: 1, ambienceFps: 20, ambienceDprCap: 0.75 }
    : { lite, sceneFps: 30, sceneDprCap: 1.5, ambienceFps: 30, ambienceDprCap: 1 };
  return cached;
}

// 2つのrAFループが同じフレームで受け取る時刻は同じ値なので、時刻が変わった回数を数えれば
// 「今が何フレーム目か」を両方で共有できる(どちらか片方しか動いていなくても数え続ける)
let frameNow = -1;
let frameIndex = 0;
function sharedFrameIndex(now: number): number {
  if (now !== frameNow) {
    frameNow = now;
    frameIndex++;
  }
  return frameIndex;
}

/** ヘッダーの林は偶数フレーム、胞子は奇数フレーム */
export type ForestLane = 0 | 1;

/**
 * rAFのたびに呼び、true のフレームだけ描く。自分のレーンのフレームで、前に描いてから fps の間隔が
 * 空いていれば描く(120Hzの画面でもレーンだけで60fpsにならないよう、間隔でも頭打ちにする)
 */
export function createFrameGate(fps: number, lane: ForestLane): (now: number) => boolean {
  const minGap = 1000 / fps - 4;
  let last = -Infinity;
  return (now: number) => {
    if (sharedFrameIndex(now) % 2 !== lane) return false;
    if (now - last < minGap) return false;
    last = now;
    return true;
  };
}
