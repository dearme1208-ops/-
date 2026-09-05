"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { useSetting } from "@/lib/settings";
import { useVisualMode } from "@/lib/theme";
import {
  buildAbnormality,
  buildAbnormalityIndex,
  buildAlarm,
  buildEnergyState,
  buildVirtues,
  estimateAccuracyOf,
  estimateForWork,
  findMeltdowns,
  ordealOf,
  riskLevelFromRatio,
  subjectNumberOf,
  VIRTUES,
  withinEstimateRateOf,
  WORK_TYPES,
  type Abnormality,
  type RiskLevel,
  type WorkType,
} from "@/lib/lobotomy";
import { lobotomyWordsFor } from "@/lib/lobotomyWords";
import { businessIconOf, type BusinessIcon, type FacilityCell } from "@/lib/lobotomyArt";
import FacilityCanvas from "@/components/lobotomy/FacilityCanvas";
import AbnormalityPortrait from "@/components/lobotomy/AbnormalityPortrait";
import { EnergyMeter, OrdealSigil, RiskSeal, VirtueChart, WorkGlyph } from "@/components/lobotomy/GlyphCanvas";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import type { DailyTask, MasterTask } from "@/lib/types";

// Lobotomy Corporation風モード(管理局モード)の「本日の作業」タブ。
//
// 元ゲームの管理画面をそのまま業務画面にしている。
//   ・上段  = エネルギー目標のメーターと警報段階(ラッパ)、時間帯(オーディール)
//   ・中央  = 収容施設の断面図。区画1つが本日の作業1件で、押すと選択される
//   ・下段  = 選択した個体の情報窓。作業種別(本能/洞察/愛着/抑制)を選んで着手する
//   ・末尾  = 職員能力値の図と、個体図鑑
//
// 数値はすべて実データから出す。危険度もキリパス・カウンタも能力値も、
// 作業マスタ・実績・本日の作業から一意に決まるため、
// 「異常に見える個体」は本当に見積もりが壊れている作業になっている。

type Panel = "facility" | "index" | "agent";

export default function LobotomySection() {
  const { wordingEnabled } = useVisualMode();
  const W = lobotomyWordsFor(wordingEnabled);
  const today = todayStr();

  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [panel, setPanel] = useState<Panel>("facility");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);
  const [openIndexId, setOpenIndexId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 元ゲームは作業種別ごとに職員が育つ。ここでも「どの向き合い方を何回選んだか」を
  // 訓練記録として残す(能力値そのものは実績から出すので、これは履歴として表示する)
  const [trainingRaw, setTrainingRaw] = useSetting("lobotomy.training", "");
  const training = useMemo(() => {
    const out: Record<WorkType, number> = { instinct: 0, insight: 0, attachment: 0, repression: 0 };
    for (const part of trainingRaw.split(",")) {
      const [k, v] = part.split(":");
      if (k && (WORK_TYPES as string[]).includes(k)) out[k as WorkType] = Number(v) || 0;
    }
    return out;
  }, [trainingRaw]);
  function recordTraining(type: WorkType) {
    const next = { ...training, [type]: (training[type] ?? 0) + 1 };
    setTrainingRaw(WORK_TYPES.map((k) => `${k}:${next[k]}`).join(","));
  }

  // 文言オフのときは、絵のほうも怪物ではなく作業そのものを表す図に切り替える。
  // どの図になるかは作業名とカテゴリの語で決まる(「メール返信」なら封筒、など)
  const iconFor = useMemo(
    () =>
      (category: string, name: string): BusinessIcon | null =>
        wordingEnabled ? null : businessIconOf(category, name),
    [wordingEnabled]
  );

  const tasks = useMemo(() => (dailyTasks ?? []).filter((t) => !t.isProvisional), [dailyTasks]);
  const elapsedSecondsOf = useMemo(() => (t: DailyTask) => segmentsAccumulatedMs(t, now) / 1000, [now]);
  const running = tasks.find((t) => t.status === "running") ?? null;

  const masterById = useMemo(() => new Map((masters ?? []).map((m) => [m.id, m])), [masters]);
  const abnormalityIndex = useMemo(
    () => buildAbnormalityIndex(masters ?? [], records ?? []),
    [masters, records]
  );

  const energy = useMemo(() => buildEnergyState(tasks, elapsedSecondsOf), [tasks, elapsedSecondsOf]);
  const meltdowns = useMemo(() => findMeltdowns(tasks, elapsedSecondsOf), [tasks, elapsedSecondsOf]);
  const ordeal = useMemo(() => ordealOf(new Date(now)), [Math.floor(now / 600000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const alarm = useMemo(
    () => buildAlarm(meltdowns, ordeal.kind === "midnight"),
    [meltdowns, ordeal.kind]
  );

  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const workedSecondsToday = tasks.reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0) / 1000;
  const virtues = useMemo(
    () =>
      buildVirtues({
        workedSecondsToday,
        estimateAccuracy: estimateAccuracyOf(records ?? [], masters ?? []),
        withinEstimateRate: withinEstimateRateOf(tasks, elapsedSecondsOf),
        streakDays,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Math.floor(workedSecondsToday / 60), records, masters, tasks, streakDays]
  );

  // 本日の作業を、施設の区画として並べる
  const cells: FacilityCell[] = useMemo(
    () =>
      tasks.map((t) => {
        const master = t.masterTaskId ? masterById.get(t.masterTaskId) : undefined;
        const elapsed = elapsedSecondsOf(t);
        const ratio = t.estimatedSeconds > 0 ? elapsed / t.estimatedSeconds : 0;
        const levelOfCell = master
          ? buildAbnormality(master, records ?? []).riskLevel
          : riskLevelFromRatio(ratio || 1);
        return {
          id: t.id,
          label: subjectNumberOf(t.category, t.name),
          name: t.name,
          riskLevel: levelOfCell,
          riskLabel: W.riskLabel[levelOfCell],
          businessIcon: iconFor(t.category, t.name),
          state: t.status === "done" ? "done" : t.status === "running" ? "running" : t.status === "paused" ? "paused" : "pending",
          progress: ratio,
          meltdown: meltdowns.some((m) => m.task.id === t.id),
          selected: t.id === selectedId,
        } satisfies FacilityCell;
      }),
    [tasks, masterById, records, elapsedSecondsOf, meltdowns, selectedId, W, iconFor]
  );

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const selectedMaster = selectedTask?.masterTaskId ? masterById.get(selectedTask.masterTaskId) : undefined;
  const selectedAbnormality: Abnormality | null = useMemo(() => {
    if (selectedMaster) return buildAbnormality(selectedMaster, records ?? []);
    if (!selectedTask) return null;
    // マスタに無い突発作業。図鑑には載らないので、その場の値だけで組み立てる
    const elapsed = elapsedSecondsOf(selectedTask);
    return {
      masterId: "",
      category: selectedTask.category,
      name: selectedTask.name,
      subjectNumber: subjectNumberOf(selectedTask.category, selectedTask.name),
      riskLevel: riskLevelFromRatio(selectedTask.estimatedSeconds > 0 ? elapsed / selectedTask.estimatedSeconds : 1),
      estimatedSeconds: selectedTask.estimatedSeconds,
      sampleCount: 0,
      medianActualSeconds: null,
      meanRatio: 1,
      qliphothCounter: 4,
      qliphothMax: 4,
      observationLevel: 0,
      breached: false,
      recommended: "instinct",
    };
  }, [selectedMaster, selectedTask, records, elapsedSecondsOf]);

  // 最初の区画を自動で選んでおく(何も選ばれていない画面は情報量がゼロになるため)
  useEffect(() => {
    if (selectedId && tasks.some((t) => t.id === selectedId)) return;
    const next = running ?? tasks[0];
    setSelectedId(next ? next.id : null);
  }, [tasks, running, selectedId]);

  // ---- 操作 ----
  async function pauseTask(task: DailyTask) {
    const closeAt = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }

  // 作業種別を選んで着手する。選んだ種別によって、その作業の想定時間が実際に書き換わる
  async function startWork(task: DailyTask, type: WorkType) {
    if (running && running.id !== task.id) await pauseTask(running);
    const abn = task.masterTaskId ? buildAbnormality(masterById.get(task.masterTaskId)!, records ?? []) : null;
    const nextEstimate = estimateForWork(type, task.estimatedSeconds, abn?.medianActualSeconds ?? null);
    await db.dailyTasks.update(task.id, {
      estimatedSeconds: nextEstimate,
      segments: [...task.segments, { start: Date.now() }],
      status: "running",
      startedAt: task.startedAt ?? Date.now(),
    });
    recordTraining(type);
    setWorkType(type);
    setNotice(W.workEffect(type, formatHms(nextEstimate)));
  }

  async function completeTask(task: DailyTask) {
    await finishDailyTask(task);
    setNotice(null);
  }

  // 融解の鎮圧: 想定を実測に書き換える。マスタがあればそちらも更新する
  async function suppressMeltdown(task: DailyTask) {
    const actual = Math.max(60, Math.round(elapsedSecondsOf(task)));
    await db.dailyTasks.update(task.id, { estimatedSeconds: actual });
    if (task.masterTaskId) {
      await db.masterTasks.update(task.masterTaskId, { estimatedSeconds: actual, updatedAt: Date.now() });
    }
    setNotice(`${task.name}: ${W.actionSuppress}（${formatHms(actual)}）`);
  }

  async function containMaster(master: MasterTask) {
    await db.dailyTasks.add({
      id: uid(),
      date: today,
      order: tasks.length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds: master.estimatedSeconds,
      status: "pending",
      segments: [],
      accumulatedMs: 0,
      isSpontaneous: true,
    });
    setShowPicker(false);
    setPickedMaster(null);
  }

  // ---- 見た目の下ごしらえ ----
  const trumpetTone =
    alarm.trumpet === 0
      ? "border-cream/25 text-cream/60"
      : alarm.trumpet === 1
        ? "border-alert/40 text-alert/80"
        : "border-alert bg-alert/15 text-alert";

  const panels: { key: Panel; label: string; badge?: number }[] = [
    { key: "facility", label: W.panelFacility, badge: meltdowns.length },
    { key: "index", label: W.panelIndex, badge: abnormalityIndex.filter((a) => a.breached).length },
    { key: "agent", label: W.panelAgent },
  ];

  return (
    <div className="space-y-2">
      {/* ══ 上段: エネルギー目標・警報・時間帯 ══ */}
      <div className="border border-cream/20 bg-black/40 p-2">
        <div className="flex items-center gap-2">
          <OrdealSigil kind={ordeal.kind} size={34} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-display text-xs tracking-[0.25em] text-cream/70">
                {W.energyTitle}
              </span>
              <span className="shrink-0 tabular-nums font-display text-lg font-bold text-alert">
                {energy.percent}
                <span className="ml-0.5 text-[10px] text-cream/50">%</span>
              </span>
            </div>
            <EnergyMeter percent={energy.percent} segments={Math.max(1, energy.totalBoxes)} height={14} className="mt-1" />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px] text-cream/50">
              <span className="tabular-nums">
                {W.quotaLabel} {formatHms(energy.quotaSeconds)} / {W.energyTitle} {formatHms(energy.generatedSeconds)}
              </span>
              <span className="tabular-nums">{W.boxSummary(energy.peBoxes, energy.neBoxes, energy.totalBoxes)}</span>
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`border px-2 py-0.5 text-[10px] tracking-widest ${trumpetTone}`}>
            {W.trumpetName(alarm.trumpet)}
          </span>
          <span className="text-[10px] text-cream/45">{alarm.reason}</span>
          <span className="ml-auto text-[10px] tracking-widest text-cream/40">{W.dayLabel(streakDays)}</span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-cream/35">
          {W.ordealName[ordeal.kind]}　{W.ordealNote[ordeal.kind]}
        </p>
      </div>

      {/* ══ パネル切り替え ══ */}
      <div className="grid grid-cols-3 gap-1">
        {panels.map((p) => (
          <button
            key={p.key}
            onClick={() => setPanel(p.key)}
            className={`relative border px-2 py-1.5 text-[11px] tracking-widest transition ${
              panel === p.key
                ? "border-alert bg-alert/10 text-alert"
                : "border-cream/20 bg-black/40 text-cream/55 hover:border-cream/45"
            }`}
          >
            {p.label}
            {!!p.badge && p.badge > 0 && (
              <span className="absolute right-1 top-0.5 text-[9px] text-alert">{p.badge}</span>
            )}
          </button>
        ))}
      </div>

      <p className="px-0.5 text-[10px] tracking-wider text-cream/35">{W.deptCaption[panel]}</p>

      {/* ══ 収容区画 ══ */}
      {panel === "facility" && (
        <div className="space-y-2">
          {meltdowns.length > 0 && (
            <div className="border border-alert/50 bg-alert/10 px-2 py-1.5">
              <p className="text-[11px] font-bold tracking-widest text-alert">{W.meltdownTitle}</p>
              <p className="mt-0.5 text-[10px] text-cream/70">{W.meltdownNote(meltdowns.length)}</p>
            </div>
          )}

          {tasks.length === 0 ? (
            <p className="border border-cream/15 bg-black/40 p-4 text-center text-xs text-cream/50">{W.cellsEmpty}</p>
          ) : (
            <FacilityCanvas
              cells={cells}
              trumpet={alarm.trumpet}
              onSelect={(id) => {
                setSelectedId(id);
                setWorkType(null);
                setNotice(null);
              }}
              className="border border-cream/20 bg-black/50"
            />
          )}

          <button
            className="w-full border border-cream/25 bg-black/40 py-2 text-xs text-cream/70 transition hover:border-alert hover:text-alert"
            onClick={() => setShowPicker(true)}
          >
            ＋ {W.pickerOpen}
          </button>

          {/* ── 選択した個体の情報窓 ── */}
          {selectedTask && selectedAbnormality ? (
            <div className="border border-cream/20 bg-black/50">
              <div className="flex gap-2 border-b border-cream/15 p-2">
                <AbnormalityPortrait
                  seed={`${selectedTask.category}/${selectedTask.name}`}
                  size={104}
                  riskLevel={selectedAbnormality.riskLevel}
                  breached={selectedAbnormality.breached}
                  businessIcon={iconFor(selectedTask.category, selectedTask.name)}
                  className="shrink-0 border border-cream/20"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-mono text-[10px] tracking-widest text-cream/45">
                    {W.subjectLabel} {selectedAbnormality.subjectNumber}
                  </p>
                  <p className="truncate font-display text-sm font-bold text-cream/90">{selectedTask.name}</p>
                  <p className="truncate text-[10px] text-cream/45">{selectedTask.category}</p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <RiskSeal level={selectedAbnormality.riskLevel} size={26} className="shrink-0" />
                    <span className="font-mono text-[11px] font-bold tracking-widest text-alert">
                      {W.riskLabel[selectedAbnormality.riskLevel]}
                    </span>
                    <span
                      className={`ml-auto border px-1.5 py-0.5 text-[9px] ${
                        selectedTask.status === "running"
                          ? "border-alert/50 text-alert"
                          : "border-cream/25 text-cream/55"
                      }`}
                    >
                      {selectedTask.status === "running"
                        ? W.statusRunning
                        : selectedTask.status === "paused"
                          ? W.statusPaused
                          : selectedTask.status === "done"
                            ? W.statusDone
                            : W.statusPending}
                    </span>
                  </div>
                  <p className="tabular-nums text-[11px] text-cream/70">
                    {formatHms(Math.floor(elapsedSecondsOf(selectedTask)))}
                    <span className="text-cream/35"> / {formatHms(selectedTask.estimatedSeconds)}</span>
                  </p>
                </div>
              </div>

              {/* 図鑑の記載。観測レベルが足りない項目は伏せられる */}
              <div className="space-y-1.5 border-b border-cream/15 p-2">
                <p className="text-[10px] tracking-[0.25em] text-alert">{W.managerialTitle}</p>
                <InfoRow
                  label={W.riskTitle}
                  value={W.riskNote(selectedAbnormality.riskLevel, selectedAbnormality.meanRatio)}
                  locked={selectedAbnormality.observationLevel < 1}
                  lockedNote={W.lockedNote(1)}
                />
                <InfoRow
                  label={W.qliphothLabel}
                  value={W.qliphothNote(selectedAbnormality.qliphothCounter, selectedAbnormality.qliphothMax)}
                  locked={selectedAbnormality.observationLevel < 2}
                  lockedNote={W.lockedNote(2)}
                  meter={{ value: selectedAbnormality.qliphothCounter, max: selectedAbnormality.qliphothMax }}
                />
                <InfoRow
                  label={W.recommendedLabel}
                  value={`${W.workName[selectedAbnormality.recommended]} — ${W.recommendedNote(selectedAbnormality.recommended)}`}
                  locked={selectedAbnormality.observationLevel < 3}
                  lockedNote={W.lockedNote(3)}
                />
                <p className="text-[10px] text-cream/35">{W.observationNote(selectedAbnormality.observationLevel)}</p>
                {selectedAbnormality.breached && (
                  <p className="border border-alert/50 bg-alert/10 p-1.5 text-[10px] leading-relaxed text-alert">
                    {W.breachedLabel}: {W.breachedNote}
                  </p>
                )}
              </div>

              {/* 作業種別。押すと想定時間が実際に書き換わって着手する */}
              {selectedTask.status !== "done" && (
                <div className="space-y-2 p-2">
                  <p className="text-[10px] tracking-[0.25em] text-alert">{W.workTitle}</p>
                  <div className="grid grid-cols-4 gap-1">
                    {WORK_TYPES.map((type) => {
                      const active = workType === type;
                      const recommended = selectedAbnormality.recommended === type && selectedAbnormality.observationLevel >= 3;
                      return (
                        <button
                          key={type}
                          onClick={() => startWork(selectedTask, type)}
                          className={`flex flex-col items-center gap-1 border px-1 py-1.5 transition ${
                            active || recommended
                              ? "border-alert bg-alert/10 text-alert"
                              : "border-cream/20 bg-black/40 text-cream/65 hover:border-alert/60 hover:text-alert"
                          }`}
                        >
                          <WorkGlyph type={type} size={32} active={active || recommended} />
                          <span className="text-[10px] tracking-wider">{W.workName[type]}</span>
                          {recommended && <span className="text-[8px] text-alert">▲</span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] leading-relaxed text-cream/40">
                    {W.workDesc[workType ?? selectedAbnormality.recommended]}
                  </p>
                  {notice && <p className="text-[10px] text-alert">{notice}</p>}

                  <div className="flex flex-wrap gap-1">
                    {selectedTask.status === "running" && (
                      <>
                        <button
                          className="flex-1 border border-cream/25 bg-black/40 py-1.5 text-[11px] text-cream/75 transition hover:border-alert hover:text-alert"
                          onClick={() => completeTask(selectedTask)}
                        >
                          {W.actionComplete}
                        </button>
                        <button
                          className="flex-1 border border-cream/25 bg-black/40 py-1.5 text-[11px] text-cream/75 transition hover:border-alert hover:text-alert"
                          onClick={() => pauseTask(selectedTask)}
                        >
                          {W.actionPause}
                        </button>
                      </>
                    )}
                    {meltdowns.some((m) => m.task.id === selectedTask.id) && (
                      <button
                        className="w-full border border-alert/50 bg-alert/10 py-1.5 text-[11px] text-alert"
                        onClick={() => suppressMeltdown(selectedTask)}
                      >
                        {W.meltdownReestimate}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            tasks.length > 0 && (
              <p className="border border-cream/15 bg-black/40 p-3 text-center text-xs text-cream/45">{W.noSelection}</p>
            )
          )}
        </div>
      )}

      {/* ══ 個体図鑑 ══ */}
      {panel === "index" && (
        <div className="space-y-1.5">
          {abnormalityIndex.length === 0 ? (
            <p className="border border-cream/15 bg-black/40 p-4 text-center text-xs text-cream/50">{W.indexEmpty}</p>
          ) : (
            abnormalityIndex.map((a) => (
              <button
                key={a.masterId}
                onClick={() => setOpenIndexId(openIndexId === a.masterId ? null : a.masterId)}
                className={`flex w-full items-center gap-2 border p-2 text-left transition ${
                  a.breached ? "border-alert/50 bg-alert/5" : "border-cream/20 bg-black/40 hover:border-cream/45"
                }`}
              >
                <AbnormalityPortrait
                  seed={`${a.category}/${a.name}`}
                  size={44}
                  riskLevel={a.riskLevel}
                  breached={a.breached}
                  businessIcon={iconFor(a.category, a.name)}
                  className="shrink-0 border border-cream/15"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[9px] tracking-widest text-cream/40">{a.subjectNumber}</p>
                  <p className="truncate text-xs text-cream/85">{a.name}</p>
                  <p className="truncate text-[10px] text-cream/40">{a.category}</p>
                </div>
                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  <RiskSeal level={a.riskLevel} size={24} />
                  <span className="font-mono text-[9px] tracking-widest text-alert">{W.riskLabel[a.riskLevel]}</span>
                </div>
                <div className="shrink-0 text-right">
                  <QliphothPips value={a.qliphothCounter} max={a.qliphothMax} />
                  <p className="mt-0.5 text-[9px] tabular-nums text-cream/35">
                    {W.observationLabel} {a.observationLevel}/4
                  </p>
                </div>
              </button>
            ))
          )}
          {openIndexId && (
            <IndexDetail
              abnormality={abnormalityIndex.find((a) => a.masterId === openIndexId) ?? null}
              words={W}
              iconFor={iconFor}
              onClose={() => setOpenIndexId(null)}
            />
          )}
        </div>
      )}

      {/* ══ 職員能力値 ══ */}
      {panel === "agent" && (
        <div className="space-y-2 border border-cream/20 bg-black/40 p-3">
          <div className="flex items-center gap-3">
            <VirtueChart
              size={150}
              values={virtues.map((v) => v.ratio)}
              labels={VIRTUES.map((v) => W.virtueName[v])}
              className="shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              {virtues.map((v) => (
                <div key={v.virtue}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-cream/75">{W.virtueName[v.virtue]}</span>
                    <span className="font-display text-sm font-bold tabular-nums text-alert">{v.level}</span>
                  </div>
                  <div className="mt-0.5 h-1 w-full bg-cream/10">
                    <div className="h-1 bg-alert/70" style={{ width: `${Math.round(v.ratio * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-[9px] text-cream/35">{v.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-cream/15 pt-2">
            <p className="text-[10px] tracking-[0.25em] text-alert">{W.logTitle}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-cream/40">{W.logLead}</p>
            {/* 数字だけでは何を数えているのか伝わらないので、項目ごとに意味を添える */}
            <div className="mt-1.5 space-y-1">
              {WORK_TYPES.map((type) => (
                <div
                  key={type}
                  className="flex items-center gap-2 border border-cream/15 bg-black/30 px-2 py-1.5"
                >
                  <WorkGlyph type={type} size={26} active={false} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-cream/75">{W.workName[type]}</p>
                    <p className="text-[10px] leading-snug text-cream/40">{W.logMeaning[type]}</p>
                  </div>
                  <p className="shrink-0 font-display text-lg font-bold tabular-nums text-cream/85">
                    {training[type] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ 個体図鑑から収容する ══ */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => {
            setShowPicker(false);
            setPickedMaster(null);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col border border-cream/25 bg-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-cream/20 p-3">
              <p className="font-display text-sm tracking-widest text-alert">{W.pickerTitle}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <MasterTaskPicker onSelect={setPickedMaster} selectedId={pickedMaster?.id ?? null} />
            </div>
            <div className="space-y-1 border-t border-cream/20 p-3">
              <button
                className="w-full border border-alert/50 bg-alert/10 py-2 text-xs text-alert disabled:opacity-40"
                disabled={!pickedMaster}
                onClick={() => pickedMaster && containMaster(pickedMaster)}
              >
                {W.pickerOpen}
              </button>
              <button
                className="w-full border border-cream/25 py-2 text-xs text-cream/60"
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

// 図鑑の1項目。観測レベルが足りない項目は伏字にする(元ゲームの未開示欄と同じ扱い)
function InfoRow({
  label,
  value,
  locked,
  lockedNote,
  meter,
}: {
  label: string;
  value: string;
  locked: boolean;
  lockedNote: string;
  meter?: { value: number; max: number };
}) {
  return (
    <div className="border-l-2 border-cream/20 pl-2">
      <p className="text-[10px] tracking-wider text-cream/45">{label}</p>
      {locked ? (
        <p className="text-[11px] tracking-widest text-cream/25">{lockedNote}</p>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-cream/80">{value}</p>
          {meter && <QliphothPips value={meter.value} max={meter.max} />}
        </>
      )}
    </div>
  );
}

// キリパス・カウンタの表示。満ちている数だけ灯る
function QliphothPips({ value, max }: { value: number; max: number }) {
  return (
    <div className="mt-1 flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 ${i < value ? "bg-alert/80" : "bg-cream/15"}`}
          aria-hidden
        />
      ))}
    </div>
  );
}

function IndexDetail({
  abnormality,
  words,
  iconFor,
  onClose,
}: {
  abnormality: Abnormality | null;
  words: ReturnType<typeof lobotomyWordsFor>;
  iconFor: (category: string, name: string) => BusinessIcon | null;
  onClose: () => void;
}) {
  if (!abnormality) return null;
  const a = abnormality;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto border border-cream/25 bg-ink p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex gap-2">
          <AbnormalityPortrait
            seed={`${a.category}/${a.name}`}
            size={120}
            riskLevel={a.riskLevel}
            breached={a.breached}
            businessIcon={iconFor(a.category, a.name)}
            className="shrink-0 border border-cream/20"
          />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] tracking-widest text-cream/45">{a.subjectNumber}</p>
            <p className="font-display text-sm font-bold text-cream/90">{a.name}</p>
            <p className="text-[10px] text-cream/45">{a.category}</p>
            <div className="mt-1 flex items-center gap-1.5">
              <RiskSeal level={a.riskLevel} size={26} />
              <span className="font-mono text-[11px] font-bold tracking-widest text-alert">
              {words.riskLabel[a.riskLevel]}
            </span>
            </div>
          </div>
        </div>

        <dl className="mt-3 space-y-1.5 text-[11px]">
          {(
            [
              [words.riskTitle, words.riskNote(a.riskLevel, a.meanRatio)],
              [words.qliphothLabel, words.qliphothNote(a.qliphothCounter, a.qliphothMax)],
              [words.observationLabel, words.observationNote(a.observationLevel)],
              [
                words.recommendedLabel,
                `${words.workName[a.recommended]} — ${words.recommendedNote(a.recommended)}`,
              ],
              [
                "想定時間",
                a.medianActualSeconds
                  ? `${formatHms(a.estimatedSeconds)}（実績の中央値 ${formatHms(Math.round(a.medianActualSeconds))}）`
                  : formatHms(a.estimatedSeconds),
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="border-l-2 border-cream/20 pl-2">
              <dt className="text-[10px] tracking-wider text-cream/45">{label}</dt>
              <dd className="leading-relaxed text-cream/80">{value}</dd>
            </div>
          ))}
        </dl>

        {a.breached && (
          <p className="mt-2 border border-alert/50 bg-alert/10 p-2 text-[10px] leading-relaxed text-alert">
            {words.breachedLabel}: {words.breachedNote}
          </p>
        )}

        <button className="mt-3 w-full border border-cream/25 py-2 text-xs text-cream/60" onClick={onClose}>
          {words.closeLabel}
        </button>
      </div>
    </div>
  );
}
