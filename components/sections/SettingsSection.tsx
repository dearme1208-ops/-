"use client";

import { useRef, useState } from "react";
import { useSetting } from "@/lib/settings";
import { parseBreakRanges, serializeBreakRanges } from "@/lib/breaks";
import { DEFAULT_TAG_PRESETS } from "@/lib/todo";
import { exportBackup, importBackup, type BackupFile } from "@/lib/backup";
import { buildArchive, deleteArchivedRange } from "@/lib/archive";
import { downloadTextFile } from "@/lib/report";
import { todayStr } from "@/lib/time";
import type { BreakRange } from "@/lib/types";

export default function SettingsSection() {
  const [backupStatus, setBackupStatus] = useState("");
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [archiveBeforeMonth, setArchiveBeforeMonth] = useState(() => todayStr().slice(0, 7));
  const [archiveStatus, setArchiveStatus] = useState("");
  const [archiveExported, setArchiveExported] = useState(false);
  const [thresholdMinutesStr, setThresholdMinutesStr] = useSetting("today.untrackedThresholdMinutes", "5");
  const [provisionalEnabledStr, setProvisionalEnabledStr] = useSetting("today.provisionalEnabled", "false");
  const provisionalEnabled = provisionalEnabledStr === "true";
  const [provisionalNotifyEnabledStr, setProvisionalNotifyEnabledStr] = useSetting(
    "today.provisionalNotifyEnabled",
    "true"
  );
  const provisionalNotifyEnabled = provisionalNotifyEnabledStr === "true";
  const [breakRangesStr, setBreakRangesStr] = useSetting("today.provisionalBreakRanges", "[]");
  const breakRanges = parseBreakRanges(breakRangesStr);
  const [provisionalIdleHoursStr, setProvisionalIdleHoursStr] = useSetting("today.provisionalIdleThresholdHours", "3");
  const [emphasizeRunningStr, setEmphasizeRunningStr] = useSetting("today.emphasizeRunning", "false");
  const emphasizeRunning = emphasizeRunningStr === "true";
  const [masterEditModeStr, setMasterEditModeStr] = useSetting("records.masterEditMode", "relink");
  const [autoImportantTag, setAutoImportantTag] = useSetting("todo.autoImportantTag", "対応中");
  const [afterHoursCutoff, setAfterHoursCutoff] = useSetting("report.afterHoursCutoff", "18:00");
  const [weeklyAfterHoursNotifyEnabledStr, setWeeklyAfterHoursNotifyEnabledStr] = useSetting(
    "notify.afterHoursWeeklyEnabled",
    "false"
  );
  const weeklyAfterHoursNotifyEnabled = weeklyAfterHoursNotifyEnabledStr === "true";
  const [weeklyAfterHoursThresholdStr, setWeeklyAfterHoursThresholdStr] = useSetting(
    "notify.afterHoursWeeklyThresholdHours",
    "5"
  );

  function addBreakRange() {
    setBreakRangesStr(serializeBreakRanges([...breakRanges, { start: "12:00", end: "13:00" }]));
  }
  function updateBreakRange(index: number, patch: Partial<BreakRange>) {
    const next = breakRanges.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setBreakRangesStr(serializeBreakRanges(next));
  }
  function removeBreakRange(index: number) {
    setBreakRangesStr(serializeBreakRanges(breakRanges.filter((_, i) => i !== index)));
  }

  async function downloadBackup() {
    const data = await exportBackup();
    downloadTextFile(`koutei-hyo_backup_${todayStr()}.json`, JSON.stringify(data, null, 2));
    setBackupStatus("バックアップをダウンロードしました。");
  }

  async function restoreBackup(file: File) {
    const text = await file.text();
    let data: BackupFile;
    try {
      data = JSON.parse(text);
    } catch {
      setBackupStatus("ファイルの読み込みに失敗しました（JSON形式ではありません）。");
      return;
    }
    if (data.app !== "koutei-hyo" || !data.tables) {
      setBackupStatus("このアプリのバックアップファイルではないようです。");
      return;
    }
    if (
      !confirm(
        "現在のすべてのデータをこのバックアップの内容で置き換えます。この操作は元に戻せません。よろしいですか?"
      )
    ) {
      return;
    }
    const { restoredRows } = await importBackup(data);
    setBackupStatus(`復元しました（${restoredRows}件のデータ）。エクスポート日時: ${data.exportedAt}`);
  }

  async function exportArchive() {
    const beforeDate = `${archiveBeforeMonth}-01`;
    const data = await buildArchive(beforeDate);
    if (data.records.length === 0 && data.dailyTasks.length === 0) {
      setArchiveStatus("対象期間のデータはありません。");
      setArchiveExported(false);
      return;
    }
    downloadTextFile(`koutei-hyo_archive_before-${archiveBeforeMonth}.json`, JSON.stringify(data, null, 2));
    setArchiveStatus(
      `実績${data.records.length}件、日次タスク${data.dailyTasks.length}件をダウンロードしました。内容を確認してから削除を実行してください。`
    );
    setArchiveExported(true);
  }

  async function deleteArchive() {
    const beforeDate = `${archiveBeforeMonth}-01`;
    if (
      !confirm(
        `${archiveBeforeMonth}より前の実績・日次タスクを削除します。ダウンロードしたアーカイブファイルは保存済みですか？この操作は元に戻せません。`
      )
    ) {
      return;
    }
    const { deletedRecords, deletedDailyTasks } = await deleteArchivedRange(beforeDate);
    setArchiveStatus(`削除しました（実績${deletedRecords}件、日次タスク${deletedDailyTasks}件）。`);
    setArchiveExported(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg font-bold">設定</h2>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">未計測時間の自動計測</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            className={provisionalEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setProvisionalEnabledStr(provisionalEnabled ? "false" : "true")}
          >
            未計測の自動計測: {provisionalEnabled ? "ON" : "OFF"}
          </button>
        </div>
        {provisionalEnabled && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <span>未計測が</span>
            <input
              type="number"
              min={0}
              value={thresholdMinutesStr}
              onChange={(e) => setThresholdMinutesStr(e.target.value)}
              className="w-14 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
            />
            <span>分以上続いたら、自動で仮計測を開始します</span>
            <button
              className={provisionalNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setProvisionalNotifyEnabledStr(provisionalNotifyEnabled ? "false" : "true")}
            >
              仮計測の通知: {provisionalNotifyEnabled ? "ON" : "OFF"}
            </button>
          </div>
        )}

        {provisionalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <p className="text-xs text-cream/60">
              除外する時間帯（休憩など）。この時間帯は未計測の自動開始が始まらず、「さかのぼって開始/再開」でも対象に含まれません。
            </p>
            {breakRanges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
                <input
                  type="time"
                  value={r.start}
                  onChange={(e) => updateBreakRange(i, { start: e.target.value })}
                  className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <span>〜</span>
                <input
                  type="time"
                  value={r.end}
                  onChange={(e) => updateBreakRange(i, { end: e.target.value })}
                  className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
                />
                <button className="text-alert" onClick={() => removeBreakRange(i)} aria-label="削除">
                  ✕
                </button>
              </div>
            ))}
            <button className="btn-pill-outline text-xs" onClick={addBreakRange}>
              + 時間帯を追加
            </button>
          </div>
        )}

        {provisionalEnabled && (
          <div className="space-y-2 border-t border-cream/10 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
              <span>放置</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={provisionalIdleHoursStr}
                onChange={(e) => setProvisionalIdleHoursStr(e.target.value)}
                className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>時間以上マウス/キーボード操作がなければ、未計測の計測を最後に操作していた時刻で自動的に打ち切ります</span>
            </div>
            <p className="text-[10px] text-cream/40">
              定時後・休日にPCを開いたまま放置しても、際限なく計測され続けないようにするための保険です。
            </p>
          </div>
        )}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">本日の作業の表示</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={emphasizeRunning ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setEmphasizeRunningStr(emphasizeRunning ? "false" : "true")}
          >
            計測中の作業を強調表示: {emphasizeRunning ? "ON" : "OFF"}
          </button>
        </div>
        <p className="text-xs text-cream/50">
          ONにすると、計測中の作業がある間は他の作業が薄く表示され、ボタンも操作できなくなります（仮計測中と同様の見せ方です）。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">実績編集で名称・区分を変更した時の挙動</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={masterEditModeStr === "relink" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMasterEditModeStr("relink")}
          >
            別のマスタに繋ぎ変える
          </button>
          <button
            className={masterEditModeStr === "rename" ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setMasterEditModeStr("rename")}
          >
            マスタ自体もリネームする
          </button>
        </div>
        <p className="text-xs text-cream/50">
          {masterEditModeStr === "rename"
            ? "この実績が紐づく作業マスタの名称・区分もそのまま書き換えます。同じマスタに紐づく他の日の実績の表示も一緒に変わります。"
            : "新しい名称・区分の作業マスタが既にあればそこに繋ぎ変え、なければ新規作成して繋ぎ変えます。元のマスタや、それに紐づく他の実績には影響しません。"}
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">ToDoのタグによる自動重要化</h3>
        <div className="flex flex-wrap gap-2">
          <button
            className={!autoImportantTag ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setAutoImportantTag("")}
          >
            なし
          </button>
          {DEFAULT_TAG_PRESETS.map((t) => (
            <button
              key={t}
              className={autoImportantTag === t ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
              onClick={() => setAutoImportantTag(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-xs text-cream/50">
          {autoImportantTag
            ? `ToDoのタスク登録・編集時にタグ「${autoImportantTag}」を選ぶと、自動的に★重要にします（タグを外しても重要フラグは自動では解除しません）。`
            : "自動重要化は無効です。タグを選んでも★重要は自動では変わりません。"}
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">週報・月報の「定時以降の業務」判定基準</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <span>定時（終業時刻）</span>
          <input
            type="time"
            value={afterHoursCutoff}
            onChange={(e) => setAfterHoursCutoff(e.target.value)}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          />
        </div>
        <p className="text-xs text-cream/50">
          週報・月報で、この時刻より後にかかった実績時間を「定時以降の業務」として集計します（所定労働時間による概算残業とは別の、実際の時刻ベースの集計です）。
        </p>
        <div className="space-y-2 border-t border-cream/10 pt-3">
          <button
            className={weeklyAfterHoursNotifyEnabled ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            onClick={() => setWeeklyAfterHoursNotifyEnabledStr(weeklyAfterHoursNotifyEnabled ? "false" : "true")}
          >
            週次の基準超え通知: {weeklyAfterHoursNotifyEnabled ? "ON" : "OFF"}
          </button>
          {weeklyAfterHoursNotifyEnabled && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
              <span>今週の定時以降の業務が</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={weeklyAfterHoursThresholdStr}
                onChange={(e) => setWeeklyAfterHoursThresholdStr(e.target.value)}
                className="w-16 rounded border border-cream/20 bg-ink px-2 py-1 text-center text-cream"
              />
              <span>時間を超えたら通知します（週1回）</span>
            </div>
          )}
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">全データのバックアップ・復元</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill-outline text-sm" onClick={downloadBackup}>
            バックアップをダウンロード
          </button>
          <button className="btn-pill-outline text-sm" onClick={() => restoreInputRef.current?.click()}>
            バックアップから復元
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) restoreBackup(file);
              e.target.value = "";
            }}
          />
        </div>
        {backupStatus && <p className="text-xs text-cream/70">{backupStatus}</p>}
        <p className="text-xs text-cream/50">
          このアプリのデータは端末のブラウザ内にのみ保存されています。定期的にバックアップをダウンロードしておくと、機種変更やブラウザデータ消去の際に復元できます。復元は現在のデータを全て上書きします。
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="font-display text-sm font-bold text-cream/80">実績データの月次アーカイブ</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
          <input
            type="month"
            value={archiveBeforeMonth}
            onChange={(e) => {
              setArchiveBeforeMonth(e.target.value);
              setArchiveExported(false);
              setArchiveStatus("");
            }}
            className="rounded border border-cream/20 bg-ink px-2 py-1 text-cream"
          />
          <span>より前の実績・日次タスクをアーカイブ</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill-outline text-sm" onClick={exportArchive}>
            アーカイブをダウンロード
          </button>
          <button
            className="btn-pill-outline text-sm disabled:opacity-30"
            onClick={deleteArchive}
            disabled={!archiveExported}
          >
            ダウンロード済みデータを削除
          </button>
        </div>
        {archiveStatus && <p className="text-xs text-cream/70">{archiveStatus}</p>}
        <p className="text-xs text-cream/50">
          データが増えすぎて動作が重くなってきた場合などに使います。まずダウンロードしてバックアップし、内容を確認してから削除を実行してください（削除ボタンは同じ期間でダウンロードするまで押せません）。作業マスタや案件、ToDoは削除されません。
        </p>
      </div>
    </div>
  );
}
