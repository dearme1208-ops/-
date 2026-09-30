"use client";

import { useMemo, useState } from "react";
import { db, uid } from "@/lib/db";
import {
  buildProjectFromTemplate,
  collectRetrospectives,
  plannedDurationDays,
  projectReferenceTime,
  similarCompletedProjects,
  stageReferenceTimes,
} from "@/lib/projectTemplate";
import { formatDateJp, formatHms, shiftDateStr, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { ProjectItem, WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// 案件を「型」にして、同じ種類の新しい案件を作るダイアログ(lib/projectTemplate.ts)。
// 段階の構成を引き継ぎ、同じ種類の過去の案件の実績から段階ごとの参考時間と
// 全体の見積りの初期値を出し、過去に残した振り返りも作る前に目を通せるようにする
export default function ProjectTemplateDialog({
  source,
  projects,
  records,
  onClose,
}: {
  source: ProjectItem;
  projects: ProjectItem[];
  records: WorkRecord[];
  onClose: () => void;
}) {
  const similar = useMemo(() => similarCompletedProjects(source, projects), [source, projects]);
  const stageRefs = useMemo(() => stageReferenceTimes(similar, records), [similar, records]);
  const totalRef = useMemo(() => projectReferenceTime(similar, records), [similar, records]);
  const retrospectives = useMemo(() => collectRetrospectives(similar), [similar]);
  const [title, setTitle] = useState(source.title);
  const [dueDate, setDueDate] = useState(() => shiftDateStr(todayStr(), plannedDurationDays(source)));
  const valid = title.trim() !== "" && !!dueDate;

  async function create() {
    if (!valid) return;
    const item = buildProjectFromTemplate(source, {
      title: title.trim(),
      dueDate,
      now: Date.now(),
      newId: uid,
      stageRefs,
      totalRef,
    });
    await db.projects.add(item);
    onClose();
    showUndoToast(`「${item.title}」を「${source.title}」の型から作りました`, async () => {
      await db.projects.delete(item.id);
    });
  }

  return (
    <Modal title="📐 型にして新しく作る" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-cream/60">
          「{source.title}」の段階の構成を引き継いで、同じ種類({source.category} / {source.workName})の新しい案件を作ります。進捗・期日・対応状況は引き継ぎません。
        </p>

        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-xs text-cream/60">件名</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
              aria-label="新しい案件の件名"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-cream/60">期日(元の案件と同じ期間で仮置きしています)</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-cream"
              aria-label="新しい案件の期日"
            />
          </label>
        </div>

        <div>
          <h4 className="mb-1 text-xs font-bold text-cream/70">引き継ぐ段階と参考時間</h4>
          {(source.stages ?? []).length === 0 ? (
            <p className="text-xs text-cream/50">段階はありません(案件だけを作ります)。</p>
          ) : (
            <ul className="space-y-1">
              {(source.stages ?? []).map((s) => {
                const ref = stageRefs.get(s.title);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink/60 px-3 py-1.5 text-xs">
                    <span className="truncate text-cream/85">
                      {s.title}
                      {s.targetCount != null && <span className="ml-1 text-cream/50">（目標{s.targetCount}件）</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-cream/60">
                      {ref ? `目安 ${formatHms(ref.avgSeconds)}（${ref.samples}件の平均）` : "実績なし"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-cream/60">
            {totalRef
              ? `全体の見積り: ${formatHms(totalRef.avgSeconds)}（同じ種類の完了案件${totalRef.samples}件の平均。案件の「見積もり総所要時間」に入れます）`
              : "同じ種類の完了案件に作業の実績がないため、全体の見積りは空のままにします。"}
          </p>
        </div>

        {retrospectives.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-bold text-cream/70">📝 同じ種類の案件で残した振り返り</h4>
            <ul className="space-y-1.5">
              {retrospectives.slice(0, 5).map((r) => (
                <li key={r.projectId} className="rounded-lg bg-ink/60 px-3 py-2 text-xs">
                  <div className="text-[10px] text-cream/40">
                    {r.projectTitle}（{formatDateJp(todayStr(new Date(r.completedAt)))}完了）
                  </div>
                  <div className="whitespace-pre-wrap text-cream/85">{r.text}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill text-sm" disabled={!valid} onClick={create}>
            この内容で作る
          </button>
        </div>
      </div>
    </Modal>
  );
}
