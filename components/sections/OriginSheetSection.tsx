"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { findOrCreateMasterTask } from "@/lib/master";
import { parseBreakRanges, timeToMsOfDay } from "@/lib/breaks";
import { useSetting } from "@/lib/settings";
import { finishDailyTask } from "@/lib/tasks";
import { formatHms, shiftDateStr, todayStr } from "@/lib/time";
import {
  ORIGIN_AXIS_END_HM,
  ORIGIN_AXIS_STEP_MIN,
  ORIGIN_DEFAULT_BREAKS,
  axisRatio,
  buildOriginAxis,
  buildOriginRows,
  computeOriginEstimates,
  computeOriginTopWorks,
  formatOriginDuration,
  hmToMsOnDate,
  msToHm,
  originKey,
  roundMsToStep,
  summarizeOrigin,
  type MsRange,
  type OriginRow,
} from "@/lib/origin";
import type { DailyTask, MasterTask, TodoTask, WorkRecord } from "@/lib/types";
import Modal from "@/components/ui/Modal";

// ===== 原点モード: 工程表.xlsm の画面 =====
//
// このアプリの原型である1枚のExcelシートを、実データの上でそのまま動かすための画面。
// 元ブックの工程表シートと同じ持ち物をそのまま並べている。
//
//   C3            … 日付
//   B列 / C列     … 作業(業務区分) / 内容
//   E列 / F列     … 開始時間 / 終了時間
//   J列           … 想定時間
//   K列           … 完了フラグ(1)
//   L列〜CI列     … 08:00〜20:30 を10分刻みで並べた時間軸
//   CK列          … やることリスト
//   7行目以降     … 奇数行=予定 / 偶数行=実績 の2行ペア
//
// ボタンも元ブックのマクロと同じ3つ(作業完了 / 予定外差し込み / 予定を下に)で、
// 「作業完了」は現在時刻を10分単位に丸めて打刻したうえで
// 「予定通りの作業を実行しましたか？」を必ず聞く、というあの流れをそのまま踏襲している。
//
// そのうえで、元ブックのメモシートに本人が書き残していた不満は直してある。
// メモシートの原文と、この画面での対応は以下のとおり。
//
//   「予定時間をずらさないといけない」        → 「予定を下に」1回で以降の予定がまとめてずれる
//   「行が狭い」                              → 行の高さと目盛り幅を画面上で変えられる
//   「予定と実績の縦並びわかりにくい」        → ペアを縦線で括り、実績行に「実」の印を付けた
//   「バーがどれがどれか」「バーに文字」      → 帯の中に作業名を書き込んだ
//   「予定外の色を変える」                    → 予定内=黄 / 予定外=赤 を元ブックと同じ色番号で塗り分け
//   「時間超過を赤文字に」                    → 想定を超えた実績は赤字＋超過分を併記
//   「途中の場合何か出したい」                → 計測中の行は帯が伸び続け、現在時刻の線が走る
//   「新しい項目が出来た際に取り入れれるように」→ 作業項目ダイアログからその場で新規登録できる
//   「予定内外の合計がおかしい」              → 上部の集計は実データから毎回数え直す
//   「集計方法」                              → 想定時間は元ブックと同じ刈り込み平均で出す

const ROW_HEIGHTS: Record<string, number> = { sm: 22, md: 28, lg: 36 };
const CELL_WIDTHS: Record<string, number> = { sm: 14, md: 22, lg: 34 };

export default function OriginSheetSection({
  onOpenTodo,
}: {
  onOpenTodo?: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [startHm] = useSetting("today.standardWorkStart", "08:00");
  const [closingHm] = useSetting("today.standardWorkEnd", "17:00");
  const [breakJson] = useSetting("today.provisionalBreakRanges", "[]");
  const [roundStampStr, setRoundStampStr] = useSetting("origin.roundStamp", "true");
  const [rowSize, setRowSize] = useSetting("origin.rowSize", "md");
  const [cellSize, setCellSize] = useSetting("origin.cellSize", "md");
  const [useTrimmedStr, setUseTrimmedStr] = useSetting("origin.useTrimmedMean", "true");
  const [showTopStr, setShowTopStr] = useSetting("origin.showTop10", "true");
  // 画面が狭いと固定列だけで幅を使い切ってしまうので、B列・C列を畳んで
  // 時間軸に幅を回せるようにしておく(帯の中に作業名が入っているので読める)
  const [wideAxisStr, setWideAxisStr] = useSetting("origin.wideAxis", "false");
  const wideAxis = wideAxisStr === "true";
  const roundStamp = roundStampStr !== "false";
  const useTrimmed = useTrimmedStr !== "false";
  const showTop = showTopStr !== "false";
  const rowH = ROW_HEIGHTS[rowSize] ?? ROW_HEIGHTS.md;
  const cellW = CELL_WIDTHS[cellSize] ?? CELL_WIDTHS.md;

  const tasks = useLiveQuery(() => db.dailyTasks.where("date").equals(date).toArray(), [date]);
  const masterTasks = useLiveQuery(() => db.masterTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);

  const [finishOpen, setFinishOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailRowId, setDetailRowId] = useState<string | null>(null);

  const breaks: MsRange[] = useMemo(() => {
    const parsed = parseBreakRanges(breakJson);
    const src = parsed.length > 0 ? parsed : ORIGIN_DEFAULT_BREAKS;
    return src
      .map((r) => [timeToMsOfDay(date, r.start), timeToMsOfDay(date, r.end)] as MsRange)
      .filter(([s, e]) => e > s);
  }, [breakJson, date]);
  const usingDefaultBreaks = parseBreakRanges(breakJson).length === 0;

  const rows = useMemo(
    () => buildOriginRows(tasks ?? [], { dateStr: date, startHm, closingHm, breaks, now }),
    [tasks, date, startHm, closingHm, breaks, now]
  );
  const summary = useMemo(() => summarizeOrigin(rows), [rows]);

  // 元ブックの集計シート。結合キー(業務区分+内容)ごとの刈り込み平均を引けるようにしておく
  const estimates = useMemo(() => computeOriginEstimates(records ?? []), [records]);
  const topWorks = useMemo(() => {
    if (!showTop) return [];
    const from = shiftDateStr(date, -30);
    return computeOriginTopWorks((records ?? []).filter((r) => r.date > from && r.date <= date), 10);
  }, [records, date, showTop]);

  // 時間軸の右端。元ブックは 20:30 固定だが、そこを越えて働いた日は自動で延ばす
  const axisEndHm = useMemo(() => {
    const base = hmToMsOnDate(date, ORIGIN_AXIS_END_HM);
    let latest = base;
    for (const r of rows) {
      latest = Math.max(latest, r.planEndMs, r.actualEndMs ?? 0, r.running ? now : 0);
    }
    if (latest <= base) return ORIGIN_AXIS_END_HM;
    const step = ORIGIN_AXIS_STEP_MIN * 60_000;
    return msToHm(Math.ceil(latest / step) * step);
  }, [rows, date, now]);
  const axis = useMemo(
    () => buildOriginAxis(date, startHm, axisEndHm, ORIGIN_AXIS_STEP_MIN),
    [date, startHm, axisEndHm]
  );
  const axisWidth = (axis.ticks.length - 1) * cellW;

  const runningRow = rows.find((r) => r.running) ?? null;
  const nextPending = rows.find((r) => r.task.status === "pending") ?? null;
  const isToday = date === todayStr();

  // やることリスト(元ブックの CK列)。マイデイに入っているものと、期日が来ているものを並べる
  const todoList = useMemo(() => {
    return (todos ?? [])
      .filter((t) => !t.completed && !t.parentTaskId)
      .filter((t) => t.myDayDate === date || (t.dueDate !== undefined && t.dueDate <= date))
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.order - b.order);
  }, [todos, date]);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // 今の時刻が画面の外にあると「途中」が見えないので、最初の描画で現在時刻の少し手前へ寄せる
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !scrollerRef.current || !isToday) return;
    const ratio = axisRatio(now, axis.startMs, axis.endMs);
    scrollerRef.current.scrollLeft = Math.max(0, ratio * axisWidth - 200);
    scrolledRef.current = true;
  }, [now, axis.startMs, axis.endMs, axisWidth, isToday]);

  const detailRow = rows.find((r) => r.task.id === detailRowId) ?? null;

  function estimateFor(category: string, name: string) {
    return estimates.get(originKey(category, name)) ?? null;
  }

  // ---- 元ブックのマクロにあたる操作 ----

  /** 打刻。設定がONなら元ブックと同じく10分単位へ丸める */
  function stampNow(): number {
    return roundStamp ? roundMsToStep(Date.now()) : Date.now();
  }

  /**
   * 予定外差し込み(元ブック Module1.予定外差し込み)。
   * あちらは以降60行を下へずらして空いた行を赤く塗り、InputBoxで作業内容を聞いていた。
   * ここでは突発作業(isSpontaneous)として実際に行を挿し込み、以降の予定を後ろへずらす
   */
  async function insertUnplanned(category: string, name: string, startNow: boolean) {
    const all = await db.dailyTasks.where("date").equals(date).toArray();
    const master = await findOrCreateMasterTask(category, name, 0);
    // 計測中があれば、元ブックの流れどおり先に打刻して終わらせる
    const stamp = stampNow();
    const running = all.find((t) => t.status === "running" && !t.isProvisional);
    if (running) await finishDailyTask(running, stamp);

    // 挿し込み位置は「計測中だった行の直後」。無ければ末尾
    const anchorOrder = running ? running.order : Math.max(-1, ...all.map((t) => t.order));
    for (const t of all) {
      if (t.order > anchorOrder) await db.dailyTasks.update(t.id, { order: t.order + 1 });
    }
    const startAt = startNow ? Math.min(stamp, Date.now()) : undefined;
    const task: DailyTask = {
      id: uid(),
      date,
      order: anchorOrder + 1,
      masterTaskId: master.id,
      category,
      name,
      estimatedSeconds: 0,
      hasPlan: false,
      status: startAt !== undefined ? "running" : "pending",
      segments: startAt !== undefined ? [{ start: startAt }] : [],
      accumulatedMs: 0,
      startedAt: startAt,
      isSpontaneous: true,
    };
    await db.dailyTasks.add(task);
  }

  /** 予定行をその場で開始する(打刻は丸めた時刻をそのまま区間の開始にする) */
  async function startRow(task: DailyTask, atMs: number) {
    const all = await db.dailyTasks.where("date").equals(date).toArray();
    const running = all.find((t) => t.status === "running" && t.id !== task.id);
    if (running) await finishDailyTask(running, atMs);
    const start = Math.min(atMs, Date.now());
    await db.dailyTasks.update(task.id, {
      status: "running",
      segments: [...task.segments, { start }],
      startedAt: task.startedAt ?? start,
    });
  }

  /**
   * 作業完了(元ブック Module1.作業完了)。
   * 10分単位に丸めた時刻で打刻したうえで「予定通りの作業を実行しましたか？」を聞き、
   * はい→予定のまま次の行へ / いいえ→予定外差し込み、という分岐に入る
   */
  async function finishAsPlanned() {
    if (!runningRow) return;
    const stamp = stampNow();
    await finishDailyTask(runningRow.task, stamp);
    // 「予定通り」は元ブックでは中身が空のマクロ(=予定のまま進む)。
    // ここでは次の予定行をその場で開始するところまでやる
    const fresh = await db.dailyTasks.where("date").equals(date).toArray();
    const next = fresh
      .filter((t) => !t.isProvisional && t.status === "pending")
      .sort((a, b) => a.order - b.order)[0];
    if (next) await startRow(next, stamp);
    setFinishOpen(false);
  }

  /**
   * 予定を下に(元ブック Module3.予定を下に)。
   * あちらは35行分の予定をまとめて1行下へ押し出すだけだったが、
   * ここは「今どれだけ遅れているか」を計算して、その分の時刻を未着手の先頭行に書き込む。
   * 予定の開始時刻は前の行から積み上がる作りなので、1行直せば以降が全部ついてくる
   */
  async function pushPlanDown(deltaMs: number) {
    if (!nextPending || deltaMs === 0) return;
    const target = rows.find((r) => r.task.id === nextPending.task.id);
    if (!target) return;
    const newStart = target.planStartMs + deltaMs;
    await db.dailyTasks.update(nextPending.task.id, {
      scheduledTime: msToHm(newStart),
      // 時刻を入れただけで勝手に計測が始まると「ずらした」意味が無くなるので、自動開始は止める
      autoStartDisabled: true,
    });
    setPushOpen(false);
  }

  /** 作業項目(元ブック UserForm1)から予定行を足す */
  async function addFromMaster(category: string, name: string, estimatedSeconds: number, startNow: boolean) {
    const master = await findOrCreateMasterTask(category, name, estimatedSeconds);
    const all = await db.dailyTasks.where("date").equals(date).toArray();
    const stamp = stampNow();
    const startAt = startNow ? Math.min(stamp, Date.now()) : undefined;
    if (startNow) {
      const running = all.find((t) => t.status === "running");
      if (running) await finishDailyTask(running, stamp);
    }
    await db.dailyTasks.add({
      id: uid(),
      date,
      order: Math.max(-1, ...all.map((t) => t.order)) + 1,
      masterTaskId: master.id,
      category,
      name,
      estimatedSeconds,
      hasPlan: estimatedSeconds > 0,
      status: startAt !== undefined ? "running" : "pending",
      segments: startAt !== undefined ? [{ start: startAt }] : [],
      accumulatedMs: 0,
      startedAt: startAt,
      isSpontaneous: false,
    });
  }

  /** やることリストの1件を工程表の行に入れる */
  async function addTodoAsRow(todo: TodoTask) {
    const category = todo.category || "やることリスト";
    const est = estimateFor(category, todo.title);
    const seconds = est ? Math.round((useTrimmed ? est.trimmedSeconds : est.meanSeconds) ?? 0) : 0;
    const master = await findOrCreateMasterTask(category, todo.title, seconds);
    const all = await db.dailyTasks.where("date").equals(date).toArray();
    await db.dailyTasks.add({
      id: uid(),
      date,
      order: Math.max(-1, ...all.map((t) => t.order)) + 1,
      masterTaskId: master.id,
      category,
      name: todo.title,
      estimatedSeconds: seconds,
      hasPlan: seconds > 0,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: false,
      todoTaskId: todo.id,
    });
  }

  /** ずらし量の既定値。今の時刻と、未着手の先頭行の予定開始とのひらき */
  const defaultPushMs = useMemo(() => {
    if (!nextPending) return 0;
    const target = rows.find((r) => r.task.id === nextPending.task.id);
    if (!target) return 0;
    return roundMsToStep(Date.now()) - target.planStartMs;
  }, [nextPending, rows]);

  const nowRatio = axisRatio(now, axis.startMs, axis.endMs);
  const closingMs = hmToMsOnDate(date, closingHm);
  const closingRatio = axisRatio(closingMs, axis.startMs, axis.endMs);

  return (
    <div className={wideAxis ? "origin-sheet origin-wide space-y-2" : "origin-sheet space-y-2"}>
      {/* ---- 数式バーにあたる帯。元ブックの C3(日付)とマクロボタンをここに集めている ---- */}
      <div className="origin-bar">
        <div className="origin-namebox">C3</div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayStr())}
          className="origin-datecell"
          aria-label="工程表の日付"
        />
        <button className="origin-xbtn" onClick={() => setDate(shiftDateStr(date, -1))}>
          ◀
        </button>
        <button className="origin-xbtn" onClick={() => setDate(todayStr())} disabled={isToday}>
          本日
        </button>
        <button className="origin-xbtn" onClick={() => setDate(shiftDateStr(date, 1))}>
          ▶
        </button>
        <span className="origin-bar-sep" />
        <button
          className="origin-xbtn origin-xbtn-primary"
          onClick={() => setFinishOpen(true)}
          disabled={!runningRow}
          title="現在の作業を10分単位に丸めた時刻で打刻して完了します"
        >
          作業完了
        </button>
        <button className="origin-xbtn" onClick={() => setInsertOpen(true)}>
          予定外差し込み
        </button>
        <button className="origin-xbtn" onClick={() => setPushOpen(true)} disabled={!nextPending}>
          予定を下に
        </button>
        <button className="origin-xbtn" onClick={() => setPickerOpen(true)}>
          作業項目…
        </button>
      </div>

      {/* ---- 予定内と予定外の集計(元ブック Module8)。元ブックはボタンを押して別表に出していたが、
             メモシートに「予定内外の合計がおかしい」と書かれていたので、常に出して毎回数え直す ---- */}
      <div className="origin-tally">
        <TallyCell label="予定内" swatchClass="origin-sw-planned" value={`${summary.plannedCount}件`} sub={formatOriginDuration(summary.plannedMs)} />
        <TallyCell label="予定外" swatchClass="origin-sw-unplanned" value={`${summary.unplannedCount}件`} sub={formatOriginDuration(summary.unplannedMs)} />
        <TallyCell label="予定外の割合" value={`${Math.round(summary.unplannedShare * 100)}%`} sub="実働に占める割合" />
        <TallyCell label={`時間外(${closingHm}以降)`} value={`${summary.overtimeCount}件`} sub="別集計の対象" />
        <TallyCell label="完了" value={`${summary.doneCount}/${summary.totalCount}`} sub="K列のフラグ" />
        <div className="origin-tally-controls">
          <label>
            行高
            <select value={rowSize} onChange={(e) => setRowSize(e.target.value)}>
              <option value="sm">狭い</option>
              <option value="md">標準</option>
              <option value="lg">広い</option>
            </select>
          </label>
          <label>
            目盛
            <select value={cellSize} onChange={(e) => setCellSize(e.target.value)}>
              <option value="sm">細かい</option>
              <option value="md">標準</option>
              <option value="lg">粗い</option>
            </select>
          </label>
          <label className="origin-check">
            <input type="checkbox" checked={roundStamp} onChange={(e) => setRoundStampStr(String(e.target.checked))} />
            10分丸め
          </label>
          <label className="origin-check">
            <input type="checkbox" checked={wideAxis} onChange={(e) => setWideAxisStr(String(e.target.checked))} />
            帯を広く
          </label>
        </div>
      </div>

      <div className="origin-body">
        {/* ---- 工程表シート本体 ---- */}
        <div className="origin-grid-wrap">
          <div className="origin-grid-scroller" ref={scrollerRef}>
            <div className="origin-grid" style={{ ["--origin-cell-w" as string]: `${cellW}px`, ["--origin-row-h" as string]: `${rowH}px` }}>
              {/* 6行目の見出し */}
              <div className="origin-head origin-row">
                <HeadCells />
                <div className="origin-axis-head" style={{ width: axisWidth }}>
                  {axis.ticks.map((t, i) => {
                    const d = new Date(t);
                    const onHour = d.getMinutes() === 0;
                    if (i === axis.ticks.length - 1) return null;
                    return (
                      <div
                        key={t}
                        className={onHour ? "origin-tick origin-tick-hour" : "origin-tick"}
                        style={{ width: cellW }}
                      >
                        {onHour ? <span>{msToHm(t)}</span> : cellW >= 34 ? <span>{String(d.getMinutes()).padStart(2, "0")}</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {rows.length === 0 && (
                <div className="origin-empty">
                  この日の行はまだありません。「作業項目…」から予定を並べるか、「予定外差し込み」でその場の作業を書き込んでください。
                </div>
              )}

              {rows.map((r) => (
                <SheetRowPair
                  key={r.task.id}
                  row={r}
                  axis={axis}
                  axisWidth={axisWidth}
                  breaks={breaks}
                  now={now}
                  selected={detailRowId === r.task.id}
                  onSelect={() => setDetailRowId(detailRowId === r.task.id ? null : r.task.id)}
                />
              ))}

              {/* 休憩帯・定時の線・現在時刻の線。元ブックでは G5:I6 に休憩の時刻を書いた
                  目印のセルが置かれていただけだったので、ここでは帯として敷いている */}
              <div className="origin-overlay" style={{ width: axisWidth }} aria-hidden="true">
                {breaks.map(([s, e]) => (
                  <div
                    key={s}
                    className="origin-break"
                    style={{
                      left: axisRatio(s, axis.startMs, axis.endMs) * axisWidth,
                      width: Math.max(1, (axisRatio(e, axis.startMs, axis.endMs) - axisRatio(s, axis.startMs, axis.endMs)) * axisWidth),
                    }}
                  />
                ))}
                {closingRatio > 0 && closingRatio < 1 && (
                  <div className="origin-closing-line" style={{ left: closingRatio * axisWidth }}>
                    <span>{closingHm} 定時</span>
                  </div>
                )}
                {isToday && nowRatio > 0 && nowRatio < 1 && (
                  <div className="origin-now-line" style={{ left: nowRatio * axisWidth }}>
                    <span>{msToHm(now)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="origin-note">
            奇数行が予定、その下の「実」が実績です。帯の色は元のブックと同じで、
            <span className="origin-legend origin-sw-planned" /> 予定内 /
            <span className="origin-legend origin-sw-unplanned" /> 予定外。
            時間軸は{startHm}から{ORIGIN_AXIS_STEP_MIN}分刻み。
            {usingDefaultBreaks && "休憩帯は元のブックの目印(10:00/12:00/15:00)を使っています。設定タブで登録すればそちらが優先されます。"}
          </p>
        </div>

        {/* ---- 右の欄。元ブックの CK列「やることリスト」と、上位10位の作業 ---- */}
        <aside className="origin-rail">
          <div className="origin-rail-box">
            <div className="origin-rail-head">
              CK やることリスト
              {onOpenTodo && (
                <button className="origin-xbtn origin-xbtn-mini" onClick={onOpenTodo}>
                  一覧
                </button>
              )}
            </div>
            {todoList.length === 0 ? (
              <p className="origin-rail-empty">この日に出すものはありません。</p>
            ) : (
              <ul className="origin-rail-list">
                {todoList.map((t) => {
                  const overdue = !!t.dueDate && t.dueDate < date;
                  return (
                    <li key={t.id}>
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => db.todoTasks.update(t.id, { completed: true, completedAt: Date.now() })}
                        aria-label={`${t.title} を完了にする`}
                      />
                      <span className={overdue ? "origin-rail-title origin-overdue" : "origin-rail-title"}>{t.title}</span>
                      {t.dueDate && <span className="origin-rail-due">{t.dueDate.slice(5)}</span>}
                      <button className="origin-xbtn origin-xbtn-mini" onClick={() => addTodoAsRow(t)}>
                        行へ
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="origin-rail-box">
            <div className="origin-rail-head">
              上位10位の作業
              <button className="origin-xbtn origin-xbtn-mini" onClick={() => setShowTopStr(String(!showTop))}>
                {showTop ? "隠す" : "出す"}
              </button>
            </div>
            {showTop &&
              (topWorks.length === 0 ? (
                <p className="origin-rail-empty">直近30日の実績がありません。</p>
              ) : (
                <ol className="origin-rail-rank">
                  {topWorks.map((w, i) => (
                    <li key={w.key}>
                      <span className="origin-rank-no">{i + 1}</span>
                      <span className="origin-rank-name" title={`${w.category} / ${w.name}`}>
                        {w.category}
                        <b>{w.name}</b>
                      </span>
                      <span className="origin-rank-val tabular-nums">{formatOriginDuration(w.seconds * 1000)}</span>
                    </li>
                  ))}
                </ol>
              ))}
          </div>
        </aside>
      </div>

      {/* ---- ダイアログ ---- */}
      {finishOpen && runningRow && (
        <FinishDialog
          row={runningRow}
          stampMs={stampNow()}
          roundStamp={roundStamp}
          onAsPlanned={finishAsPlanned}
          onUnplanned={() => {
            setFinishOpen(false);
            setInsertOpen(true);
          }}
          onClose={() => setFinishOpen(false)}
        />
      )}

      {insertOpen && (
        <InsertUnplannedDialog
          masterTasks={masterTasks ?? []}
          runningName={runningRow ? `${runningRow.task.category} / ${runningRow.task.name}` : null}
          stampHm={msToHm(stampNow())}
          onSubmit={async (category, name, startNow) => {
            await insertUnplanned(category, name, startNow);
            setInsertOpen(false);
          }}
          onClose={() => setInsertOpen(false)}
        />
      )}

      {pushOpen && nextPending && (
        <PushDownDialog
          rows={rows}
          fromTaskId={nextPending.task.id}
          defaultDeltaMs={defaultPushMs}
          onSubmit={pushPlanDown}
          onClose={() => setPushOpen(false)}
        />
      )}

      {pickerOpen && (
        <WorkItemDialog
          masterTasks={masterTasks ?? []}
          estimates={estimates}
          useTrimmed={useTrimmed}
          onToggleTrimmed={() => setUseTrimmedStr(String(!useTrimmed))}
          onSubmit={async (category, name, seconds, startNow) => {
            await addFromMaster(category, name, seconds, startNow);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {detailRow && (
        <RowDetailDialog
          row={detailRow}
          estimate={estimateFor(detailRow.task.category, detailRow.task.name)}
          useTrimmed={useTrimmed}
          records={records ?? []}
          onApplyEstimate={async (seconds) => {
            if (detailRow.task.masterTaskId) {
              await db.masterTasks.update(detailRow.task.masterTaskId, {
                estimatedSeconds: seconds,
                updatedAt: Date.now(),
              });
            }
            await db.dailyTasks.update(detailRow.task.id, { estimatedSeconds: seconds, hasPlan: true });
          }}
          onStart={async () => {
            await startRow(detailRow.task, stampNow());
            setDetailRowId(null);
          }}
          onFinish={async () => {
            await finishDailyTask(detailRow.task, stampNow());
            setDetailRowId(null);
          }}
          onClose={() => setDetailRowId(null)}
        />
      )}
    </div>
  );
}

function HeadCells() {
  return (
    <div className="origin-fixed">
      <div className="origin-cell origin-rownum">行</div>
      <div className="origin-cell origin-c-b">B 作業</div>
      <div className="origin-cell origin-c-c">C 内容</div>
      <div className="origin-cell origin-c-e">E 開始</div>
      <div className="origin-cell origin-c-f">F 終了</div>
      <div className="origin-cell origin-c-j">J 想定</div>
      <div className="origin-cell origin-c-k">K</div>
    </div>
  );
}

function TallyCell({
  label,
  value,
  sub,
  swatchClass,
}: {
  label: string;
  value: string;
  sub?: string;
  swatchClass?: string;
}) {
  return (
    <div className="origin-tally-cell">
      <span className="origin-tally-label">
        {swatchClass && <span className={`origin-legend ${swatchClass}`} />}
        {label}
      </span>
      <span className="origin-tally-value tabular-nums">{value}</span>
      {sub && <span className="origin-tally-sub tabular-nums">{sub}</span>}
    </div>
  );
}

/** 予定行と実績行の2行ペア。元ブックの「奇数行=予定 / 偶数行=実績」をそのまま作る */
function SheetRowPair({
  row,
  axis,
  axisWidth,
  breaks,
  now,
  selected,
  onSelect,
}: {
  row: OriginRow;
  axis: { startMs: number; endMs: number };
  axisWidth: number;
  breaks: MsRange[];
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const planLeft = axisRatio(row.planStartMs, axis.startMs, axis.endMs) * axisWidth;
  const planRight = axisRatio(row.planEndMs, axis.startMs, axis.endMs) * axisWidth;
  const actualStart = row.actualStartMs;
  const actualEnd = row.actualEndMs ?? (row.running ? now : undefined);
  const actLeft = actualStart !== undefined ? axisRatio(actualStart, axis.startMs, axis.endMs) * axisWidth : 0;
  const actRight = actualEnd !== undefined ? axisRatio(actualEnd, axis.startMs, axis.endMs) * axisWidth : 0;

  const overMs = row.plannedSeconds > 0 ? row.actualMs - row.plannedSeconds * 1000 : 0;
  const pairClass = [
    "origin-pair",
    row.unplanned ? "origin-pair-unplanned" : "origin-pair-planned",
    selected ? "origin-pair-selected" : "",
    row.running ? "origin-pair-running" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={pairClass} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect()}>
      {/* 予定行 */}
      <div className="origin-row">
        <div className="origin-fixed">
          <div className="origin-cell origin-rownum">{row.rowNo}</div>
          <div className="origin-cell origin-c-b" title={row.task.category}>
            {row.task.category}
          </div>
          <div className="origin-cell origin-c-c" title={row.task.name}>
            {row.unplanned && <span className="origin-flag">外</span>}
            {row.task.name}
          </div>
          {/* 予定外の行には予定そのものが無いので、E・F列は空にする(元ブックでも
              差し込んだ行は予定の時刻を持たず、実績だけが入っていた) */}
          <div className="origin-cell origin-c-e tabular-nums">{row.plannedSeconds > 0 ? msToHm(row.planStartMs) : "—"}</div>
          <div className="origin-cell origin-c-f tabular-nums">{row.plannedSeconds > 0 ? msToHm(row.planEndMs) : "—"}</div>
          <div className="origin-cell origin-c-j tabular-nums">
            {row.plannedSeconds > 0 ? formatOriginDuration(row.plannedSeconds * 1000) : "—"}
          </div>
          <div className="origin-cell origin-c-k tabular-nums">{row.done ? "1" : ""}</div>
        </div>
        <div className="origin-lane" style={{ width: axisWidth }}>
          {row.plannedSeconds > 0 && (
            <div
              className="origin-bar-plan"
              style={{ left: planLeft, width: Math.max(2, planRight - planLeft) }}
              title={`予定 ${msToHm(row.planStartMs)}〜${msToHm(row.planEndMs)}`}
            >
              <span>{row.task.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* 実績行 */}
      <div className="origin-row origin-row-actual">
        <div className="origin-fixed">
          <div className="origin-cell origin-rownum">{row.rowNo + 1}</div>
          <div className="origin-cell origin-c-b origin-actual-tag">実</div>
          <div className="origin-cell origin-c-c origin-actual-note">
            {row.running ? "計測中" : row.done ? "完了" : row.actualMs > 0 ? "一時停止" : "未着手"}
            {row.overtime && <span className="origin-flag origin-flag-ot">時間外</span>}
          </div>
          <div className="origin-cell origin-c-e tabular-nums">{actualStart !== undefined ? msToHm(actualStart) : ""}</div>
          <div className="origin-cell origin-c-f tabular-nums">{row.actualEndMs !== undefined ? msToHm(row.actualEndMs) : row.running ? "—" : ""}</div>
          <div className={row.overrun ? "origin-cell origin-c-j origin-over tabular-nums" : "origin-cell origin-c-j tabular-nums"}>
            {row.actualMs > 0 ? formatOriginDuration(row.actualMs) : ""}
          </div>
          <div className="origin-cell origin-c-k" />
        </div>
        <div className="origin-lane" style={{ width: axisWidth }}>
          {actualStart !== undefined && actualEnd !== undefined && (
            <div
              className={row.running ? "origin-bar-act origin-bar-act-running" : "origin-bar-act"}
              style={{ left: actLeft, width: Math.max(2, actRight - actLeft) }}
              title={`実績 ${msToHm(actualStart)}〜${row.actualEndMs ? msToHm(row.actualEndMs) : "計測中"} / ${formatOriginDuration(row.actualMs)}`}
            >
              <span>
                {row.task.name}
                {overMs > 0 && <b className="origin-bar-over"> +{formatOriginDuration(overMs)}</b>}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 元ブック Module1.作業完了 の MsgBox "予定通りの作業を実行しましたか？" にあたるダイアログ */
function FinishDialog({
  row,
  stampMs,
  roundStamp,
  onAsPlanned,
  onUnplanned,
  onClose,
}: {
  row: OriginRow;
  stampMs: number;
  roundStamp: boolean;
  onAsPlanned: () => void;
  onUnplanned: () => void;
  onClose: () => void;
}) {
  // 元ブックは MsgBox なので、はい/いいえ がキーボードだけで押せた。そこも引き継ぐ
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "1" || e.key === "y" || e.key === "Y") onAsPlanned();
      if (e.key === "2" || e.key === "n" || e.key === "N") onUnplanned();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAsPlanned, onUnplanned]);

  const actualMs = stampMs - (row.actualStartMs ?? stampMs);
  return (
    <Modal title="作業の種類" onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <div className="origin-dialog-card">
          <p className="text-xs text-cream/50">完了にする行</p>
          <p className="font-bold text-cream">
            {row.task.category} / {row.task.name}
          </p>
          <p className="mt-1 tabular-nums text-xs text-cream/60">
            {row.actualStartMs !== undefined ? msToHm(row.actualStartMs) : "—"} 〜 <b className="text-cream">{msToHm(stampMs)}</b>
            {roundStamp && <span className="ml-1 text-cream/40">(10分に丸めた打刻)</span>}
            <span className="ml-2">実働 {formatOriginDuration(Math.max(0, actualMs))}</span>
          </p>
          {row.plannedSeconds > 0 && (
            <p className={row.overrun ? "mt-0.5 text-xs font-bold text-alert" : "mt-0.5 text-xs text-cream/50"}>
              想定 {formatOriginDuration(row.plannedSeconds * 1000)}
              {row.overrun && ` / 超過 +${formatOriginDuration(row.actualMs - row.plannedSeconds * 1000)}`}
            </p>
          )}
        </div>
        <p className="text-base font-bold text-cream">予定通りの作業を実行しましたか？</p>
        <p className="text-xs text-cream/50">
          「いいえ」を選ぶと、元のブックと同じように予定外の行をここに差し込み、以降の予定は後ろへ送ります。
          キーボードの 1 / 2 でも選べます。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill-outline text-sm" onClick={onUnplanned}>
            2 いいえ（予定外）
          </button>
          <button className="btn-pill text-sm" onClick={onAsPlanned}>
            1 はい（予定通り）
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 元ブック Module1.予定外差し込み の InputBox("作業内容を入力してください") にあたるダイアログ */
function InsertUnplannedDialog({
  masterTasks,
  runningName,
  stampHm,
  onSubmit,
  onClose,
}: {
  masterTasks: MasterTask[];
  runningName: string | null;
  stampHm: string;
  onSubmit: (category: string, name: string, startNow: boolean) => void;
  onClose: () => void;
}) {
  const categories = useMemo(
    () => [...new Set(masterTasks.filter((m) => !m.archived).map((m) => m.category))].sort(),
    [masterTasks]
  );
  const [category, setCategory] = useState(categories[0] ?? "突発対応");
  const [name, setName] = useState("");
  const canSubmit = category.trim() !== "" && name.trim() !== "";

  return (
    <Modal title="予定外差し込み" onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <p className="text-xs text-cream/50">
          元のブックでは、以降の予定を60行まとめて下へずらし、空いた行を赤く塗ってから作業内容を聞いていました。
          ここでも同じように、この行を予定外（赤）として差し込み、以降の予定を1つ後ろへ送ります。
        </p>
        {runningName && (
          <p className="rounded bg-ink/40 px-2 py-1.5 text-xs text-cream/60">
            計測中の「{runningName}」は <b className="tabular-nums text-cream">{stampHm}</b> で打刻して完了にします。
          </p>
        )}
        <label className="block">
          <span className="text-xs text-cream/50">業務区分（B列）</span>
          <input
            list="origin-category-list"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 w-full rounded border border-cream/20 bg-ink/60 px-2 py-1.5 text-sm text-cream"
          />
          <datalist id="origin-category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className="text-xs text-cream/50">作業内容を入力してください（C列）</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && onSubmit(category.trim(), name.trim(), true)}
            className="mt-1 w-full rounded border border-cream/20 bg-ink/60 px-2 py-1.5 text-sm text-cream"
          />
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill-outline text-sm" disabled={!canSubmit} onClick={() => onSubmit(category.trim(), name.trim(), false)}>
            行だけ足す
          </button>
          <button className="btn-pill text-sm" disabled={!canSubmit} onClick={() => onSubmit(category.trim(), name.trim(), true)}>
            差し込んで開始
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 元ブック Module3.予定を下に にあたるダイアログ */
function PushDownDialog({
  rows,
  fromTaskId,
  defaultDeltaMs,
  onSubmit,
  onClose,
}: {
  rows: OriginRow[];
  fromTaskId: string;
  defaultDeltaMs: number;
  onSubmit: (deltaMs: number) => void;
  onClose: () => void;
}) {
  const step = ORIGIN_AXIS_STEP_MIN * 60_000;
  const [deltaMin, setDeltaMin] = useState(Math.round(defaultDeltaMs / 60_000 / ORIGIN_AXIS_STEP_MIN) * ORIGIN_AXIS_STEP_MIN);
  const deltaMs = deltaMin * 60_000;
  const fromIndex = rows.findIndex((r) => r.task.id === fromTaskId);
  const affected = fromIndex >= 0 ? rows.slice(fromIndex) : [];

  return (
    <Modal title="予定を下に" onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <p className="text-xs text-cream/50">
          元のブックでは35行分の予定を1行ずつ手で押し下げていました（メモシートの「予定時間をずらさないといけない」がこれです）。
          ここでは先頭の未着手行の時刻を書き換えるだけで、以降の予定がまとめて後ろへ動きます。
        </p>
        <div className="flex items-center justify-center gap-2">
          <button className="btn-pill-outline text-xs" onClick={() => setDeltaMin((v) => v - ORIGIN_AXIS_STEP_MIN)}>
            −10分
          </button>
          <span className="min-w-[6rem] text-center text-xl font-bold tabular-nums text-cream">
            {deltaMin >= 0 ? "+" : "−"}
            {Math.abs(deltaMin)}分
          </span>
          <button className="btn-pill-outline text-xs" onClick={() => setDeltaMin((v) => v + ORIGIN_AXIS_STEP_MIN)}>
            +10分
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto rounded border border-cream/10">
          <table className="w-full text-xs">
            <tbody>
              {affected.map((r) => (
                <tr key={r.task.id} className="border-b border-cream/5 last:border-0">
                  <td className="px-2 py-1 text-cream/70">
                    {r.task.category} / {r.task.name}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-cream/40 line-through">{msToHm(r.planStartMs)}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-bold text-cream">{msToHm(r.planStartMs + deltaMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill text-sm" disabled={deltaMs === 0 || step <= 0} onClick={() => onSubmit(deltaMs)}>
            ずらす
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * 元ブック UserForm1 にあたるダイアログ。
 * ComboBox1(業務区分) → ComboBox2(作業名 + 詳細の2列) → TextBox1(詳細) という
 * 2段の絞り込みで作業を選ばせる作りだったので、その構造をそのまま画面にしている
 */
function WorkItemDialog({
  masterTasks,
  estimates,
  useTrimmed,
  onToggleTrimmed,
  onSubmit,
  onClose,
}: {
  masterTasks: MasterTask[];
  estimates: Map<string, { trimmedSeconds: number | null; meanSeconds: number | null; sampleCount: number; droppedCount: number }>;
  useTrimmed: boolean;
  onToggleTrimmed: () => void;
  onSubmit: (category: string, name: string, seconds: number, startNow: boolean) => void;
  onClose: () => void;
}) {
  const alive = useMemo(() => masterTasks.filter((m) => !m.archived), [masterTasks]);
  const categories = useMemo(() => [...new Set(alive.map((m) => m.category))].sort(), [alive]);
  const [category, setCategory] = useState(categories[0] ?? "");
  const [name, setName] = useState("");
  const [newMode, setNewMode] = useState(categories.length === 0);
  const [newCategory, setNewCategory] = useState("");
  const [newName, setNewName] = useState("");
  const [newMinutes, setNewMinutes] = useState("10");

  const names = useMemo(() => alive.filter((m) => m.category === category), [alive, category]);
  // 区分を選び直した直後は作業名が未選択になるが、一覧の先頭が選ばれて見えるので
  // 詳細も先頭のものを出しておく(元ブックのComboBoxも同じ振る舞いだった)
  const picked = names.find((m) => m.name === name) ?? names[0] ?? null;
  const est = picked ? estimates.get(originKey(picked.category, picked.name)) : undefined;
  const seconds = picked
    ? Math.round((useTrimmed ? (est?.trimmedSeconds ?? picked.estimatedSeconds) : (est?.meanSeconds ?? picked.estimatedSeconds)) || 0)
    : 0;

  function submit(startNow: boolean) {
    if (newMode) {
      if (!newCategory.trim() || !newName.trim()) return;
      onSubmit(newCategory.trim(), newName.trim(), Math.max(0, Math.round(Number(newMinutes) || 0) * 60), startNow);
      return;
    }
    if (!picked) return;
    onSubmit(picked.category, picked.name, seconds, startNow);
  }

  return (
    <Modal title="作業項目" onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-cream/50">元のブックの「業務区分 → 作業名 → 詳細」の2段選択です。</p>
          <button className="btn-pill-outline text-xs" onClick={() => setNewMode(!newMode)}>
            {newMode ? "一覧から選ぶ" : "＋ 新規"}
          </button>
        </div>

        {newMode ? (
          <>
            <p className="rounded bg-ink/40 px-2 py-1.5 text-xs text-cream/50">
              メモシートの「新しい項目が出来た際に取り入れれるようにしたい」への対応です。ここで入れた組み合わせはそのまま作業項目に登録されます。
            </p>
            <label className="block">
              <span className="text-xs text-cream/50">業務区分</span>
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                list="origin-category-list-2"
                className="mt-1 w-full rounded border border-cream/20 bg-ink/60 px-2 py-1.5 text-sm text-cream"
              />
              <datalist id="origin-category-list-2">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-xs text-cream/50">作業名</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border border-cream/20 bg-ink/60 px-2 py-1.5 text-sm text-cream"
              />
            </label>
            <label className="block">
              <span className="text-xs text-cream/50">想定時間（分）</span>
              <input
                type="number"
                min={0}
                step={5}
                value={newMinutes}
                onChange={(e) => setNewMinutes(e.target.value)}
                className="mt-1 w-24 rounded border border-cream/20 bg-ink/60 px-2 py-1.5 text-sm tabular-nums text-cream"
              />
            </label>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-xs text-cream/50">業務区分</p>
                <select
                  size={8}
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setName("");
                  }}
                  className="w-full rounded border border-cream/20 bg-ink/60 p-1 text-xs text-cream"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="mb-1 text-xs text-cream/50">作業名</p>
                <select
                  size={8}
                  value={picked?.name ?? ""}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-cream/20 bg-ink/60 p-1 text-xs text-cream"
                >
                  {names.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="origin-dialog-card">
              <p className="text-xs text-cream/50">詳細</p>
              {picked ? (
                <>
                  <p className="font-bold text-cream">
                    {picked.category} / {picked.name}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-cream/60">
                    想定時間 <b className="text-cream">{formatOriginDuration(seconds * 1000)}</b>
                    {est && (
                      <>
                        <span className="ml-2">実績 {est.sampleCount}件</span>
                        <span className="ml-2 text-cream/40">
                          刈り込み平均 {formatOriginDuration((est.trimmedSeconds ?? 0) * 1000)} / 単純平均{" "}
                          {formatOriginDuration((est.meanSeconds ?? 0) * 1000)}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-cream/30">
                    CL列キー: {originKey(picked.category, picked.name)}
                  </p>
                </>
              ) : (
                <p className="text-xs text-cream/40">作業名を選ぶとここに詳細が出ます。</p>
              )}
            </div>
            <label className="flex items-start gap-2 rounded bg-ink/40 px-2 py-1.5 text-xs text-cream/60">
              <input type="checkbox" checked={useTrimmed} onChange={onToggleTrimmed} className="mt-0.5" />
              <span>
                想定時間に<b className="text-cream">刈り込み平均</b>を使う。元のブックが
                <span className="font-mono"> TRIMMEAN(範囲, 0.5) </span>
                で出していた値で、上下25%ずつを捨ててから平均します。止め忘れのような極端な記録に引っ張られません
                {est && est.droppedCount > 0 && `（この作業では${est.sampleCount}件中${est.droppedCount}件を除外）`}。
                外すと、このアプリが通常使っている単純平均になります。
              </span>
            </label>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            キャンセル
          </button>
          <button className="btn-pill-outline text-sm" onClick={() => submit(false)}>
            予定に足す
          </button>
          <button className="btn-pill text-sm" onClick={() => submit(true)}>
            足してすぐ開始
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 行を押したときに出る内訳。元ブックには無い画面だが、セルの中身を全部見せる場所として置いている */
function RowDetailDialog({
  row,
  estimate,
  useTrimmed,
  records,
  onApplyEstimate,
  onStart,
  onFinish,
  onClose,
}: {
  row: OriginRow;
  estimate: { trimmedSeconds: number | null; meanSeconds: number | null; sampleCount: number; droppedCount: number } | null;
  useTrimmed: boolean;
  records: WorkRecord[];
  onApplyEstimate: (seconds: number) => void;
  onStart: () => void;
  onFinish: () => void;
  onClose: () => void;
}) {
  const suggested = estimate ? Math.round(((useTrimmed ? estimate.trimmedSeconds : estimate.meanSeconds) ?? 0)) : 0;
  const past = useMemo(
    () =>
      records
        .filter((r) => r.category === row.task.category && r.name === row.task.name)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8),
    [records, row.task.category, row.task.name]
  );

  return (
    <Modal title={`${row.rowNo}行目`} onClose={onClose}>
      <div className="space-y-3 text-sm text-cream/80">
        <div className="origin-dialog-card">
          <p className="font-bold text-cream">
            {row.unplanned && <span className="origin-flag">外</span>}
            {row.task.category} / {row.task.name}
          </p>
          <p className="mt-1 font-mono text-[10px] text-cream/30">CL列キー: {originKey(row.task.category, row.task.name)}</p>
        </div>
        <table className="w-full text-xs">
          <tbody className="[&_td]:border-b [&_td]:border-cream/5 [&_td]:py-1">
            <tr>
              <td className="text-cream/50">予定（E・F・J列）</td>
              <td className="text-right tabular-nums text-cream">
                {msToHm(row.planStartMs)}〜{row.plannedSeconds > 0 ? msToHm(row.planEndMs) : "—"}（
                {row.plannedSeconds > 0 ? formatOriginDuration(row.plannedSeconds * 1000) : "予定なし"}）
              </td>
            </tr>
            <tr>
              <td className="text-cream/50">実績</td>
              <td className={row.overrun ? "text-right font-bold tabular-nums text-alert" : "text-right tabular-nums text-cream"}>
                {row.actualStartMs !== undefined ? msToHm(row.actualStartMs) : "—"}〜
                {row.actualEndMs !== undefined ? msToHm(row.actualEndMs) : row.running ? "計測中" : "—"}（
                {formatOriginDuration(row.actualMs)}）
              </td>
            </tr>
            {row.plannedSeconds > 0 && (
              <tr>
                <td className="text-cream/50">想定との差</td>
                <td className={row.overrun ? "text-right font-bold tabular-nums text-alert" : "text-right tabular-nums text-cream"}>
                  {row.actualMs - row.plannedSeconds * 1000 >= 0 ? "+" : "−"}
                  {formatOriginDuration(Math.abs(row.actualMs - row.plannedSeconds * 1000))}
                </td>
              </tr>
            )}
            <tr>
              <td className="text-cream/50">区分</td>
              <td className="text-right text-cream">{row.unplanned ? "予定外（赤）" : "予定内（黄）"}</td>
            </tr>
            <tr>
              <td className="text-cream/50">時間外</td>
              <td className="text-right text-cream">{row.overtime ? "対象" : "—"}</td>
            </tr>
          </tbody>
        </table>

        {estimate && (
          <div className="origin-dialog-card">
            <p className="text-xs text-cream/50">集計シートの平均時間（実績{estimate.sampleCount}件）</p>
            <p className="mt-1 text-xs tabular-nums text-cream/70">
              刈り込み平均 <b className="text-cream">{formatOriginDuration((estimate.trimmedSeconds ?? 0) * 1000)}</b>
              <span className="ml-2 text-cream/40">単純平均 {formatOriginDuration((estimate.meanSeconds ?? 0) * 1000)}</span>
            </p>
            {suggested > 0 && suggested !== row.plannedSeconds && (
              <button className="btn-pill-outline mt-2 text-xs" onClick={() => onApplyEstimate(suggested)}>
                この行と作業マスタの想定時間を {formatOriginDuration(suggested * 1000)} にする
              </button>
            )}
          </div>
        )}

        {past.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-cream/50">この作業の直近の実績</p>
            <ul className="space-y-0.5 text-xs tabular-nums text-cream/60">
              {past.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>{r.date}</span>
                  <span>{formatHms(r.seconds)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-pill-outline text-sm" onClick={onClose}>
            閉じる
          </button>
          {row.running ? (
            <button className="btn-pill text-sm" onClick={onFinish}>
              打刻して完了
            </button>
          ) : (
            !row.done && (
              <button className="btn-pill text-sm" onClick={onStart}>
                この行を開始
              </button>
            )
          )}
        </div>
      </div>
    </Modal>
  );
}
