"use client";

import { useEffect, useState } from "react";
import { daysSinceLastBackup } from "@/lib/autoBackup";
import { canShareBackupFile, downloadBackupFile, shareBackupFile } from "@/lib/backupFile";
import { showUndoToast } from "@/lib/toast";

// 自動バックアップはフォルダを選べる環境(ほぼPCのChrome系)でしか動かないため、
// 携帯だけで使っている場合、控えは手で書き出さない限り1つも存在しない。
// 設定タブを開かないと経過日数に気付けなかったので、間が空いた時だけ本日タブでも報せる
const NUDGE_AFTER_DAYS = 14;

export default function BackupNudge() {
  // undefined = まだ読んでいない(localStorageは描画後にしか触れない)
  const [days, setDays] = useState<number | null | undefined>(undefined);
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDays(daysSinceLastBackup());
    setCanShare(canShareBackupFile());
  }, []);

  if (days === undefined) return null;
  if (days !== null && days < NUDGE_AFTER_DAYS) return null;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      showUndoToast(await action());
      setDays(daysSinceLastBackup());
    } catch {
      // 共有の取り消しなど。何も言わない(催促はそのまま残る)
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel border border-alert/40 p-3">
      <p className="text-sm font-bold text-alert">🗄 バックアップを取っておきませんか</p>
      <p className="mt-0.5 text-xs text-cream/60">
        {days === null
          ? "まだ一度も書き出していません。記録はこの端末の中だけにあるので、端末が壊れると元に戻せません。"
          : `最後に書き出してから${days}日が経ちました。記録はこの端末の中だけにあります。`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className="btn-pill text-xs" onClick={() => run(downloadBackupFile)} disabled={busy}>
          書き出す
        </button>
        {canShare && (
          <button className="btn-pill-outline text-xs" onClick={() => run(shareBackupFile)} disabled={busy}>
            共有して保存
          </button>
        )}
      </div>
    </div>
  );
}
