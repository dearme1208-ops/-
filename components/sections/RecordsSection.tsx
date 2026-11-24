"use client";

import { isTrashItemGone, TRASH_ALREADY_RESTORED_MESSAGE } from "@/lib/trash";
import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useWorkContext } from "@/lib/useWorkContext";
import { db, uid } from "@/lib/db";
import { useHomeFilteredRecords } from "@/lib/homeMode";
import {
  recomputeEstimateFromRecords,
  bulkFindOrCreateMasterTasks,
  recomputeEstimatesForMasterTasks,
  renameMasterTask,
  undoRenameMasterTask,
  mergeMasterTasks,
} from "@/lib/master";
import { deleteRecordToTrash, relinkRecordToMaster, undoDeleteRecord } from "@/lib/records";
import { setManualOverride, clearManualOverride } from "@/lib/outliers";
import { recordsToCsv, parseRecordsCsv, readTextFile, planRecordsImport, type RecordsImportPlan } from "@/lib/csv";
import { JOURNAL_KEY_PREFIX, journalEntriesFromSettings, journalEntriesToCsv } from "@/lib/journal";
import { collectMethodSuggestions } from "@/lib/method";
import { REFLECTION_KEY_PREFIX, reflectionEntriesFromSettings } from "@/lib/reflection";
import { CONDITION_LEVELS } from "@/lib/condition";
import { downloadTextFile } from "@/lib/report";
import { useSetting } from "@/lib/settings";
import {
  addManualRecord,
  findLinkedDoneTasks,
  moveRecordToDate,
  syncDailyTaskBoundaryFromRecord,
  syncDailyTaskSecondsFromRecord,
  undoMoveRecordToDate,
} from "@/lib/tasks";
import { recordSpanAsTask } from "@/lib/quickStamp";
import { formatClock, formatDateJp, formatHms, parseHmsToSeconds, shiftDateStr, todayStr } from "@/lib/time";
import { showUndoToast } from "@/lib/toast";
import type { MasterTask, WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";
import CategoryWorkNameDialog from "@/components/sections/CategoryWorkNameDialog";
import DayReplayModal from "@/components/DayReplayModal";
import { ConditionHeatmapPanel, WeekBlocks } from "@/components/viz/TodayViz";
import WeekForest from "@/components/viz/WeekForest";
import { IconLabel } from "@/components/ui/Icon";
import EmptyArt from "@/components/ui/EmptyArt";
import { useToday } from "@/lib/useToday";

// 時刻入力(HH:MM)の変更を、元のタイムスタンプの日付部分は保ったまま時刻だけ差し替える。
// 日をまたいだ実績(例: 23:42開始〜翌7:02終了)でも、開始・終了それぞれの本来の日付がずれないようにする
function withNewTime(epochMs: number, timeStr: string): number {
  const [hh, mm] = timeStr.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return epochMs;
  const d = new Date(epochMs);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

export default function RecordsSection() {
  const workCtx = useWorkContext();
  const today = useToday();
  const [search, setSearch] = useState("");
  // 外れ値・手動除外として集計から除外されている実績だけを絞り込んで見られるようにする
  const [showExcludedOnly, setShowExcludedOnly] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importStatus, setImportStatus] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [masterEditMode] = useSetting("records.masterEditMode", "relink");
  const [showCsvToolsStr] = useSetting("csvTools.records", "true");
  const showCsvTools = showCsvToolsStr === "true";
  // 本日の作業タブの「簡易表示（アイコンのみ）」設定を、「+ 実績を追加」ボタンでも共有する
  const [simpleButtonsStr] = useSetting("today.simpleButtons", "false");
  const simpleButtons = simpleButtonsStr === "true";
  // パソコンを閉じていた等で計測できず、後日まとめて過去の実績を手入力したい場合に使う
  const [showAddRecord, setShowAddRecord] = useState(false);
  // 選んだ1日をタイムラプス風に再生するモーダルの対象日(nullなら非表示)
  const [replayDate, setReplayDate] = useState<string | null>(null);
  const [replayPickerDate, setReplayPickerDate] = useState("");
  // CSVの取り込み・書き出しボタンを出すか(ふだんは畳む)
  const [csvMenuOpen, setCsvMenuOpen] = useState(false);
  // CSV取り込みの確認(新規・更新の件数を見せてから書き込む)
  const [pendingImport, setPendingImport] = useState<{ plan: RecordsImportPlan; errors: string[] } | null>(null);

  const recordsRaw = useLiveQuery(() => db.records.orderBy("date").reverse().toArray(), []);
  const records = useHomeFilteredRecords(recordsRaw);
  const methodSuggestions = useMemo(() => collectMethodSuggestions(records ?? []), [records]);

  // 「今日の記録」(本日タブの自由記述欄)を日付ごとに見返せる履歴パネル。
  // デフォルトは折りたたみ(件数が増えると場所を取るため)、開閉状態は設定に永続化する
  const allSettings = useLiveQuery(() => db.settings.toArray(), []);
  const journalEntries = useMemo(() => journalEntriesFromSettings(allSettings ?? []), [allSettings]);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalCollapsedStr, setJournalCollapsedStr] = useSetting("records.journalCollapsed", "true");
  const journalCollapsed = journalCollapsedStr === "true";
  const filteredJournal = useMemo(() => {
    if (!journalSearch.trim()) return journalEntries;
    return journalEntries.filter((e) => e.date.includes(journalSearch) || e.text.includes(journalSearch));
  }, [journalEntries, journalSearch]);

  // 設定テーブルの1行(日記・振り返り)を消し、「元に戻す」を出す。確認の画面は挟まない
  // (押し間違えても戻せるので、毎回の確認は要らない)。
  // 戻す時は、その日の行がまだ無い時だけ元の内容を入れる。消した後に本日タブで同じ日の記録を
  // 書き直していたら、古い内容で上書きせずそのままにする(履歴からは後になってからでも戻せるため)
  async function deleteSettingRowWithUndo(key: string, deletedMessage: string, keptMessage: string) {
    const prev = await db.settings.get(key);
    if (!prev) return;
    await db.settings.delete(key);
    showUndoToast(deletedMessage, async () => {
      const restored = await db.transaction("rw", db.settings, async () => {
        if (await db.settings.get(key)) return false;
        await db.settings.add(prev);
        return true;
      });
      if (!restored) showUndoToast(keptMessage);
    });
  }

  async function deleteJournalEntry(date: string) {
    await deleteSettingRowWithUndo(
      `${JOURNAL_KEY_PREFIX}${date}`,
      `${date}の記録を削除しました`,
      `${date}の記録は書き直されているため、元に戻しませんでした`
    );
  }

  async function updateJournalText(date: string, text: string) {
    const key = `${JOURNAL_KEY_PREFIX}${date}`;
    if (text.trim() === "") {
      await db.settings.delete(key);
    } else {
      await db.settings.put({ key, value: text });
    }
  }

  function exportJournalCsv() {
    downloadTextFile(`journal_${todayStr()}.csv`, journalEntriesToCsv(journalEntries));
  }

  // 「終業の振り返り」の回答履歴。日記(journal)と同じ設定テーブルから、こちらは
  // reflection.daily.<date> のキーで取り出す
  const reflectionEntries = useMemo(() => reflectionEntriesFromSettings(allSettings ?? []), [allSettings]);
  const [reflectionCollapsedStr, setReflectionCollapsedStr] = useSetting("records.reflectionCollapsed", "true");
  const reflectionCollapsed = reflectionCollapsedStr === "true";

  async function deleteReflection(date: string) {
    await deleteSettingRowWithUndo(
      `${REFLECTION_KEY_PREFIX}${date}`,
      `${date}の振り返りを削除しました`,
      `${date}の振り返りは書き直されているため、元に戻しませんでした`
    );
  }

  const filtered = useMemo(() => {
    if (!records) return [];
    let list = records;
    if (showExcludedOnly) list = list.filter((r) => r.excludedFromStats);
    if (search.trim()) {
      list = list.filter(
        (r) =>
          r.category.includes(search) ||
          r.name.includes(search) ||
          r.date.includes(search) ||
          (workCtx.context(r) ?? "").includes(search)
      );
    }
    return list;
  }, [records, search, showExcludedOnly, workCtx]);

  const excludedCount = useMemo(() => (records ?? []).filter((r) => r.excludedFromStats).length, [records]);

  // 実績は1件ごとに日付・時刻・区分・作業名・時間の入力欄が並ぶ縦長の行になるため、
  // 全件を一度に描くと数ヶ月分でも画面が数万pxになり、目的の行まで辿り着けない。
  // 新しい順に一定件数だけ描き、必要な分だけ足していく
  const PAGE_SIZE = 50;
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  // 実績の一覧で、編集欄を開いている1件(ふだんは1行の要約だけを出す)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const visibleRecords = useMemo(() => filtered.slice(0, shownCount), [filtered, shownCount]);
  // 編集中の実績の元になった完了済みの作業の数。1件でなければ、秒数を直しても本日の作業の表示とずれる
  const editingRecord = useMemo(() => (records ?? []).find((r) => r.id === editingRecordId), [records, editingRecordId]);
  const editingLinkedCount = useLiveQuery(
    async () => (editingRecord ? (await findLinkedDoneTasks(editingRecord)).length : 0),
    [editingRecord]
  );
  // 検索・絞り込みを変えたら先頭から見せ直す
  const filterKey = `${search}::${showExcludedOnly}`;
  const lastFilterKey = useRef(filterKey);
  if (lastFilterKey.current !== filterKey) {
    lastFilterKey.current = filterKey;
    if (shownCount !== PAGE_SIZE) setShownCount(PAGE_SIZE);
  }

  // 名称・区分を変更した場合、設定に応じて紐づく作業マスタごと名前を変える(マスタ・同じマスタの実績・
  // 本日の作業・テンプレートを揃える)か、この1件だけ別のマスタ(既存 or 新規)へ繋ぎ変える。
  // 時間変更時は紐づくマスタの想定時間を再計算する
  async function updateRecord(r: WorkRecord, patch: Partial<WorkRecord>) {
    const nameChanged = patch.name !== undefined && patch.name.trim() !== r.name;
    const categoryChanged = patch.category !== undefined && patch.category.trim() !== r.category;
    const finalPatch: Partial<WorkRecord> = { ...patch };
    // 開始/終了時刻や実績時間を手動編集すると、保持していた実働区間(segments)と
    // 矛盾してしまうため破棄する(定時以降の判定はstartedAt〜endedAtの近似に戻る)
    if (r.segments && (patch.startedAt !== undefined || patch.endedAt !== undefined || patch.seconds !== undefined)) {
      finalPatch.segments = undefined;
    }

    if ((nameChanged || categoryChanged) && r.masterTaskId) {
      const newCategory = (patch.category ?? r.category).trim();
      const newName = (patch.name ?? r.name).trim();
      // 名前の欄はここで全部扱う(残りの項目だけ下で書く)
      delete finalPatch.category;
      delete finalPatch.name;
      if (!newCategory || !newName) {
        setNameInputNonce((n) => n + 1);
        return;
      }
      if (masterEditMode === "rename") {
        await renameMasterWithUndo(r.masterTaskId, { category: newCategory, name: newName });
      } else {
        // この1件だけ繋ぎ変える。元になった完了済みの本日の作業も一緒に繋ぎ変える
        await relinkRecordToMaster(r.id, newCategory, newName);
      }
      // 表記ゆれだけで変わらなかった時なども、入力欄を保存された名前に揃える
      setNameInputNonce((n) => n + 1);
      if (Object.keys(finalPatch).length === 0) return;
    }

    await db.records.update(r.id, finalPatch);

    if (patch.seconds !== undefined && r.masterTaskId) {
      await recomputeEstimateFromRecords(r.masterTaskId);
    }
  }

  // 「全部の名前を変える」設定: 作業マスタごと名前を変え、「元に戻す」を出す。
  // 同じ名前の作業が既にあれば、まとめるか尋ねる
  const [renameConflict, setRenameConflict] = useState<{ sourceId: string; target: MasterTask } | null>(null);
  async function renameMasterWithUndo(masterId: string, next: { category: string; name: string }) {
    const res = await renameMasterTask(masterId, next);
    if (res.status === "conflict") {
      setRenameConflict({ sourceId: masterId, target: res.conflictWith });
      return;
    }
    if (res.status !== "renamed") return;
    const { undo } = res;
    showUndoToast(`「${undo.before.category} / ${undo.before.name}」を「${undo.after.category} / ${undo.after.name}」に変えました`, async () => {
      if (!(await undoRenameMasterTask(undo))) showUndoToast("その後に変更があったため元に戻せませんでした");
    });
  }
  // やめた時は、入力欄を今の名前へ戻す
  const [nameInputNonce, setNameInputNonce] = useState(0);
  function cancelRenameMerge() {
    setRenameConflict(null);
    setNameInputNonce((n) => n + 1);
  }
  async function confirmRenameMerge() {
    if (!renameConflict) return;
    const { sourceId, target } = renameConflict;
    setRenameConflict(null);
    const { movedRecords } = await mergeMasterTasks(target.id, [sourceId]);
    showUndoToast(`「${target.category} / ${target.name}」にまとめました(実績${movedRecords}件)`);
  }

  // 開始・終了時刻を編集した場合、実績時間(seconds)は動かした分だけ増減させる。
  // 実績は同じ日の同じ作業を合算したもので、間が空いていることがある(9〜10時と16〜17時の2回で2時間など)。
  // 以前は「終了 − 開始」で置き換えていたため、開始を9:05に直しただけで7時間55分になっていた。
  // 元になった本日の作業があればそちらを先に直し、作業の合計が変わった分をそのまま実績に反映する
  // (作業の側が直せない時刻なら実績も直さず、実績と作業が食い違わないようにする)。
  // 戻り値: 直したか(直さなかった時は、呼び出し側が入力欄を元の時刻へ戻す)
  async function updateRecordBoundary(r: WorkRecord, edge: "start" | "end", timeStr: string): Promise<boolean> {
    const oldTime = edge === "start" ? r.startedAt : r.endedAt;
    // 入力欄から出ただけ(時刻を変えていない)なら何もしない。秒が切り捨てられて時間が変わってしまう
    if (!timeStr || timeStr === formatClock(oldTime)) return true;
    const newTime = withNewTime(oldTime, timeStr);
    if (edge === "start" ? newTime >= r.endedAt : newTime <= r.startedAt) {
      showUndoToast("開始は終了より前の時刻にしてください");
      return false;
    }
    const synced = await syncDailyTaskBoundaryFromRecord(r, edge, newTime);
    if (synced.status === "rejected") {
      showUndoToast("この時刻には直せません(元になった作業の計測した時間と合いません)。本日の作業の側で直してください");
      return false;
    }
    const deltaMs = synced.status === "synced" ? synced.deltaMs : edge === "start" ? oldTime - newTime : newTime - oldTime;
    const seconds = Math.max(0, r.seconds + Math.round(deltaMs / 1000));
    // 実績の区間(segments)は古い時刻のままになるので捨てる(定時以降の集計は開始〜終了で近似する。
    // 本日の作業の側で時刻を直した時と同じ扱い)
    await updateRecord(r, { ...(edge === "start" ? { startedAt: newTime } : { endedAt: newTime }), seconds, segments: undefined });
    return true;
  }

  // 実績時間(秒)を直す。元になった完了済みの作業がちょうど1件なら、その合計と最後の区間の終わりも
  // 同じだけ動かす(本日の作業の「完了」の表示と食い違わないように)
  async function updateRecordSeconds(r: WorkRecord, value: string) {
    const seconds = parseHmsToSeconds(value);
    if (seconds === r.seconds) return;
    const synced = await syncDailyTaskSecondsFromRecord(r, seconds);
    if (synced.status === "rejected") {
      showUndoToast("この時間には直せません(元になった作業の最後の区間より多く減らせません)。本日の作業の側で直してください");
      return;
    }
    // 実績の終了を作業の終了に揃えていた時は、実績の終了も一緒に動かす
    const endPatch =
      synced.status === "synced" && synced.previousEndedAt === r.endedAt && synced.endedAt > r.startedAt ? { endedAt: synced.endedAt } : {};
    await updateRecord(r, { seconds, ...endPatch });
  }

  // 日付を変える。移した先の日に同じ作業の実績があればそちらへ合算し、元になった完了済みの作業も
  // その日へ移す(lib/tasks.ts の moveRecordToDate)。移せない時は理由を出して変えない
  async function changeRecordDate(r: WorkRecord, newDate: string): Promise<boolean> {
    if (!newDate || newDate === r.date) return true;
    const res = await moveRecordToDate(r.id, newDate);
    if (res.status === "rejected") {
      showUndoToast(res.message);
      return false;
    }
    if (res.status === "unchanged") return true;
    const { undo } = res;
    showUndoToast(
      res.status === "merged" ? `${newDate}の同じ作業の実績へ合算しました` : `${newDate}へ移しました`,
      async () => {
        if (!(await undoMoveRecordToDate(undo))) showUndoToast("その後に変更があったため元に戻せませんでした");
      }
    );
    if (res.status === "merged") setEditingRecordId(null);
    return true;
  }

  async function deleteRecord(r: WorkRecord) {
    // 確認を挟む代わりに、すぐ消して「元に戻す」を出す(本日の作業の削除と同じ)。
    // ゴミ箱にも入れるので、「元に戻す」が消えた後でも戻せる。
    // 戻す時は「同じIDの行がもう無い時だけ足す」(その後に入った新しい内容を古い控えで上書きしない)
    const deleted = await deleteRecordToTrash(r.id);
    if (!deleted) return;
    showUndoToast(`「${workCtx.label(r)}」の実績を削除しました`, async () => {
      // ゴミ箱から既に戻していたら二重に足さない
      if (await isTrashItemGone(deleted.trashId)) return showUndoToast(TRASH_ALREADY_RESTORED_MESSAGE);
      await undoDeleteRecord(deleted);
    });
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

  // 取り込み直しで、既にあるIDの実績へはCSVにある列だけを重ねる(lib/csv.ts の planRecordsImport)。
  // 以前はbulkPutで丸ごと置き換え、CSVに無い案件・ToDo・メモ・区間などが消えていた。
  // 件数を確かめてから書き込み、書き込んだ後は「元に戻す」を出す
  async function importCsv(file: File) {
    setImportStatus("読み込み中...");
    const text = await readTextFile(file);
    const parsed = parseRecordsCsv(text);
    setImportErrors(parsed.errors);
    if (parsed.records.length === 0) {
      setImportStatus("");
      return;
    }
    const existing = await db.records.bulkGet(parsed.records.map((r) => r.id));
    const existingById = new Map(existing.filter((r): r is WorkRecord => !!r).map((r) => [r.id, r]));
    setImportStatus("");
    setPendingImport({ plan: planRecordsImport(parsed, existingById), errors: parsed.errors });
  }

  async function applyImport(plan: RecordsImportPlan) {
    setPendingImport(null);
    // 新しく作業マスタに繋ぐのは、新規の行と区分・作業名を変えた行だけ
    const needsMaster = [
      ...plan.added,
      ...plan.updated.filter((u) => u.after.category !== u.before.category || u.after.name !== u.before.name || !u.before.masterTaskId).map((u) => u.after),
    ];
    const uniquePairs = [...new Map(needsMaster.map((r) => [`${r.category}::${r.name}`, { category: r.category, name: r.name }])).values()];
    const masterMap = await bulkFindOrCreateMasterTasks(uniquePairs);
    const masterOf = (r: { category: string; name: string }) => masterMap.get(`${r.category}::${r.name}`)?.id;

    const addedRows: WorkRecord[] = plan.added.map((r) => ({ ...r, masterTaskId: masterOf(r) }));
    const planned: WorkRecord[] = plan.updated.map(({ before, after }) =>
      after.category !== before.category || after.name !== before.name || !before.masterTaskId ? { ...after, masterTaskId: masterOf(after) } : after
    );
    // 計画は確認の画面を出す前の実績から作っている。確認している間に(計測の完了での合算など)
    // 実績が変わっていたら、CSVで変わる項目だけを今の実績へ重ねる(新しい変更を古い控えで消さない)
    const sameVal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const updatedRows: WorkRecord[] = [];
    const previous: WorkRecord[] = [];
    await db.transaction("rw", db.records, async () => {
      for (let i = 0; i < plan.updated.length; i++) {
        const { before } = plan.updated[i];
        const target = planned[i];
        const cur = await db.records.get(before.id);
        if (!cur) continue; // 確認している間に消された実績は作り直さない
        let row = target;
        if (!sameVal(cur, before)) {
          const rebased = { ...cur } as unknown as Record<string, unknown>;
          const b = before as unknown as Record<string, unknown>;
          const t = target as unknown as Record<string, unknown>;
          for (const k of new Set([...Object.keys(b), ...Object.keys(t)])) {
            if (sameVal(b[k], t[k])) continue;
            if (t[k] === undefined) delete rebased[k];
            else rebased[k] = t[k];
          }
          row = rebased as unknown as WorkRecord;
        }
        updatedRows.push(row);
        previous.push(cur);
      }
      await db.records.bulkPut([...addedRows, ...updatedRows]);
    });
    const affected = new Set<string>();
    for (const r of [...addedRows, ...updatedRows, ...previous]) if (r.masterTaskId) affected.add(r.masterTaskId);
    await recomputeEstimatesForMasterTasks(affected);
    setImportStatus(`新規${addedRows.length}件・更新${updatedRows.length}件を取り込みました。`);
    showUndoToast(`実績CSVを取り込みました(新規${addedRows.length}件・更新${updatedRows.length}件)`, async () => {
      // 取り込んだ後に直した行は、古い控えで上書きしない
      const { skipped } = await db.transaction("rw", db.records, async () => {
        let skipped = 0;
        const same = async (row: WorkRecord) => JSON.stringify(await db.records.get(row.id)) === JSON.stringify(row);
        for (const row of addedRows) {
          if (await same(row)) await db.records.delete(row.id);
          else skipped++;
        }
        for (let i = 0; i < updatedRows.length; i++) {
          if (await same(updatedRows[i])) await db.records.put(previous[i]);
          else skipped++;
        }
        return { skipped };
      });
      await recomputeEstimatesForMasterTasks(affected);
      setImportStatus(skipped > 0 ? `取り込みを元に戻しました(その後に変更があった${skipped}件はそのままです)` : "取り込みを元に戻しました。");
    });
  }

  return (
    <div className="space-y-4">
      {/* 記録を振り返る図(本日の作業から移した)。いちばん上は1週間の積み木。曜日×時間帯の調子は一覧の後 */}
      <WeekBlocks today={today} />
      {/* 森モードだけ、同じ7日を木の並びでも見せる(他モードでは何も出さない) */}
      <WeekForest end={today} today={today} title="🌲 この1週間の森" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <input
            placeholder="日付・区分・作業名で検索"
            aria-label="実績を検索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-64 rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
          />
          <label className="flex items-center gap-1.5 text-xs text-cream/60">
            <input
              type="checkbox"
              checked={showExcludedOnly}
              onChange={(e) => setShowExcludedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-cream/30 bg-ink accent-cream"
            />
            除外中のみ表示（外れ値・手動除外
            {excludedCount > 0 && `：${excludedCount}件`}）
          </label>
        </div>
        {/* スマホでは1行に均等に並べる。3つが入りきらない幅では文字を詰め、横にはみ出さないようにする */}
        <div className="flex w-full gap-1.5 sm:w-auto sm:gap-2 [&>button]:min-w-0 [&>button]:whitespace-nowrap [&>button]:px-2 sm:[&>button]:px-4">
          {simpleButtons ? (
            <button
              className="btn-pill-outline px-3 py-2 text-base"
              onClick={() => setShowAddRecord(true)}
              title="実績を追加"
              aria-label="実績を追加"
            >
              ➕
            </button>
          ) : (
            <button className="btn-pill flex-1 text-xs sm:flex-none" onClick={() => setShowAddRecord(true)}>
              + 実績を追加
            </button>
          )}
          {showCsvTools && (
            <button className="btn-pill-outline flex-1 text-xs sm:flex-none" onClick={() => setCsvMenuOpen((v) => !v)} aria-expanded={csvMenuOpen}>
              📂 取り込み・書き出し {csvMenuOpen ? "▲" : "▼"}
            </button>
          )}
        </div>
      </div>
      {/* CSVの取り込み・書き出しはふだん使わないので畳んでおく(ToDoタブと同じ) */}
      {showCsvTools && csvMenuOpen && (
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-pill-outline text-xs" onClick={exportCsv}>
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
              const file = e.target.files?.[0];
              if (file) importCsv(file);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {importStatus && <p className="text-xs text-cream/70">{importStatus}</p>}
      {importErrors.length > 0 && (
        <div className="panel border border-alert/40 p-3 text-xs text-alert">
          {importErrors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      {methodSuggestions.length > 0 && (
        <datalist id="method-suggestions">
          {methodSuggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}

      <div className="panel list-rows">
        {visibleRecords.map((r) =>
          // 1件ごとに全部の入力欄を開いていると、スマホでは1件で約200px・40件で8,000px以上になっていた。
          // ふだんは1行の要約にし、押した1件だけ編集欄を開く
          editingRecordId !== r.id ? (
            <button
              key={r.id}
              onClick={() => setEditingRecordId(r.id)}
              className="list-row"
              data-testid="record-row"
              title="押すと編集できます"
            >
              <span className="w-10 shrink-0 text-xs tabular-nums text-cream/60">{formatDateJp(r.date)}</span>
              <span className="w-[6.5rem] shrink-0 text-xs tabular-nums text-cream/60">
                {formatClock(r.startedAt)}〜{formatClock(r.endedAt)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-cream">
                <span className="text-cream/50">{r.category} / </span>
                {workCtx.label(r)}
                {r.method && <span className="text-cream/45">（{r.method}）</span>}
              </span>
              {r.excludedFromStats && (
                <span className="chip shrink-0" data-tone="alert">
                  除外中
                </span>
              )}
              <span className="num shrink-0 text-sm text-cream/90">{formatHms(r.seconds)}</span>
              <span className="shrink-0 text-xs text-cream/40" aria-hidden>
                ✎
              </span>
            </button>
          ) : (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 bg-cream/5 px-4 py-3" data-testid="record-editor">
            <div className="flex flex-wrap items-center gap-2">
              <input
                key={`date-${r.date}`}
                type="date"
                defaultValue={r.date}
                onBlur={(e) => {
                  const el = e.currentTarget;
                  void changeRecordDate(r, el.value).then((ok) => {
                    if (!ok) el.value = r.date;
                  });
                }}
                className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              <div className="flex items-center gap-1 text-xs text-cream/50">
                <input
                  key={`start-${r.startedAt}`}
                  type="time"
                  defaultValue={formatClock(r.startedAt)}
                  onBlur={(e) => {
                    const el = e.currentTarget;
                    void updateRecordBoundary(r, "start", el.value).then((ok) => {
                      if (!ok) el.value = formatClock(r.startedAt);
                    });
                  }}
                  className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-cream tabular-nums"
                />
                <span>〜</span>
                <input
                  key={`end-${r.endedAt}`}
                  type="time"
                  defaultValue={formatClock(r.endedAt)}
                  onBlur={(e) => {
                    const el = e.currentTarget;
                    void updateRecordBoundary(r, "end", el.value).then((ok) => {
                      if (!ok) el.value = formatClock(r.endedAt);
                    });
                  }}
                  className="rounded-md border border-cream/20 bg-ink px-2 py-1 text-cream tabular-nums"
                />
              </div>
              <input
                key={`category-${r.category}-${nameInputNonce}`}
                defaultValue={r.category}
                onBlur={(e) => updateRecord(r, { category: e.target.value })}
                className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              {/* 案件の段階・ToDoのサブタスクから記録した実績は、作業名だけでは何のことか分からないので
                  どの案件の/どのToDoの作業かを添える(lib/workContext.ts) */}
              {workCtx.context(r) && (
                <span className="max-w-[10rem] truncate text-[10px] text-cream/50" title={workCtx.context(r)}>
                  {workCtx.context(r)} ›
                </span>
              )}
              <input
                key={`name-${r.name}-${nameInputNonce}`}
                defaultValue={r.name}
                onBlur={(e) => updateRecord(r, { name: e.target.value })}
                className="w-32 rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              <input
                key={`method-${r.method ?? ""}`}
                defaultValue={r.method ?? ""}
                onBlur={(e) => updateRecord(r, { method: e.target.value.trim() || undefined })}
                placeholder="手段"
                list="method-suggestions"
                title="手段（例: Excel、マクロ、クエリ、Claude）"
                className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-xs text-cream"
              />
              <input
                key={`seconds-${r.seconds}`}
                defaultValue={formatHms(r.seconds)}
                onBlur={(e) => updateRecordSeconds(r, e.target.value)}
                className="w-24 rounded-md border border-cream/20 bg-ink px-2 py-1 text-center text-xs text-cream tabular-nums"
              />
              {(editingLinkedCount ?? 0) > 1 && (
                <p className="caption w-full">
                  この実績は本日の作業の完了{editingLinkedCount}件を合算しています。時間を直しても「本日の作業」の表示は変わりません。
                </p>
              )}
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
              <button className="px-1 py-1 text-xs text-alert" onClick={() => deleteRecord(r)} aria-label={`実績「${r.name}」を削除`}>
                削除
              </button>
              <button className="btn-pill text-xs" onClick={() => setEditingRecordId(null)}>
                閉じる
              </button>
            </div>
          </div>
          )
        )}
        {/* 読み込み中(records未取得)は空の知らせを出さない(一瞬「ありません」が見えるのを防ぐ) */}
        {records && filtered.length === 0 && (
          // 実績一覧の枠の内側なので、空の知らせの枠は消す
          <div className="empty-state border-0">
            {records.length === 0 ? (
              <>
                <EmptyArt name="records" />
                <p>実績データがありません。</p>
              </>
            ) : (
              // 実績はあるが、検索・絞り込みに合うものが無い
              <>
                <p>条件に合う実績はありません。</p>
                <button
                  type="button"
                  className="btn-pill-outline mt-2 text-xs"
                  onClick={() => {
                    setSearch("");
                    setShowExcludedOnly(false);
                  }}
                >
                  条件をクリア
                </button>
              </>
            )}
          </div>
        )}
        {filtered.length > visibleRecords.length && (
          <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-4">
            <span className="text-xs text-cream/50 tabular-nums">
              新しい順に{visibleRecords.length}件 / 全{filtered.length}件
            </span>
            <button className="btn-pill-outline text-xs" onClick={() => setShownCount((c) => c + PAGE_SIZE)}>
              さらに{Math.min(PAGE_SIZE, filtered.length - visibleRecords.length)}件表示
            </button>
            <button className="btn-pill-outline text-xs" onClick={() => setShownCount(filtered.length)}>
              全{filtered.length}件を表示
            </button>
          </div>
        )}
        {filtered.length > 0 && filtered.length === visibleRecords.length && filtered.length > PAGE_SIZE && (
          <p className="px-4 py-3 text-center text-xs text-cream/40 tabular-nums">全{filtered.length}件を表示中</p>
        )}
      </div>

      {/* 一覧の後に、振り返り用の図・リプレイ・各履歴 */}
      <ConditionHeatmapPanel today={today} />

      <div className="panel flex flex-wrap items-center gap-2 p-4">
        <h3 className="section-title font-display">📼 一日のリプレイ</h3>
        <p className="section-sub w-full sm:w-auto sm:flex-1">
          選んだ日の実績を、朝から順にタイムラプス風に再生します。
        </p>
        <input
          type="date"
          value={replayPickerDate || records?.[0]?.date || ""}
          onChange={(e) => setReplayPickerDate(e.target.value)}
          className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <button
          className="btn-pill text-sm"
          onClick={() => setReplayDate(replayPickerDate || records?.[0]?.date || todayStr())}
        >
          📼 この日を再生
        </button>
      </div>

      <div className="panel p-4">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setJournalCollapsedStr(journalCollapsed ? "false" : "true")}
        >
          <h3 className="section-title font-display">
            <IconLabel text="📓 記録の履歴（本日タブの「今日の記録」）" />
            {journalCollapsed && <span className="ml-1 font-normal text-cream/40">（{journalEntries.length}件）</span>}
          </h3>
          <span className="text-xs text-cream/40">{journalCollapsed ? "▶" : "▼"}</span>
        </button>
        {!journalCollapsed && (
          <div className="mt-3 space-y-3">
            {journalEntries.length === 0 ? (
              // 森モードでは開いた手帳の線画を添える(文言は<p>のまま)
              <div className="empty-state">
                <EmptyArt name="records" />
                <p>まだ記録がありません。「本日の作業」タブの「今日の記録」に書くと、ここに一覧で表示されます。</p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    placeholder="日付・内容で検索"
                    value={journalSearch}
                    onChange={(e) => setJournalSearch(e.target.value)}
                    className="w-64 max-w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
                  />
                  {showCsvTools && (
                    <button className="btn-pill-outline text-xs" onClick={exportJournalCsv}>
                      記録CSVエクスポート
                    </button>
                  )}
                </div>
                <div className="divide-y divide-cream/10 rounded-lg border border-cream/10">
                  {filteredJournal.map((e) => (
                    <div key={e.date} className="space-y-1 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-cream/60 tabular-nums">{e.date}</span>
                        <button
                          className="text-xs text-alert"
                          aria-label={`${e.date}の記録を削除`}
                          onClick={() => deleteJournalEntry(e.date)}
                        >
                          削除
                        </button>
                      </div>
                      <textarea
                        key={`journal-${e.date}`}
                        defaultValue={e.text}
                        rows={2}
                        onBlur={(ev) => updateJournalText(e.date, ev.target.value)}
                        className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
                      />
                    </div>
                  ))}
                  {filteredJournal.length === 0 && <p className="px-3 py-4 text-sm text-cream/50">該当する記録がありません。</p>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="panel p-4">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setReflectionCollapsedStr(reflectionCollapsed ? "false" : "true")}
        >
          <h3 className="section-title font-display">
            🌙 終業の振り返りの履歴（本日タブの「終業の振り返り」）
            {reflectionCollapsed && <span className="ml-1 font-normal text-cream/40">（{reflectionEntries.length}件）</span>}
          </h3>
          <span className="text-xs text-cream/40">{reflectionCollapsed ? "▶" : "▼"}</span>
        </button>
        {!reflectionCollapsed && (
          <div className="mt-3 space-y-3">
            {reflectionEntries.length === 0 ? (
              <div className="empty-state">
                <EmptyArt name="records" />
                <p>まだ記録がありません。「本日の作業」タブの「終業の振り返り」に答えると、ここに一覧で表示されます。</p>
              </div>
            ) : (
              <div className="divide-y divide-cream/10 rounded-lg border border-cream/10">
                {reflectionEntries.map((e) => {
                  const c = CONDITION_LEVELS.find((c) => Number(c.level) === e.reflection.satisfaction);
                  return (
                    <div key={e.date} className="space-y-1 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-cream/60 tabular-nums">
                          {e.date}
                          {c && (
                            <span className="font-normal text-cream/50" title={c.label}>
                              {c.emoji} {c.label}
                            </span>
                          )}
                        </span>
                        <button
                          className="text-xs text-alert"
                          aria-label={`${e.date}の振り返りを削除`}
                          onClick={() => deleteReflection(e.date)}
                        >
                          削除
                        </button>
                      </div>
                      {e.reflection.bestThing && (
                        <p className="text-sm text-cream/80">👍 {e.reflection.bestThing}</p>
                      )}
                      {e.reflection.carryOver && (
                        <p className="text-sm text-cream/60">➡️ {e.reflection.carryOver}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {showAddRecord && (
        <AddRecordDialog
          onSave={async (date, category, name, startedAt, endedAt) => {
            // 今日の分は打刻と同じく完了した作業として置く(本日の作業の「完了」に並び、そこから直せる)。
            // 過去の日は実績だけを足す
            if (date === todayStr()) await recordSpanAsTask(date, category, name, startedAt, endedAt);
            else await addManualRecord(date, category, name, startedAt, endedAt);
            setShowAddRecord(false);
          }}
          onClose={() => setShowAddRecord(false)}
        />
      )}
      {pendingImport && (
        <Modal title="実績CSVの取り込み" onClose={() => setPendingImport(null)}>
          <p className="text-sm text-cream" data-testid="records-import-summary">
            新規{pendingImport.plan.added.length}件・更新{pendingImport.plan.updated.length}件
          </p>
          <p className="caption mt-1">
            既にある実績は、CSVにある列だけを書き換えます(案件・ToDo・メモなどCSVに無い項目はそのまま残ります)。
            {pendingImport.errors.length > 0 && `読めなかった行が${pendingImport.errors.length}件あります。`}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={() => setPendingImport(null)}>
              やめる
            </button>
            <button className="btn-pill text-sm" onClick={() => void applyImport(pendingImport.plan)}>
              取り込む
            </button>
          </div>
        </Modal>
      )}
      {renameConflict && (
        <Modal title="名前を変える" onClose={cancelRenameMerge}>
          <p className="text-sm text-cream">同じ名前の作業があります。まとめますか？</p>
          <p className="caption mt-1">
            「{renameConflict.target.category} / {renameConflict.target.name}」へ、実績・本日の作業・テンプレートをまとめます。
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-pill-outline text-sm" onClick={cancelRenameMerge}>
              やめる
            </button>
            <button className="btn-pill text-sm" onClick={() => void confirmRenameMerge()}>
              まとめる
            </button>
          </div>
        </Modal>
      )}
      {replayDate && <DayReplayModal date={replayDate} onClose={() => setReplayDate(null)} />}
    </div>
  );
}

// パソコンを閉じていた・呼び止められた等でその場で計測できず、後日まとめて過去の実績を
// 手入力するためのダイアログ。日付+開始/終了時刻(HH:MM)で入力し、終了が開始以前の場合は
// 日をまたいで開始したものとみなす(EditTaskDialogの時刻編集と同じ考え方)
function AddRecordDialog({
  onSave,
  onClose,
}: {
  onSave: (date: string, category: string, name: string, startedAt: number, endedAt: number) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(() => shiftDateStr(todayStr(), -1));
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [showMasterPicker, setShowMasterPicker] = useState(false);

  function toEpoch(hm: string): number | null {
    if (!hm) return null;
    const [y, mo, d] = date.split("-").map(Number);
    const [hh, mm] = hm.split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
  }

  const rawStart = toEpoch(startTime);
  const rawEnd = toEpoch(endTime);
  // 終了が開始と同じか前の時刻なら、前日から日をまたいで始まっていたとみなす
  // (例: 23:40開始〜翌0:10終了、というケースを「終了が早い」だけで弾いてしまわないため)
  const crossesMidnight = rawStart !== null && rawEnd !== null && rawStart >= rawEnd;
  const resolvedStart = crossesMidnight && rawStart !== null ? rawStart - 86400000 : rawStart;
  const durationSeconds = resolvedStart !== null && rawEnd !== null ? Math.round((rawEnd - resolvedStart) / 1000) : 0;
  const canSave = !!category.trim() && !!name.trim() && resolvedStart !== null && rawEnd !== null && durationSeconds > 0;

  function save() {
    if (!canSave || resolvedStart === null || rawEnd === null) return;
    onSave(date, category.trim(), name.trim(), resolvedStart, rawEnd);
  }

  return (
    <Modal title="実績を追加" onClose={onClose}>
      <div className="space-y-2">
        <p className="text-xs text-cream/50">
          パソコンを閉じていた・呼び止められた等でその場で計測できず、後日まとめて入力する過去の実績を追加します。
        </p>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <input
          placeholder="区分"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <input
          placeholder="詳細作業名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
        />
        <button type="button" className="btn-pill-outline text-xs" onClick={() => setShowMasterPicker(true)}>
          登録済みの作業から選ぶ
        </button>
        <div>
          <label className="mb-1 block text-xs text-cream/60">開始〜終了時刻</label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
            <span className="text-cream/50">〜</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-cream/20 bg-ink px-3 py-2 text-sm text-cream"
            />
          </div>
          {startTime && endTime && (
            <p className="mt-1 text-xs tabular-nums text-cream/60">
              {durationSeconds > 0 ? `実績時間 ${formatHms(durationSeconds)}` : "開始・終了の時刻を確認してください"}
            </p>
          )}
          {crossesMidnight && durationSeconds > 0 && (
            <p className="mt-1 text-xs text-alert">
              終了より遅い開始時刻のため、前日の{startTime}から日をまたいで始まったものとして保存します。
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-pill text-sm disabled:opacity-40" disabled={!canSave} onClick={save}>
          保存
        </button>
      </div>
      {showMasterPicker && (
        <CategoryWorkNameDialog
          title="登録済みの作業から選ぶ"
          initialMode="master"
          confirmLabel="この内容を使う"
          defaultCategory={category}
          defaultWorkName={name}
          onConfirm={(newCategory, newName) => {
            setCategory(newCategory);
            setName(newName);
            setShowMasterPicker(false);
          }}
          onClose={() => setShowMasterPicker(false)}
        />
      )}
    </Modal>
  );
}
