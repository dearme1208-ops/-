import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { useVisualMode } from "./theme";
import type { WorkRecord } from "./types";

// 家庭モード中、「家庭モード管理」タブで除外指定した作業マスタに紐づく実績を、
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
