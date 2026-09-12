"use client";

import { useEffect, useState } from "react";
import { exportBackup } from "@/lib/backup";
import { todayStr } from "@/lib/time";

// 画面のどこかで例外が起きたときに、真っ白ではなくこの画面を出す。
// このアプリのデータは端末のブラウザ内にしか無いため、復旧より先に
// 「バックアップを取り出せること」を最優先で用意している。
// ここでlib/reportのdownloadTextFileを使うと集計系モジュールを芋づるで読み込むことになり、
// そちら側の不具合で落ちている場合に救出まで道連れになるため、保存処理は直接書いている
function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [backupStatus, setBackupStatus] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);

  // 起動時に立つ data-booting は本文(main)をCSSで伏せており、通常はページ側が
  // 設定を読み終えた時点で外す。読み込み中に落ちるとその処理まで辿り着かないため、
  // この画面自体が伏せられたままになる(4秒の保険が効くまで真っ白に見える)。
  // エラー画面はいつでも即座に出したいので、ここで自分で外す
  useEffect(() => {
    document.documentElement.removeAttribute("data-booting");
  }, []);

  async function downloadBackup() {
    setBackupStatus("書き出しています…");
    try {
      const data = await exportBackup();
      downloadJson(`koutei-hyo_backup_${todayStr()}.json`, JSON.stringify(data, null, 2));
      setBackupStatus("バックアップをダウンロードしました。");
    } catch {
      setBackupStatus("バックアップの書き出しに失敗しました。データは消えていないので、アプリを再読み込みしてから設定タブでお試しください。");
    }
  }

  return (
    <div className="panel border-2 border-alert bg-alert/[0.06] p-5">
      <h2 className="font-display text-lg font-bold text-alert">エラーが発生しました</h2>
      <p className="mt-2 text-sm text-cream/80">
        画面の表示中に問題が起きました。<b>記録したデータは消えていません</b>（端末内にそのまま残っています）。
        下の「再試行」で戻れることが多いですが、念のため先にバックアップを取っておくと安心です。
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-pill text-sm" onClick={reset}>
          再試行
        </button>
        <button className="btn-pill-outline text-sm" onClick={() => window.location.reload()}>
          アプリを再読み込み
        </button>
        <button className="btn-pill-outline border-alert text-sm text-alert hover:bg-alert/10" onClick={downloadBackup}>
          バックアップをダウンロード
        </button>
      </div>

      {backupStatus && <p className="mt-2 text-xs text-cream/70">{backupStatus}</p>}

      <div className="mt-4 border-t border-cream/10 pt-3">
        <button className="text-xs text-cream/50 hover:text-cream/80" onClick={() => setDetailOpen((v) => !v)}>
          {detailOpen ? "▼" : "▶"} エラーの詳細
        </button>
        {detailOpen && (
          <pre className="mt-2 overflow-x-auto rounded-lg bg-ink/60 p-3 text-[11px] text-cream/60">
            {error.message}
            {error.digest ? `\n(digest: ${error.digest})` : ""}
          </pre>
        )}
      </div>
    </div>
  );
}
