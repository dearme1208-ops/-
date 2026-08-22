"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { upsertMasterTasksFromCsv, recomputeAllMasterEstimates } from "@/lib/master";
import { recomputeOutliersForAll } from "@/lib/outliers";
import { formatHms, parseHmsToSeconds, todayStr } from "@/lib/time";
import { masterTasksToCsv, masterCsvTemplate, parseMasterCsv } from "@/lib/masterCsv";
import { downloadTextFile } from "@/lib/report";
import { computeStaleMasterTasks } from "@/lib/staleMaster";
import { useSetting } from "@/lib/settings";
import { useVisualMode } from "@/lib/theme";
import type { MasterTask } from "@/lib/types";
import { showUndoToast } from "@/lib/toast";

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
  const [newCategory, setNewCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [newEstimate, setNewEstimate] = useState("00:10:00");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string>("");
  const [recalcStatus, setRecalcStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [staleDaysStr] = useSetting("master.staleDays", "90");
  const staleDays = Math.max(1, Number(staleDaysStr) || 90);

  const tasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);

  const staleCandidates = useMemo(
    () => computeStaleMasterTasks(tasks ?? [], records ?? [], staleDays, todayStr()),
    [tasks, records, staleDays]
  );

  const grouped = useMemo(() => {
    if (!tasks) return [];
    const filtered = tasks.filter((t) => {
      if (!showArchived && t.archived) return false;
      if (showArchived && !t.archived) return false;
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
  }, [tasks, search, sortKey, showArchived]);

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

  async function updateEstimate(t: MasterTask, hms: string) {
    await db.masterTasks.update(t.id, { estimatedSeconds: parseHmsToSeconds(hms), updatedAt: Date.now() });
  }

  async function deleteTask(t: MasterTask) {
    await db.masterTasks.delete(t.id);
    showUndoToast(`「${t.category} / ${t.name}」をマスタから削除しました`, async () => {
      await db.masterTasks.add(t);
    });
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
          <button
            className={showArchived ? "btn-pill text-sm" : "btn-pill-outline text-sm"}
            onClick={() => setShowArchived((v) => !v)}
          >
            アーカイブ済みを表示
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
                    onToggleFavorite={() => toggleFavorite(t)}
                    onUpdateTags={(v) => updateTags(t, v)}
                    onUpdateEstimate={(v) => updateEstimate(t, v)}
                    onArchive={() => archiveTask(t)}
                    onUnarchive={() => unarchiveTask(t)}
                    onDelete={() => deleteTask(t)}
                  />
                ))}
              </div>
            ) : (
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
                        <input
                          key={`tags-${(t.tags ?? []).join(",")}`}
                          defaultValue={(t.tags ?? []).join(", ")}
                          placeholder="タグ（カンマ区切り）"
                          onBlur={(e) => updateTags(t, e.target.value)}
                          className="mt-1 w-40 rounded-md border border-cream/10 bg-transparent px-2 py-0.5 text-[11px] text-cream/70"
                        />
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
    </div>
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
  onToggleFavorite,
  onUpdateTags,
  onUpdateEstimate,
  onArchive,
  onUnarchive,
  onDelete,
}: {
  task: MasterTask;
  onToggleFavorite: () => void;
  onUpdateTags: (value: string) => void;
  onUpdateEstimate: (value: string) => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`adv-quest-card flex flex-col gap-2 p-3 ${task.archived ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-2xl">{monsterIconFor(task.id)}</span>
        <button onClick={onToggleFavorite} aria-label="契約モンスターにする" className="text-lg leading-none">
          {task.isFavorite ? "★" : "☆"}
        </button>
      </div>
      <div>
        <div className="truncate text-sm font-bold text-cream">{task.name}</div>
        <div className="text-[10px] text-cream/50">遭遇回数 {task.sampleCount}回</div>
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
