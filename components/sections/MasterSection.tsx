"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { upsertMasterTasksFromCsv, recomputeAllMasterEstimates } from "@/lib/master";
import { recomputeOutliersForAll } from "@/lib/outliers";
import { formatHms, parseHmsToSeconds, todayStr } from "@/lib/time";
import { masterTasksToCsv, masterCsvTemplate, parseMasterCsv } from "@/lib/masterCsv";
import { downloadTextFile } from "@/lib/report";
import type { MasterTask } from "@/lib/types";

export default function MasterSection() {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [newEstimate, setNewEstimate] = useState("00:10:00");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const [recalcStatus, setRecalcStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tasks = useLiveQuery(() => db.masterTasks.toArray(), []);

  const grouped = useMemo(() => {
    if (!tasks) return [];
    const filtered = tasks.filter(
      (t) =>
        search.trim() === "" ||
        t.category.includes(search) ||
        t.name.includes(search)
    );
    const map = new Map<string, MasterTask[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ja"))
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => a.name.localeCompare(b.name, "ja")),
      }));
  }, [tasks, search]);

  async function toggleFavorite(t: MasterTask) {
    await db.masterTasks.update(t.id, { isFavorite: !t.isFavorite });
  }

  async function updateEstimate(t: MasterTask, hms: string) {
    await db.masterTasks.update(t.id, { estimatedSeconds: parseHmsToSeconds(hms), updatedAt: Date.now() });
  }

  async function deleteTask(t: MasterTask) {
    if (!confirm(`「${t.category} / ${t.name}」をマスタから削除しますか?（過去の実績は残ります）`)) return;
    await db.masterTasks.delete(t.id);
  }

  async function createNew() {
    if (!newCategory.trim() || !newName.trim()) return;
    const now = Date.now();
    await db.masterTasks.add({
      id: uid(),
      category: newCategory.trim(),
      name: newName.trim(),
      estimatedSeconds: parseHmsToSeconds(newEstimate),
      isFavorite: false,
      sampleCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    setNewCategory("");
    setNewName("");
    setNewEstimate("00:10:00");
    setShowNew(false);
  }

  function downloadTemplate() {
    downloadTextFile("master_template.csv", masterCsvTemplate());
  }

  function exportCsv() {
    if (!tasks) return;
    downloadTextFile(`master_${todayStr()}.csv`, masterTasksToCsv(tasks));
  }

  async function importCsv(file: File) {
    const text = await file.text();
    const { rows, errors } = parseMasterCsv(text);
    setImportErrors(errors);
    if (rows.length === 0) {
      setImportResult("");
      return;
    }
    const { created, updated } = await upsertMasterTasksFromCsv(rows);
    setImportResult(`${created}件を新規追加、${updated}件を更新しました。`);
  }

  async function recalcEstimates() {
    setRecalcStatus("再計算中...");
    await recomputeOutliersForAll();
    await recomputeAllMasterEstimates();
    setRecalcStatus("すべての想定時間を再計算しました。");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          placeholder="区分・作業名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 max-w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <div className="flex flex-wrap gap-2">
          <button className="btn-pill-outline text-sm" onClick={downloadTemplate}>
            CSVテンプレート
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
          <button className="btn-pill-outline text-sm" onClick={recalcEstimates}>
            想定時間を再計算
          </button>
          <button className="btn-pill text-sm" onClick={() => setShowNew((v) => !v)}>
            + 新規作業を追加
          </button>
        </div>
      </div>

      {recalcStatus && <p className="text-xs text-cream/70">{recalcStatus}</p>}
      {importResult && <p className="text-xs text-cream/70">{importResult}</p>}
      {importErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="panel space-y-2 p-4">
          <input
            placeholder="業務区分（大項目）"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="詳細作業名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="想定時間 hh:mm:ss"
            value={newEstimate}
            onChange={(e) => setNewEstimate(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <button className="btn-pill text-sm" onClick={createNew}>
            追加
          </button>
        </div>
      )}

      {grouped.map(({ category, items }) => (
        <div key={category} className="panel p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setCollapsed((c) => ({ ...c, [category]: !c[category] }))}
          >
            <h3 className="font-display text-base font-bold">
              {category} <span className="text-xs font-normal text-cream/50">({items.length})</span>
            </h3>
            <span className="text-cream/60">{collapsed[category] ? "▶" : "▼"}</span>
          </button>
          {!collapsed[category] && (
            <div className="mt-3 space-y-2">
              {items.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => toggleFavorite(t)} aria-label="お気に入り">
                      {t.isFavorite ? "★" : "☆"}
                    </button>
                    <div>
                      <div className="text-sm text-cream">{t.name}</div>
                      <div className="text-xs text-cream/50">実績サンプル数 {t.sampleCount}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      key={`estimate-${t.estimatedSeconds}`}
                      defaultValue={formatHms(t.estimatedSeconds)}
                      onBlur={(e) => updateEstimate(t, e.target.value)}
                      className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-center text-xs text-cream tabular-nums"
                    />
                    <button className="text-xs text-alert" onClick={() => deleteTask(t)}>
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {grouped.length === 0 && (
        <p className="text-sm text-cream/50">
          作業マスタはまだ空です。実際の作業を記録すると自動的に登録されます。
        </p>
      )}
    </div>
  );
}
