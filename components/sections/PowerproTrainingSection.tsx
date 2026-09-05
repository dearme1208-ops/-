"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeRemainingEstimatedSeconds, finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { findOrCreateMasterTask } from "@/lib/master";
import { formatHms, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { useVisualMode } from "@/lib/theme";
import {
  ABILITY_KEYS,
  buildAbilities,
  buildCommands,
  buildCondition,
  buildExperience,
  buildHotGauge,
  buildSpecialAbilities,
  buildTurnState,
  favoriteCategoryOf,
  playerRankOf,
  type PracticeCommand,
} from "@/lib/powerpro";
import { EXP_COLOR, SPECIAL_COLOR, rankCssColor, skyPhaseOf, type Rgb } from "@/lib/powerproArt";
import { powerproWordsFor } from "@/lib/powerproWords";
import {
  AbilityHex,
  CardBase,
  Gauge,
  PracticeIcon,
  RankEmblem,
  Stadium,
  accentPlateStyle,
  useAccentRgb,
} from "@/components/powerpro/PowerproCanvas";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import type { DailyTask, MasterTask } from "@/lib/types";

// パワプロ風モード(育成選手モード)の「本日の作業」タブ。
//
// これまでこのモードは絵文字のアイコンメニューと表組みだけで、画面の作りは通常と同じだった。
// ここではサクセスの育成画面そのものに置き換えている。
//
//   ・見出し = 球場の一枚絵。時間帯で空の色が変わり、電光掲示板に本日の消化数が出る
//   ・ゲージ = 体力(1日8時間の残り) / やる気(本日の見積もり精度) / 熱血(本日の消化率)
//   ・コマンド = 本日の作業ひとつひとつが練習コマンド。押すとその作業の計測が始まる
//   ・選手データ = 6能力の六角形とG〜Sランク、5色の経験点、特殊能力
//
// ゲーム的に見える数値はすべて実績・本日の作業・ToDoから決定的に導出したもので、
// 演出のためだけの乱数や水増しは一切置いていない。どの数字にも根拠(reason)を添えている。

const MOTIVATION_COLOR: Rgb[] = [
  [150, 158, 178],
  [126, 152, 200],
  [72, 148, 218],
  [86, 186, 118],
  [232, 172, 40],
];

function css(c: Rgb, a = 1): string {
  return a >= 1 ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

type Panel = "training" | "player" | "scout";
type PickerTab = "menu" | "master" | "favorite" | "free";

export default function PowerproTrainingSection() {
  const { wordingEnabled } = useVisualMode();
  const W = powerproWordsFor(wordingEnabled);
  const today = todayStr();
  // チームカラーは設定のアクセントカラーに従う。図版(球場・ユニフォーム)も同じ色を読むので、
  // ここでボタンや見出しにも同じ色を掛けておかないと、絵とUIで色が食い違ってしまう
  const accent = useAccentRgb();
  const accentPlate = accentPlateStyle(accent);

  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const todos = useLiveQuery(() => db.todoTasks.toArray(), []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [panel, setPanel] = useState<Panel>("training");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>("menu");
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);
  const [freeCategory, setFreeCategory] = useState("");
  const [freeName, setFreeName] = useState("");
  const [openReason, setOpenReason] = useState<string | null>(null);

  const tasks = useMemo(() => (dailyTasks ?? []).filter((t) => !t.isProvisional), [dailyTasks]);
  const elapsedSecondsOf = useMemo(() => (t: DailyTask) => segmentsAccumulatedMs(t, now) / 1000, [now]);
  const running = tasks.find((t) => t.status === "running") ?? null;

  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const turn = useMemo(() => buildTurnState(today, records ?? [], tasks), [today, records, tasks]);
  const condition = useMemo(() => buildCondition(tasks, elapsedSecondsOf), [tasks, elapsedSecondsOf]);
  const hot = useMemo(() => buildHotGauge(tasks), [tasks]);
  const favoriteCategory = useMemo(() => favoriteCategoryOf(records ?? []), [records]);
  const commands = useMemo(
    () => buildCommands(tasks, elapsedSecondsOf, favoriteCategory),
    [tasks, elapsedSecondsOf, favoriteCategory]
  );
  const abilities = useMemo(
    () => buildAbilities(records ?? [], todos ?? [], masters ?? []),
    [records, todos, masters]
  );
  const experience = useMemo(() => buildExperience(records ?? [], streakDays), [records, streakDays]);
  const player = useMemo(() => playerRankOf(abilities), [abilities]);
  const specials = useMemo(
    () => buildSpecialAbilities(records ?? [], todos ?? [], abilities, streakDays, condition),
    [records, todos, abilities, streakDays, condition]
  );

  const favoriteMasters = useMemo(
    () => (masters ?? []).filter((m) => m.isFavorite && !m.archived),
    [masters]
  );
  const overdueTodos = (todos ?? []).filter((t) => !t.completed && t.dueDate && t.dueDate < today).length;
  const runningCommand = commands.find((c) => c.taskId === running?.id) ?? null;

  // ---- 操作 ----
  async function pauseTask(task: DailyTask) {
    const closeAt = Date.now();
    const segments = task.segments.map((s, i) =>
      i === task.segments.length - 1 && s.end === undefined ? { ...s, end: closeAt } : s
    );
    const accumulatedMs = segments.reduce((sum, s) => sum + ((s.end ?? closeAt) - s.start), 0);
    await db.dailyTasks.update(task.id, { segments, status: "paused", accumulatedMs, stoppedAt: closeAt });
  }
  async function startTask(task: DailyTask) {
    if (running && running.id !== task.id) await pauseTask(running);
    await db.dailyTasks.update(task.id, {
      segments: [...task.segments, { start: Date.now() }],
      status: "running",
      startedAt: task.startedAt ?? Date.now(),
    });
  }

  // 追加系。想定時間の算出前には必ず実行中の作業を止めておく
  // (止めないと計測中の分がaccumulatedMsに乗らず、残り想定時間がずれる)
  async function insertTask(
    category: string,
    name: string,
    masterId: string,
    estimatedSeconds: number,
    startImmediately: boolean
  ) {
    await db.dailyTasks.add({
      id: uid(),
      date: today,
      order: tasks.length,
      masterTaskId: masterId,
      category,
      name,
      estimatedSeconds,
      status: startImmediately ? "running" : "pending",
      segments: startImmediately ? [{ start: Date.now() }] : [],
      accumulatedMs: 0,
      startedAt: startImmediately ? Date.now() : undefined,
      isSpontaneous: true,
    });
  }
  async function addFromMaster(master: MasterTask, startImmediately: boolean) {
    if (startImmediately && running) await pauseTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      today,
      master.category,
      master.name,
      master.estimatedSeconds
    );
    await insertTask(master.category, master.name, master.id, estimatedSeconds, startImmediately);
  }
  async function addFreeform(category: string, name: string, startImmediately: boolean) {
    const cat = category.trim();
    const nm = name.trim();
    if (!cat || !nm) return;
    if (startImmediately && running) await pauseTask(running);
    const master = await findOrCreateMasterTask(cat, nm, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, cat, nm, master.estimatedSeconds);
    await insertTask(cat, nm, master.id, estimatedSeconds, startImmediately);
  }
  function closePicker() {
    setShowPicker(false);
    setPickerTab("menu");
    setPickedMaster(null);
    setFreeCategory("");
    setFreeName("");
  }

  const plate =
    "w-full rounded-lg border border-white/40 px-3 py-2.5 text-sm font-bold text-white shadow-[0_2px_0_rgba(12,28,60,0.35)] transition active:translate-y-px";
  const plateAccent = plate;
  const plateQuiet =
    "w-full rounded-lg border border-cream/20 bg-panel px-3 py-2.5 text-sm font-bold text-cream/80 transition active:translate-y-px";

  return (
    <div className="space-y-2.5">
      {/* ══ ターン表示 ══ */}
      <div className="overflow-hidden rounded-xl border border-cream/15 shadow-[0_3px_0_rgba(12,28,60,0.18)]">
        <div
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
          style={accentPlate}
        >
          <div className="flex items-baseline gap-2">
            <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white">
              {W.screenTitle}
            </span>
            <span className="font-display text-sm font-black tabular-nums tracking-wide text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.35)]">
              {W.turnLabel(turn.year, turn.month, turn.weekOfMonth)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-white/85">
            <span className="tabular-nums">{W.usedTurns(turn.usedTurns)}</span>
            <span className="rounded bg-black/25 px-1.5 py-0.5 tabular-nums">{W.remainingTurns(turn.remainingTurns)}</span>
          </div>
        </div>
        {favoriteCategory && (
          <div className="flex items-center gap-1.5 bg-panel px-3 py-1.5 text-[11px] text-cream/65">
            <span className="rounded bg-[rgb(232,172,40)]/20 px-1.5 py-0.5 text-[10px] font-black text-[rgb(166,116,10)]">
              ★ {W.favoriteTrainingLabel}
            </span>
            <span className="truncate font-bold text-cream/80">{favoriteCategory}</span>
          </div>
        )}
      </div>

      {/* ══ 球場 + ゲージ ══ */}
      <div className="relative overflow-hidden rounded-xl border border-cream/15 shadow-[0_3px_0_rgba(12,28,60,0.18)]">
        <Stadium
          phase={skyPhaseOf(new Date(now).getHours())}
          motivation={condition.motivation}
          running={!!running}
          injured={condition.injuryRisk >= 0.6}
          hot={hot.filled}
          fever={hot.fever}
          doneCount={hot.done}
          totalCount={hot.total}
          seed={today}
        />
        {hot.fever && (
          <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-[rgb(232,172,40)] px-3 py-1 text-[11px] font-black text-white shadow-[0_2px_0_rgba(140,92,0,0.5)]">
            {W.feverLabel}
          </span>
        )}
        {/* ゲージ盤。球場の上に半透明で乗せる */}
        <div className="absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
          <GaugeRow
            label={W.staminaLabel}
            value={condition.staminaPercent / 100}
            color={[86, 186, 118]}
            danger={condition.staminaPercent <= 20}
            right={`${condition.staminaPercent}`}
            onInfo={() => setOpenReason(W.staminaNote(String(Math.round(condition.staminaSeconds / 60))))}
          />
          <GaugeRow
            label={W.motivationLabel}
            value={(condition.motivation + 1) / 5}
            color={MOTIVATION_COLOR[condition.motivation]}
            segments={5}
            right={W.motivationName(condition.motivation)}
            onInfo={() => setOpenReason(condition.motivationReason)}
          />
          <GaugeRow
            label={W.hotLabel}
            value={hot.filled}
            color={[226, 74, 60]}
            right={`${hot.done}/${hot.total}`}
            onInfo={() => setOpenReason(W.hotNote(hot.done, hot.total))}
          />
        </div>
      </div>

      {openReason && (
        <p className="rounded-lg border border-cream/15 bg-panel px-3 py-2 text-[11px] leading-relaxed text-cream/70">
          <span className="mr-1 font-bold text-cream/50">{W.basisLabel}:</span>
          {openReason}
          <button className="ml-2 text-cream/40 underline" onClick={() => setOpenReason(null)}>
            {W.closeLabel}
          </button>
        </p>
      )}

      {/* ══ 画面切り替え ══ */}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["training", W.panelTraining, commands.length],
            ["player", W.panelPlayer, undefined],
            ["scout", W.panelScout, overdueTodos || undefined],
          ] as const
        ).map(([key, label, badge]) => (
          <button
            key={key}
            onClick={() => setPanel(key)}
            style={panel === key ? accentPlate : undefined}
            className={`relative rounded-lg border px-2 py-2 text-xs font-black transition active:translate-y-px ${
              panel === key
                ? "border-white/40 text-white shadow-[0_2px_0_rgba(12,28,60,0.35)]"
                : "border-cream/15 bg-panel text-cream/55"
            }`}
          >
            {label}
            {badge !== undefined && badge > 0 && (
              <span className="absolute right-1 top-0.5 text-[9px] opacity-70">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ══ 練習中 ══ */}
      {panel === "training" && running && runningCommand && (
        <div className="overflow-hidden rounded-xl border-2 border-[rgb(226,74,60)]/60 bg-panel shadow-[0_3px_0_rgba(160,40,32,0.25)]">
          <div className="flex items-center gap-2 bg-gradient-to-b from-[rgb(232,88,72)] to-[rgb(196,44,38)] px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            <span className="text-[11px] font-black tracking-wider text-white">{W.nowTraining}</span>
            <span className="ml-auto text-[11px] font-bold text-white/85">
              {W.practiceName(runningCommand.kind)}
            </span>
          </div>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <PracticeIcon kind={runningCommand.kind} expKind={runningCommand.expKind} size={46} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-cream/50">{running.category}</p>
              <p className="truncate font-display text-sm font-black text-cream/90">{running.name}</p>
            </div>
            <p
              className="shrink-0 font-display font-black tabular-nums leading-none text-cream"
              style={{ fontSize: "clamp(1.4rem, 8vw, 2rem)" }}
            >
              {formatHms(Math.floor(runningCommand.elapsedSeconds))}
            </p>
          </div>
          <div className="px-3 pb-2">
            <Gauge
              value={Math.min(1, runningCommand.progress)}
              color={EXP_COLOR[runningCommand.expKind]}
              danger={runningCommand.overrunSeconds > 0}
              height={10}
            />
            <p className="mt-1 text-[10px] tabular-nums text-cream/45">
              {formatHms(Math.floor(runningCommand.elapsedSeconds))} / {formatHms(runningCommand.estimatedSeconds)}
            </p>
            {runningCommand.overrunSeconds > 0 && (
              <p className="mt-1 rounded border border-[rgb(226,74,60)]/40 bg-[rgb(226,74,60)]/10 px-2 py-1 text-[11px] font-bold text-[rgb(186,40,34)]">
                {W.overrunBadge}　{W.overrunNote(formatHms(Math.round(runningCommand.overrunSeconds)))}
              </p>
            )}
          </div>
          <div className="flex gap-1.5 border-t border-cream/10 p-2">
            <button className={plateAccent} style={accentPlate} onClick={() => finishDailyTask(running)}>
              {W.actionFinish}
            </button>
            <button className={plateQuiet} onClick={() => pauseTask(running)}>
              {W.actionPause}
            </button>
          </div>
        </div>
      )}

      {/* ══ 練習コマンド ══ */}
      {panel === "training" && (
        <div className="space-y-2">
          {commands.length === 0 ? (
            <p className="rounded-xl border border-cream/15 bg-panel p-6 text-center text-xs text-cream/55">
              {W.trainingEmpty}
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between px-1">
                <p className="text-[11px] font-black tracking-wider text-cream/60">{W.trainingTitle}</p>
                <p className="text-[11px] text-cream/45">{W.trainingHint}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {commands
                  .filter((c) => c.taskId !== running?.id)
                  .map((c) => (
                    <CommandPlate
                      key={c.taskId}
                      command={c}
                      words={W}
                      onStart={() => {
                        const t = tasks.find((x) => x.id === c.taskId);
                        if (t) startTask(t);
                      }}
                    />
                  ))}
              </div>
            </>
          )}
          <button className={plateAccent} style={accentPlate} onClick={() => setShowPicker(true)}>
            {W.actionPick}
          </button>
        </div>
      )}

      {/* ══ 選手データ ══ */}
      {panel === "player" && (
        <div className="space-y-2">
          {/* 選手カード */}
          <div className="relative overflow-hidden rounded-xl border border-cream/15 shadow-[0_3px_0_rgba(12,28,60,0.18)]">
            <CardBase rank={player.rank} seed={today} className="absolute inset-0" />
            <div className="relative flex items-center gap-3 px-3 py-3">
              <RankEmblem rank={player.rank} size={54} className="shrink-0 drop-shadow-[0_2px_3px_rgba(0,0,0,0.4)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] tracking-[0.2em] text-white/60">{W.playerRankLabel}</p>
                <p className="font-display text-2xl font-black leading-tight text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.4)]">
                  {player.rank}
                  {player.allA && (
                    <span className="ml-2 rounded bg-[rgb(236,196,72)] px-1.5 py-0.5 align-middle text-[10px] font-black text-[rgb(72,48,4)]">
                      {W.allALabel}
                    </span>
                  )}
                </p>
                <p className="text-[11px] tabular-nums text-white/60">
                  {W.playerTitle}　{player.total} / {ABILITY_KEYS.length * 150}
                </p>
              </div>
            </div>
          </div>

          {/* 六角形 + 能力値 */}
          <div className="rounded-xl border border-cream/15 bg-panel p-3 shadow-[0_2px_0_rgba(12,28,60,0.1)]">
            <AbilityHex
              values={abilities.map((a) => a.value)}
              labels={abilities.map((a) => W.abilityName(a.key))}
            />
            <div className="mt-1 space-y-1">
              {abilities.map((a) => (
                <button
                  key={a.key}
                  onClick={() => setOpenReason(a.reason)}
                  className="flex w-full items-center gap-2 border-b border-cream/10 py-1 text-left"
                >
                  <span className="w-24 shrink-0 truncate text-[11px] text-cream/55">{W.abilityName(a.key)}</span>
                  <span className="min-w-0 flex-1">
                    <Gauge value={a.value / 150} color={accent} height={8} />
                  </span>
                  <span className="w-9 shrink-0 text-right text-xs font-black tabular-nums text-cream/85">
                    {a.value}
                  </span>
                  <span
                    className="w-6 shrink-0 rounded text-center text-[11px] font-black text-white"
                    style={{ background: rankCssColor(a.rank) }}
                  >
                    {a.rank}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 経験点 */}
          <div className="rounded-xl border border-cream/15 bg-panel p-3 shadow-[0_2px_0_rgba(12,28,60,0.1)]">
            <p className="mb-2 text-[11px] font-black tracking-wider text-cream/60">{W.expTitle}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {experience.map((e) => (
                <button
                  key={e.kind}
                  onClick={() => setOpenReason(e.reason)}
                  className="rounded-lg border border-white/30 px-1 py-1.5 text-center shadow-[0_2px_0_rgba(12,28,60,0.2)]"
                  style={{
                    background: `linear-gradient(to bottom, ${css(EXP_COLOR[e.kind], 0.9)}, ${css(
                      EXP_COLOR[e.kind]
                    )})`,
                  }}
                >
                  <span className="block text-[10px] font-bold leading-tight text-white/85">{W.expName(e.kind)}</span>
                  <span className="block font-display text-base font-black leading-tight tabular-nums text-white">
                    {e.value}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 特殊能力 */}
          <div className="rounded-xl border border-cream/15 bg-panel p-3 shadow-[0_2px_0_rgba(12,28,60,0.1)]">
            <p className="mb-2 text-[11px] font-black tracking-wider text-cream/60">{W.specialTitle}</p>
            {specials.length === 0 ? (
              <p className="text-[11px] text-cream/45">{W.specialEmpty}</p>
            ) : (
              <ul className="space-y-1">
                {specials.map((s) => (
                  <li key={s.name} className="flex items-start gap-2">
                    <span
                      className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-black text-white shadow-[0_1px_0_rgba(12,28,60,0.25)]"
                      style={{
                        background: `linear-gradient(to bottom, ${css(SPECIAL_COLOR[s.color], 0.85)}, ${css(
                          SPECIAL_COLOR[s.color]
                        )})`,
                      }}
                    >
                      {wordingEnabled ? s.name : s.plainName}
                    </span>
                    <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-cream/55">{s.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ══ 評価(本日の成績) ══ */}
      {panel === "scout" && (
        <div className="space-y-2">
          <div className="rounded-xl border border-cream/15 bg-panel p-3 shadow-[0_2px_0_rgba(12,28,60,0.1)]">
            <p className="mb-2 text-[11px] font-black tracking-wider text-cream/60">{W.recordTitle}</p>
            <div className="grid grid-cols-3 gap-x-3 gap-y-2">
              {(
                [
                  [W.workedLabel, formatHms(Math.floor(condition.workedSeconds))],
                  [W.doneLabel, `${hot.done}件`],
                  [W.plannedLabel, `${hot.total}件`],
                  [W.streakLabel, `${streakDays}日`],
                  [W.overdueLabel, `${overdueTodos}件`],
                  [W.favoriteTrainingLabel, favoriteCategory ?? W.none],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="truncate text-[10px] tracking-wider text-cream/45">{label}</p>
                  <p className="truncate font-display text-sm font-black tabular-nums text-cream/85">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-cream/15 bg-panel p-3 shadow-[0_2px_0_rgba(12,28,60,0.1)]">
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="text-[11px] font-black tracking-wider text-cream/60">{W.injuryLabel}</p>
              <p className="text-xs font-black tabular-nums text-cream/80">
                {Math.round(condition.injuryRisk * 100)}%
              </p>
            </div>
            <Gauge
              value={condition.injuryRisk}
              color={[226, 74, 60]}
              danger={condition.injuryRisk >= 0.6}
              height={12}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-cream/50">{W.injuryNote}</p>
            <p className="mt-0.5 text-[11px] text-cream/45">
              <span className="mr-1 font-bold text-cream/40">{W.basisLabel}:</span>
              {condition.injuryReason}
            </p>
          </div>

          <div className="rounded-xl border border-cream/15 bg-panel p-3 shadow-[0_2px_0_rgba(12,28,60,0.1)]">
            <div className="mb-1.5 flex items-baseline justify-between">
              <p className="text-[11px] font-black tracking-wider text-cream/60">{W.motivationLabel}</p>
              <p className="text-xs font-black text-cream/80">{W.motivationName(condition.motivation)}</p>
            </div>
            <Gauge
              value={(condition.motivation + 1) / 5}
              color={MOTIVATION_COLOR[condition.motivation]}
              segments={5}
              height={12}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-cream/50">{condition.motivationReason}</p>
          </div>
        </div>
      )}

      {/* ══ 練習メニューの追加 ══ */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(10,20,44)]/55 p-4"
          onClick={closePicker}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/30 bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2" style={accentPlate}>
              <p className="font-display text-sm font-black text-white">{W.pickerTitle}</p>
            </div>

            {pickerTab === "menu" && (
              <div className="space-y-2 p-3">
                <p className="text-[11px] text-cream/50">{W.pickerMenuTitle}</p>
                <button className={plateAccent} style={accentPlate} onClick={() => setPickerTab("master")}>
                  {W.pickerOptMaster}
                </button>
                <button className={plateAccent} style={accentPlate} onClick={() => setPickerTab("favorite")}>
                  {W.pickerOptFavorite}
                </button>
                <button className={plateAccent} style={accentPlate} onClick={() => setPickerTab("free")}>
                  {W.pickerOptFree}
                </button>
                <button className={plateQuiet} onClick={closePicker}>
                  {W.closeLabel}
                </button>
              </div>
            )}

            {pickerTab === "master" && (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <MasterTaskPicker onSelect={setPickedMaster} selectedId={pickedMaster?.id ?? null} />
                </div>
                <div className="space-y-1.5 border-t border-cream/10 p-3">
                  <button
                    className={plateAccent + " disabled:opacity-40"}
                  style={accentPlate}
                    disabled={!pickedMaster}
                    onClick={async () => {
                      if (!pickedMaster) return;
                      await addFromMaster(pickedMaster, true);
                      closePicker();
                    }}
                  >
                    {W.actionStart}
                  </button>
                  <button
                    className={plateQuiet + " disabled:opacity-40"}
                    disabled={!pickedMaster}
                    onClick={async () => {
                      if (!pickedMaster) return;
                      await addFromMaster(pickedMaster, false);
                      closePicker();
                    }}
                  >
                    {W.actionPick}
                  </button>
                  <button className={plateQuiet} onClick={() => setPickerTab("menu")}>
                    {W.closeLabel}
                  </button>
                </div>
              </>
            )}

            {pickerTab === "favorite" && (
              <>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                  {favoriteMasters.length === 0 ? (
                    <p className="text-[11px] text-cream/50">{W.favoriteEmpty}</p>
                  ) : (
                    favoriteMasters.map((m) => (
                      <button
                        key={m.id}
                        className="flex w-full items-center gap-2 rounded-lg border border-cream/15 bg-ink px-2.5 py-2 text-left"
                        onClick={async () => {
                          await addFromMaster(m, true);
                          closePicker();
                        }}
                      >
                        <span className="text-[rgb(232,172,40)]">★</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] text-cream/45">{m.category}</span>
                          <span className="block truncate text-xs font-bold text-cream/85">{m.name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-cream/40">
                          {formatHms(m.estimatedSeconds)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-cream/10 p-3">
                  <button className={plateQuiet} onClick={() => setPickerTab("menu")}>
                    {W.closeLabel}
                  </button>
                </div>
              </>
            )}

            {pickerTab === "free" && (
              <div className="space-y-2 p-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-cream/50">{W.freeCategoryLabel}</span>
                  <input
                    className="w-full rounded-lg border border-cream/20 bg-ink px-2.5 py-2 text-sm text-cream"
                    value={freeCategory}
                    onChange={(e) => setFreeCategory(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-cream/50">{W.freeNameLabel}</span>
                  <input
                    className="w-full rounded-lg border border-cream/20 bg-ink px-2.5 py-2 text-sm text-cream"
                    value={freeName}
                    onChange={(e) => setFreeName(e.target.value)}
                  />
                </label>
                <button
                  className={plateAccent + " disabled:opacity-40"}
                  style={accentPlate}
                  disabled={!freeCategory.trim() || !freeName.trim()}
                  onClick={async () => {
                    await addFreeform(freeCategory, freeName, true);
                    closePicker();
                  }}
                >
                  {W.actionStart}
                </button>
                <button
                  className={plateQuiet + " disabled:opacity-40"}
                  disabled={!freeCategory.trim() || !freeName.trim()}
                  onClick={async () => {
                    await addFreeform(freeCategory, freeName, false);
                    closePicker();
                  }}
                >
                  {W.actionPick}
                </button>
                <button className={plateQuiet} onClick={() => setPickerTab("menu")}>
                  {W.closeLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 球場に重ねるゲージ1本ぶん。押すとその値の根拠が出る
function GaugeRow({
  label,
  value,
  color,
  segments = 0,
  danger = false,
  right,
  onInfo,
}: {
  label: string;
  value: number;
  color: Rgb;
  segments?: number;
  danger?: boolean;
  right: string;
  onInfo: () => void;
}) {
  return (
    <button onClick={onInfo} className="flex w-full items-center gap-2 text-left">
      <span className="w-16 shrink-0 text-[10px] font-black tracking-wider text-white/90 drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
        {label}
      </span>
      <span className="min-w-0 flex-1">
        <Gauge value={value} color={color} segments={segments} danger={danger} height={11} />
      </span>
      <span className="w-14 shrink-0 text-right text-[11px] font-black tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
        {right}
      </span>
    </button>
  );
}

// 練習コマンド1枚。サクセスのコマンド盤に倣い、アイコン・名前・入る経験点・進み具合を載せる
function CommandPlate({
  command,
  words,
  onStart,
}: {
  command: PracticeCommand;
  words: ReturnType<typeof powerproWordsFor>;
  onStart: () => void;
}) {
  const done = command.status === "done";
  const c = EXP_COLOR[command.expKind];
  return (
    <button
      onClick={done ? undefined : onStart}
      disabled={done}
      className={`overflow-hidden rounded-xl border text-left transition active:translate-y-px ${
        done
          ? "border-cream/10 bg-panel/60 opacity-60"
          : "border-white/40 shadow-[0_3px_0_rgba(12,28,60,0.28)] hover:brightness-105"
      }`}
      style={
        done
          ? undefined
          : { background: `linear-gradient(to bottom, ${css(c, 0.92)} 0%, ${css(c)} 55%, ${css(c, 0.82)} 100%)` }
      }
    >
      <div className="flex items-start gap-2 px-2 pb-1 pt-2">
        <PracticeIcon kind={command.kind} expKind={command.expKind} size={38} dim={done} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-[10px] ${done ? "text-cream/40" : "text-white/70"}`}>{command.category}</p>
          <p
            className={`line-clamp-2 text-xs font-black leading-tight ${done ? "text-cream/55" : "text-white drop-shadow-[0_1px_0_rgba(0,0,0,0.3)]"}`}
          >
            {command.name}
          </p>
        </div>
      </div>
      <div className="px-2 pb-2">
        <div className="flex flex-wrap items-center gap-1">
          <span
            className={`rounded px-1 py-0.5 text-[9px] font-black ${
              done ? "bg-cream/10 text-cream/45" : "bg-black/25 text-white"
            }`}
          >
            {words.expGainLabel(command.expGain, words.expName(command.expKind))}
          </span>
          {command.favorite && !done && (
            <span className="rounded bg-[rgb(232,172,40)] px-1 py-0.5 text-[9px] font-black text-[rgb(72,48,4)]">
              ★{words.favoriteBadge}
            </span>
          )}
          {command.status === "paused" && (
            <span className="rounded bg-white/85 px-1 py-0.5 text-[9px] font-black text-[rgb(24,54,110)]">
              {words.actionResume}
            </span>
          )}
        </div>
        {(command.elapsedSeconds > 0 || done) && (
          <p className={`mt-1 text-[10px] tabular-nums ${done ? "text-cream/45" : "text-white/80"}`}>
            {formatHms(Math.floor(command.elapsedSeconds))} / {formatHms(command.estimatedSeconds)}
            {command.overrunSeconds > 0 && (
              <span className={done ? "ml-1 text-[rgb(196,60,52)]" : "ml-1 text-[rgb(255,226,120)]"}>
                ⚠{words.overrunBadge}
              </span>
            )}
          </p>
        )}
      </div>
    </button>
  );
}
