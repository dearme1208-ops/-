// 画面のどこでも拾われなかったエラー(未処理のPromiseの失敗・実行時エラー)を、
// 使う人に伝わる言葉の知らせに直す。黙って失敗して「保存したつもり」になるのを防ぐ

export const QUOTA_MESSAGE = "保存容量が足りません。古いデータの書き出しと削除か、バックアップ後の整理をしてください";

function nameOf(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; inner?: unknown };
    if (typeof e.name === "string" && e.name !== "Error") return e.name;
    // Dexieは元のエラーをinnerに包む
    if (e.inner) return nameOf(e.inner);
    if (typeof e.name === "string") return e.name;
  }
  return "";
}

function textOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") return (err as { message: string }).message;
  return "";
}

function isQuota(err: unknown): boolean {
  const name = nameOf(err);
  if (name === "QuotaExceededError") return true;
  if (err && typeof err === "object" && (err as { inner?: unknown }).inner && isQuota((err as { inner: unknown }).inner)) return true;
  return /quota/i.test(textOf(err));
}

/** 知らせに出す文。出さなくてよいもの(取り消し・ブラウザ内部の無害な警告など)はnull */
export function describeGlobalError(err: unknown): string | null {
  const name = nameOf(err);
  const text = textOf(err);
  // 容量不足は書き込みの取りやめ(AbortError)に包まれて届くことがあるので、先に見る
  if (isQuota(err)) return QUOTA_MESSAGE;
  // 使う人が取り消した操作(共有の画面を閉じた等)は失敗ではない
  if (name === "AbortError") return null;
  // ブラウザの描画の都合で出る無害な警告
  if (/ResizeObserver loop/i.test(text)) return null;
  // 別のサイトのスクリプトのエラーは中身が見えず、こちらでは直せない
  if (text === "Script error." || text === "Script error") return null;
  // 画面の部品の読み込み失敗は、各画面の枠(SectionBoundary)が案内する
  if (name === "ChunkLoadError" || /Loading chunk [\w-]+ failed/i.test(text)) return null;
  if (name === "DatabaseClosedError" || name === "InvalidStateError") {
    return "データの保存先との接続が切れました。画面を再読み込みしてください(直前の操作が保存されていない場合があります)";
  }
  const detail = text ? `(${text.slice(0, 80)})` : "";
  return `思わぬエラーが起きました${detail}。直前の操作が保存されていない場合があります。画面を再読み込みしてやり直してください`;
}

/** 同じ知らせを短い間に何度も出さないための判定。出してよければtrue */
export function createErrorDeduper(windowMs = 30_000): (message: string, now?: number) => boolean {
  const lastShown = new Map<string, number>();
  return (message, now = Date.now()) => {
    const last = lastShown.get(message);
    if (last !== undefined && now - last < windowMs) return false;
    lastShown.set(message, now);
    return true;
  };
}
