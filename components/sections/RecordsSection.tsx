"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  recomputeEstimateFromRecords,
  bulkFindOrCreateMasterTasks,
  recomputeEstimatesForMasterTasks,
} from "@/lib/master";
import { recomputeOutliersForAll, setManualOverride, clearManualOverride } from "@/lib/outliers";
import { recordsToCsv, parseRecordsCsv } from "@/lib/csv";
import { downloadTextFile } from "@/lib/report";
import { formatHms, parseHmsToSeconds, todayStr } from "@/lib/time";
import type { WorkRecord } from "@/lib/types";

export default function RecordsSection() {
  const [search, setSearch] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const records = useLiveQuery(() => db.records.orderBy("date").reverse().toArray(), []);

  const filtered = useMemo(() => {
    if (!records) return [];
    if (!search.trim()) return records;
    return records.filter((r) => r.category.includes(search) || r.name.includes(search) || r.date.includes(search));
  }, [records, search]);

  async function updateRecord(r: WorkRecord, patch: Partial<WorkRecord>) {
    await db.records.update(r.id, patch);
    await recomputeOutliersForAll();
    if (patch.seconds !== undefined && r.masterTaskId) {
      await recomputeEstimateFromRecords(r.masterTaskId);
    }
  }

  async function deleteRecord(r: WorkRecord) {
    if (!confirm(`「${r.date} ${r.category}/${r.name}」の実績を削除しますか?`)) return;
    await db.records.delete(r.id);
    await recomputeOutliersForAll();
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
    await recomputeOutliersForAll();
    await recomputeEstimatesForMasterTasks(Array.from(masterMap.values(), (m) => m.id));
    setImportStatus(`${fullRecords.length}件を取り込みました。`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          placeholder="日付・区分・作業名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 max-w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <div className="flex gap-2">
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
    </div>
  );
}
