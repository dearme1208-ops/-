"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeRemainingEstimatedSeconds, finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { findOrCreateMasterTask } from "@/lib/master";
import { computeStreakDays } from "@/lib/streak";
import { formatHms, todayStr } from "@/lib/time";
import { useDraftSetting } from "@/lib/settings";
import { useVisualMode } from "@/lib/theme";
import {
  buildBugCage,
  buildDiary,
  buildMonthCalendar,
  buildMorningGlory,
  buildStampCard,
  daysLeftInMonth,
  phaseOf,
  weatherOf,
  type Bug,
} from "@/lib/natsuyasumi";
import { natsuWordsFor } from "@/lib/natsuyasumiWords";
import { DiaryPicture, Insect, RuledPaper, Scenery, StampCard } from "@/components/natsuyasumi/NatsuCanvas";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import type { DailyTask, MasterTask } from "@/lib/types";

// ぼくのなつやすみ風モードの「本日の作業」タブ。
//
// これまでこのモードは配色と小さな装飾(ちょうちょ・ホタル)だけで、画面の作りは通常と同じだった。
// ここでは原作の一日の構造そのものに置き換えている。
//
//   ・一枚絵   = 朝/昼/夕方/夜で描き替わる風景。原作と同じく時間で絵が変わる
//   ・ラジオ体操カード = 連続記録日数のぶんだけ判子が押される
//   ・朝顔     = 本日の実働時間で伸び、完了した数だけ花が咲く
//   ・むしかご = 実績のある作業マスタが虫として並ぶ
//   ・えにっき = その日いちばん時間を使った作業を、絵と文で残す
//
// 数字はすべて実データそのもの。演出のための乱数は絵の揺らぎにしか使っていない。

const WEEKDAY = ["にち", "げつ", "か", "すい", "もく", "きん", "ど"];
const WEEKDAY_PLAIN = ["日", "月", "火", "水", "木", "金", "土"];

type Panel = "today" | "cage" | "calendar";
type PickerTab = "menu" | "master" | "favorite" | "free";

export default function NatsuyasumiSection() {
  const { wordingEnabled } = useVisualMode();
  const W = natsuWordsFor(wordingEnabled);
  const today = todayStr();
  const month = today.slice(0, 7);

  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [panel, setPanel] = useState<Panel>("today");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>("menu");
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);
  const [freeCategory, setFreeCategory] = useState("");
  const [freeName, setFreeName] = useState("");
  const [openBugId, setOpenBugId] = useState<string | null>(null);
  // 絵日記の一言。日付ごとに保存する
  const [diaryNote, setDiaryNote] = useDraftSetting(`natsuyasumi.diary.${today}`, "");

  const tasks = useMemo(() => (dailyTasks ?? []).filter((t) => !t.isProvisional), [dailyTasks]);
  const elapsedSecondsOf = useMemo(() => (t: DailyTask) => segmentsAccumulatedMs(t, now) / 1000, [now]);
  const running = tasks.find((t) => t.status === "running") ?? null;

  const phase = useMemo(() => phaseOf(new Date(now)), [Math.floor(now / 60000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const weather = useMemo(
    () => weatherOf(tasks.map((t) => ({ estimatedSeconds: t.estimatedSeconds, elapsedSeconds: elapsedSecondsOf(t) }))),
    [tasks, elapsedSecondsOf]
  );
  const workedSeconds = tasks.reduce((s, t) => s + elapsedSecondsOf(t), 0);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const stampCard = useMemo(
    () => buildStampCard(streakDays, workedSeconds > 0),
    [streakDays, workedSeconds > 0] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const glory = useMemo(() => buildMorningGlory(workedSeconds, doneCount), [workedSeconds, doneCount]);
  const bugs = useMemo(
    () => buildBugCage(masters ?? [], records ?? [], tasks, today),
    [masters, records, tasks, today]
  );
  const diary = useMemo(
    () => buildDiary(today, tasks, elapsedSecondsOf, weather.weather, wordingEnabled),
    [today, tasks, elapsedSecondsOf, weather.weather, wordingEnabled]
  );
  const calendar = useMemo(() => buildMonthCalendar(month, records ?? [], today), [month, records, today]);
  const favoriteMasters = useMemo(() => (masters ?? []).filter((m) => m.isFavorite && !m.archived), [masters]);

  const d = new Date(today + "T00:00:00");
  const weekday = (wordingEnabled ? WEEKDAY : WEEKDAY_PLAIN)[d.getDay()];
  const caughtToday = bugs.filter((b) => b.caughtToday).length;
  const openBug = bugs.find((b) => b.masterId === openBugId) ?? null;

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
  async function insertTask(category: string, name: string, masterId: string, estimatedSeconds: number, startNow: boolean) {
    await db.dailyTasks.add({
      id: uid(),
      date: today,
      order: tasks.length,
      masterTaskId: masterId,
      category,
      name,
      estimatedSeconds,
      status: startNow ? "running" : "pending",
      segments: startNow ? [{ start: Date.now() }] : [],
      accumulatedMs: 0,
      startedAt: startNow ? Date.now() : undefined,
      isSpontaneous: true,
    });
  }
  // 想定時間の算出前には必ず実行中の作業を止める。止めないと計測中の分が
  // accumulatedMsに乗らず、残りの想定時間がずれてしまう
  async function addFromMaster(master: MasterTask, startNow: boolean) {
    if (startNow && running) await pauseTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, master.category, master.name, master.estimatedSeconds);
    await insertTask(master.category, master.name, master.id, estimatedSeconds, startNow);
  }
  async function addFreeform(category: string, name: string, startNow: boolean) {
    const cat = category.trim();
    const nm = name.trim();
    if (!cat || !nm) return;
    if (startNow && running) await pauseTask(running);
    const master = await findOrCreateMasterTask(cat, nm, 0);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(today, cat, nm, master.estimatedSeconds);
    await insertTask(cat, nm, master.id, estimatedSeconds, startNow);
  }
  function closePicker() {
    setShowPicker(false);
    setPickerTab("menu");
    setPickedMaster(null);
    setFreeCategory("");
    setFreeName("");
  }

  // 画用紙のような面。このモードの器はどれもこの質感で統一する
  const card =
    "rounded-2xl border border-[rgb(var(--nat-leaf-rgb)/0.28)] bg-panel shadow-[0_2px_10px_-4px_rgba(60,44,20,0.25)]";
  const btn =
    "rounded-full border border-[rgb(var(--nat-leaf-rgb)/0.5)] bg-[rgb(var(--nat-leaf-rgb)/0.12)] px-3.5 py-1.5 text-xs font-bold text-cream transition active:translate-y-px";
  const btnSun =
    "rounded-full border border-[rgb(var(--nat-sun-rgb)/0.6)] bg-[rgb(var(--nat-sun-rgb)/0.22)] px-3.5 py-1.5 text-xs font-bold text-cream transition active:translate-y-px";

  return (
    <div className="space-y-3">
      {/* ══ 一枚絵 ══ */}
      <div className={`overflow-hidden ${card}`}>
        <Scenery
          phase={phase.phase}
          weather={weather.weather}
          blooms={glory.blooms}
          growth={glory.growth}
          caught={caughtToday}
          seed={today}
        />
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-base font-bold text-cream">
              {W.dateLine(d.getMonth() + 1, d.getDate(), weekday)}
            </span>
            <span className="rounded-full bg-[rgb(var(--nat-sun-rgb)/0.25)] px-2 py-0.5 text-[10px] font-bold text-cream/80">
              {W.phaseName(phase.phase)}
            </span>
            <span className="rounded-full bg-[rgb(var(--nat-sea-rgb)/0.22)] px-2 py-0.5 text-[10px] font-bold text-cream/80">
              {W.weatherName(weather.weather)}
            </span>
          </div>
          <span className="text-[11px] text-cream/45">{W.daysLeft(daysLeftInMonth(today))}</span>
        </div>
        <p className="border-t border-[rgb(var(--nat-leaf-rgb)/0.18)] px-4 py-2 text-[12px] leading-relaxed text-cream/55">
          {W.phaseNote(phase.phase)}
          <span className="ml-1 text-cream/35">
            {W.weatherNote}（{weather.reason}）
          </span>
        </p>
      </div>

      {/* ══ 画面切り替え ══ */}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ["today", W.panelToday, tasks.length],
            ["cage", W.panelCage, bugs.length],
            ["calendar", W.panelCalendar, undefined],
          ] as const
        ).map(([key, label, badge]) => (
          <button
            key={key}
            onClick={() => setPanel(key)}
            className={`relative rounded-full border px-2 py-2 text-xs font-bold transition active:translate-y-px ${
              panel === key
                ? "border-[rgb(var(--nat-sun-rgb))] bg-[rgb(var(--nat-sun-rgb)/0.3)] text-cream"
                : "border-[rgb(var(--nat-leaf-rgb)/0.3)] bg-panel text-cream/50"
            }`}
          >
            {label}
            {badge !== undefined && badge > 0 && (
              <span className="absolute right-2 top-1 text-[9px] text-cream/40">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {panel === "today" && (
        <>
          {/* ══ ラジオ体操カード ══ */}
          <div className={`overflow-hidden ${card}`}>
            <StampCard stamps={stampCard.stamps} title={W.stampTitle} seed={today} />
            <p className="border-t border-[rgb(var(--nat-leaf-rgb)/0.18)] px-4 py-2 text-[12px] text-cream/55">
              {W.stampNote(stampCard.streak, stampCard.cardNumber)}
              <span className="ml-2 text-cream/35">{stampCard.filledToday ? W.stampDone : W.stampTodo}</span>
            </p>
          </div>

          {/* ══ 朝顔 ══ */}
          <div className={`${card} px-4 py-3`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-bold tracking-wider text-cream/50">{W.vineTitle}</p>
              <p className="font-display text-sm font-bold tabular-nums text-cream/85">
                {formatHms(Math.floor(workedSeconds))}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgb(var(--nat-leaf-rgb)/0.15)]">
              <div
                className="h-full rounded-full bg-[rgb(var(--nat-leaf-rgb))] transition-[width] duration-700"
                style={{ width: `${Math.round(glory.growth * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-cream/45">
              {W.vineNote(formatHms(Math.floor(workedSeconds)), glory.blooms)}
            </p>
          </div>

          {/* ══ いま やっていること ══ */}
          {running && (
            <div className={`${card} overflow-hidden`}>
              <div className="flex items-center gap-2 bg-[rgb(var(--nat-sun-rgb)/0.22)] px-4 py-1.5">
                <span className="nat-firefly inline-flex h-1.5 w-1.5 rounded-full bg-[rgb(var(--nat-sun-rgb))]" aria-hidden />
                <span className="text-[11px] font-bold tracking-wider text-cream/80">{W.runningLabel}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] text-cream/45">{running.category}</p>
                  <p className="truncate font-display text-base font-bold text-cream">{running.name}</p>
                </div>
                <p className="shrink-0 font-display text-2xl font-bold tabular-nums text-cream">
                  {formatHms(Math.floor(elapsedSecondsOf(running)))}
                </p>
              </div>
              <div className="flex gap-2 border-t border-[rgb(var(--nat-leaf-rgb)/0.18)] px-4 py-2.5">
                <button className={btnSun} onClick={() => finishDailyTask(running)}>
                  {W.actionDone}
                </button>
                <button className={btn} onClick={() => pauseTask(running)}>
                  {W.actionRelease}
                </button>
              </div>
            </div>
          )}

          {/* ══ きょう やること ══ */}
          <div className={`${card} px-4 py-3`}>
            <p className="text-[11px] font-bold tracking-wider text-cream/50">{W.todayTitle}</p>
            {tasks.filter((t) => t.id !== running?.id).length === 0 ? (
              <p className="mt-2 text-[12px] text-cream/40">{W.todayEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {tasks
                  .filter((t) => t.id !== running?.id)
                  .map((t) => {
                    const elapsed = elapsedSecondsOf(t);
                    const over = t.estimatedSeconds > 0 && elapsed > t.estimatedSeconds;
                    const done = t.status === "done";
                    return (
                      <li
                        key={t.id}
                        className={`flex items-center gap-2.5 rounded-xl border border-[rgb(var(--nat-leaf-rgb)/0.2)] px-3 py-2 ${
                          done ? "opacity-55" : ""
                        }`}
                      >
                        <Insect
                          species={
                            bugs.find((b) => b.masterId === t.masterTaskId)?.species ??
                            (t.estimatedSeconds >= 2 * 3600 ? "kuwagata" : "batta")
                          }
                          scale={Math.min(1, Math.max(0.15, t.estimatedSeconds / (4 * 3600)))}
                          rarity={0}
                          size={34}
                          dim={done}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[10px] text-cream/40">{t.category}</p>
                          <p className={`truncate text-sm text-cream/85 ${done ? "line-through" : ""}`}>{t.name}</p>
                          {(elapsed > 0 || done) && (
                            <p className="text-[10px] tabular-nums text-cream/40">
                              {formatHms(Math.floor(elapsed))} / {formatHms(t.estimatedSeconds)}
                              {over && <span className="ml-1 text-alert">{W.overrunLabel}</span>}
                            </p>
                          )}
                        </div>
                        {!done && (
                          <button className={btn + " shrink-0"} onClick={() => startTask(t)}>
                            {t.status === "paused" ? W.actionResume : W.actionCatch}
                          </button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
            <button className={btnSun + " mt-3 w-full"} onClick={() => setShowPicker(true)}>
              {W.actionPick}
            </button>
          </div>

          {/* ══ えにっき ══ */}
          <div className={`overflow-hidden ${card}`}>
            <p className="px-4 pt-3 text-[11px] font-bold tracking-wider text-cream/50">{W.diaryTitle}</p>
            <div className="px-4 pb-1 pt-2">
              <DiaryPicture
                seed={diary.topic ? `${diary.topic.category}/${diary.topic.name}` : today}
                phase={phase.phase}
                weather={weather.weather}
                blooms={glory.blooms}
                className="overflow-hidden rounded-lg border border-[rgb(var(--nat-leaf-rgb)/0.3)]"
              />
            </div>
            <div className="relative mx-4 mb-3 mt-2 overflow-hidden rounded-lg border border-[rgb(var(--nat-leaf-rgb)/0.3)]">
              <RuledPaper lineHeight={26} className="absolute inset-0" />
              <p className="relative px-8 py-2 text-[13px] leading-[26px] text-[rgb(52,44,34)]">{diary.body}</p>
            </div>
            <div className="px-4 pb-3">
              <label className="mb-1 block text-[10px] tracking-wider text-cream/40">{W.diaryNoteLabel}</label>
              <textarea
                value={diaryNote}
                onChange={(e) => setDiaryNote(e.target.value)}
                placeholder={W.diaryPlaceholder}
                rows={2}
                className="w-full rounded-lg border border-[rgb(var(--nat-leaf-rgb)/0.3)] bg-ink px-3 py-2 text-sm text-cream"
              />
            </div>
          </div>
        </>
      )}

      {/* ══ むしかご ══ */}
      {panel === "cage" && (
        <div className={`${card} px-4 py-3`}>
          <p className="text-[11px] font-bold tracking-wider text-cream/50">{W.cageTitle}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-cream/40">{W.cageNote}</p>
          {bugs.length === 0 ? (
            <p className="mt-3 text-[12px] text-cream/40">{W.cageEmpty}</p>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {bugs.map((b) => (
                <button
                  key={b.masterId}
                  onClick={() => setOpenBugId(b.masterId)}
                  className="flex flex-col items-center gap-1 rounded-xl border border-[rgb(var(--nat-leaf-rgb)/0.25)] bg-[rgb(var(--nat-leaf-rgb)/0.06)] px-1 py-2"
                >
                  <Insect species={b.species} scale={b.size} rarity={b.rarity} size={52} />
                  <span className="w-full truncate px-1 text-center text-[10px] text-cream/70">{b.name}</span>
                  {b.caughtToday && (
                    <span className="rounded-full bg-[rgb(var(--nat-sun-rgb)/0.3)] px-1.5 text-[9px] text-cream/80">
                      {W.caughtTodayLabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ カレンダー ══ */}
      {panel === "calendar" && (
        <div className={`${card} px-4 py-3`}>
          <p className="text-[11px] font-bold tracking-wider text-cream/50">{W.calendarTitle}</p>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {(wordingEnabled ? WEEKDAY : WEEKDAY_PLAIN).map((wd) => (
              <div key={wd} className="text-center text-[10px] text-cream/35">
                {wd}
              </div>
            ))}
            {Array.from({ length: calendar[0]?.weekday ?? 0 }, (_, i) => (
              <div key={`pad${i}`} />
            ))}
            {calendar.map((day) => {
              const hours = day.seconds / 3600;
              const level = day.seconds === 0 ? 0 : Math.min(4, Math.ceil(hours / 2));
              return (
                <div
                  key={day.date}
                  title={day.seconds > 0 ? `${day.date} ${formatHms(day.seconds)}` : day.date}
                  className={`flex aspect-square flex-col items-center justify-center rounded-md border text-[11px] tabular-nums ${
                    day.isToday
                      ? "border-[rgb(var(--nat-sun-rgb))] font-bold text-cream"
                      : "border-transparent text-cream/60"
                  } ${day.isFuture ? "opacity-35" : ""}`}
                  style={
                    level > 0
                      ? { background: `rgb(var(--nat-leaf-rgb) / ${0.14 + level * 0.16})` }
                      : { background: "rgb(var(--nat-leaf-rgb) / 0.05)" }
                  }
                >
                  {day.day}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-cream/40">{W.calendarNote}</p>
        </div>
      )}

      {/* ══ 虫の詳細 ══ */}
      {openBug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenBugId(null)}>
          <div
            className={`w-full max-w-sm overflow-hidden ${card}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[rgb(var(--nat-leaf-rgb)/0.2)] px-4 py-3">
              <Insect species={openBug.species} scale={openBug.size} rarity={openBug.rarity} size={64} className="shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-cream/45">{W.speciesName(openBug.species)}</p>
                <p className="truncate font-display text-base font-bold text-cream">{openBug.name}</p>
                <p className="text-[11px] text-cream/45">
                  {openBug.category}・{W.rarityName(openBug.rarity)}
                </p>
              </div>
            </div>
            <dl className="space-y-1 px-4 py-3 text-[12px]">
              {(
                [
                  [W.sizeLabel, formatHms(Math.round(openBug.size * 4 * 3600))],
                  [W.countLabel, `${openBug.count}`],
                  [W.lastSeenLabel, openBug.lastSeenDate ?? "—"],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex gap-3 border-b border-[rgb(var(--nat-leaf-rgb)/0.14)] pb-1">
                  <dt className="w-28 shrink-0 text-cream/45">{label}</dt>
                  <dd className="min-w-0 flex-1 tabular-nums text-cream/80">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="px-4 pb-3">
              <button className={btn + " w-full"} onClick={() => setOpenBugId(null)}>
                {W.closeLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ やることを ふやす ══ */}
      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closePicker}>
          <div
            className={`flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden ${card}`}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="bg-[rgb(var(--nat-sun-rgb)/0.22)] px-4 py-2 font-display text-sm font-bold text-cream">
              {W.pickerTitle}
            </p>

            {pickerTab === "menu" && (
              <div className="space-y-2 p-4">
                <p className="text-[11px] text-cream/45">{W.pickerMenu}</p>
                <button className={btnSun + " w-full"} onClick={() => setPickerTab("master")}>
                  {W.pickerMaster}
                </button>
                <button className={btnSun + " w-full"} onClick={() => setPickerTab("favorite")}>
                  {W.pickerFavorite}
                </button>
                <button className={btnSun + " w-full"} onClick={() => setPickerTab("free")}>
                  {W.pickerFree}
                </button>
                <button className={btn + " w-full"} onClick={closePicker}>
                  {W.closeLabel}
                </button>
              </div>
            )}

            {pickerTab === "master" && (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <MasterTaskPicker onSelect={setPickedMaster} selectedId={pickedMaster?.id ?? null} />
                </div>
                <div className="space-y-2 border-t border-[rgb(var(--nat-leaf-rgb)/0.2)] p-4">
                  <button
                    className={btnSun + " w-full disabled:opacity-40"}
                    disabled={!pickedMaster}
                    onClick={async () => {
                      if (!pickedMaster) return;
                      await addFromMaster(pickedMaster, true);
                      closePicker();
                    }}
                  >
                    {W.actionCatch}
                  </button>
                  <button
                    className={btn + " w-full disabled:opacity-40"}
                    disabled={!pickedMaster}
                    onClick={async () => {
                      if (!pickedMaster) return;
                      await addFromMaster(pickedMaster, false);
                      closePicker();
                    }}
                  >
                    {W.actionPick}
                  </button>
                  <button className={btn + " w-full"} onClick={() => setPickerTab("menu")}>
                    {W.closeLabel}
                  </button>
                </div>
              </>
            )}

            {pickerTab === "favorite" && (
              <>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
                  {favoriteMasters.length === 0 ? (
                    <p className="text-[12px] text-cream/45">{W.favoriteEmpty}</p>
                  ) : (
                    favoriteMasters.map((m) => (
                      <button
                        key={m.id}
                        className="flex w-full items-center gap-2 rounded-xl border border-[rgb(var(--nat-leaf-rgb)/0.25)] px-3 py-2 text-left"
                        onClick={async () => {
                          await addFromMaster(m, true);
                          closePicker();
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] text-cream/40">{m.category}</span>
                          <span className="block truncate text-sm text-cream/85">{m.name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-cream/40">
                          {formatHms(m.estimatedSeconds)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-[rgb(var(--nat-leaf-rgb)/0.2)] p-4">
                  <button className={btn + " w-full"} onClick={() => setPickerTab("menu")}>
                    {W.closeLabel}
                  </button>
                </div>
              </>
            )}

            {pickerTab === "free" && (
              <div className="space-y-2 p-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-cream/45">{W.freeCategoryLabel}</span>
                  <input
                    className="w-full rounded-lg border border-[rgb(var(--nat-leaf-rgb)/0.3)] bg-ink px-3 py-2 text-sm text-cream"
                    value={freeCategory}
                    onChange={(e) => setFreeCategory(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-cream/45">{W.freeNameLabel}</span>
                  <input
                    className="w-full rounded-lg border border-[rgb(var(--nat-leaf-rgb)/0.3)] bg-ink px-3 py-2 text-sm text-cream"
                    value={freeName}
                    onChange={(e) => setFreeName(e.target.value)}
                  />
                </label>
                <button
                  className={btnSun + " w-full disabled:opacity-40"}
                  disabled={!freeCategory.trim() || !freeName.trim()}
                  onClick={async () => {
                    await addFreeform(freeCategory, freeName, true);
                    closePicker();
                  }}
                >
                  {W.actionCatch}
                </button>
                <button className={btn + " w-full"} onClick={() => setPickerTab("menu")}>
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

export type { Bug };
