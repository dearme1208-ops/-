import { exportBackup } from "./backup";
import { markManualBackup } from "./autoBackup";
import { downloadTextFile } from "./report";
import { todayStr } from "./time";

// バックアップの「書き出し方」をここに集約する。設定タブと、本日タブの催促の
// 両方から同じ手順で呼べるようにして、片方だけ最終バックアップ日を更新し忘れる
// といったズレが起きないようにしている
function backupFileName(): string {
  return `koutei-hyo_backup_${todayStr()}.json`;
}

async function backupJson(): Promise<string> {
  return JSON.stringify(await exportBackup(), null, 2);
}

/** ファイルとして保存する。書き出せたら「最後にバックアップした日」を更新する */
export async function downloadBackupFile(): Promise<string> {
  downloadTextFile(backupFileName(), await backupJson());
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
  const file = new File([await backupJson()], backupFileName(), { type: "application/json" });
  if (typeof navigator === "undefined" || !navigator.share || !navigator.canShare?.({ files: [file] })) {
    return "この端末・ブラウザは共有機能に対応していません。「バックアップをダウンロード」をご利用ください。";
  }
  await navigator.share({ files: [file], title: "工程表バックアップ" });
  markManualBackup();
  return "共有しました。";
}
