import { exportBackup } from "./backup";
import { todayStr } from "./time";

// 自動バックアップ。
//
// このアプリのデータは端末のIndexedDBにしか無く、書き出しは手動のダウンロードだけだった。
// ブラウザのサイトデータ削除やiOSのストレージ回収で消えると取り返しがつかないので、
// 「選んだフォルダに1日1回、勝手に書き出す」を足す。
//
// 保存先にクラウドの同期フォルダ(iCloud Drive / OneDrive / Dropbox 等)を選べば、
// バックエンドを持たないまま他の端末からもファイルを拾える。
//
// File System Access API はChromium系のデスクトップでしか使えないため、
// 非対応の環境では「前回の手動バックアップからの経過日数」を出すだけにとどめる。
// 出来ないことを出来るふりで隠さないほうが、いざというときに困らない。

/** 残す世代数。1日1ファイルなので、おおむね直近2週間分 */
const KEEP_GENERATIONS = 14;

const HANDLE_DB = "koutei-hyo-fs";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "autoBackupDir";

// フォルダの許可(FileSystemDirectoryHandle)は文字列にできないためsettingsテーブルに入らない。
// Dexieのスキーマを上げると既存データの移行が絡むので、ハンドル専用の小さなIndexedDBを別に持つ
function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(HANDLE_STORE)) req.result.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openHandleDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    if (handle) tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    else tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isAutoBackupSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/** 保存先フォルダを選び直す。選んだ時点で書き込み許可も取る */
export async function chooseAutoBackupFolder(): Promise<string | null> {
  if (!isAutoBackupSupported()) return null;
  const picker = (window as unknown as {
    showDirectoryPicker: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: "readwrite" });
  await writeHandle(handle);
  return handle.name;
}

export async function clearAutoBackupFolder(): Promise<void> {
  await writeHandle(null);
}

export async function getAutoBackupFolderName(): Promise<string | null> {
  const handle = await readHandle();
  return handle?.name ?? null;
}

type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
};

/**
 * 書き込み許可の状態を確かめる。
 * requestが必要な場合、ブラウザはユーザー操作の中でしか許可ダイアログを出さないため、
 * 起動時の自動実行(interactive=false)では問い合わせずに諦める
 */
async function ensureWritable(handle: FileSystemDirectoryHandle, interactive: boolean): Promise<boolean> {
  const h = handle as PermissionCapableHandle;
  if (!h.queryPermission) return true;
  const state = await h.queryPermission({ mode: "readwrite" });
  if (state === "granted") return true;
  if (!interactive || !h.requestPermission) return false;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

export interface AutoBackupResult {
  status: "written" | "skipped" | "no-folder" | "denied" | "unsupported" | "error";
  fileName?: string;
  message: string;
}

const LAST_RUN_KEY = "koutei-hyo.autoBackup.lastDate";

/** 最後に自動バックアップを書けた日(YYYY-MM-DD)。localStorageで十分な揮発性の情報 */
export function lastAutoBackupDate(): string | null {
  try {
    return localStorage.getItem(LAST_RUN_KEY);
  } catch {
    return null;
  }
}

/** 古い世代を消す。同じ日に何度走っても同じファイル名を上書きするので、日数=世代数になる */
async function pruneGenerations(handle: FileSystemDirectoryHandle): Promise<void> {
  const dir = handle as FileSystemDirectoryHandle & {
    keys?: () => AsyncIterableIterator<string>;
    removeEntry?: (name: string) => Promise<void>;
  };
  if (!dir.keys || !dir.removeEntry) return;
  const names: string[] = [];
  for await (const name of dir.keys()) {
    if (/^koutei-hyo_auto_\d{4}-\d{2}-\d{2}\.json$/.test(name)) names.push(name);
  }
  names.sort(); // ファイル名に日付が入っているので辞書順 = 古い順
  for (const name of names.slice(0, Math.max(0, names.length - KEEP_GENERATIONS))) {
    try {
      await dir.removeEntry(name);
    } catch {
      // 消せなくても致命的ではない。書き込みのほうを優先する
    }
  }
}

/**
 * 1日1回の自動バックアップ。
 * force=true なら同じ日でも書き直す(設定画面の「今すぐ書き出す」用)
 */
export async function runAutoBackup({ force = false, interactive = false } = {}): Promise<AutoBackupResult> {
  if (!isAutoBackupSupported()) {
    return { status: "unsupported", message: "この端末・ブラウザは保存先フォルダの指定に対応していません。" };
  }
  const handle = await readHandle();
  if (!handle) return { status: "no-folder", message: "保存先フォルダが未設定です。" };

  const today = todayStr();
  if (!force && lastAutoBackupDate() === today) {
    return { status: "skipped", message: "本日分は書き出し済みです。" };
  }

  if (!(await ensureWritable(handle, interactive))) {
    return { status: "denied", message: "保存先フォルダへの書き込みが許可されていません。設定画面で選び直してください。" };
  }

  try {
    const fileName = `koutei-hyo_auto_${today}.json`;
    const data = await exportBackup();
    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    await pruneGenerations(handle);
    try {
      localStorage.setItem(LAST_RUN_KEY, today);
    } catch {
      // プライベートウィンドウ等。書き出し自体は成功しているので失敗扱いにしない
    }
    return { status: "written", fileName, message: `${fileName} を書き出しました。` };
  } catch (e) {
    return { status: "error", message: `書き出しに失敗しました: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const MANUAL_KEY = "koutei-hyo.manualBackup.lastDate";

export function markManualBackup(): void {
  try {
    localStorage.setItem(MANUAL_KEY, todayStr());
  } catch {
    // 記録できなくても手動バックアップ自体は成立している
  }
}

/**
 * 自動バックアップが使えない環境向けに、最後に手動で書き出してからの経過日数を返す。
 * 一度も書き出していなければ null
 */
export function daysSinceLastBackup(): number | null {
  let last: string | null = null;
  try {
    const manual = localStorage.getItem(MANUAL_KEY);
    const auto = localStorage.getItem(LAST_RUN_KEY);
    last = manual && auto ? (manual > auto ? manual : auto) : (manual ?? auto);
  } catch {
    return null;
  }
  if (!last) return null;
  const diff = Date.parse(`${todayStr()}T00:00:00`) - Date.parse(`${last}T00:00:00`);
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.round(diff / 86400000));
}
