"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import {
  findOrCreateMasterTask,
  recomputeEstimateFromRecords,
  bulkFindOrCreateMasterTasks,
  recomputeEstimatesForMasterTasks,
} from "@/lib/master";
import { setManualOverride, clearManualOverride } from "@/lib/outliers";
import { recordsToCsv, parseRecordsCsv } from "@/lib/csv";
import { JOURNAL_KEY_PREFIX, journalEntriesFromSettings, journalEntriesToCsv } from "@/lib/journal";
import { downloadTextFile } from "@/lib/report";
import { useSetting } from "@/lib/settings";
import { mergeRecordSegments } from "@/lib/tasks";
import { formatClock, formatHms, parseHmsToSeconds, shiftDateStr, todayStr } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";

// 時刻入力(HH:MM)の変更を、元のタイムスタンプの日付部分は保ったまま時刻だけ差し替える。
// 日をまたいだ実績(例: 23:42開始〜翌7:02終了)でも、開始・終了それぞれの本来の日付がずれないようにする
function withNewTime(epochMs: number, timeStr: string): number {
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return epochMs;
  const d = new Date(epochMs);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

export default function RecordsSection() {
  const [search, setSearch] = useState("");
  // 外れ値・手動除外として集計から除外されている実績だけを絞り込んで見られるようにする
  const [showExcludedOnly, setShowExcludedOnly] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [masterEditMode] = useSetting("records.masterEditMode", "relink");
  // パソコンを閉じていた等で計測できず、後日まとめて過去の実績を手入力したい場合に使う
  const [showAddRecord, setShowAddRecord] = useState(false);

  const records = useLiveQuery(() => db.records.orderBy("date").reverse().toArray(), []);

  // 「今日の記録」(本日タブの自由記述欄)を日付ごとに見返せる履歴パネル。
  // デフォルトは折りたたみ(件数が増えると場所を取るため)、開閉状態は設定に永続化する
  const allSettings = useLiveQuery(() => db.settings.toArray(), []);
  const journalEntries = useMemo(() => journalEntriesFromSettings(allSettings ?? []), [allSettings]);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalCollapsedStr, setJournalCollapsedStr] = useSetting("records.journalCollapsed", "true");
  const journalCollapsed = journalCollapsedStr === "true";
  const filteredJournal = useMemo(() => {
    if (!journalSearch.trim()) return journalEntries;
    return journalEntries.filter((e) => e.date.includes(journalSearch) || e.text.includes(journalSearch));
  }, [journalEntries, journalSearch]);

  async function updateJournalText(date: string, text: string) {
    const key = `${JOURNAL_KEY_PREFIX}${date}`;
    if (text.trim() === "") {
      await db.settings.delete(key);
    } else {
      await db.settings.put({ key, value: text });
    }
  }

  function exportJournalCsv() {
    downloadTextFile(`journal_${todayStr()}.csv`, journalEntriesToCsv(journalEntries));
  }

  const filtered = useMemo(() => {
    if (!records) return [];
    let list = records;
    if (showExcludedOnly) list = list.filter((r) => r.excludedFromStats);
    if (search.trim()) {
      list = list.filter((r) => r.category.includes(search) || r.name.includes(search) || r.date.includes(search));
    }
    return list;
  }, [records, search, showExcludedOnly]);

  const excludedCount = useMemo(() => (records ?? []).filter((r) => r.excludedFromStats).length, [records]);

  // 名称・区分を変更した場合、設定に応じて紐づく作業マスタもリネームするか、
  // 新しい名称・区分のマスタ（既存 or 新規）に繋ぎ変える。時間変更時は紐づくマスタの想定時間を再計算する
  async function updateRecord(r: WorkRecord, patch: Partial<WorkRecord>) {
    const nameChanged = patch.name !== undefined && patch.name !== r.name;
    const categoryChanged = patch.category !== undefined && patch.category !== r.category;
    const finalPatch: Partial<WorkRecord> = { ...patch };
    // 開始/終了時刻や実績時間を手動編集すると、保持していた実働区間(segments)と
    // 矛盾してしまうため破棄する(定時以降の判定はstartedAt〜endedAtの近似に戻る)
    if (r.segments && (patch.startedAt !== undefined || patch.endedAt !== undefined || patch.seconds !== undefined)) {
      finalPatch.segments = undefined;
    }
    let oldMasterId: string | undefined;
    let newMasterId: string | undefined;

    if ((nameChanged || categoryChanged) && r.masterTaskId) {
      const newCategory = (patch.category ?? r.category).trim();
      const newName = (patch.name ?? r.name).trim();
      if (masterEditMode === "rename") {
        await db.masterTasks.update(r.masterTaskId, { category: newCategory, name: newName, updatedAt: Date.now() });
        // マスタ自体をリネームする設定の場合、同じマスタに紐づく他の実績も
        // 表示上の名称・区分を新しいものに揃える(この実績自身への反映は下のupdateで行う)
        await db.records
          .where("masterTaskId")
          .equals(r.masterTaskId)
          .filter((other) => other.id !== r.id)
          .modify({ category: newCategory, name: newName });
      } else {
        const master = await findOrCreateMasterTask(newCategory, newName, 0);
        if (master.id !== r.masterTaskId) {
          finalPatch.masterTaskId = master.id;
          oldMasterId = r.masterTaskId;
          newMasterId = master.id;
        }
      }
    }

    await db.records.update(r.id, finalPatch);

    const affected = new Set<string>();
    if (patch.seconds !== undefined) {
      const id = finalPatch.masterTaskId ?? r.masterTaskId;
      if (id) affected.add(id);
    }
    if (oldMasterId) affected.add(oldMasterId);
    if (newMasterId) affected.add(newMasterId);
    for (const id of affected) {
      await recomputeEstimateFromRecords(id);
    }
  }

  // 開始・終了時刻を編集した場合、実績時間(seconds)もその2時刻の差に合わせて再計算する
  // (時刻と実績時間の表示がずれて見えないようにするため)
  async function updateRecordStartTime(r: WorkRecord, timeStr: string) {
    if (!timeStr) return;
    const startedAt = withNewTime(r.startedAt, timeStr);
    const seconds = Math.max(0, Math.round((r.endedAt - startedAt) / 1000));
    await updateRecord(r, { startedAt, seconds });
  }

  async function updateRecordEndTime(r: WorkRecord, timeStr: string) {
    if (!timeStr) return;
    const endedAt = withNewTime(r.endedAt, timeStr);
    const seconds = Math.max(0, Math.round((endedAt - r.startedAt) / 1000));
    await updateRecord(r, { endedAt, seconds });
  }

  async function deleteRecord(r: WorkRecord) {
    if (!confirm(`「${r.date} ${r.category}/${r.name}」の実績を削除しますか?`)) return;
    await db.records.delete(r.id);
    if (r.masterTaskId) await recomputeEstimateFromRecords(r.masterTaskId);
  }

  async function toggleExclude(r: WorkRecord) {
    if (r.excludedFromStats) {
      await clearManualOverride(r.id);
    } else {
      await setManualOverride(r.id, true);
    }
  }

  function exportCsv() {
    if (!records) return;
    downloadTextFile(`records_${todayStr()}.csv`, recordsToCsv(records));
  }

  async function importCsv(file: File) {
    setImportStatus("読み込み中...");
    const text = await file.text();
    const { records: parsed, errors } = parseRecordsCsv(text);
    setImportErrors(errors);
    if (parsed.length === 0) {
      setImportStatus("");
      return;
    }

    const uniquePairs = [...new Map(parsed.map((r) => [`${r.category}::${r.name}`, { category: r.category, name: r.name }])).values()];
    const masterMap = await bulkFindOrCreateMasterTasks(uniquePairs);

    const fullRecords: WorkRecord[] = parsed.map((r) => ({
      ...r,
      masterTaskId: masterMap.get(`${r.category}::${r.name}`)!.id,
    }));
    await db.records.bulkPut(fullRecords);
    await recomputeEstimatesForMasterTasks(Array.from(masterMap.values(), (m) => m.id));
    setImportStatus(`${fullRecords.length}件を取り込みました。`);
  }

  // 計測できずに後日まとめて手入力する過去の実績を1件追加する。同日・同じ作業の実績が
  // 既にあれば、通常の作業完了時と同じルールで合算する(区分・作業名の統一、時間の合算)
  async function addPastRecord(date: string, category: string, name: string, startedAt: number, endedAt: number) {
    const master = await findOrCreateMasterTask(category, name, 0);
    const seconds = Math.round((endedAt - startedAt) / 1000);
    const segments = [{ start: startedAt, end: endedAt }];

    const existing = await db.records
      .where("date")
      .equals(date)
      .filter((r) => r.masterTaskId === master.id && !r.projectId && !r.stageId)
      .first();

    if (existing) {
      await db.records.update(existing.id, {
        seconds: existing.seconds + seconds,
        startedAt: Math.min(existing.startedAt, startedAt),
        endedAt: Math.max(existing.endedAt, endedAt),
        segments: mergeRecordSegments(existing, segments),
      });
    } else {
      await db.records.add({
        id: uid(),
        date,
        category,
        name,
        masterTaskId: master.id,
        seconds,
        startedAt,
        endedAt,
        excludedFromStats: false,
        segments,
      });
    }
    await recomputeEstimateFromRecords(master.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <input
            placeholder="日付・区分・作業名で検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 max-w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <label className="flex items-center gap-1.5 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={showExcludedOnly}
              onChange={(e) => setShowExcludedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            除外中のみ表示（外れ値・手動除外
            {excludedCount > 0 && `：${excludedCount}件`}）
          </label>
        </div>
        <div className="flex gap-2">
          <button className="btn-pill-outline text-sm" onClick={() => setShowAddRecord(true)}>
            + 実績を追加
          </button>
          <button className="btn-pill-outline text-sm" onClick={exportCsv}>
            CSVエクスポート
          </button>
          <button className="btn-pill-outline text-sm" onClick={() => fileInputRef.current?.click()}>
            CSVインポート
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importCsv(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {importStatus && <p className="text-xs text-cream/70">{importStatus}</p>}
      {importErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="panel p-4">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setJournalCollapsedStr(journalCollapsed ? "false" : "true")}
        >
          <h3 className="font-display text-sm font-bold text-cream/80">
            📓 記録の履歴（本日タブの「今日の記録」）
            {journalCollapsed && <span className="ml-1 font-normal text-cream/40">（{journalEntries.length}件）</span>}
          </h3>
          <span className="text-xs text-cream/40">{journalCollapsed ? "▶" : "▼"}</span>
        </button>
        {!journalCollapsed && (
          <div className="mt-3 space-y-3">
            {journalEntries.length === 0 ? (
              <p className="text-sm text-cream/50">
                まだ記録がありません。「本日の作業」タブの「今日の記録」に書くと、ここに一覧で表示されます。
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    placeholder="日付・内容で検索"
                    value={journalSearch}
                    onChange={(e) => setJournalSearch(e.target.value)}
                    className="w-64 max-w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
                  />
                  <button className="btn-pill-outline text-xs" onClick={exportJournalCsv}>
                    記録CSVエクスポート
                  </button>
                </div>
                <div className="divide-y divide-cream/10 rounded-lg border border-cream/10">
                  {filteredJournal.map((e) => (
                    <div key={e.date} className="space-y-1 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-cream/60 tabular-nums">{e.date}</span>
                        <button
                          className="text-xs text-alert"
                          aria-label={`${e.date}の記録を削除`}
                          onClick={() => confirm(`${e.date}の記録を削除しますか?`) && updateJournalText(e.date, "")}
                        >
                          削除
                        </button>
                      </div>
                      <textarea
                        key={`journal-${e.date}`}
                        defaultValue={e.text}
                        rows={2}
                        onBlur={(ev) => updateJournalText(e.date, ev.target.value)}
                        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
                      />
                    </div>
                  ))}
                  {filteredJournal.length === 0 && <p className="px-3 py-4 text-sm text-cream/50">該当する記録がありません。</p>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel divide-y divide-cream/10">
        {filtered.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                key={`date-${r.date}`}
                type="date"
                defaultValue={r.date}
                onBlur={(e) => e.target.value && updateRecord(r, { date: e.target.value })}
                className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              <div className="flex items-center gap-1 text-xs text-cream/50">
                <input
                  key={`start-${r.startedAt}`}
                  type="time"
                  defaultValue={formatClock(r.startedAt)}
                  onBlur={(e) => updateRecordStartTime(r, e.target.value)}
                  className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-cream tabular-nums"
                />
                <span>〜</span>
                <input
                  key={`end-${r.endedAt}`}
                  type="time"
                  defaultValue={formatClock(r.endedAt)}
                  onBlur={(e) => updateRecordEndTime(r, e.target.value)}
                  className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-cream tabular-nums"
                />
              </div>
              <input
                key={`category-${r.category}`}
                defaultValue={r.category}
                onBlur={(e) => updateRecord(r, { category: e.target.value })}
                className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              <input
                key={`name-${r.name}`}
                defaultValue={r.name}
                onBlur={(e) => updateRecord(r, { name: e.target.value })}
                className="w-32 rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              <input
                key={`seconds-${r.seconds}`}
                defaultValue={formatHms(r.seconds)}
                onBlur={(e) => updateRecord(r, { seconds: parseHmsToSeconds(e.target.value) })}
                className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-center text-xs text-cream tabular-nums"
              />
            </div>
            <div className="flex items-center gap-3">
              {r.excludedFromStats && (
                <span className="text-xs text-alert">
                  除外中{r.excludeReason === "manual" ? "(手動)" : "(外れ値)"}
                </span>
              )}
              <button className="btn-pill-outline text-xs" onClick={() => toggleExclude(r)}>
                {r.excludedFromStats ? "集計に復活" : "集計から除外"}
              </button>
              <button className="text-xs text-alert" onClick={() => deleteRecord(r)}>
                削除
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="px-4 py-6 text-sm text-cream/50">実績データがありません。</p>}
      </div>

      {showAddRecord && (
        <AddRecordDialog
          onSave={async (date, category, name, startedAt, endedAt) => {
            await addPastRecord(date, category, name, startedAt, endedAt);
            setShowAddRecord(false);
          }}
          onClose={() => setShowAddRecord(false)}
        />
      )}
    </div>
  );
}

// パソコンを閉じていた・呼び止められた等でその場で計測できず、後日まとめて過去の実績を
// 手入力するためのダイアログ。日付+開始/終了時刻(HH:MM)で入力し、終了が開始以前の場合は
// 日をまたいで開始したものとみなす(EditTaskDialogの時刻編集と同じ考え方)
function AddRecordDialog({
  onSave,
  onClose,
}: {
  onSave: (date: string, category: string, name: string, startedAt: number, endedAt: number) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(() => shiftDateStr(todayStr(), -1));
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [showMasterPicker, setShowMasterPicker] = useState(false);

  function toEpoch(hm: string): number | null {
    if (!hm) return null;
    const [y, mo, d] = date.split("-").map(Number);
    const [hh, mm] = hm.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  }

  const rawStart = toEpoch(startTime);
  const rawEnd = toEpoch(endTime);
  // 終了が開始と同じか前の時刻なら、前日から日をまたいで始まっていたとみなす
  // (例: 23:40開始〜翌0:10終了、というケースを「終了が早い」だけで弾いてしまわないため)
  const crossesMidnight = rawStart !== null && rawEnd !== null && rawStart >= rawEnd;
  const resolvedStart = crossesMidnight && rawStart !== null ? rawStart - 86400000 : rawStart;
  const durationSeconds = resolvedStart !== null && rawEnd !== null ? Math.round((rawEnd - resolvedStart) / 1000) : 0;
  const canSave = !!category.trim() && !!name.trim() && resolvedStart !== null && rawEnd !== null && durationSeconds > 0;

  function save() {
    if (!canSave || resolvedStart === null || rawEnd === null) return;
    onSave(date, category.trim(), name.trim(), resolvedStart, rawEnd);
  }

  return (
    <Modal title="実績を追加" onClose={onClose}>
      <div className="space-y-2">
        <p className="text-xs text-cream/50">
          パソコンを閉じていた・呼び止められた等でその場で計測できず、後日まとめて入力する過去の実績を追加します。
        </p>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <input
          placeholder="業務区分（大項目）"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <input
          placeholder="詳細作業名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <button type="button" className="btn-pill-outline text-xs" onClick={() => setShowMasterPicker(true)}>
          作業マスタから選択
        </button>
        <div>
          <label className="mb-1 block text-xs text-cream/60">開始〜終了時刻</label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <span className="text-cream/50">〜</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
          </div>
          {startTime && endTime && (
            <p className="mt-1 text-xs tabular-nums text-cream/60">
              {durationSeconds > 0 ? `実績時間 ${formatHms(durationSeconds)}` : "開始・終了の時刻を確認してください"}
            </p>
          )}
          {crossesMidnight && durationSeconds > 0 && (
            <p className="mt-1 text-xs text-alert">
              終了より遅い開始時刻のため、前日の{startTime}から日をまたいで始まったものとして保存します。
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm disabled:opacity-40" disabled={!canSave} onClick={save}>
          保存
        </button>
      </div>
      {showMasterPicker && (
        <CategoryWorkNameDialog
          title="作業マスタから選択"
          confirmLabel="この内容を使う"
          defaultCategory={category}
          defaultWorkName={name}
          onConfirm={(newCategory, newName) => {
            setCategory(newCategory);
            setName(newName);
            setShowMasterPicker(false);
          }}
          onClose={() => setShowMasterPicker(false)}
        />
      )}
    </Modal>
  );
}
