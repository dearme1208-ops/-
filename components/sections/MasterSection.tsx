"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import {
  upsertMasterTasksFromCsv,
  recomputeAllMasterEstimates,
  recoverOrphanedMasterHistory,
  findDuplicateMasterGroups,
  mergeMasterTasks,
} from "@/lib/master";
import { recomputeOutliersForAll, clearManualOverride } from "@/lib/outliers";
import { formatHms, parseHmsToSeconds, todayStr } from "@/lib/time";
import { masterTasksToCsv, masterCsvTemplate, parseMasterCsv } from "@/lib/masterCsv";
import { downloadTextFile } from "@/lib/report";
import { computeStaleMasterTasks } from "@/lib/staleMaster";
import { useSetting } from "@/lib/settings";
import { useVisualMode } from "@/lib/theme";
import type { MasterTask, WorkRecord } from "@/lib/types";
import { formatYen, computeCost, parseCategoryRates, resolveCategoryRate } from "@/lib/cost";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";

type SortKey = "name" | "sampleCount" | "estimatedSeconds";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "名前順" },
  { key: "sampleCount", label: "実績件数順" },
  { key: "estimatedSeconds", label: "想定時間順" },
];

export default function MasterSection() {
  const { adventurerMode } = useVisualMode();
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [newEstimate, setNewEstimate] = useState("00:10:00");
  // 入力中の区分/作業名と完全一致する、生きている作業マスタが既にある場合の警告。
  // 入力を変えたら黙って消す(古い警告のまま新規登録されるのを防ぐ)
  const [duplicateWarning, setDuplicateWarning] = useState<MasterTask | null>(null);
  // 統合(重複マスタの解消)で選択中の作業マスタID
  const [mergeSelectedIds, setMergeSelectedIds] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<{ ids: string[] } | null>(null);
  const [mergeStatus, setMergeStatus] = useState<string>("");
  const [duplicatesCollapsed, setDuplicatesCollapsed] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const [recalcStatus, setRecalcStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [staleDaysStr] = useSetting("master.staleDays", "90");
  const staleDays = Math.max(1, Number(staleDaysStr) || 90);
  const [showCsvToolsStr] = useSetting("csvTools.master", "true");
  const showCsvTools = showCsvToolsStr === "true";
  const [orphansCollapsed, setOrphansCollapsed] = useState(false);
  // クリックした作業マスタ(または宙に浮いた実績のグループ)の実績一覧を表示するモーダル。
  // recordsをその場でコピーせず参照条件だけ持たせることで、モーダルを開いたまま
  // 集計への復活操作をしても一覧がリアルタイムに更新される
  const [viewingRecords, setViewingRecords] = useState<
    | { title: string; masterId: string }
    | { title: string; category: string; name: string }
    | { title: string; masterIds: string[] }
    | null
  >(null);

  const tasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const clients = useLiveQuery(() => db.clients.orderBy("order").toArray(), []);
  const [defaultHourlyRateStr] = useSetting("cost.defaultHourlyRate", "");
  const defaultHourlyRate = Number(defaultHourlyRateStr) > 0 ? Number(defaultHourlyRateStr) : null;
  const [categoryRatesJson] = useSetting("cost.categoryRates", "{}");
  const categoryRates = useMemo(() => parseCategoryRates(categoryRatesJson), [categoryRatesJson]);
  const [showClientAggregation, setShowClientAggregation] = useState(false);

  const staleCandidates = useMemo(
    () => computeStaleMasterTasks(tasks ?? [], records ?? [], staleDays, todayStr()),
    [tasks, records, staleDays]
  );

  // 区分/作業名が完全一致する、生きている作業マスタの重複候補
  const duplicateGroups = useMemo(() => findDuplicateMasterGroups(tasks ?? []), [tasks]);

  const viewingRecordsList = useMemo(() => {
    if (!viewingRecords || !records) return [];
    if ("masterId" in viewingRecords) {
      return records.filter((r) => r.masterTaskId === viewingRecords.masterId);
    }
    if ("masterIds" in viewingRecords) {
      const idSet = new Set(viewingRecords.masterIds);
      return records.filter((r) => r.masterTaskId && idSet.has(r.masterTaskId));
    }
    const existingMasterIds = new Set((tasks ?? []).map((t) => t.id));
    return records.filter(
      (r) => r.category === viewingRecords.category && r.name === viewingRecords.name && r.masterTaskId && !existingMasterIds.has(r.masterTaskId)
    );
  }, [viewingRecords, records, tasks]);

  // 宙に浮いた実績: masterTaskIdが設定されているのに、そのIDの作業マスタが
  // (削除等で)もう存在しない実績を、区分/作業名でグループ化する
  const orphanedGroups = useMemo(() => {
    if (!tasks || !records) return [];
    const existingMasterIds = new Set(tasks.map((t) => t.id));
    const orphaned = records.filter((r) => r.masterTaskId && !existingMasterIds.has(r.masterTaskId) && !r.excludedFromStats);
    const map = new Map<string, { category: string; name: string; records: WorkRecord[] }>();
    for (const r of orphaned) {
      const key = `${r.category}::${r.name}`;
      if (!map.has(key)) map.set(key, { category: r.category, name: r.name, records: [] });
      map.get(key)!.records.push(r);
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        totalSeconds: g.records.reduce((sum, r) => sum + r.seconds, 0),
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }, [tasks, records]);

  function openRecordsFor(t: MasterTask) {
    setViewingRecords({ title: `${t.category} / ${t.name}`, masterId: t.id });
  }

  async function recoverOrphanGroup(category: string, name: string) {
    const id = uid();
    const recovered = await recoverOrphanedMasterHistory(id, category, name);
    if (!recovered) return;
    const now = Date.now();
    await db.masterTasks.add({
      id,
      category,
      name,
      estimatedSeconds: recovered.estimatedSeconds,
      isFavorite: false,
      sampleCount: recovered.sampleCount,
      createdAt: now,
      updatedAt: now,
    });
  }

  const grouped = useMemo(() => {
    if (!tasks) return [];
    const filtered = tasks.filter((t) => {
      if (!showArchived && t.archived) return false;
      if (showArchived && !t.archived) return false;
      if (showFavoritesOnly && !t.isFavorite) return false;
      if (search.trim() === "") return true;
      return t.category.includes(search) || t.name.includes(search);
    });
    const map = new Map<string, MasterTask[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    const sortItems = (items: MasterTask[]) => {
      if (sortKey === "name") {
        return items.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      }
      return items.sort((a, b) => b[sortKey] - a[sortKey] || a.name.localeCompare(b.name, "ja"));
    };
    const sum = (items: MasterTask[], key: "sampleCount" | "estimatedSeconds") =>
      items.reduce((s, t) => s + t[key], 0);

    return [...map.entries()]
      .sort((a, b) => {
        if (sortKey === "name") return a[0].localeCompare(b[0], "ja");
        return sum(b[1], sortKey) - sum(a[1], sortKey) || a[0].localeCompare(b[0], "ja");
      })
      .map(([category, items]) => ({
        category,
        items: sortItems(items),
      }));
  }, [tasks, search, sortKey, showArchived, showFavoritesOnly]);

  // 作業マスタに設定した取引先(clientId)の括りごとに、紐づく実績(WorkRecord.masterTaskId経由)を
  // 合算する。取引先が未設定の作業マスタの実績は「未設定」としてまとめる
  const clientAggregation = useMemo(() => {
    if (!tasks || !records) return [];
    const clientIdByMaster = new Map(tasks.map((t) => [t.id, t.clientId]));
    const map = new Map<string, { seconds: number; recordCount: number; taskIds: Set<string>; cost: number; hasRate: boolean }>();
    for (const r of records) {
      if (r.excludedFromStats || !r.masterTaskId) continue;
      const clientId = clientIdByMaster.get(r.masterTaskId) ?? "__none__";
      if (!map.has(clientId)) map.set(clientId, { seconds: 0, recordCount: 0, taskIds: new Set(), cost: 0, hasRate: false });
      const bucket = map.get(clientId)!;
      bucket.seconds += r.seconds;
      bucket.recordCount += 1;
      bucket.taskIds.add(r.masterTaskId);
      const rate = resolveCategoryRate(r.category, categoryRates, defaultHourlyRate);
      if (rate !== null) {
        bucket.cost += computeCost(r.seconds, rate);
        bucket.hasRate = true;
      }
    }
    const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
    return [...map.entries()]
      .map(([clientId, v]) => ({
        clientId,
        clientName: clientId === "__none__" ? "（取引先未設定）" : clientNameById.get(clientId) ?? "（削除済みの取引先）",
        seconds: v.seconds,
        recordCount: v.recordCount,
        taskCount: v.taskIds.size,
        masterIds: [...v.taskIds],
        cost: v.hasRate ? v.cost : null,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [tasks, records, clients, categoryRates, defaultHourlyRate]);

  async function toggleFavorite(t: MasterTask) {
    await db.masterTasks.update(t.id, { isFavorite: !t.isFavorite });
  }

  async function archiveTask(t: MasterTask) {
    await db.masterTasks.update(t.id, { archived: true });
  }

  async function unarchiveTask(t: MasterTask) {
    await db.masterTasks.update(t.id, { archived: false });
  }

  async function updateTags(t: MasterTask, tagsStr: string) {
    const tags = tagsStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await db.masterTasks.update(t.id, { tags: tags.length > 0 ? tags : undefined });
  }

  async function updateClient(t: MasterTask, clientId: string) {
    await db.masterTasks.update(t.id, { clientId: clientId || undefined });
  }

  async function updateEstimate(t: MasterTask, hms: string) {
    await db.masterTasks.update(t.id, { estimatedSeconds: parseHmsToSeconds(hms), updatedAt: Date.now() });
  }

  async function deleteTask(t: MasterTask) {
    await db.masterTasks.delete(t.id);
    showUndoToast(`「${t.category} / ${t.name}」をマスタから削除しました`, async () => {
      await db.masterTasks.add(t);
    });
  }

  async function insertNewMaster(category: string, name: string) {
    const now = Date.now();
    const id = uid();
    // 誤って削除したマスタの実績が同じ区分/作業名で宙に浮いている場合、そちらを新IDへ
    // 繋ぎ直した上でその平均・件数を優先する(見つからなければ入力欄の想定時間を使う)
    const recovered = await recoverOrphanedMasterHistory(id, category, name);
    await db.masterTasks.add({
      id,
      category,
      name,
      estimatedSeconds: recovered ? recovered.estimatedSeconds : parseHmsToSeconds(newEstimate),
      isFavorite: false,
      sampleCount: recovered ? recovered.sampleCount : 0,
      createdAt: now,
      updatedAt: now,
    });
    setNewCategory("");
    setNewName("");
    setNewEstimate("00:10:00");
    setShowNew(false);
    setDuplicateWarning(null);
  }

  async function createNew() {
    const category = newCategory.trim();
    const name = newName.trim();
    if (!category || !name) return;
    // 同じ区分/作業名の生きているマスタが既にある場合、黙って重複を増やさず先に警告する。
    // 気付かず複数回登録すると、実績・想定時間がマスタごとにバラバラに積まれてしまうため
    const existing = (tasks ?? []).find((t) => t.category === category && t.name === name);
    if (existing) {
      setDuplicateWarning(existing);
      return;
    }
    await insertNewMaster(category, name);
  }

  async function createAnyway() {
    const category = newCategory.trim();
    const name = newName.trim();
    if (!category || !name) return;
    await insertNewMaster(category, name);
  }

  function toggleMergeSelect(id: string) {
    setMergeSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 完全一致で見つかった重複の組は、迷う余地が無いので確認モーダルを挟まず即座に統合する
  // (実績が最も多いものを残す。他の一覧操作(アーカイブする等)と同じ一手扱い)
  async function mergeDuplicateGroup(group: { tasks: MasterTask[] }) {
    const sorted = [...group.tasks].sort((a, b) => b.sampleCount - a.sampleCount || a.createdAt - b.createdAt);
    const [target, ...rest] = sorted;
    const { movedRecords } = await mergeMasterTasks(
      target.id,
      rest.map((t) => t.id)
    );
    setMergeStatus(`「${target.category} / ${target.name}」に${rest.length}件を統合し、実績${movedRecords}件を繋ぎ直しました。`);
  }

  async function confirmManualMerge(targetId: string) {
    if (!mergeTarget) return;
    const sourceIds = mergeTarget.ids.filter((id) => id !== targetId);
    const target = (tasks ?? []).find((t) => t.id === targetId);
    const { movedRecords } = await mergeMasterTasks(targetId, sourceIds);
    setMergeStatus(
      `「${target?.category ?? ""} / ${target?.name ?? ""}」に${sourceIds.length}件を統合し、実績${movedRecords}件を繋ぎ直しました。`
    );
    setMergeTarget(null);
    setMergeSelectedIds(new Set());
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-cream/50">並び替え:</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortKey(opt.key)}
              className={sortKey === opt.key ? "btn-pill text-xs" : "btn-pill-outline text-xs"}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {showCsvTools && (
            <>
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
            </>
          )}
          <button className="btn-pill-outline text-sm" onClick={recalcEstimates}>
            想定時間を再計算
          </button>
          <button
            className={showArchived ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            onClick={() => setShowArchived((v) => !v)}
          >
            アーカイブ済みを表示
          </button>
          <button
            className={showFavoritesOnly ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            onClick={() => setShowFavoritesOnly((v) => !v)}
          >
            ★ お気に入りのみ
          </button>
          <button className="btn-pill text-sm" onClick={() => setShowNew((v) => !v)}>
            + 新規作業を追加
          </button>
        </div>
      </div>

      {recalcStatus && <p className="text-xs text-cream/70">{recalcStatus}</p>}
      {importResult && <p className="text-xs text-cream/70">{importResult}</p>}
      {mergeStatus && <p className="text-xs text-cream/70">{mergeStatus}</p>}
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
            onChange={(e) => {
              setNewCategory(e.target.value);
              setDuplicateWarning(null);
            }}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="詳細作業名"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setDuplicateWarning(null);
            }}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <input
            placeholder="想定時間 hh:mm:ss"
            value={newEstimate}
            onChange={(e) => setNewEstimate(e.target.value)}
            className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          {duplicateWarning ? (
            <div className="space-y-2 rounded-lg border border-alert/40 bg-alert/10 p-3 text-xs">
              <p className="font-bold text-alert">
                同じ「{duplicateWarning.category} / {duplicateWarning.name}」という作業マスタが既にあります（実績{duplicateWarning.sampleCount}件・想定{formatHms(duplicateWarning.estimatedSeconds)}）。
              </p>
              <p className="text-cream/60">
                作業を始める際に自由入力や作業マスタから選べば、このマスタがそのまま使われます。ここで新規登録すると、同じ作業の記録がマスタ間で分かれたままになります。
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn-pill-outline text-xs" onClick={() => setDuplicateWarning(null)}>
                  やめる
                </button>
                <button className="btn-pill-outline text-xs" onClick={createAnyway}>
                  それでも新規登録する
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-pill text-sm" onClick={createNew}>
              追加
            </button>
          )}
        </div>
      )}

      {!showArchived && staleCandidates.length > 0 && (
        <div className="panel space-y-2 p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setCollapsed((c) => ({ ...c, __stale: !c.__stale }))}
          >
            <h3 className="font-display text-sm font-bold text-cream/80">
              使われていない作業（{staleDays}日以上未使用・{staleCandidates.length}件）
            </h3>
            <span className="shrink-0 text-cream/60">{collapsed.__stale ? "▶" : "▼"}</span>
          </button>
          {!collapsed.__stale && (
            <div className="space-y-2">
              {staleCandidates.map(({ task, lastUsedDate, daysSinceLastUse }) => (
                <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                  <div>
                    <div className="text-xs text-cream/50">{task.category}</div>
                    <div className="text-sm text-cream">{task.name}</div>
                    <div className="text-xs text-cream/40">
                      {lastUsedDate ? `最終実績 ${lastUsedDate}（${daysSinceLastUse}日前）` : `実績なし（登録から${daysSinceLastUse}日）`}
                    </div>
                  </div>
                  <button className="btn-pill-outline text-xs" onClick={() => archiveTask(task)}>
                    アーカイブする
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {orphanedGroups.length > 0 && (
        <div className="panel space-y-2 border border-alert/30 p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setOrphansCollapsed((v) => !v)}
          >
            <h3 className="font-display text-sm font-bold text-alert">
              宙に浮いた実績（作業マスタが見つからない・{orphanedGroups.length}件）
            </h3>
            <span className="shrink-0 text-cream/60">{orphansCollapsed ? "▶" : "▼"}</span>
          </button>
          {!orphansCollapsed && (
            <>
              <p className="text-xs text-cream/50">
                作業マスタを削除した後などに、どのマスタにも属さなくなった実績です。実績データ自体は失われていません。「復元する」でこの区分/作業名の作業マスタを作り直し、これらの実績を紐づけ直せます。
              </p>
              <div className="space-y-2">
                {orphanedGroups.map((g) => (
                  <div key={`${g.category}::${g.name}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                    <div>
                      <div className="text-xs text-cream/50">{g.category}</div>
                      <div className="text-sm text-cream">{g.name}</div>
                      <button
                        className="text-xs text-cream/40 underline decoration-dotted hover:text-cream/70"
                        onClick={() => setViewingRecords({ title: `${g.category} / ${g.name}`, category: g.category, name: g.name })}
                      >
                        実績 {g.records.length}件・計 {formatHms(g.totalSeconds)}
                      </button>
                    </div>
                    <button className="btn-pill-outline text-xs" onClick={() => recoverOrphanGroup(g.category, g.name)}>
                      作業マスタとして復元する
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {duplicateGroups.length > 0 && (
        <div className="panel space-y-2 border border-alert/30 p-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setDuplicatesCollapsed((v) => !v)}
          >
            <h3 className="font-display text-sm font-bold text-alert">
              重複している可能性がある作業マスタ（{duplicateGroups.length}件）
            </h3>
            <span className="shrink-0 text-cream/60">{duplicatesCollapsed ? "▶" : "▼"}</span>
          </button>
          {!duplicatesCollapsed && (
            <>
              <p className="text-xs text-cream/50">
                区分・作業名が完全に一致する作業マスタが複数あります。「作業マスタ」タブの新規登録に重複チェックが無かった頃に、同じ作業を何度か登録すると実績が別々のマスタに分かれてしまいます。「統合する」で実績の多い方へまとめ、実績・本日以降の作業を繋ぎ直します。
              </p>
              <div className="space-y-2">
                {duplicateGroups.map((g) => (
                  <div key={`${g.category}::${g.name}`} className="rounded-lg bg-ink/50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs text-cream/50">{g.category}</div>
                        <div className="text-sm text-cream">{g.name}</div>
                      </div>
                      <button className="btn-pill-outline text-xs" onClick={() => mergeDuplicateGroup(g)}>
                        統合する（{g.tasks.length}件 → 1件）
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-cream/40">
                      {g.tasks.map((t) => (
                        <span key={t.id}>
                          実績{t.sampleCount}件・想定{formatHms(t.estimatedSeconds)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel p-4">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowClientAggregation((v) => !v)}
        >
          <h3 className="font-display text-base font-bold">
            🏢 取引先別集計 <span className="text-xs font-normal text-cream/50">({clientAggregation.length})</span>
          </h3>
          <span className="text-cream/60">{showClientAggregation ? "▼" : "▶"}</span>
        </button>
        <p className="mt-1 text-[11px] text-cream/40">
          作業マスタごとに設定した取引先の括りで、実績(作業時間)を合算します。作業マスタの一覧で各作業の「取引先未設定」欄から設定してください。
        </p>
        {showClientAggregation && (
          <div className="mt-3 space-y-1.5">
            {clientAggregation.length === 0 && <p className="text-xs text-cream/50">集計対象の実績がありません。</p>}
            {clientAggregation.map((c) => (
              <button
                key={c.clientId}
                type="button"
                onClick={() => setViewingRecords({ title: `${c.clientName} の実績`, masterIds: c.masterIds })}
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2 text-left hover:bg-ink/70"
              >
                <div className="text-sm text-cream">{c.clientName}</div>
                <div className="flex items-center gap-3 text-xs text-cream/60">
                  <span>
                    作業マスタ <span className="font-bold tabular-nums text-cream">{c.taskCount}</span>件
                  </span>
                  <span>
                    実績 <span className="font-bold tabular-nums text-cream">{c.recordCount}</span>件
                  </span>
                  <span>
                    合計 <span className="font-bold tabular-nums text-cream">{formatHms(c.seconds)}</span>
                  </span>
                  {c.cost !== null && (
                    <span>
                      概算 <span className="font-bold tabular-nums text-cream">{formatYen(c.cost)}</span>
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {mergeSelectedIds.size > 0 && (
        <div className="panel sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 border border-alert/30 p-3">
          <p className="text-xs text-cream/70">
            統合の対象として<span className="font-bold text-cream">{mergeSelectedIds.size}件</span>を選択中（一覧の☑から選べます）
          </p>
          <div className="flex gap-2">
            <button className="btn-pill-outline text-xs" onClick={() => setMergeSelectedIds(new Set())}>
              選択を解除
            </button>
            <button
              className="btn-pill text-xs"
              disabled={mergeSelectedIds.size < 2}
              onClick={() => setMergeTarget({ ids: [...mergeSelectedIds] })}
            >
              統合する
            </button>
          </div>
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
          {!collapsed[category] &&
            (adventurerMode ? (
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((t) => (
                  <MonsterCard
                    key={t.id}
                    task={t}
                    mergeSelected={mergeSelectedIds.has(t.id)}
                    onToggleMergeSelect={() => toggleMergeSelect(t.id)}
                    onToggleFavorite={() => toggleFavorite(t)}
                    onUpdateTags={(v) => updateTags(t, v)}
                    onUpdateEstimate={(v) => updateEstimate(t, v)}
                    onArchive={() => archiveTask(t)}
                    onUnarchive={() => unarchiveTask(t)}
                    onDelete={() => deleteTask(t)}
                    onViewRecords={() => openRecordsFor(t)}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {items.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={mergeSelectedIds.has(t.id)}
                        onChange={() => toggleMergeSelect(t.id)}
                        aria-label="統合の対象として選択"
                        title="統合の対象として選択"
                      />
                      <button onClick={() => toggleFavorite(t)} aria-label="お気に入り">
                        {t.isFavorite ? "★" : "☆"}
                      </button>
                      <div>
                        <div className="text-sm text-cream">{t.name}</div>
                        <button
                          className="text-xs text-cream/50 underline decoration-dotted hover:text-cream/80"
                          onClick={() => openRecordsFor(t)}
                        >
                          実績サンプル数 {t.sampleCount}
                        </button>
                        <input
                          key={`tags-${(t.tags ?? []).join(",")}`}
                          defaultValue={(t.tags ?? []).join(", ")}
                          placeholder="タグ（カンマ区切り）"
                          onBlur={(e) => updateTags(t, e.target.value)}
                          className="mt-1 w-40 rounded-md border border-cream/10 bg-transparent px-2 py-0.5 text-[11px] text-cream/70"
                        />
                        <select
                          value={t.clientId ?? ""}
                          onChange={(e) => updateClient(t, e.target.value)}
                          className="mt-1 ml-1 rounded-md border border-cream/10 bg-transparent px-1 py-0.5 text-[11px] text-cream/70"
                          title="取引先の括り（集計に使えます）"
                        >
                          <option value="">取引先未設定</option>
                          {(clients ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              🏢 {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        key={`estimate-${t.estimatedSeconds}`}
                        defaultValue={formatHms(t.estimatedSeconds)}
                        onBlur={(e) => updateEstimate(t, e.target.value)}
                        className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-center text-xs text-cream tabular-nums"
                      />
                      {t.archived ? (
                        <button className="text-xs text-cream/60 hover:text-cream" onClick={() => unarchiveTask(t)}>
                          アーカイブ解除
                        </button>
                      ) : (
                        <button className="text-xs text-cream/60 hover:text-cream" onClick={() => archiveTask(t)}>
                          アーカイブ
                        </button>
                      )}
                      <button className="text-xs text-alert" onClick={() => deleteTask(t)}>
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </div>
      ))}

      {grouped.length === 0 && (
        <p className="text-sm text-cream/50">
          作業マスタはまだ空です。実際の作業を記録すると自動的に登録されます。
        </p>
      )}

      {viewingRecords && (
        <Modal title={viewingRecords.title} onClose={() => setViewingRecords(null)}>
          {viewingRecordsList.length === 0 ? (
            <p className="text-sm text-cream/50">実績がありません。</p>
          ) : (
            <div className="space-y-1.5">
              {[...viewingRecordsList]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((r) => (
                  <div key={r.id} className="rounded-lg bg-ink/50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-cream/80">
                        {r.date}
                        {viewingRecords && "masterIds" in viewingRecords && (
                          <span className="ml-2 text-xs text-cream/50">
                            {r.category} / {r.name}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-cream">{formatHms(r.seconds)}</span>
                        {r.isTrouble && <span className="text-xs text-alert">トラブル対応</span>}
                      </div>
                    </div>
                    {r.note && <p className="mt-1 whitespace-pre-line text-xs text-cream/60">💬 {r.note}</p>}
                    {r.excludedFromStats && (
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="text-xs text-cream/40">
                          集計から除外中{r.excludeReason === "manual" ? "(手動)" : "(外れ値)"}
                        </span>
                        <button
                          className="text-xs text-cream/60 underline hover:text-cream"
                          onClick={() => clearManualOverride(r.id)}
                        >
                          集計に復活させる
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              <p className="pt-1 text-xs text-cream/40">
                合計 {formatHms(viewingRecordsList.reduce((sum, r) => sum + r.seconds, 0))}（{viewingRecordsList.length}件）
              </p>
            </div>
          )}
        </Modal>
      )}

      {mergeTarget && (
        <MergeConfirmModal
          tasks={(tasks ?? []).filter((t) => mergeTarget.ids.includes(t.id))}
          onConfirm={confirmManualMerge}
          onClose={() => setMergeTarget(null)}
        />
      )}
    </div>
  );
}

// 統合の対象として選んだ複数の作業マスタのうち、どれを残すかを選ばせる確認モーダル。
// 残す1件以外(source)は、実績・本日以降の作業がその1件へ繋ぎ直された上で削除される
function MergeConfirmModal({
  tasks,
  onConfirm,
  onClose,
}: {
  tasks: MasterTask[];
  onConfirm: (targetId: string) => void;
  onClose: () => void;
}) {
  // 既定では実績が最も多いものを残す候補にしておく(手作業で選び直せる)
  const defaultTargetId = useMemo(
    () => [...tasks].sort((a, b) => b.sampleCount - a.sampleCount || a.createdAt - b.createdAt)[0]?.id ?? "",
    [tasks]
  );
  const [targetId, setTargetId] = useState(defaultTargetId);
  const totalRecords = tasks.reduce((sum, t) => sum + t.sampleCount, 0);

  return (
    <Modal title="作業マスタを統合" onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <p className="text-xs text-cream/50">
          残すマスタを1つ選んでください。他のマスタに紐づく実績・本日以降の作業はすべて選んだマスタへ繋ぎ直され、他のマスタ自体は削除されます（実績は失われません。合計{totalRecords}件が1つのマスタにまとまります）。
        </p>
        <div className="space-y-1.5">
          {tasks.map((t) => (
            <label
              key={t.id}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                targetId === t.id ? "border-alert bg-alert/10" : "border-cream/10 bg-ink/50"
              }`}
            >
              <span className="flex items-center gap-2">
                <input type="radio" name="merge-target" checked={targetId === t.id} onChange={() => setTargetId(t.id)} />
                <span>
                  <span className="block text-xs text-cream/50">{t.category}</span>
                  <span className="text-sm text-cream">{t.name}</span>
                </span>
              </span>
              <span className="text-xs text-cream/50">
                実績{t.sampleCount}件・想定{formatHms(t.estimatedSeconds)}
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill text-sm" disabled={!targetId} onClick={() => onConfirm(targetId)}>
            このマスタに統合する
          </button>
        </div>
      </div>
    </Modal>
  );
}

// モンスター図鑑の1体分の図鑑カード。作業マスタ(=遭遇するモンスター)を、行ではなく
// 図鑑エントリのカードとして見せる。編集操作(タグ・想定時間・アーカイブ・削除)は
// 通常表示と同じものをそのままカードの中に収めており、機能面での欠落は無い
const MONSTER_ICONS = ["🐲", "👹", "🦑", "🦂", "🐺", "🦇", "🐍", "🦉", "🕷️", "🐉", "👻", "🦖"];
function monsterIconFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return MONSTER_ICONS[hash % MONSTER_ICONS.length];
}

function MonsterCard({
  task,
  mergeSelected,
  onToggleMergeSelect,
  onToggleFavorite,
  onUpdateTags,
  onUpdateEstimate,
  onArchive,
  onUnarchive,
  onDelete,
  onViewRecords,
}: {
  task: MasterTask;
  mergeSelected: boolean;
  onToggleMergeSelect: () => void;
  onToggleFavorite: () => void;
  onUpdateTags: (value: string) => void;
  onUpdateEstimate: (value: string) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onViewRecords: () => void;
}) {
  return (
    <div className={`adv-quest-card flex flex-col gap-2 p-3 ${task.archived ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={mergeSelected}
            onChange={onToggleMergeSelect}
            aria-label="統合の対象として選択"
            title="統合の対象として選択"
          />
          <span className="text-2xl">{monsterIconFor(task.id)}</span>
        </div>
        <button onClick={onToggleFavorite} aria-label="契約モンスターにする" className="text-lg leading-none">
          {task.isFavorite ? "★" : "☆"}
        </button>
      </div>
      <div>
        <div className="truncate text-sm font-bold text-cream">{task.name}</div>
        <button className="text-[10px] text-cream/50 underline decoration-dotted hover:text-cream/80" onClick={onViewRecords}>
          遭遇回数 {task.sampleCount}回
        </button>
      </div>
      <input
        key={`estimate-${task.estimatedSeconds}`}
        defaultValue={formatHms(task.estimatedSeconds)}
        onBlur={(e) => onUpdateEstimate(e.target.value)}
        title="討伐目安"
        className="w-full rounded-md border border-cream/20 bg-ink/30 px-2 py-1 text-center text-xs text-cream tabular-nums"
      />
      <input
        key={`tags-${(task.tags ?? []).join(",")}`}
        defaultValue={(task.tags ?? []).join(", ")}
        placeholder="特性（カンマ区切り）"
        onBlur={(e) => onUpdateTags(e.target.value)}
        className="w-full rounded-md border border-cream/10 bg-transparent px-2 py-1 text-[11px] text-cream/70"
      />
      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px]">
        {task.archived ? (
          <button className="text-cream/60 hover:text-cream" onClick={onUnarchive}>
            図鑑に戻す
          </button>
        ) : (
          <button className="text-cream/60 hover:text-cream" onClick={onArchive}>
            封印する
          </button>
        )}
        <button className="text-alert" onClick={onDelete}>
          削除
        </button>
      </div>
    </div>
  );
}
