"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, uid } from "@/lib/db";
import { computeRemainingEstimatedSeconds, finishDailyTask, segmentsAccumulatedMs } from "@/lib/tasks";
import { formatHms, formatMsClock, todayStr } from "@/lib/time";
import { computeStreakDays } from "@/lib/streak";
import { computeGrowthStage } from "@/lib/growth";
import { useSetting } from "@/lib/settings";
import { getRiskTier, riskBadgeClasses, riskBadgeLabel, useVisualMode } from "@/lib/theme";
import { buildKaiiIndex, erosionPercent, judgeRoute, phaseOf, type KaiiEntry } from "@/lib/hayarigami";
import { kaiiStatusLabel, wordsFor } from "@/lib/hayarigamiWords";
import MasterTaskPicker from "@/components/sections/MasterTaskPicker";
import SceneCanvas from "@/components/hayarigami/SceneCanvas";
import KaiiSilhouette from "@/components/hayarigami/KaiiSilhouette";
import CaseDiagram from "@/components/hayarigami/CaseDiagram";
import type { DailyTask, MasterTask, TodoTask } from "@/lib/types";

// 流行り神風モード(怪異調査モード)専用の「本日の作業」タブ。
// ホラーサウンドノベルの画面構成(暗闇の背景 + 下部のメッセージウィンドウ + 選択肢)を
// そのまま業務画面にしたもので、他モードと同じdailyTasks/todoTasks/records/masterTasksを扱う。
//
// 元ネタの肝である「オカルトか、科学か」の二択は、演出だけの飾りにはしていない。
// 想定時間を超えた作業に対して、
//   ・オカルト = 「これは怪異の仕業」→ その作業をトラブル対応(isTrouble)として記録する
//   ・科学     = 「見積もりが甘かった」→ 作業マスタの想定時間を実測値に書き換える
// という、このアプリに元からある2つの意味づけ(突発的な一件 / 恒常的な見積もり誤差)へ
// そのまま接続している。さらにその判定の蓄積が「ルート」として残り、
// 実績から組み上げた「怪異名鑑」がゲームの図鑑のように育っていく
type Screen = "main" | "index" | "files" | "rumors" | "record";

const NOMINAL_DAY_SECONDS = 8 * 3600;
const TYPE_INTERVAL_MS = 26;

function nowClock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}時${pad(d.getMinutes())}分`;
}

const DANGER_TEXT = ["text-cream/50", "text-cream/70", "text-alert/70", "text-alert", "text-alert"];

export default function HayarigamiSection() {
  const { themedMode, wordingEnabled } = useVisualMode();
  const mode = themedMode ?? "hayarigami";
  // 設定の「テーマに合わせた文言を使う」がオフなら、色・絵はこのモードのまま
  // 言葉づかいだけ工程表本来のものへ差し替える
  const W = wordsFor(wordingEnabled);
  const today = todayStr();

  const dailyTasks = useLiveQuery(() => db.dailyTasks.where("date").equals(today).toArray(), [today]);
  const todoTasks = useLiveQuery(() => db.todoTasks.toArray(), []);
  const records = useLiveQuery(() => db.records.toArray(), []);
  const masters = useLiveQuery(() => db.masterTasks.toArray(), []);
  const favoriteMasters = useMemo(() => (masters ?? []).filter((m) => m.isFavorite && !m.archived), [masters]);

  // 判定の履歴。実データの書き換え(isTrouble / 想定時間)は判定と同時に行われるが、
  // 「どちらの説を何回採ったか」自体はどこにも残らないため、この2つだけ設定に貯める
  const [occultStr, setOccultStr] = useSetting("hayarigami.occultCount", "0");
  const [scienceStr, setScienceStr] = useSetting("hayarigami.scienceCount", "0");
  const occultCount = Number(occultStr) || 0;
  const scienceCount = Number(scienceStr) || 0;
  const route = judgeRoute(occultCount, scienceCount, wordingEnabled);

  const [now, setNow] = useState(Date.now());
  const [screen, setScreen] = useState<Screen>("main");
  const [judgedIds, setJudgedIds] = useState<string[]>([]);
  const [lastJudgement, setLastJudgement] = useState<string | null>(null);
  const [openKaii, setOpenKaii] = useState<KaiiEntry | null>(null);
  // 名鑑(作業マスタ)から自由に選んで調査を始める/ファイルだけ用意するためのピッカー
  const [showPicker, setShowPicker] = useState(false);
  const [pickedMaster, setPickedMaster] = useState<MasterTask | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = useMemo(() => phaseOf(new Date(now), wordingEnabled), [Math.floor(now / 600000), wordingEnabled]); // 10分ごとに評価

  const tasks = dailyTasks ?? [];
  const running = tasks.find((t) => t.status === "running") ?? null;
  const pending = tasks.filter((t) => t.status === "pending" && !t.isProvisional);
  const paused = tasks.filter((t) => t.status === "paused");
  const done = tasks.filter((t) => t.status === "done");
  const openTodos = (todoTasks ?? []).filter((t) => !t.completed && !t.parentTaskId);
  const overdueTodos = openTodos.filter((t) => t.dueDate && t.dueDate < today);
  const myDayTodos = openTodos.filter((t) => t.myDayDate === today);

  const totalMsToday = tasks.reduce((sum, t) => sum + segmentsAccumulatedMs(t, now), 0);
  const streakDays = useMemo(() => computeStreakDays(records ?? [], today), [records, today]);
  const { stage: growthStage } = computeGrowthStage(mode, totalMsToday / 1000);

  // 侵蝕度: 本日の「想定からはみ出した時間」の割合。数値が高いほど画面も蝕まれる
  const erosion = useMemo(
    () =>
      erosionPercent(
        tasks.map((t) => ({ estimatedSeconds: t.estimatedSeconds, elapsedSeconds: segmentsAccumulatedMs(t, now) / 1000 }))
      ),
    [tasks, now]
  );

  const kaiiIndex = useMemo(() => buildKaiiIndex(masters ?? [], records ?? []), [masters, records]);
  const sealedCount = kaiiIndex.filter((k) => k.status === "鎮められた").length;

  const runningElapsedMs = running ? segmentsAccumulatedMs(running, now) : 0;
  const runningRatio = running && running.estimatedSeconds > 0 ? runningElapsedMs / 1000 / running.estimatedSeconds : 0;
  const runningTier = getRiskTier(runningRatio || 0, mode);
  const isOverrun = !!running && running.estimatedSeconds > 0 && runningRatio >= 1.3;
  const askJudgement = isOverrun && !!running && !judgedIds.includes(running.id) && !running.isTrouble;

  // 画面が「蝕まれている」条件: 深夜帯、または侵蝕度が高い、または今まさに強い超過中
  const corrupted = phase.corrupt || erosion >= 60 || runningTier.level >= 3;

  // 一枚絵(背景)の種と濃さ。調査中の作業があればその作業名、無ければ日付と時間帯で決まるため、
  // 同じ案件を開けば毎回同じ景色が出る。濃さは侵蝕度と今の危険度の高い方を採る
  const sceneSeed = running ? `${running.category}/${running.name}` : `${today}:${phase.phase}`;
  const sceneIntensity = Math.max(erosion / 100, runningTier.level / 4);

  // ---- 語り(メッセージウィンドウ本文) ----
  const { narration, narrationKey } = useMemo(() => {
    const clock = nowClock();
    if (lastJudgement) return { narration: lastJudgement, narrationKey: `judged:${lastJudgement}` };

    if (screen === "index") {
      const top = kaiiIndex[0];
      return {
        narration: W.narration.index(
          kaiiIndex.length,
          sealedCount,
          top ? (wordingEnabled ? top.displayName : top.realName) : ""
        ),
        narrationKey: `index:${kaiiIndex.length}:${sealedCount}:${kaiiIndex[0]?.key ?? "-"}`,
      };
    }
    if (screen === "files") {
      return {
        narration: W.narration.files(tasks.length, done.length, pending.length, paused.length),
        narrationKey: `files:${tasks.length}:${done.length}:${pending.length}:${paused.length}`,
      };
    }
    if (screen === "rumors") {
      return {
        narration: W.narration.rumors(overdueTodos.length, myDayTodos.length),
        narrationKey: `rumors:${overdueTodos.length}:${myDayTodos.length}`,
      };
    }
    if (screen === "record") {
      return {
        narration: W.narration.record(
          streakDays,
          formatHms(Math.floor(totalMsToday / 1000)),
          erosion,
          growthStage.label,
          route.description
        ),
        narrationKey: `record:${streakDays}:${erosion}:${growthStage.label}:${route.route}`,
      };
    }

    // ---- 調査画面 ----
    if (running) {
      if (running.estimatedSeconds <= 0) {
        return {
          narration: W.narration.runningNoEstimate(clock, running.category, running.name),
          narrationKey: `run-noest:${running.id}`,
        };
      }
      const tail = wordingEnabled && phase.corrupt && runningTier.level >= 2 ? `……${phase.label}に、これはよくない。` : "";
      return {
        narration: W.narration.running(
          clock,
          running.category,
          running.name,
          formatHms(running.estimatedSeconds),
          W.commentary(runningRatio),
          tail
        ),
        narrationKey: `run:${running.id}:${runningTier.level}:${phase.phase}`,
      };
    }
    if (paused.length > 0) {
      return {
        narration: W.narration.paused(paused[0].category, paused[0].name),
        narrationKey: `paused:${paused[0].id}`,
      };
    }
    if (pending.length > 0) {
      return {
        narration: W.narration.pending(clock, phase.flavor, pending.length),
        narrationKey: `pending:${pending.length}:${phase.phase}`,
      };
    }
    if (done.length > 0) {
      return {
        narration: W.narration.allDone(done.length, streakDays, erosion),
        narrationKey: `alldone:${done.length}:${streakDays}:${erosion}`,
      };
    }
    return {
      narration: W.narration.idle(clock, phase.flavor),
      narrationKey: `idle:${phase.phase}`,
    };
  }, [
    lastJudgement,
    screen,
    running,
    runningRatio,
    runningTier.level,
    tasks.length,
    done.length,
    pending.length,
    paused,
    overdueTodos.length,
    myDayTodos.length,
    streakDays,
    totalMsToday,
    growthStage.label,
    erosion,
    route.description,
    route.route,
    kaiiIndex,
    sealedCount,
    phase,
    W,
    wordingEnabled,
  ]);

  // ---- タイプライター表示(句読点と三点リーダーで「間」を取る) ----
  const [typedCount, setTypedCount] = useState(0);
  useEffect(() => {
    setTypedCount(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      i += 1;
      setTypedCount(i);
      if (i >= narration.length) return;
      const ch = narration[i - 1];
      const delay = ch === "…" ? 150 : ch === "。" ? 110 : ch === "、" ? 70 : TYPE_INTERVAL_MS;
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, TYPE_INTERVAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationKey, narration]);
  const typedDone = typedCount >= narration.length;

  // ---- 作業の操作 ----
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
    await db.dailyTasks.update(task.id, { segments: [...task.segments, { start: Date.now() }], status: "running" });
    setLastJudgement(null);
  }
  async function completeTask(task: DailyTask) {
    await finishDailyTask(task);
    setLastJudgement(W.narration.completed(task.name));
  }
  // 名鑑(作業マスタ)から本日のファイルを起こす。startImmediately=falseなら未着手のまま積むだけ。
  // 想定時間は他タブと同じ計算(同じ作業を既にこなした分を差し引いた残り)に揃える
  async function addFromMaster(master: MasterTask, startImmediately: boolean) {
    if (startImmediately && running) await pauseTask(running);
    const estimatedSeconds = await computeRemainingEstimatedSeconds(
      today,
      master.category,
      master.name,
      master.estimatedSeconds
    );
    await db.dailyTasks.add({
      id: uid(),
      date: today,
      order: tasks.length,
      masterTaskId: master.id,
      category: master.category,
      name: master.name,
      estimatedSeconds,
      status: startImmediately ? "running" : "pending",
      segments: startImmediately ? [{ start: Date.now() }] : [],
      accumulatedMs: 0,
      startedAt: startImmediately ? Date.now() : undefined,
      isSpontaneous: true,
    });
    setLastJudgement(startImmediately ? null : W.narration.queued(master.name));
  }

  // ---- オカルト / 科学 の二択(どちらも実データを書き換える) ----
  async function judgeOccult(task: DailyTask) {
    await db.dailyTasks.update(task.id, { isTrouble: true });
    setJudgedIds((prev) => [...prev, task.id]);
    setOccultStr(String(occultCount + 1));
    setLastJudgement(W.narration.judgedOccult(occultCount + 1));
  }
  async function judgeScience(task: DailyTask) {
    const actualSeconds = Math.max(1, Math.round(segmentsAccumulatedMs(task, Date.now()) / 1000));
    await db.dailyTasks.update(task.id, { estimatedSeconds: actualSeconds });
    if (task.masterTaskId) {
      await db.masterTasks.update(task.masterTaskId, { estimatedSeconds: actualSeconds, updatedAt: Date.now() });
    }
    setJudgedIds((prev) => [...prev, task.id]);
    setScienceStr(String(scienceCount + 1));
    setLastJudgement(W.narration.judgedScience(formatHms(actualSeconds), !!task.masterTaskId));
  }

  const choiceClass =
    "w-full rounded-sm border border-cream/25 bg-black/40 px-3 py-2 text-left text-sm text-cream transition hover:border-alert hover:bg-alert/10 hover:text-alert";

  return (
    <div className="space-y-3">
      {/* ── 上段: 現在開いているファイル ── */}
      <div
        className={`relative overflow-hidden rounded-sm border p-4 ${
          corrupted ? "hyr-corrupt border-alert/40" : "border-cream/15"
        } ${runningTier.level >= 4 && !!running ? "hyr-shake" : ""}`}
        style={{
          minHeight: "15.5rem",
          backgroundImage:
            "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.10) 0%, transparent 62%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
        }}
      >
        <SceneCanvas
          seed={sceneSeed}
          intensity={sceneIntensity}
          night={phase.corrupt}
          className="pointer-events-none absolute inset-0"
        />
        {/* 文字が沈まないよう、一枚絵の上に暗幕を1枚敷く */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-black/10 to-black/70" />
        <div className="relative">
        <div className="mb-3 flex items-center justify-between text-[10px] tracking-[0.3em] text-cream/40">
          <span>{W.fileHeader}</span>
          <span>
            {phase.label}／{today.replace(/-/g, ".")}
          </span>
        </div>

        {screen === "main" && (
          <div className="space-y-3">
            {running ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] tracking-[0.25em] text-cream/40">
                    {W.fileNoPrefix}
                    {done.length + 1}
                  </span>
                  {running.estimatedSeconds > 0 && (
                    <span className={riskBadgeClasses(runningTier.level, mode)}>{riskBadgeLabel(runningTier, mode)}</span>
                  )}
                  {running.isTrouble && (
                    <span className="rounded-sm border border-alert/60 px-1.5 py-0.5 text-[10px] text-alert">{W.troubleBadge}</span>
                  )}
                </div>
                <p className="mt-2 font-display text-xl font-bold text-cream">{running.name}</p>
                <p className="text-xs text-cream/45">{running.category}</p>
                <p className="mt-3 font-display text-3xl font-bold tabular-nums text-alert">{formatMsClock(runningElapsedMs)}</p>
                <p className="text-[11px] tabular-nums text-cream/40">
                  想定 {running.estimatedSeconds > 0 ? formatHms(running.estimatedSeconds) : W.noEstimate}
                  {running.estimatedSeconds > 0 && ` ／ 到達率 ${Math.round(runningRatio * 100)}%`}
                </p>
                {running.estimatedSeconds > 0 && (
                  <div className="mt-2 h-1 w-full overflow-hidden bg-cream/10">
                    <div className="h-1 bg-alert transition-[width]" style={{ width: `${Math.min(100, runningRatio * 100)}%` }} />
                  </div>
                )}
              </div>
            ) : (
              <div className="py-6 text-center">
                <p className="text-4xl">{growthStage.icon}</p>
                <p className="mt-2 text-sm text-cream/50">{W.noRunning}</p>
                <p className="text-[11px] text-cream/30">
                  {W.stagePrefix}: {growthStage.label}
                </p>
              </div>
            )}
          </div>
        )}

        {screen === "index" && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {kaiiIndex.length === 0 && (
              <p className="text-sm text-cream/40">{W.indexEmpty}</p>
            )}
            {kaiiIndex.slice(0, 40).map((k) => (
              <button
                key={k.key}
                onClick={() => setOpenKaii(k)}
                className="flex w-full items-center gap-2 border-l-2 border-cream/25 bg-black/30 px-2 py-1.5 text-left text-xs hover:border-alert hover:bg-alert/10"
              >
                <KaiiSilhouette
                  seed={k.displayName}
                  size={34}
                  dangerLevel={k.dangerLevel}
                  className="shrink-0 rounded-sm border border-cream/15"
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className={`${DANGER_TEXT[k.dangerLevel]} font-bold`}>
                    {wordingEnabled ? k.displayName : k.realName}
                  </span>
                  <span className="ml-1.5 text-[10px] text-cream/35">{kaiiStatusLabel(k.status, wordingEnabled)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-cream/45">×{k.encounterCount}</span>
              </button>
            ))}
          </div>
        )}

        {screen === "files" && (
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {tasks.length === 0 && <p className="text-sm text-cream/40">{W.filesEmpty}</p>}
            {tasks.length > 0 && (
              <CaseDiagram
                className="overflow-hidden rounded-sm border border-cream/10"
                height={186}
                centerLabel={`本日 ${done.length}/${tasks.length}`}
                seed={`${today}:${tasks.length}`}
                nodes={tasks.slice(0, 8).map((t) => {
                  const el = segmentsAccumulatedMs(t, now) / 1000;
                  const ratio = t.estimatedSeconds > 0 ? el / t.estimatedSeconds : 0;
                  return { label: t.name, level: getRiskTier(ratio, mode).level, done: t.status === "done" };
                })}
              />
            )}
            {tasks.map((t, i) => {
              const elapsed = segmentsAccumulatedMs(t, now);
              const ratio = t.estimatedSeconds > 0 ? elapsed / 1000 / t.estimatedSeconds : 0;
              return (
                <div
                  key={t.id}
                  className={`flex items-center justify-between gap-2 border-l-2 bg-black/30 px-2 py-1.5 text-xs ${
                    t.status === "done" ? "border-cream/20 opacity-50" : ratio >= 1.3 ? "border-alert" : "border-cream/30"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-cream/80">
                    <span className="mr-1.5 text-[10px] text-cream/30">No.{i + 1}</span>
                    {t.name}
                    {t.isTrouble && <span className="ml-1 text-alert">［{W.troubleBadge}］</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-cream/50">{formatMsClock(elapsed)}</span>
                  <span className="shrink-0 text-[10px] text-cream/35">
                    {t.status === "done"
                      ? W.statusDone
                      : t.status === "running"
                        ? W.statusRunning
                        : t.status === "paused"
                          ? W.statusPaused
                          : W.statusPending}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {screen === "rumors" && (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
            {overdueTodos.length === 0 && myDayTodos.length === 0 && (
              <p className="text-sm text-cream/40">{W.rumorsEmpty}</p>
            )}
            {overdueTodos.map((t: TodoTask) => (
              <div key={t.id} className="border-l-2 border-alert bg-black/30 px-2 py-1.5 text-xs">
                <span className="text-cream/80">{t.title}</span>
                <span className="ml-2 text-[10px] text-alert">期限 {t.dueDate} を過ぎている</span>
              </div>
            ))}
            {myDayTodos.map((t: TodoTask) => (
              <div key={t.id} className="border-l-2 border-cream/25 bg-black/30 px-2 py-1.5 text-xs text-cream/70">
                {t.title}
              </div>
            ))}
          </div>
        )}

        {screen === "record" && (
          <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
            <div>
              <div className="flex items-center justify-between text-[10px] text-cream/40">
                <span>{W.erosionLabel}</span>
                <span className="tabular-nums">{erosion}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden bg-cream/10">
                <div className="h-1.5 bg-alert transition-[width]" style={{ width: `${erosion}%` }} />
              </div>
            </div>
            <div className="border border-alert/30 bg-black/40 px-2 py-2">
              <p className="text-[10px] tracking-[0.2em] text-cream/40">{W.routeTitle}</p>
              <p className="font-display text-base font-bold text-alert">{route.label}</p>
              <p className="mt-0.5 text-[10px] text-cream/50">
                {W.occultCountLabel} {occultCount}回 ／ {W.scienceCountLabel} {scienceCount}回
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                { label: W.statStreak, value: `${streakDays}日` },
                { label: W.statToday, value: formatHms(Math.floor(totalMsToday / 1000)) },
                { label: W.statSolved, value: `${done.length}件` },
                { label: W.statIndexed, value: `${kaiiIndex.length}件` },
                { label: W.statSealed, value: `${sealedCount}件` },
                { label: W.statLoad, value: `${Math.round((totalMsToday / 1000 / NOMINAL_DAY_SECONDS) * 100)}%` },
              ].map((s) => (
                <div key={s.label} className="border border-cream/10 bg-black/30 px-2 py-2">
                  <p className="text-[10px] tracking-wider text-cream/40">{s.label}</p>
                  <p className="font-display text-lg font-bold tabular-nums text-cream">{s.value}</p>
                </div>
              ))}
            </div>
            {tasks.length > 0 && done.length === tasks.length && (
              <div className="border border-alert/40 bg-alert/5 px-2 py-2">
                <p className="text-[10px] tracking-[0.2em] text-alert">{W.reportTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-cream/75">
                  {W.reportBody(tasks.length, erosion, formatHms(Math.floor(totalMsToday / 1000)), route.label)}
                </p>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* ── メッセージウィンドウ ── */}
      <div
        className="cursor-pointer rounded-sm border border-cream/25 bg-black/70 p-4"
        style={{ minHeight: "6.5rem" }}
        onClick={() => setTypedCount(narration.length)}
      >
        <p className="text-sm leading-relaxed tracking-wide text-cream/90">
          {narration.slice(0, typedCount)}
          {!typedDone && <span className="text-alert">▊</span>}
        </p>
        {typedDone && <p className="mt-2 text-right text-xs text-alert">▼</p>}
      </div>

      {/* ── 選択肢 ── */}
      <div className="space-y-2">
        {askJudgement && running && (
          <div className="space-y-2 rounded-sm border border-alert/50 bg-alert/5 p-3">
            <p className="text-center text-xs tracking-[0.2em] text-alert">{W.judgeTitle}</p>
            <button className={choiceClass} onClick={() => judgeOccult(running)}>
              <span className="mr-2 text-alert">{W.occultTag}</span>
              {W.occultChoice}
            </button>
            <button className={choiceClass} onClick={() => judgeScience(running)}>
              <span className="mr-2 text-alert">{W.scienceTag}</span>
              {W.scienceChoice}
            </button>
            <p className="text-center text-[10px] text-cream/35">{W.judgeNote}</p>
          </div>
        )}

        {screen === "main" && (
          <>
            {running ? (
              <>
                <button className={choiceClass} onClick={() => completeTask(running)}>
                  {W.completeChoice}
                </button>
                <button className={choiceClass} onClick={() => pauseTask(running)}>
                  {W.pauseChoice}
                </button>
              </>
            ) : (
              <>
                {paused.map((t) => (
                  <button key={t.id} className={choiceClass} onClick={() => startTask(t)}>
                    {W.resumeChoice(t.name)}
                  </button>
                ))}
                {pending.slice(0, 4).map((t) => (
                  <button key={t.id} className={choiceClass} onClick={() => startTask(t)}>
                    {W.openChoice(t.name)}
                  </button>
                ))}
                {favoriteMasters.slice(0, 3).map((m) => (
                  <button key={m.id} className={choiceClass} onClick={() => addFromMaster(m, true)}>
                    {W.newChoice(m.name)}
                  </button>
                ))}
                {paused.length === 0 && pending.length === 0 && favoriteMasters.length === 0 && (
                  <p className="px-1 text-xs text-cream/35">{W.noStartHint}</p>
                )}
              </>
            )}
            <button className={choiceClass} onClick={() => setShowPicker(true)}>
              {W.pickerChoice}
            </button>
          </>
        )}

        <div className="grid grid-cols-5 gap-1 pt-1">
          {(
            [
              { key: "main", label: W.screens.main },
              { key: "index", label: `${W.screens.index}${kaiiIndex.length > 0 ? `(${kaiiIndex.length})` : ""}` },
              { key: "files", label: W.screens.files },
              { key: "rumors", label: `${W.screens.rumors}${overdueTodos.length > 0 ? `(${overdueTodos.length})` : ""}` },
              { key: "record", label: W.screens.record },
            ] as { key: Screen; label: string }[]
          ).map((s) => (
            <button
              key={s.key}
              onClick={() => {
                setScreen(s.key);
                setLastJudgement(null);
              }}
              className={`rounded-sm border px-1 py-1.5 text-[11px] transition ${
                screen === s.key
                  ? "border-alert bg-alert/15 text-alert"
                  : "border-cream/20 bg-black/30 text-cream/60 hover:border-cream/40"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 名鑑(作業マスタ)から選ぶ ── */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => {
            setShowPicker(false);
            setPickedMaster(null);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-sm border border-alert/40 bg-ink p-4"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.12) 0%, transparent 65%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
            }}
          >
            <p className="shrink-0 text-[10px] tracking-[0.3em] text-cream/40">{W.pickerTitle}</p>
            <p className="mb-2 shrink-0 text-xs text-cream/50">{W.pickerDesc}</p>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <MasterTaskPicker selectedId={pickedMaster?.id} onSelect={setPickedMaster} />
            </div>
            <div className="mt-3 shrink-0 space-y-2">
              <button
                className={choiceClass + " disabled:opacity-40"}
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await addFromMaster(pickedMaster, true);
                  setPickedMaster(null);
                  setShowPicker(false);
                }}
              >
                {W.pickerStart}
              </button>
              <button
                className={choiceClass + " disabled:opacity-40"}
                disabled={!pickedMaster}
                onClick={async () => {
                  if (!pickedMaster) return;
                  await addFromMaster(pickedMaster, false);
                  setPickedMaster(null);
                  setShowPicker(false);
                }}
              >
                {W.pickerQueue}
              </button>
              <button
                className="w-full rounded-sm border border-cream/25 py-2 text-xs text-cream/70"
                onClick={() => {
                  setShowPicker(false);
                  setPickedMaster(null);
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 怪異の詳細(名鑑を開いた時) ── */}
      {openKaii && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpenKaii(null)}
        >
          <div
            className="w-full max-w-sm rounded-sm border border-alert/40 bg-ink p-4"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundImage:
                "radial-gradient(ellipse at 50% 0%, rgb(var(--accent-rgb) / 0.12) 0%, transparent 65%), linear-gradient(180deg, rgb(var(--panel-rgb)) 0%, rgb(var(--ink-rgb)) 100%)",
            }}
          >
            <p className="text-[10px] tracking-[0.3em] text-cream/40">{W.detailHeader}</p>
            <div className="mt-1 flex items-start gap-3">
              <KaiiSilhouette
                seed={openKaii.displayName}
                size={92}
                dangerLevel={openKaii.dangerLevel}
                className="shrink-0 rounded-sm border border-cream/20"
              />
              <div className="min-w-0">
                <p className={`font-display text-lg font-bold leading-snug ${DANGER_TEXT[openKaii.dangerLevel]}`}>
                  {wordingEnabled ? openKaii.displayName : openKaii.realName}
                </p>
                <p className="text-[11px] text-cream/40">
                  {openKaii.category} / {openKaii.realName}
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-cream/70">
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">{W.detailStatus}</span>
                <span>{kaiiStatusLabel(openKaii.status, wordingEnabled)}</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">{W.detailCount}</span>
                <span className="tabular-nums">{openKaii.encounterCount}回</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">{W.detailAvg}</span>
                <span className="tabular-nums">{formatHms(Math.round(openKaii.avgSeconds))}</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">{W.detailMax}</span>
                <span className="tabular-nums">{formatHms(Math.round(openKaii.maxSeconds))}</span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">{W.detailRatio}</span>
                <span className="tabular-nums">
                  {openKaii.avgRatio > 0 ? `${Math.round(openKaii.avgRatio * 100)}%` : W.noEstimate}
                </span>
              </div>
              <div className="flex justify-between border-b border-cream/10 pb-1">
                <span className="text-cream/40">{W.detailTrouble}</span>
                <span className="tabular-nums">{openKaii.troubleCount}回</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cream/40">{W.detailLastSeen}</span>
                <span className="tabular-nums">{openKaii.lastSeenDate}</span>
              </div>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-cream/35">
              {W.detailNote}
            </p>
            <button className="mt-3 w-full rounded-sm border border-cream/25 py-2 text-xs text-cream/70" onClick={() => setOpenKaii(null)}>
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
