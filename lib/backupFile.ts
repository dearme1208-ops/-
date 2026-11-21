import { backupJsonParts, exportBackup } from "./backup";
import { markManualBackup } from "./autoBackup";
import { downloadBlob } from "./report";
import { todayStr } from "./time";

// バックアップの「書き出し方」をここに集約する。設定タブと、本日タブの催促の
// 両方から同じ手順で呼べるようにして、片方だけ最終バックアップ日を更新し忘れる
// といったズレが起きないようにしている
function backupFileName(): string {
  return `koutei-hyo_backup_${todayStr()}.json`;
}

// 中身は1つの文字列にせず、分割したまま渡す(理由は backupJsonParts のコメント参照)
async function backupParts(): Promise<string[]> {
  return backupJsonParts(await exportBackup());
}

/** ファイルとして保存する。書き出せたら「最後にバックアップした日」を更新する */
export async function downloadBackupFile(): Promise<string> {
  downloadBlob(backupFileName(), new Blob(await backupParts(), { type: "text/plain;charset=utf-8" }));
  markManualBackup();
  return "バックアップをダウンロードしました。";
}

/** OSの共有機能でファイルを渡せる環境か(ほぼ携帯。PCのブラウザでは概ね不可) */
export function canShareBackupFile(): boolean {
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File(["{}"], "probe.json", { type: "application/json" })] });
  } catch {
    return false;
  }
}

/**
 * OSの共有機能(AirDrop/近くのデバイス/クラウドへ保存 等)へ渡す。
 * 自動バックアップが使えない携帯では、これが実質のバックアップ手段になるため、
 * 渡し終えた時点で最終バックアップ日も更新する(取り消した場合は例外になり更新されない)
 */
export async function shareBackupFile(): Promise<string> {
  const file = new File(await backupParts(), backupFileName(), { type: "application/json" });
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare?.({ files: [file] })) {
    return "この端末・ブラウザは共有機能に対応していません。「バックアップをダウンロード」をご利用ください。";
  }
  await navigator.share({ files: [file], title: "工程表バックアップ" });
  markManualBackup();
  return "共有しました。";
}
