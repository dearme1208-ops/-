"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import {
  applyWbsImport,
  buildWbsTree,
  computeWbsDateRange,
  computeWbsEffective,
  flattenWbsTree,
  getDescendantIds,
  parseWbsCsv,
  wbsCsvTemplate,
  wbsNodesToCsv,
  type ParsedWbsResult,
  type WbsEffective,
  type WbsRow,
} from "@/lib/wbs";
import { downloadTextFile } from "@/lib/report";
import { daysBetweenDateStrs, formatDateJp, shiftDateStr, todayStr } from "@/lib/time";
import type { ProjectItem, WbsNode } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// ===== WBS(作業分解構成図)ダイアログ =====
//
// 案件1件の中身を、任意の深さの親子構造(工程→タスク→サブタスク→…)に分解して
// 管理する専用画面。左に折りたたみ可能なツリー、右にガントチャート(先行タスクの
// 依存線つき)を並べ、両方とも同じ行順・同じ行の高さで表示することで、
// どのバーがどの項目かひと目で追えるようにしてある。
//
// 行の主要な操作(並び替え・インデント・日付・進捗・先行タスク)は、ツリー本体の
// 1行を折り返し無しの固定高さに保つため、あえて別ダイアログ(WbsNodeEditDialog)に
// 逃がしてある。1行に全部詰め込むと、案件の段階編集で実際に起きた「潰れる」問題を
// 繰り返すことになるため
const ROW_H = 32;
const DEFAULT_PX_PER_DAY = 26;
const MIN_PX_PER_DAY = 3;
const MAX_PX_PER_DAY = 90;
const MIN_LABEL_SPACING_PX = 46;
const TREE_COL_W = 300;

export default function WbsDialog({ project, onClose }: { project: ProjectItem; onClose: () => void }) {
  const nodes = useLiveQuery(() => db.wbsNodes.where("projectId").equals(project.id).toArray(), [project.id]);
  const list = useMemo(() => nodes ?? [], [nodes]);
  const tree = useMemo(() => buildWbsTree(list), [list]);
  const effectiveMap = useMemo(() => computeWbsEffective(tree), [tree]);
  // ツリー本体・ガント本体は折りたたみを反映した行だけ(見えている行同士で番号・高さを揃える)。
  // 先行タスクの選択肢一覧・CSV書き出しは折りたたみに関係なく全項目を対象にする
  const visibleRows = useMemo(() => flattenWbsTree(tree, { respectCollapsed: true }), [tree]);
  const allRows = useMemo(() => flattenWbsTree(tree, { respectCollapsed: false }), [tree]);
  const codeById = useMemo(() => new Map(allRows.map((r) => [r.node.id, r.code])), [allRows]);
  const nodeById = useMemo(() => new Map(list.map((n) => [n.id, n])), [list]);
  const hasChildrenById = useMemo(() => new Map(allRows.map((r) => [r.node.id, r.hasChildren])), [allRows]);

  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string; count: number } | null>(null);
  const [importResult, setImportResult] = useState("");
  const [pendingImport, setPendingImport] = useState<ParsedWbsResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pxPerDay, setPxPerDay] = useState(DEFAULT_PX_PER_DAY);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayStr();

  const dataRange = useMemo(() => computeWbsDateRange(list), [list]);
  const { rangeStartStr, totalDays } = useMemo(() => {
    let start = dataRange?.start ?? today;
    let end = dataRange?.end ?? today;
    if (start > today) start = today;
    if (end < today) end = today;
    start = shiftDateStr(start, -2);
    end = shiftDateStr(end, 3);
    return { rangeStartStr: start, totalDays: Math.max(daysBetweenDateStrs(start, end), 1) };
  }, [dataRange, today]);
  const todayIndex = daysBetweenDateStrs(rangeStartStr, today);
  const dayMarks = Array.from({ length: totalDays + 1 }, (_, i) => i);
  const labelStepDays = Math.max(1, Math.ceil(MIN_LABEL_SPACING_PX / pxPerDay));

  function zoomIn() {
    setPxPerDay((v) => Math.min(MAX_PX_PER_DAY, +(v * 1.4).toFixed(2)));
  }
  function zoomOut() {
    setPxPerDay((v) => Math.max(MIN_PX_PER_DAY, +(v / 1.4).toFixed(2)));
  }
  function fitToView() {
    const w = scrollRef.current?.clientWidth ?? 0;
    if (w <= 0 || totalDays <= 0) return;
    setPxPerDay(Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, +((w - 24) / totalDays).toFixed(3))));
  }
  // 開いた時点で「今日」が見える位置までスクロールしておく
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, todayIndex * pxPerDay - el.clientWidth / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function barRangeFor(id: string): { left: number; width: number } | null {
    const eff = effectiveMap.get(id);
    if (!eff?.startDate) return null;
    const end = eff.endDate ?? eff.startDate;
    const a = daysBetweenDateStrs(rangeStartStr, eff.startDate);
    const b = daysBetweenDateStrs(rangeStartStr, end) + 1;
    return { left: a * pxPerDay, width: Math.max((b - a) * pxPerDay, 3) };
  }

  // ---- 構造の操作 ----
  async function addRootNode() {
    const now = Date.now();
    const order = Math.max(-1, ...list.filter((n) => !n.parentId).map((n) => n.order)) + 1;
    await db.wbsNodes.add({
      id: uid(),
      projectId: project.id,
      order,
      title: "新しい項目",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function addChild(parentId: string) {
    const now = Date.now();
    const siblings = list.filter((n) => n.parentId === parentId);
    const order = Math.max(-1, ...siblings.map((n) => n.order)) + 1;
    const parent = nodeById.get(parentId);
    if (parent?.collapsed) await db.wbsNodes.update(parentId, { collapsed: false });
    await db.wbsNodes.add({
      id: uid(),
      projectId: project.id,
      parentId,
      order,
      title: "新しい項目",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function addSiblingBelow(node: WbsNode) {
    const now = Date.now();
    const siblings = list.filter((n) => n.parentId === node.parentId);
    await db.transaction("rw", db.wbsNodes, async () => {
      for (const s of siblings) {
        if (s.order > node.order) await db.wbsNodes.update(s.id, { order: s.order + 1 });
      }
      await db.wbsNodes.add({
        id: uid(),
        projectId: project.id,
        parentId: node.parentId,
        order: node.order + 1,
        title: "新しい項目",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async function moveSibling(node: WbsNode, dir: -1 | 1) {
    const siblings = list.filter((n) => n.parentId === node.parentId).sort((a, b) => a.order - b.order);
    const i = siblings.findIndex((n) => n.id === node.id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= siblings.length) return;
    const other = siblings[j];
    await db.transaction("rw", db.wbsNodes, async () => {
      await db.wbsNodes.update(node.id, { order: other.order });
      await db.wbsNodes.update(other.id, { order: node.order });
    });
  }

  async function indentNode(node: WbsNode) {
    const siblings = list.filter((n) => n.parentId === node.parentId).sort((a, b) => a.order - b.order);
    const i = siblings.findIndex((n) => n.id === node.id);
    if (i <= 0) return; // 兄弟の先頭はインデントできない(受け皿になる前の兄弟が無い)
    const newParent = siblings[i - 1];
    const newSiblings = list.filter((n) => n.parentId === newParent.id);
    const order = Math.max(-1, ...newSiblings.map((n) => n.order)) + 1;
    await db.wbsNodes.update(node.id, { parentId: newParent.id, order, updatedAt: Date.now() });
    if (newParent.collapsed) await db.wbsNodes.update(newParent.id, { collapsed: false });
  }

  async function outdentNode(node: WbsNode) {
    if (!node.parentId) return; // 最上位はこれ以上インデント解除できない
    const parent = nodeById.get(node.parentId);
    if (!parent) return;
    const grandSiblings = list.filter((n) => n.parentId === parent.parentId);
    await db.transaction("rw", db.wbsNodes, async () => {
      for (const s of grandSiblings) {
        if (s.order > parent.order) await db.wbsNodes.update(s.id, { order: s.order + 1 });
      }
      await db.wbsNodes.update(node.id, { parentId: parent.parentId, order: parent.order + 1, updatedAt: Date.now() });
    });
  }

  function requestDelete(node: WbsNode) {
    const count = getDescendantIds(tree, node.id).size;
    setDeleteTarget({ id: node.id, title: node.title, count });
  }

  async function performDelete() {
    if (!deleteTarget) return;
    const ids = [deleteTarget.id, ...getDescendantIds(tree, deleteTarget.id)];
    await db.transaction("rw", db.wbsNodes, async () => {
      await db.wbsNodes.bulkDelete(ids);
      // 削除した項目を先行タスクとして参照していた、残る項目からその参照を外す
      const idSet = new Set(ids);
      const remaining = await db.wbsNodes.where("projectId").equals(project.id).toArray();
      for (const n of remaining) {
        if (!n.predecessorIds?.some((pid) => idSet.has(pid))) continue;
        await db.wbsNodes.update(n.id, { predecessorIds: n.predecessorIds!.filter((pid) => !idSet.has(pid)) });
      }
    });
    if (editingNodeId && ids.includes(editingNodeId)) setEditingNodeId(null);
    setDeleteTarget(null);
  }

  async function toggleCollapse(node: WbsNode) {
    await db.wbsNodes.update(node.id, { collapsed: !node.collapsed });
  }

  async function updateNode(id: string, patch: Partial<WbsNode>) {
    await db.wbsNodes.update(id, { ...patch, updatedAt: Date.now() });
  }

  async function togglePredecessor(node: WbsNode, otherId: string) {
    const cur = node.predecessorIds ?? [];
    const next = cur.includes(otherId) ? cur.filter((id) => id !== otherId) : [...cur, otherId];
    await updateNode(node.id, { predecessorIds: next });
  }

  // ---- CSV取り込み・書き出し ----
  function exportCsv() {
    downloadTextFile(`wbs_${project.title}_${todayStr()}.csv`, wbsNodesToCsv(list));
  }
  function downloadTemplate() {
    downloadTextFile("wbs_template.csv", wbsCsvTemplate());
  }
  async function pickImportFile(file: File) {
    const text = await file.text();
    setImportResult("");
    setPendingImport(parseWbsCsv(text));
  }
  async function confirmImport(mode: "replace" | "append") {
    if (!pendingImport) return;
    const { created } = await applyWbsImport(project.id, pendingImport.rows, mode);
    setImportResult(`${created}件を取り込みました。`);
    setPendingImport(null);
  }

  // ルート直下をまとめて1つの仮想ルートとみなした、案件全体の進捗率
  const overall = useMemo(() => {
    if (tree.length === 0) return null;
    let sumWeight = 0;
    let sumProgress = 0;
    for (const r of tree) {
      const eff = effectiveMap.get(r.id);
      if (!eff) continue;
      sumWeight += eff.weight;
      sumProgress += eff.progress * eff.weight;
    }
    return sumWeight > 0 ? sumProgress / sumWeight : 0;
  }, [tree, effectiveMap]);

  const editingNode = editingNodeId ? (nodeById.get(editingNodeId) ?? null) : null;

  return (
    <Modal title={`WBS: ${project.title}`} onClose={onClose} size="xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-cream/60">
            {overall !== null && (
              <span>
                全体進捗 <b className="text-cream">{Math.round(overall)}%</b>（{list.length}項目・子から自動計算）
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-pill-outline text-xs" onClick={downloadTemplate}>
              CSVテンプレート
            </button>
            <button className="btn-pill-outline text-xs" onClick={exportCsv} disabled={list.length === 0}>
              CSVエクスポート
            </button>
            <button className="btn-pill-outline text-xs" onClick={() => fileInputRef.current?.click()}>
              CSVインポート
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickImportFile(f);
                e.target.value = "";
              }}
            />
            <button className="btn-pill text-xs" onClick={addRootNode}>
              ＋ 最上位に追加
            </button>
          </div>
        </div>
        {importResult && <p className="text-xs text-cream/60">{importResult}</p>}

        {list.length === 0 ? (
          <p className="rounded-lg bg-ink/40 px-3 py-6 text-center text-sm text-cream/50">
            まだ項目がありません。「＋ 最上位に追加」で作るか、CSVテンプレートを元にWBS表を取り込んでください。
          </p>
        ) : (
          <div className="panel flex flex-col overflow-hidden p-3 lg:flex-row">
            {/* 左: ツリー(固定幅で常に折り返さない。編集・日付・先行タスクは詳細ダイアログへ)。
                画面が狭い間はガントに割ける横幅が無いため、上下に積む(lg以上で横並びにする) */}
            <div style={{ maxWidth: TREE_COL_W }} className="w-full overflow-hidden lg:shrink-0 lg:pr-2">
              <div className="mb-1 h-6 border-b border-cream/20 text-[10px] font-bold text-cream/40">項目</div>
              {visibleRows.map((row) => (
                <WbsTreeRow
                  key={row.node.id}
                  row={row}
                  effective={effectiveMap.get(row.node.id)}
                  onToggleCollapse={() => toggleCollapse(row.node)}
                  onTitleChange={(v) => updateNode(row.node.id, { title: v })}
                  onEdit={() => setEditingNodeId(row.node.id)}
                  onDelete={() => requestDelete(row.node)}
                />
              ))}
            </div>
            {/* 右: ガントチャート(横スクロール可)。行の高さ・並びは左のツリーと同じにして対応させる */}
            <div className="mt-2 min-w-0 border-t border-cream/10 pt-2 lg:mt-0 lg:flex-1 lg:border-l lg:border-t-0 lg:pl-2 lg:pt-0">
              <div className="mb-1 flex h-6 items-center justify-end gap-1 border-b border-cream/20">
                <button className="btn-pill-outline px-2 py-0.5 text-[10px]" onClick={zoomOut} aria-label="縮小">
                  －
                </button>
                <button className="btn-pill-outline px-2 py-0.5 text-[10px]" onClick={zoomIn} aria-label="拡大">
                  ＋
                </button>
                <button className="btn-pill-outline px-2 py-0.5 text-[10px]" onClick={fitToView}>
                  全体表示
                </button>
              </div>
              <div ref={scrollRef} className="overflow-x-auto">
                <div style={{ width: totalDays * pxPerDay + 24 }}>
                  <div className="relative h-5 text-[9px] text-cream/40">
                    {dayMarks
                      .filter((d) => d % labelStepDays === 0)
                      .map((d) => (
                        <div key={d} className="absolute top-0 border-l border-cream/10 pl-1" style={{ left: d * pxPerDay }}>
                          {formatDateJp(shiftDateStr(rangeStartStr, d))}
                        </div>
                      ))}
                  </div>
                  <div className="relative" style={{ height: visibleRows.length * ROW_H }}>
                    {dayMarks
                      .filter((d) => d % labelStepDays === 0)
                      .map((d) => (
                        <div key={d} className="absolute top-0 bottom-0 border-l border-cream/5" style={{ left: d * pxPerDay }} />
                      ))}
                    <div className="absolute top-0 bottom-0 border-l-2 border-alert/70" style={{ left: todayIndex * pxPerDay }} />
                    {/* 先行タスクの依存線。開始日・終了日が両方揃っている項目同士でだけ描ける */}
                    <svg
                      className="pointer-events-none absolute inset-0"
                      width={totalDays * pxPerDay}
                      height={visibleRows.length * ROW_H}
                    >
                      <defs>
                        <marker id="wbs-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                          <path d="M0,0 L6,3 L0,6 Z" fill="rgb(var(--cream-rgb) / 0.5)" />
                        </marker>
                      </defs>
                      {visibleRows.flatMap((row, idx) =>
                        (row.node.predecessorIds ?? []).map((predId) => {
                          const predIdx = visibleRows.findIndex((r) => r.node.id === predId);
                          if (predIdx === -1) return null; // 折り畳みで隠れている/削除済み
                          const predRange = barRangeFor(predId);
                          const curRange = barRangeFor(row.node.id);
                          if (!predRange || !curRange) return null;
                          const y1 = predIdx * ROW_H + ROW_H / 2;
                          const y2 = idx * ROW_H + ROW_H / 2;
                          const x1 = predRange.left + predRange.width;
                          const x2 = curRange.left;
                          // 後続の開始が先行の終了より前にある(矛盾している)場合は赤で警告する。
                          // 自動で日付をずらすことはせず、あくまで気づきとしてだけ示す
                          const conflict = x2 < x1;
                          const midX = conflict ? x1 + 10 : x1 + Math.max(6, (x2 - x1) / 2);
                          return (
                            <path
                              key={`${predId}->${row.node.id}`}
                              d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                              fill="none"
                              stroke={conflict ? "rgb(var(--accent-rgb) / 0.8)" : "rgb(var(--cream-rgb) / 0.35)"}
                              strokeWidth={1.5}
                              markerEnd="url(#wbs-arrow)"
                            />
                          );
                        })
                      )}
                    </svg>
                    {visibleRows.map((row, idx) => {
                      const range = barRangeFor(row.node.id);
                      const eff = effectiveMap.get(row.node.id);
                      const progress = eff?.progress ?? 0;
                      if (!range) return null;
                      return (
                        <div
                          key={row.node.id}
                          className={`absolute rounded ${row.hasChildren ? "border border-cream/50 bg-cream/15" : "bg-cream/70"}`}
                          style={{ left: range.left, width: range.width, top: idx * ROW_H + 7, height: ROW_H - 14 }}
                          title={`${row.node.title}（${eff?.startDate ?? "?"}〜${eff?.endDate ?? "?"}・${Math.round(progress)}%）`}
                        >
                          <div
                            className="h-full rounded bg-alert/70"
                            style={{ width: `${Math.max(progress, progress > 0 ? 6 : 0)}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <p className="text-[10px] leading-relaxed text-cream/40">
          子を持つ項目の進捗率・開始日・終了日は、常に子から自動計算した値です（保存されている値は子を持たない項目でだけ使われます）。先行タスクの矢印は日付の自動調整はせず、後続の開始が先行の終了より前になっている場合に赤で示すだけです。
        </p>
      </div>

      {editingNode && (
        <WbsNodeEditDialog
          node={editingNode}
          code={codeById.get(editingNode.id) ?? ""}
          effective={effectiveMap.get(editingNode.id)}
          hasChildren={hasChildrenById.get(editingNode.id) ?? false}
          candidatePredecessors={allRows.filter(
            (r) => r.node.id !== editingNode.id && !getDescendantIds(tree, editingNode.id).has(r.node.id)
          )}
          onAddChild={() => addChild(editingNode.id)}
          onAddSiblingBelow={() => addSiblingBelow(editingNode)}
          onMoveUp={() => moveSibling(editingNode, -1)}
          onMoveDown={() => moveSibling(editingNode, 1)}
          onIndent={() => indentNode(editingNode)}
          onOutdent={() => outdentNode(editingNode)}
          onUpdate={(patch) => updateNode(editingNode.id, patch)}
          onTogglePredecessor={(otherId) => togglePredecessor(editingNode, otherId)}
          onDelete={() => {
            setEditingNodeId(null);
            requestDelete(editingNode);
          }}
          onClose={() => setEditingNodeId(null)}
        />
      )}

      {deleteTarget && (
        <Modal title="項目を削除" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-3 text-sm text-cream/80">
            <p>
              「{deleteTarget.title}」を削除します
              {deleteTarget.count > 0 && (
                <>
                  。配下の子項目<b className="text-alert">{deleteTarget.count}件</b>も一緒に削除されます
                </>
              )}
              。この操作は元に戻せません。
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-pill-outline text-sm" onClick={() => setDeleteTarget(null)}>
                キャンセル
              </button>
              <button className="btn-pill-danger text-sm" onClick={performDelete}>
                削除する
              </button>
            </div>
          </div>
        </Modal>
      )}

      {pendingImport && (
        <Modal title="WBSを取り込む" onClose={() => setPendingImport(null)}>
          <div className="space-y-3 text-sm text-cream/80">
            <p className="text-cream">
              {pendingImport.rows.length}件の項目を読み取りました。
            </p>
            {pendingImport.errors.length > 0 && (
              <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-alert/40 bg-alert/10 p-2 text-xs text-alert">
                {pendingImport.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}
            {pendingImport.rows.length > 0 && (
              <>
                <p className="text-xs text-cream/50">
                  {list.length > 0
                    ? "この案件には既にWBS項目があります。取り込み方を選んでください。"
                    : "取り込み方を選んでください。"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {list.length > 0 && (
                    <button className="btn-pill-outline text-xs" onClick={() => confirmImport("replace")}>
                      既存を全部消して置き換える
                    </button>
                  )}
                  <button className="btn-pill text-xs" onClick={() => confirmImport("append")}>
                    {list.length > 0 ? "末尾に追記する" : "取り込む"}
                  </button>
                </div>
              </>
            )}
            <div className="flex justify-end">
              <button className="btn-pill-outline text-sm" onClick={() => setPendingImport(null)}>
                キャンセル
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// ツリー本体の1行。折り返しをせず、常に同じ高さ(ROW_H)を保つ。
// 日付・進捗・先行タスク・並び替えなどの込み入った操作は全部onEditの先(詳細ダイアログ)へ逃がしてある
function WbsTreeRow({
  row,
  effective,
  onToggleCollapse,
  onTitleChange,
  onEdit,
  onDelete,
}: {
  row: WbsRow;
  effective?: WbsEffective;
  onToggleCollapse: () => void;
  onTitleChange: (value: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const progress = Math.round(effective?.progress ?? row.node.progress ?? 0);
  return (
    <div className="flex items-center gap-1 border-b border-cream/5" style={{ height: ROW_H }}>
      <div style={{ width: row.depth * 14 }} className="shrink-0" />
      <button
        className="w-4 shrink-0 text-[10px] text-cream/40 hover:text-cream/70"
        onClick={onToggleCollapse}
        style={{ visibility: row.hasChildren ? "visible" : "hidden" }}
        aria-label={row.node.collapsed ? "子を開く" : "子を折りたたむ"}
      >
        {row.node.collapsed ? "▶" : "▼"}
      </button>
      <span className="w-10 shrink-0 truncate font-mono text-[9px] text-cream/30" title={row.code}>
        {row.code}
      </span>
      <input
        value={row.node.title}
        onChange={(e) => onTitleChange(e.target.value)}
        className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-cream focus:border-cream/30 focus:outline-none"
      />
      <span className={`w-9 shrink-0 text-right text-[10px] tabular-nums ${progress >= 100 ? "text-cream/40" : "text-cream/70"}`}>
        {progress}%
      </span>
      <button className="shrink-0 text-[11px] text-cream/40 hover:text-cream/70" onClick={onEdit} aria-label="詳細を編集">
        ✎
      </button>
      <button className="shrink-0 text-[11px] text-cream/40 hover:text-alert" onClick={onDelete} aria-label="削除">
        ✕
      </button>
    </div>
  );
}

// 1項目の詳細編集(日付・進捗・担当者・先行タスク・構造の操作)をまとめたダイアログ
function WbsNodeEditDialog({
  node,
  code,
  effective,
  hasChildren,
  candidatePredecessors,
  onAddChild,
  onAddSiblingBelow,
  onMoveUp,
  onMoveDown,
  onIndent,
  onOutdent,
  onUpdate,
  onTogglePredecessor,
  onDelete,
  onClose,
}: {
  node: WbsNode;
  code: string;
  effective?: WbsEffective;
  hasChildren: boolean;
  candidatePredecessors: WbsRow[];
  onAddChild: () => void;
  onAddSiblingBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  onUpdate: (patch: Partial<WbsNode>) => void;
  onTogglePredecessor: (otherId: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const predecessorSet = new Set(node.predecessorIds ?? []);
  return (
    <Modal title={`${code} ${node.title || "（無題）"}`} onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <label className="block">
          <span className="text-xs text-cream/50">名前</span>
          <input
            value={node.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="mt-1 w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
        </label>

        {hasChildren ? (
          <div className="rounded-lg bg-ink/40 px-3 py-2 text-xs text-cream/60">
            この項目は子を持つため、開始日・終了日・進捗率は子から自動計算されます。
            {effective?.startDate && (
              <p className="mt-1 text-cream">
                {formatDateJp(effective.startDate)} 〜 {effective.endDate ? formatDateJp(effective.endDate) : "（終了日未定）"}
                　進捗 {Math.round(effective.progress)}%
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-cream/60">
              開始日
              <input
                type="date"
                value={node.startDate ?? ""}
                onChange={(e) => onUpdate({ startDate: e.target.value || undefined })}
                className="rounded-md border border-cream/20 bg-ink px-1.5 py-1 text-xs text-cream"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-cream/60">
              終了日
              <input
                type="date"
                value={node.endDate ?? ""}
                onChange={(e) => onUpdate({ endDate: e.target.value || undefined })}
                className="rounded-md border border-cream/20 bg-ink px-1.5 py-1 text-xs text-cream"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-cream/60">
              進捗
              <input
                type="number"
                min={0}
                max={100}
                value={node.progress ?? 0}
                onChange={(e) => onUpdate({ progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                className="w-14 rounded-md border border-cream/20 bg-ink px-1.5 py-1 text-right text-xs tabular-nums text-cream"
              />
              %
            </label>
            <button className="btn-pill-outline text-xs" onClick={() => onUpdate({ progress: 100 })}>
              完了にする
            </button>
          </div>
        )}

        <label className="block">
          <span className="text-xs text-cream/50">担当者</span>
          <input
            value={node.assignee ?? ""}
            onChange={(e) => onUpdate({ assignee: e.target.value || undefined })}
            placeholder="（任意）"
            className="mt-1 w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
        </label>

        <div>
          <p className="mb-1 text-xs text-cream/50">先行タスク（この項目が始まる前に終わっているべき項目）</p>
          {candidatePredecessors.length === 0 ? (
            <p className="text-xs text-cream/40">選べる項目がありません。</p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-cream/10 p-2">
              {candidatePredecessors.map((r) => (
                <label key={r.node.id} className="flex items-center gap-2 text-xs text-cream/70">
                  <input type="checkbox" checked={predecessorSet.has(r.node.id)} onChange={() => onTogglePredecessor(r.node.id)} />
                  <span className="font-mono text-cream/40">{r.code}</span>
                  <span className="truncate">{r.node.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-cream/10 pt-3">
          <p className="mb-1.5 text-xs text-cream/50">構造の操作</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-pill-outline text-xs" onClick={onAddChild}>
              ＋ 子を追加
            </button>
            <button className="btn-pill-outline text-xs" onClick={onAddSiblingBelow}>
              ＋ 下に兄弟を追加
            </button>
            <button className="btn-pill-outline text-xs" onClick={onMoveUp}>
              ↑ 上へ
            </button>
            <button className="btn-pill-outline text-xs" onClick={onMoveDown}>
              ↓ 下へ
            </button>
            <button className="btn-pill-outline text-xs" onClick={onOutdent} disabled={!node.parentId}>
              ← インデント解除
            </button>
            <button className="btn-pill-outline text-xs" onClick={onIndent}>
              → インデント
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button className="text-xs text-alert" onClick={onDelete}>
            この項目を削除
          </button>
          <button className="btn-pill text-sm" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
