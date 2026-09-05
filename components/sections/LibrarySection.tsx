"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeRemainingEstimatedSeconds, finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, todayStr } from "@/lib/time";
import { useVisualMode } from "@/lib/theme";
import {
  buildBook,
  buildCollection,
  buildDateSlip,
  buildDeskSummary,
  buildLoan,
  callNumberOf,
  overdueLevel,
  roomStateOf,
  thicknessOf,
  type BookEntry,
} from "@/lib/library";
import { libraryWordsFor } from "@/lib/libraryWords";
import type { Spine } from "@/lib/libraryArt";
import { CardStock, DateSlip, OpenBook, ReadingRoom, Shelf } from "@/components/library/LibraryCanvas";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import type { DailyTask, MasterTask } from "@/lib/types";

// 図書館モードの「本日の作業」タブ。
//
// これまでこのモードは配色とカードめくり演出だけで、画面の作りは通常と同じだった。
// ここでは閲覧室そのものに置き換えている。
//
//   ・見出し = 閲覧室の一枚絵。時間帯で採光が変わり、借りている冊数だけ灯りがともる
//   ・書見台 = いま開いている本。栞の位置が進み具合、はみ出せば延滞
//   ・貸出棚 = 本日借りた本の背表紙。押すと目録カードが出る
//   ・目録   = 蔵書(作業マスタ)の一覧と、巻末の返却期限票
//
// 背表紙の厚みは想定時間、擦り切れ具合は貸出回数、日付印は実際の実績日。
// どれも実データから決まるので、棚を眺めるだけでその作業の来歴がわかる。

type Panel = "desk" | "shelf" | "catalog";

export default function LibrarySection() {
  const { wordingEnabled } = useVisualMode();
  const W = libraryWordsFor(wordingEnabled);
  const today = todayStr();

  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [panel, setPanel] = useState<Panel>("desk");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openBookId, setOpenBookId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tasks = useMemo(() => (dailyTasks ?? []).filter((t) => !t.isProvisional), [dailyTasks]);
  const elapsedSecondsOf = useMemo(() => (t: DailyTask) => segmentsAccumulatedMs(t, now) / 1000, [now]);
  const running = tasks.find((t) => t.status === "running") ?? null;
  const masterById = useMemo(() => new Map((masters ?? []).map((m) => [m.id, m])), [masters]);

  const room = useMemo(() => roomStateOf(new Date(now)), [Math.floor(now / 600000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const collection = useMemo(
    () => buildCollection(masters ?? [], records ?? [], tasks),
    [masters, records, tasks]
  );
  const summary = useMemo(
    () => buildDeskSummary(tasks, elapsedSecondsOf, collection.length),
    [tasks, elapsedSecondsOf, collection.length]
  );

  // 本日の作業を、棚に並んだ背表紙にする
  const spines: Spine[] = useMemo(
    () =>
      tasks.map((t) => {
        const loan = buildLoan(t, elapsedSecondsOf(t));
        const master = t.masterTaskId ? masterById.get(t.masterTaskId) : undefined;
        const book = master ? buildBook(master, records ?? [], tasks) : null;
        return {
          id: t.id,
          title: t.name,
          callNumber: loan.callNumber,
          thickness: thicknessOf(t.estimatedSeconds),
          wear: book?.wear ?? 0,
          progress: loan.progress,
          state: loan.status,
          selected: t.id === selectedId,
        } satisfies Spine;
      }),
    [tasks, elapsedSecondsOf, masterById, records, selectedId]
  );

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const selectedLoan = selectedTask ? buildLoan(selectedTask, elapsedSecondsOf(selectedTask)) : null;
  const selectedMaster = selectedTask?.masterTaskId ? masterById.get(selectedTask.masterTaskId) : undefined;
  const selectedBook = selectedMaster ? buildBook(selectedMaster, records ?? [], tasks) : null;
  const selectedSlip = useMemo(
    () =>
      selectedTask
        ? buildDateSlip(selectedMaster ?? null, selectedTask.category, selectedTask.name, records ?? [])
        : [],
    [selectedTask, selectedMaster, records]
  );

  const openBook = collection.find((b) => b.masterId === openBookId) ?? null;
  const openBookSlip = useMemo(() => {
    if (!openBook) return [];
    const m = masterById.get(openBook.masterId) ?? null;
    return buildDateSlip(m, openBook.category, openBook.title, records ?? []);
  }, [openBook, masterById, records]);

  // 開いている本が無いときは、直近で触った一冊を選んでおく
  useEffect(() => {
    if (selectedId && tasks.some((t) => t.id === selectedId)) return;
    const next = running ?? tasks[0];
    setSelectedId(next ? next.id : null);
  }, [tasks, running, selectedId]);

  const runningLoan = running ? buildLoan(running, elapsedSecondsOf(running)) : null;

  // ---- 操作 ----
  async function restTask(task: DailyTask) {
    const closeAt = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }
  async function borrow(task: DailyTask) {
    if (running && running.id !== task.id) await restTask(running);
    await db.dailyTasks.update(task.id, {
      segments: [...task.segments, { start: Date.now() }],
      status: "running",
      startedAt: task.startedAt ?? Date.now(),
    });
    setNotice(null);
  }
  async function returnBook(task: DailyTask) {
    await finishDailyTask(task);
    setNotice(null);
  }
  // 貸出の延長。返却期限(想定時間)を実測に合わせ、蔵書側の期間も更新する
  async function extendLoan(task: DailyTask) {
    const actual = Math.max(60, Math.round(elapsedSecondsOf(task)));
    await db.dailyTasks.update(task.id, { estimatedSeconds: actual });
    if (task.masterTaskId) {
      await db.masterTasks.update(task.masterTaskId, { estimatedSeconds: actual, updatedAt: Date.now() });
    }
    setNotice(W.extendNote(formatHms(actual)));
  }
  async function borrowFromCatalog(master: MasterTask, startNow: boolean) {
    if (startNow && running) await restTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      today,
      master.category,
      master.name,
      master.estimatedSeconds
    );
    const id = uid();
    await db.dailyTasks.add({
      id,
      date: today,
      order: tasks.length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds,
      status: startNow ? "running" : "pending",
      segments: startNow ? [{ start: Date.now() }] : [],
      accumulatedMs: 0,
      startedAt: startNow ? Date.now() : undefined,
      isSpontaneous: true,
    });
    setSelectedId(id);
    setShowPicker(false);
    setPickedMaster(null);
    setOpenBookId(null);
    setPanel("shelf");
  }

  const panels: { key: Panel; label: string; badge?: number }[] = [
    { key: "desk", label: W.panelDesk },
    { key: "shelf", label: W.panelShelf, badge: summary.overdueCount },
    { key: "catalog", label: W.panelCatalog, badge: collection.length },
  ];

  const stat = (label: string, value: string) => (
    <div key={label} className="min-w-0">
      <p className="truncate text-[10px] tracking-wider text-cream/45">{label}</p>
      <p className="truncate font-display text-sm font-bold tabular-nums text-cream/85">{value}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* ══ 閲覧室 ══ */}
      <div className="overflow-hidden border border-cream/25 bg-panel">
        <ReadingRoom
          phase={room.phase}
          lampsLit={tasks.filter((t) => t.status !== "done").length}
          overdue={summary.overdueCount}
          seed={today}
        />
        <div className="border-t border-cream/15 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-sm tracking-[0.2em] text-cream/85">{W.roomTitle}</h2>
            {!room.open && (
              <span className="border border-alert/50 px-1.5 py-0.5 text-[10px] text-alert">{W.closedNote}</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-cream/50">{W.roomNote[room.phase]}</p>
          <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5">
            {stat(W.statLoaned, W.unitBooks(summary.loanedCount))}
            {stat(W.statReturned, W.unitBooks(summary.returnedCount))}
            {stat(W.statOverdue, W.unitBooks(summary.overdueCount))}
            {stat(W.statRead, formatHms(summary.readSeconds))}
            {stat(W.statDue, formatHms(summary.dueSeconds))}
            {stat(W.statShelf, W.unitBooks(summary.shelfTotal))}
          </div>
        </div>
      </div>

      {/* ══ 出納口(画面切り替え) ══ */}
      <div className="grid grid-cols-3 gap-1">
        {panels.map((p) => (
          <button
            key={p.key}
            onClick={() => setPanel(p.key)}
            className={`relative border px-2 py-1.5 text-[11px] tracking-[0.2em] transition ${
              panel === p.key
                ? "border-alert bg-alert/10 text-alert"
                : "border-cream/25 bg-panel text-cream/60 hover:border-cream/50"
            }`}
          >
            {p.label}
            {!!p.badge && p.badge > 0 && (
              <span className="absolute right-1 top-0.5 text-[9px] text-cream/45">{p.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══ 書見台 ══ */}
      {panel === "desk" && (
        <div className="space-y-2">
          <div className="overflow-hidden border border-cream/25 bg-panel">
            <OpenBook
              title={running ? running.name : W.deskIdle}
              progress={runningLoan?.progress ?? 0}
              overdue={!!runningLoan && runningLoan.overdueSeconds > 0}
              idle={!running}
              seed={running ? `${running.category}/${running.name}` : today}
            />
            <div className="border-t border-cream/15 px-3 py-2">
              {running && runningLoan ? (
                <>
                  <p className="font-mono text-[10px] tracking-widest text-cream/45">
                    {W.callNumberLabel} {runningLoan.callNumber}
                  </p>
                  <p className="font-display text-base font-bold text-cream/90">{running.name}</p>
                  <p className="text-[11px] text-cream/50">{running.category}</p>
                  <p className="mt-1 tabular-nums text-sm text-cream/85">
                    {formatHms(Math.floor(runningLoan.elapsedSeconds))}
                    <span className="text-cream/40"> / {W.dueLabel} {formatHms(runningLoan.dueSeconds)}</span>
                  </p>
                  {runningLoan.overdueSeconds > 0 && (
                    <p className="mt-1 border border-alert/50 bg-alert/10 px-2 py-1 text-[11px] text-alert">
                      {W.overdueBadge}（{W.overdueLevelName(overdueLevel(runningLoan.progress))}）
                      {W.overdueNote(formatHms(runningLoan.overdueSeconds))}
                    </p>
                  )}
                  {notice && <p className="mt-1 text-[11px] text-alert">{notice}</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      className="flex-1 border border-cream/30 bg-ink/40 py-1.5 text-[11px] text-cream/80 transition hover:border-alert hover:text-alert"
                      onClick={() => returnBook(running)}
                    >
                      {W.actionReturn}
                    </button>
                    <button
                      className="flex-1 border border-cream/30 bg-ink/40 py-1.5 text-[11px] text-cream/80 transition hover:border-alert hover:text-alert"
                      onClick={() => restTask(running)}
                    >
                      {W.actionRest}
                    </button>
                    {runningLoan.overdueSeconds > 0 && (
                      <button
                        className="w-full border border-alert/50 bg-alert/10 py-1.5 text-[11px] text-alert"
                        onClick={() => extendLoan(running)}
                      >
                        {W.actionExtend}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-display text-sm text-cream/70">{W.deskIdle}</p>
                  <p className="mt-0.5 text-[11px] text-cream/45">{W.deskIdleHint}</p>
                  <button
                    className="mt-2 w-full border border-cream/30 bg-ink/40 py-2 text-xs text-cream/75 transition hover:border-alert hover:text-alert"
                    onClick={() => setShowPicker(true)}
                  >
                    ＋ {W.pickerOpen}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 巻末の返却期限票。実際に借りた日が判子で並ぶ */}
          {running && (
            <DateSlip
              stamps={buildDateSlip(selectedMaster ?? null, running.category, running.name, records ?? [])}
              title={`${W.slipTitle}　${running.name}`}
              className="overflow-hidden border border-cream/25"
            />
          )}
        </div>
      )}

      {/* ══ 貸出棚 ══ */}
      {panel === "shelf" && (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <p className="border border-cream/25 bg-panel p-5 text-center text-xs text-cream/55">{W.shelfEmpty}</p>
          ) : (
            <Shelf
              spines={spines}
              onSelect={(id) => {
                setSelectedId(id);
                setNotice(null);
              }}
              className="overflow-hidden border border-cream/25"
            />
          )}

          <button
            className="w-full border border-cream/30 bg-panel py-2 text-xs text-cream/75 transition hover:border-alert hover:text-alert"
            onClick={() => setShowPicker(true)}
          >
            ＋ {W.pickerOpen}
          </button>

          {/* 選んだ一冊の目録カード */}
          {selectedTask && selectedLoan ? (
            <div className="relative border border-cream/30">
              <CardStock seed={`${selectedTask.category}/${selectedTask.name}`} className="absolute inset-0" />
              <div className="relative px-3 pb-6 pt-3">
                <p className="font-mono text-[10px] tracking-widest text-cream/55">
                  {W.callNumberLabel}　{selectedLoan.callNumber}
                </p>
                <p className="mt-1 font-display text-base font-bold text-cream/90">{selectedTask.name}</p>
                <p className="text-[11px] text-cream/55">
                  {W.authorLabel}　{selectedTask.category}
                </p>

                <dl className="mt-2 space-y-1 text-[11px]">
                  {(
                    [
                      [W.dueLabel, formatHms(selectedLoan.dueSeconds)],
                      [W.elapsedLabel, formatHms(Math.floor(selectedLoan.elapsedSeconds))],
                      [W.loanCountLabel, selectedBook ? `${selectedBook.loanCount}回` : W.neverLoaned],
                      [
                        W.medianLabel,
                        selectedBook?.medianSeconds
                          ? formatHms(Math.round(selectedBook.medianSeconds))
                          : W.neverLoaned,
                      ],
                      [
                        W.overdueRateLabel,
                        selectedBook && selectedBook.loanCount > 0
                          ? `${Math.round(selectedBook.overdueRate * 100)}%`
                          : W.neverLoaned,
                      ],
                      [W.lastLoanLabel, selectedBook?.lastLoanDate ?? W.neverLoaned],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex gap-2 border-b border-cream/10 pb-0.5">
                      <dt className="w-32 shrink-0 text-cream/45">{label}</dt>
                      <dd className="min-w-0 flex-1 tabular-nums text-cream/80">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="border border-cream/35 px-1.5 py-0.5 text-[10px] text-cream/65">
                    {W.loanStatus[selectedLoan.status]}
                  </span>
                  {selectedLoan.overdueSeconds > 0 && (
                    <span className="border border-alert/60 bg-alert/10 px-1.5 py-0.5 text-[10px] text-alert">
                      {W.overdueBadge} {formatHms(selectedLoan.overdueSeconds)}
                    </span>
                  )}
                </div>

                {notice && <p className="mt-1 text-[11px] text-alert">{notice}</p>}

                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedTask.status !== "done" && selectedTask.status !== "running" && (
                    <button
                      className="flex-1 border border-cream/30 bg-ink/40 py-1.5 text-[11px] text-cream/80 transition hover:border-alert hover:text-alert"
                      onClick={() => borrow(selectedTask)}
                    >
                      {selectedTask.status === "paused" ? W.actionResume : W.actionBorrow}
                    </button>
                  )}
                  {selectedTask.status === "running" && (
                    <>
                      <button
                        className="flex-1 border border-cream/30 bg-ink/40 py-1.5 text-[11px] text-cream/80 transition hover:border-alert hover:text-alert"
                        onClick={() => returnBook(selectedTask)}
                      >
                        {W.actionReturn}
                      </button>
                      <button
                        className="flex-1 border border-cream/30 bg-ink/40 py-1.5 text-[11px] text-cream/80 transition hover:border-alert hover:text-alert"
                        onClick={() => restTask(selectedTask)}
                      >
                        {W.actionRest}
                      </button>
                    </>
                  )}
                  {selectedLoan.overdueSeconds > 0 && selectedTask.status !== "done" && (
                    <button
                      className="w-full border border-alert/50 bg-alert/10 py-1.5 text-[11px] text-alert"
                      onClick={() => extendLoan(selectedTask)}
                    >
                      {W.actionExtend}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            tasks.length > 0 && (
              <p className="border border-cream/25 bg-panel p-4 text-center text-xs text-cream/50">
                {W.selectPrompt}
              </p>
            )
          )}

          {selectedTask && (
            <DateSlip
              stamps={selectedSlip}
              title={`${W.slipTitle}　${selectedTask.name}`}
              className="overflow-hidden border border-cream/25"
            />
          )}
        </div>
      )}

      {/* ══ 蔵書目録 ══ */}
      {panel === "catalog" && (
        <div className="space-y-1.5">
          {collection.length === 0 ? (
            <p className="border border-cream/25 bg-panel p-5 text-center text-xs text-cream/55">{W.catalogEmpty}</p>
          ) : (
            collection.map((b) => (
              <button
                key={b.masterId}
                onClick={() => setOpenBookId(openBookId === b.masterId ? null : b.masterId)}
                className="flex w-full items-center gap-3 border border-cream/25 bg-panel p-2 text-left transition hover:border-alert"
              >
                <MiniSpine book={b} />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[9px] tracking-widest text-cream/45">{b.callNumber}</p>
                  <p className="truncate text-xs font-bold text-cream/85">{b.title}</p>
                  <p className="truncate text-[10px] text-cream/50">{b.category}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] tabular-nums text-cream/60">
                    {W.loanCountLabel} {b.loanCount}回
                  </p>
                  <p className="text-[10px] tabular-nums text-cream/40">{formatHms(b.estimatedSeconds)}</p>
                  <span
                    className={`mt-0.5 inline-block border px-1 py-0.5 text-[9px] ${
                      b.status === "貸出中" ? "border-alert/60 text-alert" : "border-cream/30 text-cream/55"
                    }`}
                  >
                    {W.shelfStatus[b.status]}
                  </span>
                </div>
              </button>
            ))
          )}

          {openBook && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream/40 p-4" onClick={() => setOpenBookId(null)}>
              <div
                className="max-h-[85vh] w-full max-w-sm overflow-y-auto border border-cream/40 bg-panel"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative">
                  <CardStock seed={`${openBook.category}/${openBook.title}`} className="absolute inset-0" />
                  <div className="relative p-3">
                    <p className="font-mono text-[10px] tracking-widest text-cream/55">
                      {W.callNumberLabel}　{openBook.callNumber}
                    </p>
                    <p className="mt-1 font-display text-base font-bold text-cream/90">{openBook.title}</p>
                    <p className="text-[11px] text-cream/55">
                      {W.authorLabel}　{openBook.category}
                    </p>
                    <dl className="mt-2 space-y-1 text-[11px]">
                      {(
                        [
                          [W.dueLabel, formatHms(openBook.estimatedSeconds)],
                          [W.loanCountLabel, `${openBook.loanCount}回`],
                          [
                            W.medianLabel,
                            openBook.medianSeconds ? formatHms(Math.round(openBook.medianSeconds)) : W.neverLoaned,
                          ],
                          [
                            W.overdueRateLabel,
                            openBook.loanCount > 0 ? `${Math.round(openBook.overdueRate * 100)}%` : W.neverLoaned,
                          ],
                          [W.lastLoanLabel, openBook.lastLoanDate ?? W.neverLoaned],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="flex gap-2 border-b border-cream/10 pb-0.5">
                          <dt className="w-32 shrink-0 text-cream/45">{label}</dt>
                          <dd className="min-w-0 flex-1 tabular-nums text-cream/80">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
                <DateSlip
                  stamps={openBookSlip}
                  title={`${W.slipTitle}　${openBook.title}`}
                  className="border-t border-cream/20"
                />
                <div className="space-y-1 border-t border-cream/20 p-3">
                  <button
                    className="w-full border border-alert/50 bg-alert/10 py-2 text-xs text-alert"
                    onClick={() => {
                      const m = masterById.get(openBook.masterId);
                      if (m) borrowFromCatalog(m, true);
                    }}
                  >
                    {W.actionBorrow}
                  </button>
                  <button
                    className="w-full border border-cream/30 py-2 text-xs text-cream/65"
                    onClick={() => setOpenBookId(null)}
                  >
                    {W.closeLabel}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ 蔵書目録から借りる ══ */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-cream/40 p-4"
          onClick={() => {
            setShowPicker(false);
            setPickedMaster(null);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col border border-cream/40 bg-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-cream/25 p-3">
              <p className="font-display text-sm tracking-[0.2em] text-cream/85">{W.pickerTitle}</p>
              <p className="mt-0.5 text-[11px] text-cream/50">{W.borrowPrompt}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <MasterTaskPicker onSelect={setPickedMaster} selectedId={pickedMaster?.id ?? null} />
            </div>
            <div className="space-y-1 border-t border-cream/25 p-3">
              <button
                className="w-full border border-alert/50 bg-alert/10 py-2 text-xs text-alert disabled:opacity-40"
                disabled={!pickedMaster}
                onClick={() => pickedMaster && borrowFromCatalog(pickedMaster, true)}
              >
                {W.actionBorrow}
              </button>
              <button
                className="w-full border border-cream/30 py-2 text-xs text-cream/65 disabled:opacity-40"
                disabled={!pickedMaster}
                onClick={() => pickedMaster && borrowFromCatalog(pickedMaster, false)}
              >
                {W.loanStatus["予約"]}
              </button>
              <button
                className="w-full border border-cream/30 py-2 text-xs text-cream/65"
                onClick={() => {
                  setShowPicker(false);
                  setPickedMaster(null);
                }}
              >
                {W.closeLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 目録一覧の左に置く小さな背表紙。厚みと擦り切れ具合は一覧でも本物と同じ値を使う
function MiniSpine({ book }: { book: BookEntry }) {
  const w = 8 + Math.round(book.thickness * 14);
  return (
    <div
      className="shrink-0 border border-cream/30"
      style={{
        width: `${w}px`,
        height: "44px",
        background: `rgb(var(--accent-rgb) / ${0.18 + book.thickness * 0.4})`,
        boxShadow: `inset 0 0 0 1px rgb(var(--cream-rgb) / ${0.1 + book.wear * 0.2})`,
      }}
      aria-hidden
    />
  );
}
