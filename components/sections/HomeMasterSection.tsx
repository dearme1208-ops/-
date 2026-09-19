"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import type { MasterTask } from "@/lib/types";

// 森モード(旧・家庭モード)の「茂みへ隠す」タブ。作業マスタ本体(MasterSection)とは
// 別に置き、森モード中に「実り・累積」等の主要な集計画面(実績編集・集計/ランキング・
// グラフ・ヒートマップ・年表・残業分析・日報週報月報)から茂みの奥へ隠したい作業マスタ
// だけをチェックボックスで選べる。除外指定はMasterTask.excludedFromHomeとして保存し、
// 実際のフィルタはlib/homeMode.tsのuseHomeFilteredRecordsが各画面側でdb.recordsに適用する
export default function HomeMasterSection() {
  const tasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const [showArchived, setShowArchived] = useState(false);

  const groups = useMemo(() => {
    const list = (tasks ?? []).filter((t) => showArchived || !t.archived);
    const map = new Map<string, MasterTask[]>();
    for (const t of list) {
      const key = t.category || "未分類";
      const group = map.get(key) ?? [];
      group.push(t);
      map.set(key, group);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "ja"));
  }, [tasks, showArchived]);

  const excludedCount = (tasks ?? []).filter((t) => t.excludedFromHome).length;

  async function toggleExcluded(t: MasterTask) {
    await db.masterTasks.update(t.id, { excludedFromHome: !t.excludedFromHome });
  }

  // 大項目(カテゴリ)単位で、含まれる作業マスタ全部の除外を一括ON/OFFする。
  // 既に全件除外済みなら一括解除、そうでなければ(未除外・一部除外どちらでも)一括で除外にする
  async function setGroupExcluded(list: MasterTask[], excluded: boolean) {
    await db.transaction("rw", db.masterTasks, async () => {
      for (const t of list) {
        await db.masterTasks.update(t.id, { excludedFromHome: excluded });
      }
    });
  }

  if (!tasks) return <div className="panel p-4 text-sm text-cream/50">読み込み中…</div>;

  return (
    <div className="space-y-4">
      <div className="panel space-y-2 p-4">
        <h3 className="font-display text-base font-bold">🌲 茂みへ隠す</h3>
        <p className="text-xs text-cream/60">
          チェックを入れた作業マスタは、森モード中は実績編集・集計・ランキング・グラフ・ヒートマップ・年表・残業分析・日報週報月報から茂みの奥へ隠れます(このマスタに紐づく実績のみが対象で、マスタ自体や本日の作業は消えません)。
        </p>
        {excludedCount > 0 && <p className="text-xs text-cream/40">現在 {excludedCount}件を茂みに隠しています</p>}
        <label className="flex items-center gap-1.5 text-xs text-cream/60">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-cream/30 bg-ink accent-cream"
          />
          アーカイブ済みも表示
        </label>
      </div>

      {groups.length === 0 && (
        <p className="panel p-4 text-sm text-cream/50">作業マスタがまだ登録されていません。</p>
      )}

      {groups.map(([category, list]) => {
        const allExcluded = list.every((t) => t.excludedFromHome);
        return (
        <div key={category} className="panel space-y-1.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-cream/70">{category}</h4>
            <button className="btn-pill-outline px-2 py-0.5 text-[11px]" onClick={() => setGroupExcluded(list, !allExcluded)}>
              {allExcluded ? "まとめて出す" : "まとめて隠す"}
            </button>
          </div>
          <div className="space-y-1">
            {list.map((t) => (
              <label
                key={t.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  t.excludedFromHome ? "bg-alert/10" : "hover:bg-cream/5"
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!t.excludedFromHome}
                  onChange={() => toggleExcluded(t)}
                  className="h-4 w-4 rounded border-cream/30 bg-ink accent-alert"
                />
                <span className={t.archived ? "text-cream/40" : "text-cream/85"}>{t.name}</span>
                {t.archived && <span className="text-[10px] text-cream/30">(アーカイブ済み)</span>}
                {t.excludedFromHome && <span className="ml-auto text-[10px] text-alert">茂みの中</span>}
              </label>
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}
