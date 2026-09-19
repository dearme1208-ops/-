import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { useVisualMode } from "./theme";
import type { MasterTask, WorkRecord } from "./types";

// 森モード中、「茂みへ隠す」タブで除外指定した作業マスタに紐づく実績を、
// 主要な集計画面(実績編集・集計/ランキング・グラフ・ヒートマップ・年表・残業分析・
// 日報週報月報)から取り除くための共通フック。各画面はdb.recordsを取得した直後に
// これへ通すだけでよく、除外ロジックをそれぞれで再実装しなくて済む
export function useHomeFilteredRecords(records: WorkRecord[] | undefined): WorkRecord[] | undefined {
  const { homeMode } = useVisualMode();
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  return useMemo(() => {
    if (!records || !homeMode) return records;
    const excludedIds = new Set((masters ?? []).filter((m) => m.excludedFromHome).map((m) => m.id));
    if (excludedIds.size === 0) return records;
    return records.filter((r) => !r.masterTaskId || !excludedIds.has(r.masterTaskId));
  }, [records, homeMode, masters]);
}

// 森モード中、「茂みへ隠す」タブで除外指定した作業マスタを、作業を追加/開始する際の
// 一覧(マスタから作業を追加のピッカー・お気に入りのクイックスタート等)から取り除く。
// 実績自体は消さない(useHomeFilteredRecords)のに対し、こちらは「これから新しく
// この作業を始める」導線からだけ隠す
export function useHomeFilteredMasterTasks<T extends MasterTask>(tasks: T[] | undefined): T[] | undefined {
  const { homeMode } = useVisualMode();
  return useMemo(() => {
    if (!tasks || !homeMode) return tasks;
    return tasks.filter((t) => !t.excludedFromHome);
  }, [tasks, homeMode]);
}
