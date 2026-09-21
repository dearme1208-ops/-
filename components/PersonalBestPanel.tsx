"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import { todayStr } from "@/lib/time";
import { buildPersonalBestDetail, computePersonalBests, computeNewBestsToday, type PersonalBest } from "@/lib/personalBests";
import { fireConfetti } from "@/lib/confetti";
import { showUndoToast } from "@/lib/toast";
import Modal from "@/components/ui/Modal";

// 平均との比較(要注意リスト等)とは逆に、これまでの実績の中で最も良かった記録を見せる。
// 過去に更新したベストはそのまま残り続け、今日それを更新した場合だけ祝う
export default function PersonalBestPanel() {
  const date = todayStr();
  const recordsRaw = useLiveQuery(() => db.records.toArray(), []);
  const records = useHomeFilteredRecords(recordsRaw);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const bests = useMemo(
    () => (records && masterTasks ? computePersonalBests(records, masterTasks, projects ?? []) : []),
    [records, masterTasks, projects]
  );
  const newTodayIds = useMemo(
    () => (records && masterTasks ? computeNewBestsToday(records, masterTasks, date, projects ?? []) : new Set<string>()),
    [records, masterTasks, date, projects]
  );

  const celebratedRef = useRef<{ date: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (bests.length === 0) return;
    if (!celebratedRef.current || celebratedRef.current.date !== date) {
      celebratedRef.current = { date, ids: new Set() };
    }
    for (const id of newTodayIds) {
      if (!celebratedRef.current.ids.has(id)) {
        celebratedRef.current.ids.add(id);
        const best = bests.find((b) => b.id === id);
        if (best) {
          fireConfetti();
          showUndoToast(`🏆 自己ベスト更新「${best.label}」`);
        }
      }
    }
  }, [bests, newTodayIds, date]);

  const [selected, setSelected] = useState<PersonalBest | null>(null);
  const detail = useMemo(
    () => (selected ? buildPersonalBestDetail(selected, records ?? [], projects ?? []) : null),
    [selected, records, projects]
  );

  if (bests.length === 0) {
    return <p className="text-sm text-cream/50">まだ自己ベストと呼べる記録がありません。実績を積み重ねていきましょう。</p>;
  }

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {bests.map((b) => {
          const isNew = newTodayIds.has(b.id);
          return (
            <button
              key={b.id}
              onClick={() => setSelected(b)}
              className={`rounded-lg border px-3 py-2 text-left transition-colors hover:border-cream/30 ${
                isNew ? "border-alert/40 bg-alert/10" : "border-cream/10 bg-ink/40"
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs text-cream/60">
                <span>{b.icon}</span>
                <span>{b.label}</span>
                {isNew && <span className="rounded-full bg-alert/20 px-1.5 py-0.5 text-[9px] font-bold text-alert">NEW</span>}
              </div>
              <p className="mt-0.5 font-display text-lg font-bold text-cream">{b.valueLabel}</p>
              <p className="text-[10px] text-cream/40">
                {b.date}
                {b.detail && ` ・ ${b.detail}`}
              </p>
            </button>
          );
        })}
      </div>

      {selected && detail && (
        <Modal title={detail.title} onClose={() => setSelected(null)}>
          {detail.intro && <p className="mb-3 text-xs text-cream/60">{detail.intro}</p>}
          {detail.rows.length === 0 ? (
            <p className="text-sm text-cream/50">{detail.emptyMessage ?? "内訳がありません。"}</p>
          ) : (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {detail.rows.map((row, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3 rounded-lg bg-ink/40 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-cream/85">{row.label}</div>
                    {row.sublabel && <div className="truncate text-xs text-cream/50">{row.sublabel}</div>}
                  </div>
                  <div className="shrink-0 tabular-nums text-cream/70">{row.value}</div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
